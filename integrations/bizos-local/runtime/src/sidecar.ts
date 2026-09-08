import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { LocalBizosHarness } from "./harness/harness.js";
import { waitForCliShutdown } from "./harness/procs.js";
import {
  targetForThreadId,
  threadIdForTarget,
  type AskAnswer,
  type Bot,
  type Group,
  type MessageBlock,
  type Run,
  type ThreadMessage,
  type ThreadSnapshot,
  type ThreadTarget,
} from "./harness/types.js";
import { buildHandlers, runHandler } from "./ipc.js";
import type { RuntimeSettings, Routine } from "./harness/types.js";
import type { PublicPlan } from "./harness/plan-types.js";
import {
  emptyDurableIndex,
  LOCAL_BACKEND_CAPABILITIES,
  LOCAL_PROVIDERS,
  normalizeDurableIndex,
  type DurableIndex,
  type AgentManagementResult,
  type LocalTeamEvent,
  type RecruitmentResult,
} from "./sidecar-contract.js";
import { acquireStateLock, readStrictJson, repairStateLock } from "./sidecar-state.js";
import { LOCAL_TEAM_TOOL_SPECS } from "./local-team-mcp.js";
import { AgencyError, AgencyService, hostFromHarness, type AgencyState } from "./harness/agency.js";
import { isAgencyToolName } from "./harness/agency-tools.js";
import { publicRoutine, publicRoutineRun, routineVersion, triggerFromToolInput, type PublicRoutine, type PublicRoutineRun } from "./routines-public.js";
import { pairingAdminRoute } from "./mobile/admin-routes.js";
import { createMobileBackend } from "./mobile/backend.js";
import { RelayConnector } from "./mobile/connector.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_ROOT_VARIABLE = "LOCALBIZOS_SIDECAR_STATE";
const defaultStateRoot = resolve(join(homedir(), "Library", "Application Support", "BizOS-local-harness"));
const stateRoot = resolve(process.env[STATE_ROOT_VARIABLE] ?? defaultStateRoot);
const descriptorPath = resolve(
  process.env.LOCALBIZOS_SIDECAR_DESCRIPTOR
    ?? join(homedir(), "Library", "Application Support", "BizOS-desktop", "local-harness.json"),
);
const harnessRoot = join(stateRoot, "runtime");
const instancePath = join(stateRoot, "instance.json");
const indexPath = join(stateRoot, "collaboration-index.json");
const logPath = join(stateRoot, "sidecar.log");
const lockPath = join(stateRoot, "sidecar.lock");
const action = process.argv[2] ?? "status";
const MAX_BODY_BYTES = 64 * 1024;

interface Descriptor {
  version: 1;
  origin: string;
  token: string;
  instanceId: string;
  pid: number;
}

interface CollaborationMessage {
  deliveryState?: "complete";
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  senderType: "human" | "agent";
  senderUserId: string | null;
  senderAgentId: string | null;
  senderName: string;
  clientMessageId: string | null;
  runId: string | null;
  replyToMessageId: string | null;
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function privateWrite(path: string, value: string): void {
  privateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function instanceId(): string {
  const existing = readStrictJson<{ version?: unknown; instanceId?: unknown }>(instancePath, "instance.json");
  if (existing?.version === 1 && typeof existing.instanceId === "string" && existing.instanceId) {
    return existing.instanceId;
  }
  if (existing) throw new Error("instance.json has an invalid shape; refusing to replace durable identity");
  const value = randomUUID();
  privateWrite(instancePath, `${JSON.stringify({ version: 1, instanceId: value })}\n`);
  return value;
}

function readDescriptor(): Descriptor | null {
  const value = readStrictJson<Partial<Descriptor>>(descriptorPath, "local-harness.json");
  if (value === null) return null;
  if (value.version !== 1 || typeof value.origin !== "string" || typeof value.token !== "string"
    || typeof value.instanceId !== "string" || typeof value.pid !== "number") {
    throw new Error("local-harness.json has an invalid shape; refusing to replace runtime credentials");
  }
  return value as Descriptor;
}

function durableIndex(): DurableIndex {
  const value = readStrictJson<unknown>(indexPath, "collaboration-index.json");
  return value === null ? emptyDurableIndex() : normalizeDurableIndex(value);
}

function saveIndex(value: DurableIndex): void {
  privateWrite(indexPath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeHarnessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "COLORTERM", "PATH",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

function secureEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function objectBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_payload", "A JSON object is required.");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !keys.includes(key));
  if (unknown) throw new HttpError(400, "invalid_payload", `Unknown field: ${unknown}.`);
  return record;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_payload", `${field} must be a non-empty string.`);
  }
  if (value.length > max) throw new HttpError(400, "invalid_payload", `${field} is too long.`);
  return value.trim();
}

/** The second brain's refusals, as statuses: everything else stays 400. */
const BRAIN_ERROR_STATUS: Record<string, number | undefined> = {
  not_found: 404,
  read_only: 403,
  exists: 409,
};

const BRAIN_OPEN_MODES: readonly string[] = ["reveal", "default", "obsidian"];

/** A folder inside a vault: `""` and an absent field both mean the vault's
 * own root, which is why this is not `requiredString`. */
function vaultPath(value: unknown, field: string): string {
  if (value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, "invalid_payload", `${field} must be a string.`);
  if (value.length > 1024) throw new HttpError(400, "invalid_payload", `${field} is too long.`);
  return value;
}

function stringList(value: unknown, field: string, max = 64): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item)) {
    throw new HttpError(400, "invalid_payload", `${field} must be a bounded string array.`);
  }
  return [...new Set(value as string[])];
}

function uuid(value: unknown, field: string): string {
  const text = requiredString(value, field, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(400, "invalid_payload", `${field} must be a UUID.`);
  }
  return text;
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large", "Request body is too large.");
    chunks.push(bytes);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "A valid JSON object is required.");
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

function requestError(response: ServerResponse, error: unknown): void {
  const failure = error instanceof HttpError
    ? error
    : new HttpError(500, "local_runtime_error", error instanceof Error ? error.message : String(error));
  sendJson(response, failure.status, { error: { code: failure.code, message: failure.message.slice(0, 500) } });
}

function routeId(pathname: string, pattern: RegExp): string | null {
  const match = pathname.match(pattern);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function processCommand(pid: number): string {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function descriptorProcessIsOurs(descriptor: Descriptor): boolean {
  if (!Number.isInteger(descriptor.pid) || descriptor.pid <= 1) return false;
  try { process.kill(descriptor.pid, 0); } catch { return false; }
  const command = processCommand(descriptor.pid);
  return command.includes(basename(fileURLToPath(import.meta.url))) && command.includes("serve");
}

function processEnvironment(pid: number): string {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-wwwE", "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

// A generic `sidecar.js serve` is not enough to authorise a signal: the process
// must serve *this* state root. An explicit override must match exactly, and an
// unset override only matches when we ourselves run on the default state root.
export function environmentDeclaresStateRoot(
  environment: string,
  expected: string,
  fallback: string,
): boolean {
  if (!environment) return false;
  const marker = `${STATE_ROOT_VARIABLE}=`;
  const at = environment.indexOf(` ${marker}`);
  if (at < 0) return expected === fallback;
  const value = environment.slice(at + marker.length + 1);
  const end = value.indexOf(" ");
  return resolve(end < 0 ? value : value.slice(0, end)) === expected;
}

export type ProcessIdentity = "ours" | "absent" | "unknown";

// Three outcomes, never two: a PID that still runs a sidecar `serve` but cannot
// prove it is this instance is *unknown*, not gone. Collapsing it into "absent"
// is what let `stop` report a live process as down.
export function resolveProcessIdentity(probe: {
  readonly runsOurServeCommand: boolean;
  readonly descriptorMatches: boolean;
  readonly provesInstance: boolean;
}): ProcessIdentity {
  if (!probe.runsOurServeCommand) return "absent";
  if (!probe.descriptorMatches || !probe.provesInstance) return "unknown";
  return "ours";
}

// Ownership for the direct-PID fallback: the live process must still match the
// descriptor we read, and must prove it is this instance either by declaring
// our state root or by answering the authenticated health check with our
// instanceId. PID reuse and stale descriptors fail both proofs.
async function identifyDescriptorProcess(descriptor: Descriptor): Promise<ProcessIdentity> {
  const current = readDescriptor();
  const descriptorMatches = Boolean(current)
    && current!.pid === descriptor.pid
    && current!.instanceId === descriptor.instanceId;
  const candidate = descriptorMatches ? current! : descriptor;
  const runsOurServeCommand = descriptorProcessIsOurs(candidate);
  const provesInstance = runsOurServeCommand && descriptorMatches
    && (environmentDeclaresStateRoot(processEnvironment(candidate.pid), stateRoot, defaultStateRoot)
      || await descriptorHealthy(candidate));
  return resolveProcessIdentity({ runsOurServeCommand, descriptorMatches, provesInstance });
}

export function signalProcessGroup(
  pid: number,
  kill: (pid: number, signal: NodeJS.Signals) => boolean = process.kill,
): boolean {
  try {
    kill(-pid, "SIGTERM");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

// A foreground `serve` is alive without leading its own process group, so an
// absent group says nothing about the process itself. Signal the PID alone,
// never a group we do not own, and keep EPERM fatal.
export function signalProcess(
  pid: number,
  kill: (pid: number, signal: NodeJS.Signals) => boolean = process.kill,
): boolean {
  try {
    kill(pid, "SIGTERM");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function descriptorHealthy(descriptor: Descriptor): Promise<boolean> {
  if (!descriptorProcessIsOurs(descriptor)) return false;
  try {
    const url = new URL("/api/local/health", descriptor.origin);
    if (url.hostname !== "127.0.0.1") return false;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${descriptor.token}` },
      signal: AbortSignal.timeout(1_500),
    });
    const body = await response.json() as { ok?: unknown; instanceId?: unknown };
    return response.ok && body.ok === true && body.instanceId === descriptor.instanceId;
  } catch {
    return false;
  }
}

function textOf(blocks: readonly MessageBlock[]): string {
  return blocks.flatMap((block) => {
    if (block.kind === "text" || block.kind === "meta") return [block.text];
    if (block.kind === "card") return [[block.title, block.body].filter(Boolean).join("\n")];
    if (block.kind === "ask") return [block.summary];
    if (block.kind === "progress") return [[block.phase, block.detail].filter(Boolean).join(": ")];
    return [];
  }).filter(Boolean).join("\n\n").slice(0, 20_000);
}

interface TeamCapability {
  botId: string;
  threadId: string;
  runId: string;
  expiresAt: number;
}

/** `GET /api/local/agency` — the desktop contract for the agency pack. */
export interface AgencyStatus {
  installed: boolean;
  status: "not-installed" | "installing" | "ready" | "error";
  template: { id: string; name: string; version: number };
  dashboardUrl: string | null;
  bots: Array<{ id: string; name: string; slug: string; threadId: string }>;
  teamThreadId: string | null;
  skillsCount: number;
  error?: string;
}

export class LocalTeamBroker {
  private readonly tickets = new Map<string, TeamCapability>();
  private readonly sessions = new Map<string, TeamCapability>();

  issue(input: Omit<TeamCapability, "expiresAt">): string {
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(ticket, { ...input, expiresAt: Date.now() + 20 * 60_000 });
    return ticket;
  }

  exchange(ticket: string): string {
    const capability = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!capability || capability.expiresAt <= Date.now()) throw new HttpError(401, "invalid_team_capability", "Local team capability is invalid or expired.");
    const session = randomBytes(32).toString("base64url");
    this.sessions.set(session, capability);
    return session;
  }

  revoke(runId: string): void {
    for (const [token, capability] of this.tickets) if (capability.runId === runId) this.tickets.delete(token);
    for (const [token, capability] of this.sessions) if (capability.runId === runId) this.sessions.delete(token);
  }

  authorize(session: string): TeamCapability {
    const capability = this.sessions.get(session);
    if (!capability || capability.expiresAt <= Date.now()) {
      this.sessions.delete(session);
      throw new HttpError(401, "invalid_team_capability", "Local team capability is invalid or expired.");
    }
    return capability;
  }
}

export class CollaborationFacade {
  private readonly handlers;
  private mutationTail: Promise<unknown> = Promise.resolve();
  readonly userId: string;
  readonly workspaceId: string;

  constructor(
    private readonly harness: LocalBizosHarness,
    readonly instanceId: string,
    private readonly teamBroker: LocalTeamBroker,
    private readonly index: DurableIndex = durableIndex(),
    private readonly agency: AgencyService | null = null,
  ) {
    this.handlers = buildHandlers(harness);
    this.userId = `local:${instanceId}:user`;
    this.workspaceId = `local:${instanceId}:workspace`;
  }

  private async invoke<T>(channel: string, args: unknown[] = []): Promise<T> {
    const handler = this.handlers[channel];
    if (!handler) throw new HttpError(404, "not_found", "Local operation not found.");
    const envelope = await runHandler(handler, args);
    if (!envelope.ok) throw new HttpError(400, envelope.error.code, envelope.error.message);
    return envelope.value as T;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(work, work);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private agentId(botId: string): string {
    return `local:${this.instanceId}:agent:${botId}`;
  }

  private internalAgentId(agentId: string): string {
    const prefix = `local:${this.instanceId}:agent:`;
    if (!agentId.startsWith(prefix) || !agentId.slice(prefix.length)) {
      throw new HttpError(422, "invalid_agent_target", "Agent is not in this local workspace.");
    }
    return agentId.slice(prefix.length);
  }

  private publicThreadId(target: ThreadTarget): string {
    return `local:${this.instanceId}:thread:${threadIdForTarget(target)}`;
  }

  private target(threadId: string): ThreadTarget {
    const prefix = `local:${this.instanceId}:thread:`;
    const target = threadId.startsWith(prefix) ? targetForThreadId(threadId.slice(prefix.length)) : null;
    if (!target) throw new HttpError(404, "not_found", "Thread not found.");
    return target;
  }

  private messageId(messageId: string): string {
    return `local:${this.instanceId}:message:${messageId}`;
  }

  private internalMessageId(messageId: string): string {
    const prefix = `local:${this.instanceId}:message:`;
    if (!messageId.startsWith(prefix) || !messageId.slice(prefix.length)) {
      throw new HttpError(400, "invalid_cursor", "Message cursor is invalid.");
    }
    return messageId.slice(prefix.length);
  }

  private runId(runId: string): string {
    return `local:${this.instanceId}:run:${runId}`;
  }

  private internalRunId(runId: string): string {
    const prefix = `local:${this.instanceId}:run:`;
    if (!runId.startsWith(prefix) || !runId.slice(prefix.length)) {
      throw new HttpError(404, "not_found", "Run not found.");
    }
    return runId.slice(prefix.length);
  }

  private slug(bot: Bot): string {
    const readable = bot.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "agent";
    return `${readable}-${bot.id.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 40);
  }

  private agent(bot: Bot) {
    return { agentId: this.agentId(bot.id), slug: this.slug(bot), name: bot.name, title: bot.title ?? null };
  }

  private clientIdForMessage(messageId: string): string | null {
    return Object.entries(this.index.messages)
      .find(([, value]) => value.state === "completed" && value.messageId === messageId)?.[0] ?? null;
  }

  private message(message: ThreadMessage, target: ThreadTarget, bots: readonly Bot[]): CollaborationMessage | null {
    const publicBlocks = message.deliveryState === "control"
      ? message.blocks.filter(block => block.kind === "meta") : message.blocks;
    if (message.role === "system" || (message.deliveryState === "control" && !textOf(publicBlocks))) return null;
    const publicThreadId = this.publicThreadId(target);
    const botId = message.botId ?? ("botId" in target ? target.botId : undefined);
    const bot = botId ? bots.find((candidate) => candidate.id === botId) : undefined;
    return {
      id: this.messageId(message.id),
      threadId: publicThreadId,
      role: message.role === "user" ? "user" : "assistant",
      content: textOf(publicBlocks),
      ...(message.deliveryState === "complete" ? { deliveryState: "complete" as const } : {}),
      createdAt: message.createdAt,
      senderType: message.role === "user" ? "human" : "agent",
      senderUserId: message.role === "user" ? this.userId : null,
      senderAgentId: message.role === "bot" && botId ? this.agentId(botId) : null,
      senderName: message.role === "user" ? "Local owner" : bot?.name ?? "Local agent",
      clientMessageId: this.clientIdForMessage(message.id),
      runId: message.runId ? this.runId(message.runId) : null,
      replyToMessageId: message.replyToMessageId ? this.messageId(message.replyToMessageId) : null,
    };
  }

  private async thread(target: ThreadTarget, bots: readonly Bot[], groups: readonly Group[]) {
    const snapshot = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
    let messages = snapshot.messages.map((message) => this.message(message, target, bots)).filter((value): value is CollaborationMessage => value !== null);
    let cursor = snapshot.olderCursor;
    while (!messages.length && cursor) {
      const page = await this.invoke<{ messages: ThreadMessage[]; olderCursor: string | null }>("lbz:threads:messages", [target, cursor]);
      messages = page.messages.map(message => this.message(message, target, bots)).filter((value): value is CollaborationMessage => value !== null);
      cursor = page.olderCursor;
    }
    if ("botId" in target) {
      const bot = bots.find((candidate) => candidate.id === target.botId);
      if (!bot) throw new HttpError(404, "not_found", "Thread not found.");
      return {
        id: this.publicThreadId(target), kind: "agent" as const, name: bot.name,
        updatedAt: snapshot.updatedAt, humanUserIds: [this.userId], agentIds: [this.agentId(bot.id)],
        canPost: true, canManage: true, lastMessage: messages.at(-1) ?? null,
      };
    }
    const group = groups.find((candidate) => candidate.id === target.groupId);
    if (!group) throw new HttpError(404, "not_found", "Thread not found.");
    return {
      id: this.publicThreadId(target), kind: "group" as const, name: group.name,
      updatedAt: snapshot.updatedAt, humanUserIds: [this.userId], agentIds: group.memberIds.map((id) => this.agentId(id)),
      canPost: true, canManage: true, lastMessage: messages.at(-1) ?? null,
    };
  }

  async bootstrap() {
    const [bots, groups, plans, settings] = await Promise.all([
      this.invoke<Bot[]>("lbz:bots:list"),
      this.invoke<Group[]>("lbz:groups:list"),
      this.invoke<PublicPlan[]>("lbz:plans:list"),
      this.invoke<RuntimeSettings>("lbz:runtime:getSettings"),
    ]);
    const visibleBots = bots.filter((bot) => !bot.archived);
    const visibleGroups = groups.filter((group) => !group.archived);
    const threads = await Promise.all([
      ...visibleBots.map((bot) => this.thread({ botId: bot.id }, visibleBots, visibleGroups)),
      ...visibleGroups.map((group) => this.thread({ groupId: group.id }, visibleBots, visibleGroups)),
    ]);
    return {
      contractVersion: 1 as const,
      backend: {
        mode: "local" as const,
        instanceId: this.instanceId,
        workspaceId: this.workspaceId,
        persistence: "device" as const,
        runtime: "byo-cli" as const,
        cloudOrgId: null,
      },
      session: { userId: this.userId, workspaceId: this.workspaceId, access: "owner" as const },
      capabilities: LOCAL_BACKEND_CAPABILITIES,
      providers: {
        supported: LOCAL_PROVIDERS,
        configured: [...new Set(plans.filter((plan) => plan.status !== "disconnected").map((plan) => plan.provider))],
        selected: settings.local.provider ?? null,
        recruitment: { codex: true, claude: true },
      },
      humans: [{ userId: this.userId, displayName: "Local owner", email: null, isSelf: true }],
      agents: visibleBots.map((bot) => this.agent(bot)),
      threads,
      teamEvents: this.index.events.slice(-100),
    };
  }

  async threads() {
    return { threads: (await this.bootstrap()).threads };
  }

  async createGroup(raw: unknown): Promise<{ status: number; body: unknown }> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["clientRequestId", "name", "humanUserIds", "agentIds"]);
      const clientRequestId = uuid(input.clientRequestId, "clientRequestId");
      const name = requiredString(input.name, "name", 60);
      const humanUserIds = stringList(input.humanUserIds, "humanUserIds", 16);
      if (humanUserIds.some((id) => id !== this.userId)) {
        throw new HttpError(422, "invalid_human_target", "Only the local owner exists in this workspace.");
      }
      const agentIds = stringList(input.agentIds, "agentIds", 32);
      const internalIds = agentIds.map((id) => this.internalAgentId(id));
      const fingerprint = JSON.stringify({ name, humanUserIds: [...humanUserIds].sort(), agentIds: [...agentIds].sort() });
      const previous = this.index.groups[clientRequestId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, "idempotency_conflict", "This request id was already used.");
        if (previous.state === "pending") throw new HttpError(409, "idempotency_in_doubt", "The earlier group creation has an uncertain outcome; it will not be repeated automatically.");
        const bootstrap = await this.bootstrap();
        const thread = bootstrap.threads.find((candidate) => candidate.id === this.publicThreadId({ groupId: previous.groupId }));
        if (!thread) throw new HttpError(404, "not_found", "Thread not found.");
        return { status: 200, body: { thread, duplicate: true } };
      }
      this.index.groups[clientRequestId] = { state: "pending", fingerprint, createdAt: new Date().toISOString() };
      saveIndex(this.index);
      const group = await this.invoke<Group>("lbz:groups:create", [{ name, memberIds: internalIds }]);
      this.index.groups[clientRequestId] = { state: "completed", fingerprint, groupId: group.id, createdAt: new Date().toISOString() };
      saveIndex(this.index);
      const bootstrap = await this.bootstrap();
      const thread = bootstrap.threads.find((candidate) => candidate.id === this.publicThreadId({ groupId: group.id }));
      return { status: 201, body: { thread, duplicate: false } };
    });
  }

  async messagePage(threadId: string, url: URL) {
    const target = this.target(threadId);
    const bots = await this.invoke<Bot[]>("lbz:bots:list");
    const before = url.searchParams.get("before");
    const afterValue = url.searchParams.get("after");
    const after = afterValue === "0" ? null : afterValue;
    if (before && after) throw new HttpError(400, "invalid_cursor", "Use before or after, not both.");
    let raw: ThreadMessage[] = [];
    let olderCursor: string | null = null;
    if (before) {
      const internal = this.internalMessageId(before);
      const found = await this.invoke<ThreadMessage | null>("lbz:threads:message", [target, internal]);
      if (!found) throw new HttpError(409, "cursor_unknown", "Message cursor is not present in this local thread.");
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
    if (after) {
      let cursor = this.internalMessageId(after);
      let first = true;
      while (raw.map((message) => this.message(message, target, bots)).filter(Boolean).length < limit) {
        const page = await this.invoke<{ messages: ThreadMessage[]; nextCursor: string; hasMore: boolean } | null>(
          "lbz:threads:after", [target, cursor, 200],
        );
        if (!page) {
          if (first) throw new HttpError(409, "cursor_unknown", "Message cursor is not present in this local thread.");
          break;
        }
        first = false;
        raw.push(...page.messages);
        cursor = page.nextCursor;
        if (!page.hasMore || page.messages.length === 0) break;
      }
    } else {
      let cursor = before ? this.internalMessageId(before) : undefined;
      let hasOlder = false;
      while (raw.map((message) => this.message(message, target, bots)).filter(Boolean).length < limit) {
        const page = await this.invoke<{ messages: ThreadMessage[]; olderCursor: string | null }>(
          "lbz:threads:messages", [target, cursor],
        );
        raw = [...page.messages, ...raw];
        hasOlder = Boolean(page.olderCursor);
        if (!page.olderCursor || page.messages.length === 0) break;
        cursor = page.olderCursor;
      }
      const visible = raw.map((message) => this.message(message, target, bots)).filter((value): value is CollaborationMessage => value !== null);
      const selected = visible.slice(-limit);
      olderCursor = (hasOlder || visible.length > selected.length) && selected[0] ? selected[0].id : null;
      return { threadId, messages: selected, nextCursor: selected.at(-1)?.id ?? before ?? null, olderCursor };
    }
    const messages = raw.map((message) => this.message(message, target, bots))
      .filter((value): value is CollaborationMessage => value !== null).slice(0, limit);
    return {
      threadId,
      messages,
      nextCursor: messages.at(-1)?.id ?? after ?? null,
      olderCursor,
    };
  }

  private async run(internalRunId: string, triggerOverride?: string) {
    const run = await this.invoke<Run | null>("lbz:runs:get", [internalRunId]);
    if (!run) throw new HttpError(404, "not_found", "Run not found.");
    const state = publicRunState(run.state);
    return {
      runId: this.runId(run.id),
      threadId: this.publicThreadId(targetForThreadId(run.threadId) ?? (() => { throw new HttpError(500, "invalid_local_run", "Run thread is invalid."); })()),
      agentId: this.agentId(run.botId),
      triggerMessageId: this.messageId(triggerOverride ?? this.index.runTriggers[run.id] ?? run.messageId ?? `trigger-${run.id}`),
      state,
      error: run.error ?? (run.state === "cancelled" ? "cancelled" : null),
      createdAt: run.startedAt,
      updatedAt: run.endedAt ?? run.startedAt,
    };
  }

  async postMessage(threadId: string, raw: unknown): Promise<{ status: number; body: unknown }> {
    return this.exclusive(async () => {
      const target = this.target(threadId);
      const input = objectBody(raw, ["clientMessageId", "content", "mentionAgentIds"]);
      const clientMessageId = uuid(input.clientMessageId, "clientMessageId");
      const content = requiredString(input.content, "content", 20_000);
      const mentionAgentIds = stringList(input.mentionAgentIds ?? [], "mentionAgentIds", 32);
      const requestedBotIds = mentionAgentIds.map((id) => this.internalAgentId(id));
      const allowedBotIds = "botId" in target
        ? [target.botId]
        : (await this.invoke<Group[]>("lbz:groups:list")).find((group) => group.id === target.groupId)?.memberIds;
      if (!allowedBotIds || requestedBotIds.some((id) => !allowedBotIds.includes(id))) {
        throw new HttpError(422, "invalid_agent_target", "Agent is not in this thread.");
      }
      // The underlying harness historically fanned an unmentioned group turn
      // out to every member. Local collaboration instead has one deterministic
      // lead: explicit mentions win, otherwise the first seated agent answers.
      const mentionBotIds = requestedBotIds.length > 0
        ? requestedBotIds
        : "groupId" in target ? allowedBotIds.slice(0, 1) : [];
      const fingerprint = JSON.stringify({ threadId, content, mentionAgentIds: [...mentionAgentIds].sort() });
      const previous = this.index.messages[clientMessageId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, "idempotency_conflict", "This message id was already used.");
        if (previous.state === "pending") throw new HttpError(409, "idempotency_in_doubt", "The earlier message has an uncertain outcome; it will not be sent again automatically.");
        const bots = await this.invoke<Bot[]>("lbz:bots:list");
        const original = await this.invoke<ThreadMessage | null>("lbz:threads:message", [target, previous.messageId]);
        if (!original) throw new HttpError(404, "not_found", "Message not found.");
        const message = this.message(original, target, bots);
        const runs = await Promise.all(previous.runIds.map((id) => this.run(id, previous.messageId)));
        return { status: 200, body: { message, duplicate: true, runs } };
      }
      this.index.messages[clientMessageId] = {
        state: "pending", fingerprint, threadId: threadIdForTarget(target), createdAt: new Date().toISOString(),
      };
      saveIndex(this.index);
      const before = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
      const known = new Set(before.messages.map((message) => message.id));
      const sent = await this.invoke<{ runIds: string[] }>("lbz:threads:send", [target, { text: content, mentionBotIds }]);
      const after = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
      const userMessage = [...after.messages].reverse().find((message) => message.role === "user" && !known.has(message.id));
      if (!userMessage) throw new HttpError(500, "message_not_persisted", "The local message was not persisted.");
      this.index.messages[clientMessageId] = {
        state: "completed", fingerprint, threadId: threadIdForTarget(target), messageId: userMessage.id,
        runIds: sent.runIds, createdAt: new Date().toISOString(),
      };
      for (const runId of sent.runIds) this.index.runTriggers[runId] = userMessage.id;
      saveIndex(this.index);
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const message = this.message(userMessage, target, bots);
      const runs = await Promise.all(sent.runIds.map((id) => this.run(id, userMessage.id)));
      return { status: 201, body: { message, duplicate: false, runs } };
    });
  }

  /** Recovery lookup for a client that lost the reply to its own send. It
   * reads the durable idempotency journal only — it never re-sends. */
  async messageByClientId(threadId: string, clientMessageId: string) {
    const target = this.target(threadId);
    const previous = this.index.messages[uuid(clientMessageId, "clientMessageId")];
    if (!previous || previous.state !== "completed" || previous.threadId !== threadIdForTarget(target)) {
      throw new HttpError(404, "not_found", "Message not found.");
    }
    const found = await this.invoke<ThreadMessage | null>("lbz:threads:message", [target, previous.messageId]);
    const message = found ? this.message(found, target, await this.invoke<Bot[]>("lbz:bots:list")) : null;
    if (!message) throw new HttpError(404, "not_found", "Message not found.");
    return { message };
  }

  async runs(input: { threadId?: string; active?: boolean } = {}) {
    const threadId = input.threadId ? threadIdForTarget(this.target(input.threadId)) : undefined;
    const rows = await this.invoke<Run[]>("lbz:runs:list", [{ limit: 200 }]);
    const selected = rows.filter((run) => (!threadId || run.threadId === threadId)
      && (!input.active || run.state === "queued" || run.state === "working" || run.state === "waiting_input"));
    return { runs: await Promise.all(selected.map((run) => this.run(run.id))) };
  }

  async getRun(publicRunId: string) {
    return this.run(this.internalRunId(publicRunId));
  }

  async cancel(publicRunId: string) {
    const runId = this.internalRunId(publicRunId);
    const run = await this.invoke<Run | null>("lbz:runs:get", [runId]);
    if (!run) throw new HttpError(404, "not_found", "Run not found.");
    const target = targetForThreadId(run.threadId);
    if (!target) throw new HttpError(500, "invalid_local_run", "Run thread is invalid.");
    await this.invoke<void>("lbz:threads:stop", [target]);
    this.teamBroker.revoke(runId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const stopped = await this.getRun(publicRunId);
      if (stopped.state !== "running" && stopped.state !== "queued") return stopped;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    return this.getRun(publicRunId);
  }

  async approvals(publicRunId: string) {
    const runId = this.internalRunId(publicRunId);
    const run = await this.invoke<Run | null>("lbz:runs:get", [runId]);
    if (!run) throw new HttpError(404, "not_found", "Run not found.");
    const target = targetForThreadId(run.threadId);
    if (!target) throw new HttpError(500, "invalid_local_run", "Run thread is invalid.");
    const snapshot = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
    const approvals = snapshot.messages.flatMap((message) => message.blocks.flatMap((block) => {
      if (block.kind !== "ask" || block.runId !== runId) return [];
      return [{
        askId: block.askId,
        requestType: block.requestType,
        tool: block.tool,
        summary: block.summary,
        ...(block.detailText ? { detailText: block.detailText } : {}),
        ...(block.choices ? { choices: block.choices } : {}),
        status: block.status,
        ...(block.answered ? { answered: block.answered } : {}),
      }];
    }));
    return { runId: publicRunId, approvals };
  }

  async answer(publicRunId: string, raw: unknown) {
    const runId = this.internalRunId(publicRunId);
    const input = objectBody(raw, ["askId", "answer"]);
    const askId = requiredString(input.askId, "askId", 64);
    const answer = input.answer as AskAnswer;
    await this.invoke<void>("lbz:threads:answer", [{ runId, askId, answer }]);
    return this.approvals(publicRunId);
  }

  async localRuntime() {
    void this.invoke("lbz:plans:refreshUsage").catch(() => undefined);
    const [settings, plans, models, tools, inference] = await Promise.all([
      this.invoke<RuntimeSettings>("lbz:runtime:getSettings"), this.invoke("lbz:plans:list"),
      this.invoke("lbz:runtime:models"), this.invoke("lbz:runtime:toolsStatus"),
      this.invoke<{ providers: unknown[]; presets: unknown[] }>("lbz:inference:list"),
    ]);
    const source = settings.local.inferenceProviderId ? "provider" : settings.local.activePlanId ? "plan" : "auto";
    return {
      mode: "local-harness", backendMode: "local", settings, plans, models, tools,
      providers: { supported: LOCAL_PROVIDERS, recruitment: { codex: true, claude: true } },
      inference: {
        source,
        planId: settings.local.activePlanId ?? null,
        providerId: settings.local.inferenceProviderId ?? null,
        preferredFamily: settings.local.provider ?? null,
        external: inference.providers,
        presets: inference.presets,
      },
    };
  }
  setInference(raw: unknown) { return this.invoke("lbz:runtime:setInference", [raw]); }
  setModel(raw: unknown) {
    const input = objectBody(raw, ["model"]);
    return this.invoke("lbz:runtime:setSettings", [{ mode: "local", local: { model: requiredString(input.model, "model", 120) } }]);
  }
  inferenceProviders() { return this.invoke("lbz:inference:list"); }
  addInferenceProvider(raw: unknown) { return this.invoke("lbz:inference:add", [raw]); }
  updateInferenceProvider(id: string, raw: unknown) { return this.invoke("lbz:inference:update", [id, raw]); }
  removeInferenceProvider(id: string) { return this.invoke("lbz:inference:remove", [id]); }
  testInferenceProvider(id: string) { return this.invoke("lbz:inference:test", [id]); }
  disconnectPlan(id: string) { return this.invoke("lbz:plans:disconnect", [id]); }

  bots() { return this.invoke<Bot[]>("lbz:bots:list"); }
  async createBot(raw: unknown) {
    const bot = await this.invoke<Bot>("lbz:bots:create", [raw]);
    const bootstrap = await this.bootstrap();
    const agent = this.agent(bot);
    const thread = bootstrap.threads.find((candidate) => candidate.kind === "agent" && candidate.agentIds.includes(agent.agentId));
    return { bot, agent, thread };
  }
  async updateBot(id: string, raw: unknown) {
    const bot = await this.invoke<Bot>("lbz:bots:update", [id, raw]);
    const bootstrap = await this.bootstrap();
    const agent = this.agent(bot);
    const thread = bootstrap.threads.find((candidate) => candidate.kind === "agent" && candidate.agentIds.includes(agent.agentId));
    return { bot, agent, thread };
  }
  async setSandbox(raw: unknown) {
    const input = objectBody(raw, ["sandbox"]);
    if (input.sandbox !== "read-only" && input.sandbox !== "workspace-write") {
      throw new HttpError(400, "invalid_payload", "sandbox must be read-only or workspace-write.");
    }
    return this.invoke("lbz:runtime:setSettings", [{ mode: "local", local: { sandbox: input.sandbox } }]);
  }
  /** The one permission switch, for every agent at once. `skip-all` is the
   * dangerous mode: no CLI asks anything, of anybody. */
  async setPermissions(raw: unknown) {
    const input = objectBody(raw, ["permissions"]);
    if (input.permissions !== "ask" && input.permissions !== "skip-all") {
      throw new HttpError(400, "invalid_settings", 'permissions must be "ask" or "skip-all".');
    }
    return this.invoke("lbz:runtime:setPermissions", [{ permissions: input.permissions }]);
  }
  plans() {
    // A Settings page is reading: start the usage refresh, answer now.
    void this.invoke("lbz:plans:refreshUsage").catch(() => undefined);
    return this.invoke("lbz:plans:list");
  }
  connectPlan(raw: unknown) { return this.invoke("lbz:plans:connect", [raw]); }
  activatePlan(id: string) { return this.invoke("lbz:plans:setActive", [id]); }
  testPlan(id: string) { return this.invoke("lbz:plans:test", [id]); }

  // Local apps: the catalogue, what is added, and the four verbs. Secrets
  // travel in through POST/PATCH and never out (the list carries names only).
  async appsOverview() {
    const [catalog, installed, settings] = await Promise.all([
      this.invoke<Record<string, unknown>>("lbz:apps:catalog"),
      this.invoke("lbz:apps:list"),
      this.invoke<RuntimeSettings>("lbz:runtime:getSettings"),
    ]);
    return { ...catalog, installed, provider: settings.local.provider ?? null };
  }
  installApp(raw: unknown) {
    const input = objectBody(raw, ["catalogId", "values", "name", "description", "approval", "custom"]);
    if (input.custom !== undefined) return this.invoke("lbz:apps:addCustom", [input.custom]);
    return this.invoke("lbz:apps:install", [{
      catalogId: input.catalogId,
      values: input.values ?? {},
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.approval === undefined ? {} : { approval: input.approval }),
    }]);
  }
  updateApp(id: string, raw: unknown) { return this.invoke("lbz:apps:update", [id, raw]); }
  modelCatalogs() { return this.invoke("lbz:runtime:modelCatalogs"); }

  /** Apps → Routines, the cloud's `/api/crons` shape: one app reads both. */
  async crons(): Promise<{ items: PublicRoutine[] }> {
    const [routines, bots] = await Promise.all([
      this.invoke<Routine[]>("lbz:routines:list", []),
      this.invoke<Bot[]>("lbz:bots:list"),
    ]);
    return { items: routines.map((routine) => publicRoutine(routine, bots, (botId) => this.agentId(botId))) };
  }
  async patchCron(id: string, raw: unknown): Promise<{ item: PublicRoutine }> {
    const input = objectBody(raw, ["status", "expected_updated_at", "agent_id", "name", "description", "trigger"]);
    const routines = await this.invoke<Routine[]>("lbz:routines:list", []);
    const current = routines.find((routine) => routine.id === id);
    if (!current) throw new HttpError(404, "not_found", "No such routine.");
    if (typeof input.expected_updated_at === "string" && input.expected_updated_at && input.expected_updated_at !== routineVersion(current)) {
      throw new HttpError(409, "stale_version", "This routine changed while the window was open.");
    }
    const patch: Record<string, unknown> = {};
    if (input.status !== undefined) {
      if (input.status !== "active" && input.status !== "paused") throw new HttpError(400, "invalid_status", "status must be active or paused.");
      patch.enabled = input.status === "active";
    }
    if (input.agent_id !== undefined) {
      const owner = requiredString(input.agent_id, "agent_id", 160);
      patch.botId = owner.startsWith("local:") ? this.internalAgentId(owner) : owner;
    }
    if (input.name !== undefined) patch.name = requiredString(input.name, "name", 80);
    if (input.description !== undefined) patch.prompt = requiredString(input.description, "description", 6000);
    if (input.trigger !== undefined) {
      if (!input.trigger || typeof input.trigger !== "object" || Array.isArray(input.trigger)) throw new HttpError(400, "invalid_trigger", "trigger must be an object.");
      patch.trigger = input.trigger;
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, "invalid_body", "Nothing to change.");
    const updated = await this.invoke<Routine>("lbz:routines:update", [id, patch]);
    const bots = await this.invoke<Bot[]>("lbz:bots:list");
    return { item: publicRoutine(updated, bots, (botId) => this.agentId(botId)) };
  }
  async deleteCron(id: string): Promise<{ removed: boolean }> {
    const routines = await this.invoke<Routine[]>("lbz:routines:list", []);
    if (!routines.some((routine) => routine.id === id)) throw new HttpError(404, "not_found", "No such routine.");
    await this.invoke("lbz:routines:remove", [id]);
    return { removed: true };
  }
  /** The last runs of one routine, newest first: the panel's history. */
  async cronRuns(id: string): Promise<{ items: PublicRoutineRun[] }> {
    const runs = await this.invoke<Run[]>("lbz:runs:list", [{ limit: 200 }]);
    const items = runs
      .filter((run) => run.routineId === id)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, 12)
      .map((run) => publicRoutineRun(run, (runId) => this.runId(runId)));
    return { items };
  }
  async runCron(id: string): Promise<{ runId: string }> {
    const started = await this.invoke<{ runId: string }>("lbz:routines:runNow", [id]);
    return { runId: this.runId(started.runId) };
  }
  /** An agent schedules a routine for itself or a teammate: the team tool. */
  checkpointTask(capability: TeamCapability, raw: unknown) {
    return this.harness.checkpointTask(capability, raw);
  }

  async scheduleRoutine(capability: TeamCapability, raw: unknown): Promise<{ routine: PublicRoutine }> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["name", "prompt", "frequency", "time", "weekdays", "every_minutes", "at", "owner_agent_id"]);
      const name = requiredString(input.name, "name", 80);
      const prompt = requiredString(input.prompt, "prompt", 6000);
      let trigger;
      try {
        trigger = triggerFromToolInput(input);
      } catch (error) {
        throw new HttpError(400, "invalid_trigger", error instanceof Error ? error.message : "invalid trigger");
      }
      const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      if (!run || run.botId !== capability.botId || run.threadId !== capability.threadId) {
        throw new HttpError(403, "invalid_team_scope", "The routine capability does not match this turn.");
      }
      const ownerId = input.owner_agent_id === undefined
        ? capability.botId
        : this.internalAgentId(requiredString(input.owner_agent_id, "owner_agent_id", 160));
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      if (!bots.some((bot) => bot.id === ownerId && !bot.archived)) throw new HttpError(404, "not_found", "That owner is not an active agent here.");
      const routine = await this.invoke<Routine>("lbz:routines:create", [{ botId: ownerId, name, prompt, trigger, enabled: true }]);
      return { routine: publicRoutine(routine, bots, (botId) => this.agentId(botId)) };
    });
  }
  removeApp(id: string) { return this.invoke("lbz:apps:remove", [id]); }
  testApp(id: string) { return this.invoke("lbz:apps:test", [id]); }
  loginApp(id: string) { return this.invoke("lbz:apps:login", [id]); }

  // The second brain: a scan of a trusted folder, one note, and the writes
  // the explorer and the editor make into that same folder.
  //
  // `invoke` answers 400 for every refusal, which is right for a payload and
  // wrong for a vault: a note that is gone is 404, a folder shared read-only
  // is 403, and a name already taken is 409. `BrainError` carries the code,
  // this turns it into the status.
  private async brainCall<T>(channel: string, args: unknown[]): Promise<T> {
    try {
      return await this.invoke<T>(channel, args);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      const status = BRAIN_ERROR_STATUS[error.code];
      throw status ? new HttpError(status, error.code, error.message) : error;
    }
  }
  brain(rootId: string | null) { return this.brainCall("lbz:brain:scan", rootId ? [rootId] : []); }
  brainNote(rootId: string, noteId: string) { return this.brainCall("lbz:brain:note", [rootId, noteId]); }
  createBrainNote(raw: unknown) {
    const input = objectBody(raw, ["root", "folder", "name"]);
    return this.brainCall("lbz:brain:createNote", [
      requiredString(input.root, "root", 64),
      input.folder === undefined ? "" : vaultPath(input.folder, "folder"),
      ...(input.name === undefined || input.name === null ? [] : [requiredString(input.name, "name", 120)]),
    ]);
  }
  createBrainFolder(raw: unknown) {
    const input = objectBody(raw, ["root", "folder", "name"]);
    return this.brainCall("lbz:brain:createFolder", [
      requiredString(input.root, "root", 64),
      input.folder === undefined ? "" : vaultPath(input.folder, "folder"),
      requiredString(input.name, "name", 120),
    ]);
  }
  writeBrainNote(raw: unknown) {
    const input = objectBody(raw, ["root", "note", "text"]);
    if (typeof input.text !== "string") throw new HttpError(400, "invalid_payload", "text must be a string.");
    return this.brainCall("lbz:brain:writeNote", [
      requiredString(input.root, "root", 64),
      requiredString(input.note, "note", 1024),
      input.text,
    ]);
  }
  renameBrainEntry(raw: unknown) {
    const input = objectBody(raw, ["root", "path", "name"]);
    return this.brainCall("lbz:brain:rename", [
      requiredString(input.root, "root", 64),
      requiredString(input.path, "path", 1024),
      requiredString(input.name, "name", 120),
    ]);
  }
  trashBrainEntry(rootId: string, path: string) { return this.brainCall("lbz:brain:trash", [rootId, path]); }
  openBrainEntry(raw: unknown) {
    const input = objectBody(raw, ["root", "path", "mode"]);
    const mode = requiredString(input.mode, "mode", 20);
    if (!BRAIN_OPEN_MODES.includes(mode)) {
      throw new HttpError(400, "invalid_payload", `mode must be one of ${BRAIN_OPEN_MODES.join(", ")}.`);
    }
    return this.brainCall("lbz:brain:open", [
      requiredString(input.root, "root", 64),
      requiredString(input.path, "path", 1024),
      mode,
    ]);
  }

  // The agency pack: its state for the desktop, its install, its dashboard,
  // and the one door its agents' tools come through. Ids are the public
  // collaboration ids (`local:<instance>:agent:…`, `local:<instance>:thread:…`)
  // so the desktop can open a chat from the list; no path and no secret.
  private requireAgency(): AgencyService {
    if (!this.agency) throw new HttpError(503, "agency_unavailable", "The agency pack is not available in this runtime.");
    return this.agency;
  }

  private publicAgency(state: AgencyState): AgencyStatus {
    return {
      installed: state.installed,
      status: state.status,
      template: state.template,
      dashboardUrl: state.dashboardUrl,
      bots: state.bots.map((bot) => ({
        id: this.agentId(bot.botId),
        name: bot.name,
        slug: bot.slug,
        threadId: this.publicThreadId({ botId: bot.botId }),
      })),
      teamThreadId: state.groupId ? this.publicThreadId({ groupId: state.groupId }) : null,
      skillsCount: state.skillsCount,
      ...(state.error ? { error: state.error } : {}),
    };
  }

  private async agencyCall<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AgencyError) throw new HttpError(error.status, error.code, error.message);
      throw error;
    }
  }

  agencyStatus(): Promise<AgencyStatus> {
    return this.agencyCall(async () => this.publicAgency(await this.requireAgency().status()));
  }

  agencyInstall(): Promise<AgencyStatus> {
    return this.agencyCall(async () => this.publicAgency(await this.requireAgency().install()));
  }

  agencyOpen(): Promise<AgencyStatus> {
    return this.agencyCall(async () => this.publicAgency(await this.requireAgency().open()));
  }

  /** An agency tool call from the MCP twin: `{ tool, arguments }`, under the
   * run's capability — the same check the dynamic tools make. */
  agencyTool(capability: TeamCapability, raw: unknown): Promise<unknown> {
    return this.agencyCall(async () => {
      const input = objectBody(raw, ["tool", "arguments"]);
      if (!isAgencyToolName(input.tool)) throw new HttpError(404, "unknown_tool", "Unknown agency tool.");
      return this.requireAgency().callTool(
        { botId: capability.botId, threadId: capability.threadId, runId: capability.runId },
        input.tool,
        input.arguments ?? {},
      );
    });
  }

  async recruit(capability: TeamCapability, raw: unknown): Promise<RecruitmentResult> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["name", "title", "mission"]);
      const name = requiredString(input.name, "name", 60);
      const title = requiredString(input.title, "title", 80);
      const mission = requiredString(input.mission, "mission", 2_000);
      const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      if (!run || run.botId !== capability.botId || run.threadId !== capability.threadId) {
        throw new HttpError(403, "invalid_team_scope", "The recruitment capability does not match this turn.");
      }
      const fingerprint = JSON.stringify({ name, title, mission });
      const recruitmentId = capability.runId;
      const previous = this.index.recruitments[recruitmentId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, "recruitment_limit", "One turn may recruit only one teammate.");
        if (previous.state === "pending") throw new HttpError(409, "idempotency_in_doubt", "The earlier recruitment has an uncertain outcome and will not be repeated.");
        return previous.result;
      }
      if (!(["queued", "working", "waiting_input"] as const).includes(run.state as "queued" | "working" | "waiting_input")) {
        this.teamBroker.revoke(capability.runId);
        throw new HttpError(409, "run_not_active", "Recruitment is available only while its run is active.");
      }
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      if (bots.filter((bot) => !bot.archived).length >= 32) throw new HttpError(409, "team_limit", "The local workspace is limited to 32 active agents.");
      this.index.recruitments[recruitmentId] = {
        state: "pending", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
        sourceThreadId: capability.threadId, createdAt: new Date().toISOString(),
      };
      saveIndex(this.index);
      const bot = await this.invoke<Bot>("lbz:bots:create", [{
        name,
        title,
        description: mission,
        instructions: `You were recruited locally for this bounded responsibility: ${mission}`,
        notifyOnFinish: true,
      }]);
      let group: Group;
      if (capability.threadId.startsWith("group:")) {
        const groupId = capability.threadId.slice(6);
        const existing = (await this.invoke<Group[]>("lbz:groups:list")).find((candidate) => candidate.id === groupId);
        if (!existing || !existing.memberIds.includes(capability.botId)) throw new HttpError(403, "invalid_team_scope", "Recruiter is not a member of this team.");
        group = await this.invoke<Group>("lbz:groups:update", [groupId, { memberIds: [...new Set([...existing.memberIds, bot.id])] }]);
      } else {
        const recruiter = bots.find((candidate) => candidate.id === capability.botId);
        if (!recruiter) throw new HttpError(404, "not_found", "Recruiting agent no longer exists.");
        group = await this.invoke<Group>("lbz:groups:create", [{ name: `${recruiter.name} + ${bot.name}`.slice(0, 60), memberIds: [recruiter.id, bot.id] }]);
      }
      // The newcomer introduces itself in the team thread right away, so the
      // person opening that chat finds it already there. The trigger is a
      // runtime message: part of the record the bots read, never shown.
      try {
        await this.invoke("lbz:threads:send", [{ groupId: group.id }, {
          text: `Welcome @${bot.name}. You were just created by ${bots.find((row) => row.id === capability.botId)?.name ?? "a teammate"} for this mission: ${mission}. Introduce yourself to the person in two lines, in their language, and say what you will start with.`,
          mentionBotIds: [bot.id],
          role: "system",
        }]);
      } catch {
        /* the recruitment stands even when the introduction cannot start */
      }
      const event: LocalTeamEvent = {
        eventId: `local:${this.instanceId}:team-event:${randomUUID()}`,
        type: "agent.recruited",
        actorAgentId: this.agentId(capability.botId),
        subjectAgentId: this.agentId(bot.id),
        runId: this.runId(capability.runId),
        threadId: this.publicThreadId(targetForThreadId(capability.threadId) ?? { botId: capability.botId }),
        createdAt: new Date().toISOString(),
        changes: { name: bot.name, ...(bot.title ? { title: bot.title } : {}), missionChanged: true, active: true },
      };
      const result: RecruitmentResult = {
        recruitmentId: this.runId(recruitmentId),
        sourceAgentId: this.agentId(capability.botId),
        sourceRunId: this.runId(capability.runId),
        sourceThreadId: this.publicThreadId(targetForThreadId(capability.threadId) ?? { botId: capability.botId }),
        agent: this.agent(bot),
        threadId: this.publicThreadId({ botId: bot.id }),
        teamThreadId: this.publicThreadId({ groupId: group.id }),
        eventId: event.eventId,
      };
      this.index.recruitments[recruitmentId] = {
        state: "completed", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
        sourceThreadId: capability.threadId, createdAt: new Date().toISOString(), result,
      };
      this.index.events = [...this.index.events, event].slice(-1_000);
      saveIndex(this.index);
      return result;
    });
  }

  async manageAgent(capability: TeamCapability, raw: unknown): Promise<AgentManagementResult> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["agent_id", "name", "title", "mission", "active"]);
      const publicAgentId = requiredString(input.agent_id, "agent_id", 160);
      const targetBotId = this.internalAgentId(publicAgentId);
      if (targetBotId === capability.botId) throw new HttpError(422, "invalid_agent_target", "An agent cannot manage itself through the team tool.");
      const name = input.name === undefined ? undefined : requiredString(input.name, "name", 60);
      const title = input.title === undefined ? undefined : requiredString(input.title, "title", 80);
      const mission = input.mission === undefined ? undefined : requiredString(input.mission, "mission", 2_000);
      if (input.active !== undefined && typeof input.active !== "boolean") throw new HttpError(400, "invalid_payload", "active must be a boolean.");
      if (!name && !title && !mission && input.active === undefined) throw new HttpError(400, "invalid_payload", "At least one bounded agent update is required.");
      const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      if (!run || run.botId !== capability.botId || run.threadId !== capability.threadId) {
        throw new HttpError(403, "invalid_team_scope", "The management capability does not match this turn.");
      }
      const fingerprint = JSON.stringify({ publicAgentId, name: name ?? null, title: title ?? null, mission: mission ?? null, active: input.active ?? null });
      const managementId = `${capability.runId}:${targetBotId}`;
      const previous = this.index.managements[managementId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, "idempotency_conflict", "This run already managed that teammate with a different request.");
        if (previous.state === "pending") throw new HttpError(409, "idempotency_in_doubt", "The earlier agent update has an uncertain outcome and will not be repeated.");
        return previous.result;
      }
      const changesThisRun = Object.values(this.index.managements).filter((entry) => entry.sourceRunId === capability.runId).length;
      if (changesThisRun >= 4) throw new HttpError(409, "management_limit", "One run may manage at most four teammates.");
      if (!(["queued", "working", "waiting_input"] as const).includes(run.state as "queued" | "working" | "waiting_input")) {
        this.teamBroker.revoke(capability.runId);
        throw new HttpError(409, "run_not_active", "Agent management is available only while its run is active.");
      }
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const targetBot = bots.find((candidate) => candidate.id === targetBotId);
      if (!targetBot) throw new HttpError(404, "not_found", "Managed agent does not exist.");
      let inScope = false;
      if (capability.threadId.startsWith("group:")) {
        const groupId = capability.threadId.slice(6);
        const group = (await this.invoke<Group[]>("lbz:groups:list")).find((candidate) => candidate.id === groupId);
        inScope = Boolean(group?.memberIds.includes(capability.botId) && group.memberIds.includes(targetBotId));
      } else {
        inScope = Object.values(this.index.recruitments).some((entry) => entry.state === "completed"
          && entry.sourceBotId === capability.botId && entry.result.agent.agentId === publicAgentId);
      }
      if (!inScope) throw new HttpError(403, "invalid_team_scope", "An agent may manage only a teammate in the current group or one it recruited.");
      this.index.managements[managementId] = {
        state: "pending", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
        sourceThreadId: capability.threadId, targetBotId, createdAt: new Date().toISOString(),
      };
      saveIndex(this.index);
      const updated = await this.invoke<Bot>("lbz:bots:update", [targetBotId, {
        ...(name ? { name } : {}),
        ...(title ? { title } : {}),
        ...(mission ? { description: mission, instructions: `Your current locally assigned responsibility: ${mission}` } : {}),
        ...(typeof input.active === "boolean" ? { archived: !input.active } : {}),
      }]);
      const event: LocalTeamEvent = {
        eventId: `local:${this.instanceId}:team-event:${randomUUID()}`,
        type: "agent.updated",
        actorAgentId: this.agentId(capability.botId),
        subjectAgentId: this.agentId(updated.id),
        runId: this.runId(capability.runId),
        threadId: this.publicThreadId(targetForThreadId(capability.threadId) ?? { botId: capability.botId }),
        createdAt: new Date().toISOString(),
        changes: {
          ...(name ? { name: updated.name } : {}),
          ...(title ? { title: updated.title ?? title } : {}),
          ...(mission ? { missionChanged: true } : {}),
          ...(typeof input.active === "boolean" ? { active: !updated.archived } : {}),
        },
      };
      const result: AgentManagementResult = {
        managementId: this.runId(managementId),
        sourceAgentId: this.agentId(capability.botId),
        sourceRunId: this.runId(capability.runId),
        sourceThreadId: event.threadId,
        agent: this.agent(updated),
        threadId: this.publicThreadId({ botId: updated.id }),
        active: !updated.archived,
        eventId: event.eventId,
      };
      this.index.managements[managementId] = {
        state: "completed", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
        sourceThreadId: capability.threadId, targetBotId, createdAt: new Date().toISOString(), result,
      };
      this.index.events = [...this.index.events, event].slice(-1_000);
      saveIndex(this.index);
      return result;
    });
  }
}

export function publicRunState(state: Run["state"]): "queued" | "running" | "done" | "failed" | "cancelled" {
  if (state === "queued") return "queued";
  if (state === "working" || state === "waiting_input") return "running";
  if (state === "completed") return "done";
  if (state === "cancelled") return "cancelled";
  return "failed";
}

/** Establish the local policy and team facade before any overdue routine starts. */
export async function startLocalHarness(
  harness: Pick<LocalBizosHarness, "runtime" | "start" | "templates">,
  hasSavedSettings: boolean,
  prepareFacade: () => void,
): Promise<void> {
  await harness.runtime.setSettings({
    mode: "local",
    ...(!hasSavedSettings ? { local: { sandbox: "read-only" as const, reasoningEffort: "low" as const, autoApproveReads: false } } : {}),
  });
  prepareFacade();
  await harness.start();
  // The Company OS: a fresh workspace gets its second brain and its team.
  // After `start()` so the scheduler already runs when the standby routine
  // is registered. A seeding failure is logged, never fatal — an app that
  // cannot open because its starter notes did not write is the worse bug.
  try {
    await harness.templates.ensureDefault();
  } catch (error) {
    process.stderr.write(`[localbizos] company os template: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function serve(): Promise<void> {
  privateDirectory(stateRoot);
  privateDirectory(harnessRoot);
  const stateLock = acquireStateLock(lockPath);
  process.once("exit", () => stateLock.release());
  const id = instanceId();
  const token = randomBytes(48).toString("base64url");
  const teamBroker = new LocalTeamBroker();
  let facade: CollaborationFacade | null = null;
  let connector: RelayConnector | null = null;
  let agency: AgencyService | null = null;
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const remote = request.socket.remoteAddress ?? "";
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
        throw new HttpError(403, "forbidden", "Loopback requests only.");
      }
      if (!origin || request.headers.host !== new URL(origin).host) {
        throw new HttpError(403, "forbidden", "Invalid local host.");
      }
      const requestOrigin = request.headers.origin;
      if (requestOrigin && requestOrigin !== origin) throw new HttpError(403, "forbidden", "Cross-origin requests are refused.");
      if (!facade) throw new HttpError(503, "starting", "Local harness is starting.");
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", origin);
      const authorization = request.headers.authorization ?? "";
      const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (method === "POST" && url.pathname === "/api/internal/local-team/exchange") {
        return sendJson(response, 200, { token: teamBroker.exchange(bearer) });
      }
      if (method === "POST" && url.pathname === "/api/internal/local-team/recruit") {
        return sendJson(response, 201, await facade.recruit(teamBroker.authorize(bearer), await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/internal/local-team/manage") {
        return sendJson(response, 200, await facade.manageAgent(teamBroker.authorize(bearer), await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/internal/local-team/routine") {
        return sendJson(response, 201, await facade.scheduleRoutine(teamBroker.authorize(bearer), await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/internal/local-team/checkpoint") {
        return sendJson(response, 200, facade.checkpointTask(teamBroker.authorize(bearer), await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/internal/local-team/agency") {
        return sendJson(response, 200, await facade.agencyTool(teamBroker.authorize(bearer), await bodyOf(request)));
      }
      if (!secureEqual(authorization, `Bearer ${token}`)) throw new HttpError(401, "unauthorized", "Local bearer token required.");
      // The agency pack, for the desktop: state, install, dashboard URL. The
      // UI opens the URL itself; nothing is launched from here.
      if (method === "GET" && url.pathname === "/api/local/agency") return sendJson(response, 200, await facade.agencyStatus());
      if (method === "POST" && url.pathname === "/api/local/agency/install") {
        objectBody(await bodyOf(request), []);
        return sendJson(response, 200, await facade.agencyInstall());
      }
      if (method === "POST" && url.pathname === "/api/local/agency/open") {
        objectBody(await bodyOf(request), []);
        return sendJson(response, 200, await facade.agencyOpen());
      }
      if (method === "GET" && url.pathname === "/api/local/health") {
        return sendJson(response, 200, { ok: true, mode: "local-harness", contractVersion: 1, instanceId: id });
      }
      if (method === "GET" && url.pathname === "/api/collaboration/bootstrap") return sendJson(response, 200, await facade.bootstrap());
      if (method === "GET" && url.pathname === "/api/collaboration/threads") return sendJson(response, 200, await facade.threads());
      if (method === "POST" && url.pathname === "/api/collaboration/threads") {
        const result = await facade.createGroup(await bodyOf(request));
        return sendJson(response, result.status, result.body);
      }
      const messageThreadId = routeId(url.pathname, /^\/api\/collaboration\/threads\/([^/]+)\/messages$/);
      if (messageThreadId && method === "GET") return sendJson(response, 200, await facade.messagePage(messageThreadId, url));
      if (messageThreadId && method === "POST") {
        const result = await facade.postMessage(messageThreadId, await bodyOf(request));
        return sendJson(response, result.status, result.body);
      }
      if (method === "GET" && url.pathname === "/api/collaboration/runs") {
        const threadId = url.searchParams.get("threadId");
        return sendJson(response, 200, await facade.runs({
          active: url.searchParams.get("active") === "1",
          ...(threadId ? { threadId } : {}),
        }));
      }
      const runId = routeId(url.pathname, /^\/api\/collaboration\/runs\/([^/]+)$/);
      if (runId && method === "GET") return sendJson(response, 200, await facade.getRun(runId));
      const cancelRunId = routeId(url.pathname, /^\/api\/collaboration\/runs\/([^/]+)\/cancel$/);
      if (cancelRunId && method === "POST") return sendJson(response, 200, await facade.cancel(cancelRunId));
      const approvalRunId = routeId(url.pathname, /^\/api\/collaboration\/runs\/([^/]+)\/approval$/);
      if (approvalRunId && method === "GET") return sendJson(response, 200, await facade.approvals(approvalRunId));
      if (approvalRunId && method === "POST") return sendJson(response, 200, await facade.answer(approvalRunId, await bodyOf(request)));
      if (method === "GET" && url.pathname === "/api/local/runtime") return sendJson(response, 200, await facade.localRuntime());
      if (method === "GET" && url.pathname === "/api/local/team/events") return sendJson(response, 200, { events: (await facade.bootstrap()).teamEvents });
      if (method === "POST" && url.pathname === "/api/local/runtime/sandbox") return sendJson(response, 200, { settings: await facade.setSandbox(await bodyOf(request)) });
      if (method === "POST" && url.pathname === "/api/local/runtime/permissions") return sendJson(response, 200, { settings: await facade.setPermissions(await bodyOf(request)) });
      if (method === "GET" && url.pathname === "/api/local/bots") return sendJson(response, 200, { bots: await facade.bots() });
      if (method === "POST" && url.pathname === "/api/local/bots") return sendJson(response, 201, await facade.createBot(await bodyOf(request)));
      const botId = routeId(url.pathname, /^\/api\/local\/bots\/([^/]+)$/);
      if (botId && method === "PATCH") return sendJson(response, 200, await facade.updateBot(botId, await bodyOf(request)));
      if (method === "GET" && url.pathname === "/api/local/plans") return sendJson(response, 200, { plans: await facade.plans() });
      if (method === "POST" && url.pathname === "/api/local/plans") return sendJson(response, 201, { plan: await facade.connectPlan(await bodyOf(request)) });
      const activePlanId = routeId(url.pathname, /^\/api\/local\/plans\/([^/]+)\/active$/);
      if (activePlanId && method === "POST") return sendJson(response, 200, { plan: await facade.activatePlan(activePlanId) });
      const testPlanId = routeId(url.pathname, /^\/api\/local\/plans\/([^/]+)\/test$/);
      if (testPlanId && method === "POST") return sendJson(response, 200, await facade.testPlan(testPlanId));
      const planId = routeId(url.pathname, /^\/api\/local\/plans\/([^/]+)$/);
      if (planId && method === "DELETE") return sendJson(response, 200, await facade.disconnectPlan(planId));
      if (method === "POST" && url.pathname === "/api/local/runtime/inference") {
        return sendJson(response, 200, { settings: await facade.setInference(await bodyOf(request)) });
      }
      if (method === "POST" && url.pathname === "/api/local/runtime/model") {
        return sendJson(response, 200, { settings: await facade.setModel(await bodyOf(request)) });
      }
      if (method === "GET" && url.pathname === "/api/local/providers") return sendJson(response, 200, await facade.inferenceProviders());
      if (method === "POST" && url.pathname === "/api/local/providers") {
        return sendJson(response, 201, { provider: await facade.addInferenceProvider(await bodyOf(request)) });
      }
      const providerId = routeId(url.pathname, /^\/api\/local\/providers\/([^/]+)$/);
      if (providerId && method === "PATCH") {
        return sendJson(response, 200, { provider: await facade.updateInferenceProvider(providerId, await bodyOf(request)) });
      }
      if (providerId && method === "DELETE") return sendJson(response, 200, await facade.removeInferenceProvider(providerId));
      const testProviderId = routeId(url.pathname, /^\/api\/local\/providers\/([^/]+)\/test$/);
      if (testProviderId && method === "POST") return sendJson(response, 200, await facade.testInferenceProvider(testProviderId));
      if (method === "GET" && url.pathname === "/api/local/apps") return sendJson(response, 200, await facade.appsOverview());
      if (method === "POST" && url.pathname === "/api/local/apps") return sendJson(response, 201, { app: await facade.installApp(await bodyOf(request)) });
      const appId = routeId(url.pathname, /^\/api\/local\/apps\/([^/]+)$/);
      if (appId && method === "PATCH") return sendJson(response, 200, { app: await facade.updateApp(appId, await bodyOf(request)) });
      if (method === "GET" && url.pathname === "/api/local/models") return sendJson(response, 200, await facade.modelCatalogs());
      if (method === "GET" && url.pathname === "/api/crons") return sendJson(response, 200, await facade.crons());
      const cronId = routeId(url.pathname, /^\/api\/crons\/([^/]+)$/);
      if (cronId && method === "PATCH") return sendJson(response, 200, await facade.patchCron(cronId, await bodyOf(request)));
      if (cronId && method === "DELETE") return sendJson(response, 200, await facade.deleteCron(cronId));
      const cronRunsId = routeId(url.pathname, /^\/api\/crons\/([^/]+)\/runs$/);
      if (cronRunsId && method === "GET") return sendJson(response, 200, await facade.cronRuns(cronRunsId));
      const runCronId = routeId(url.pathname, /^\/api\/crons\/([^/]+)\/run$/);
      if (runCronId && method === "POST") return sendJson(response, 202, await facade.runCron(runCronId));
      if (appId && method === "DELETE") return sendJson(response, 200, await facade.removeApp(appId));
      const testAppId = routeId(url.pathname, /^\/api\/local\/apps\/([^/]+)\/test$/);
      if (testAppId && method === "POST") return sendJson(response, 200, await facade.testApp(testAppId));
      const loginAppId = routeId(url.pathname, /^\/api\/local\/apps\/([^/]+)\/login$/);
      if (loginAppId && method === "POST") return sendJson(response, 200, await facade.loginApp(loginAppId));
      if (method === "GET" && url.pathname === "/api/local/brain") {
        return sendJson(response, 200, await facade.brain(url.searchParams.get("root")));
      }
      if (method === "GET" && url.pathname === "/api/local/brain/note") {
        const rootId = url.searchParams.get("root") ?? "";
        const noteId = url.searchParams.get("note") ?? "";
        if (!rootId || !noteId) throw new HttpError(400, "invalid_payload", "root and note are required.");
        return sendJson(response, 200, await facade.brainNote(rootId, noteId));
      }
      // The vault is the person's own folder, so the app writes back into it:
      // a new note, a new folder, an edit, a rename, a soft delete, and the
      // three ways of handing an entry to the rest of the Mac.
      if (method === "PUT" && url.pathname === "/api/local/brain/note") {
        return sendJson(response, 200, await facade.writeBrainNote(await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/local/brain/notes") {
        return sendJson(response, 200, await facade.createBrainNote(await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/local/brain/folders") {
        return sendJson(response, 200, await facade.createBrainFolder(await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/local/brain/rename") {
        return sendJson(response, 200, await facade.renameBrainEntry(await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/local/brain/open") {
        return sendJson(response, 200, await facade.openBrainEntry(await bodyOf(request)));
      }
      if (method === "DELETE" && url.pathname === "/api/local/brain/entry") {
        const rootId = url.searchParams.get("root") ?? "";
        const path = url.searchParams.get("path") ?? "";
        if (!rootId || !path) throw new HttpError(400, "invalid_payload", "root and path are required.");
        return sendJson(response, 200, await facade.trashBrainEntry(rootId, path));
      }
      // Pairing administration is bearer-only on loopback: creating an offer,
      // reading claims, confirming a device and revoking a grant are decisions
      // this computer's owner makes. A phone never reaches these paths; it
      // arrives through the relay as an opaque envelope.
      const pairing = pairingAdminRoute(method, url.pathname);
      if (pairing) {
        if (!connector) throw new HttpError(503, "starting", "Local pairing is starting.");
        if (pairing.kind === "status") {
          await connector.pollOnce().catch(() => undefined);
          return sendJson(response, 200, connector.status());
        }
        if (pairing.kind === "createOffer") return sendJson(response, 201, await connector.createOffer());
        if (pairing.kind === "claims") {
          await connector.pollOnce().catch(() => undefined);
          return sendJson(response, 200, { claims: connector.status().pendingClaims });
        }
        if (pairing.kind === "grants") return sendJson(response, 200, { grants: connector.status().grants });
        if (pairing.kind === "confirmClaim") {
          const input = objectBody(await bodyOf(request), ["decision"]);
          if (input.decision !== "approve" && input.decision !== "deny") {
            throw new HttpError(400, "invalid_payload", "decision must be approve or deny.");
          }
          return sendJson(response, 200, await connector.confirmClaim(pairing.id, input.decision));
        }
        return sendJson(response, 200, await connector.revokeGrant(pairing.id));
      }
      throw new HttpError(404, "not_found", "Local endpoint not found.");
    } catch (error) {
      requestError(response, error);
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local sidecar did not bind a TCP port.");
  origin = `http://127.0.0.1:${address.port}`;
  const harness = new LocalBizosHarness({
    rootDir: harnessRoot,
    baseUrl: origin,
    readSessionCookie: async () => "",
    orgName: () => "Local workspace",
    execPath: process.execPath,
    packaged: false,
    runAsNodeAvailable: false,
    // Deliberately absent: the sidecar exposes no BizOS/cloud MCP tool surface.
    mcpScriptPath: join(stateRoot, "disabled-bizos-mcp.mjs"),
    environment: safeHarnessEnvironment(),
    homeDir: homedir(),
    deniedDirs: [stateRoot, dirname(descriptorPath)],
    devices: false,
    localTeamTools: ({ bot, threadId, runId }) => {
      // Exchange the one-shot ticket inside the trusted host. Neither token
      // reaches Codex, its prompt, argv, environment, or the renderer.
      const session = teamBroker.exchange(teamBroker.issue({ botId: bot.id, threadId, runId }));
      const teamTools = LOCAL_TEAM_TOOL_SPECS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        call: async (argumentsValue: unknown) => {
          if (!facade) throw new HttpError(503, "not_ready", "Local team runtime is not ready.");
          const capability = teamBroker.authorize(session);
          if (tool.name === "recruit_agent") return facade.recruit(capability, argumentsValue);
          if (tool.name === "schedule_routine") return facade.scheduleRoutine(capability, argumentsValue);
          if (tool.name === "checkpoint_task") return facade.checkpointTask(capability, argumentsValue);
          return facade.manageAgent(capability, argumentsValue);
        },
      }));
      // The agency tools, for the pack's own agents only, under the SAME
      // capability: STOP or the end of the run revokes them with the rest.
      const agencyTools = agency?.isAgencyBot(bot.id)
        ? agency.dynamicTools(() => {
          const capability = teamBroker.authorize(session);
          return { botId: capability.botId, threadId: capability.threadId, runId: capability.runId };
        })
        : [];
      return [...teamTools, ...agencyTools];
    },
    // The same tools for Claude Code, which has no dynamic-tool slot:
    // a stdio MCP server, one per turn, holding a one-shot ticket that only
    // the child exchanges (it never reaches the CLI's argv or prompt). The
    // toolset rides in argv, per server; the sidecar re-checks every call.
    localTeamMcp: ({ bot, threadId, runId }) => ({
      command: process.execPath,
      args: [
        join(dirname(fileURLToPath(import.meta.url)), "local-team-mcp.js"),
        `--toolset=${agency?.isAgencyBot(bot.id) ? "team,agency" : "team"}`,
      ],
      env: { LOCALBIZOS_TEAM_ORIGIN: origin },
      forwarded: { LBZ_LOCAL_TEAM_TICKET: teamBroker.issue({ botId: bot.id, threadId, runId }) },
      preApproved: true,
    }),
    onLocalRunStopped: (runId) => {
      teamBroker.revoke(runId);
      agency?.abortRun(runId);
    },
    onLocalRunSettled: (runId) => {
      teamBroker.revoke(runId);
      // The pack's tools: requests still in flight for this run are abandoned.
      agency?.abortRun(runId);
    },
    localArchitecture: ({ bot, threadId, workspaceDir, sandbox, peers }) => ({
        mode: "local",
        instanceId: id,
        workspaceId: `local:${id}:workspace`,
        agentId: `local:${id}:agent:${bot.id}`,
        threadId: `local:${id}:thread:${threadId}`,
        workspaceDir,
        sandbox,
        supportedProviders: ["codex", "claude", "cursor"],
        peers: peers.map((peer) => ({ agentId: `local:${id}:agent:${peer.id}`, name: peer.name })),
        recruitment: "autonomous-codex",
      }),
  });
  // The agency pack shares this harness: its agents are roster bots, its
  // cockpit is one instance under `runtime/agency/`, started on demand and
  // closed with the sidecar.
  agency = new AgencyService({
    rootDir: harnessRoot,
    host: hostFromHarness(harness),
    log: (line) => process.stderr.write(`[localbizos] ${line}\n`),
  });
  const localFacade = new CollaborationFacade(harness, id, teamBroker, durableIndex(), agency);
  await startLocalHarness(harness, existsSync(join(harnessRoot, "settings.json")), () => {
    facade = localFacade;
  });
  // One workspace identity: the phone sees exactly the workspace id the
  // desktop bootstrap reports. Without LOCALBIZOS_RELAY_URL the connector
  // stays disconnected — there is no default relay, cloud or otherwise.
  connector = await RelayConnector.open({
    stateRoot,
    relayUrl: process.env.LOCALBIZOS_RELAY_URL,
    computerName: process.env.LOCALBIZOS_COMPUTER_NAME ?? "This Mac",
    backend: createMobileBackend(localFacade, { computerId: `computer_${id}`, workspaceId: localFacade.workspaceId, userId: localFacade.userId }),
    allowInsecureLoopbackRelay: process.env.LOCALBIZOS_ALLOW_INSECURE_LOOPBACK_RELAY === "1",
  });
  connector.start();
  const descriptor: Descriptor = { version: 1, origin, token, instanceId: id, pid: process.pid };
  privateWrite(descriptorPath, `${JSON.stringify(descriptor)}\n`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const current = readDescriptor();
    if (current?.pid === process.pid && current.instanceId === id) {
      try { unlinkSync(descriptorPath); } catch {}
    }
    connector?.stop();
    harness.stop();
    // Stop accepting calls immediately, but keep the process and state lock
    // until the CLI/MCP groups have exited (including SIGKILL escalation).
    server.close();
    server.closeAllConnections();
    // The cockpit goes with the sidecar: its port closes and `db.lock` is
    // released, so the next start does not find a live lock of its own.
    await agency?.close().catch((error: unknown) => {
      process.stderr.write(`[localbizos] agency cockpit close: ${error instanceof Error ? error.message : String(error)}\n`);
    });
    const childrenStopped = await waitForCliShutdown();
    stateLock.release();
    process.exit(childrenStopped ? 0 : 1);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

async function start(): Promise<void> {
  privateDirectory(stateRoot);
  const existing = readDescriptor();
  if (existing && await descriptorHealthy(existing)) {
    process.stdout.write(`sidecar=up\norigin=${existing.origin}\ndescriptor=${descriptorPath}\n`);
    return;
  }
  if (existing && descriptorProcessIsOurs(existing)) {
    throw new Error("A local sidecar process exists but failed its authenticated health check.");
  }
  const log = openSync(logPath, "a", 0o600);
  chmodSync(logPath, 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    cwd: packageRoot,
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  closeSync(log);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const descriptor = readDescriptor();
    if (descriptor && await descriptorHealthy(descriptor)) {
      process.stdout.write(`sidecar=up\norigin=${descriptor.origin}\ndescriptor=${descriptorPath}\n`);
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Sidecar did not become ready; inspect ${logPath}`);
}

async function stop(): Promise<void> {
  const descriptor = readDescriptor();
  if (!descriptor || !descriptorProcessIsOurs(descriptor)) {
    process.stdout.write("sidecar=down\n");
    return;
  }
  if (!signalProcessGroup(descriptor.pid)) {
    // An absent process group does not mean an absent process: a foreground
    // `serve` leads no group of its own. Re-prove the identity, then signal the
    // PID alone. Descriptor and lock repair stay explicit either way, because
    // another process may already own either path and `stop` must never unlink
    // ambiguous state.
    const identity = await identifyDescriptorProcess(descriptor);
    if (identity === "unknown") {
      throw new Error(
        `Refusing to stop PID ${descriptor.pid}: it is alive and runs a sidecar serve, but did not prove `
        + `it is this instance (${descriptor.instanceId}, state ${stateRoot}). `
        + "Stop it from its own owner, or repair the descriptor deliberately.",
      );
    }
    if (identity === "absent" || !signalProcess(descriptor.pid)) {
      process.stdout.write("sidecar=down\n");
      return;
    }
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!descriptorProcessIsOurs(descriptor)) {
      process.stdout.write("sidecar=down\n");
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Sidecar ${descriptor.pid} did not stop cleanly.`);
}

async function status(): Promise<void> {
  const descriptor = readDescriptor();
  const healthy = descriptor ? await descriptorHealthy(descriptor) : false;
  process.stdout.write([
    `sidecar=${healthy ? "up" : "down"}`,
    ...(healthy && descriptor ? [`origin=${descriptor.origin}`, `instanceId=${descriptor.instanceId}`] : []),
    `descriptor=${descriptorPath}`,
    `state=${stateRoot}`,
  ].join("\n") + "\n");
  if (!healthy) process.exitCode = 1;
}

function repairLock(): void {
  privateDirectory(stateRoot);
  repairStateLock(lockPath);
  process.stdout.write("sidecar_lock=repaired\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (action === "serve") await serve();
  else if (action === "start") await start();
  else if (action === "stop") await stop();
  else if (action === "status") await status();
  else if (action === "repair-lock") repairLock();
  else throw new Error("Usage: sidecar.js start|stop|status|serve|repair-lock");
}
