import { CloudExecution } from "./harness/cloud-execution.js";
import { BizosInferenceSelection } from "./harness/bizos-inference.js";
import { localComputerEnabled } from "./computer/release.js";
import { ContinuityBridgeError, desktopContinuityTransport } from "./continuity-bridge.js";
import { CONTINUITY_MCP_OPERATIONS } from "./continuity-tools.js";
import { cliCredentialPaths, runtimeProtectedPaths } from "./harness/secret-shield.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { LocalBizosHarness } from "./harness/harness.js";
import { waitForCliShutdown } from "./harness/procs.js";
import { MANAGED_ENTITLEMENT_ENV } from "./harness/managed-entitlement.js";
import { ProRequiredError, type ProFeature } from "./harness/entitlement.js";
import { isTemplateId, parseCreationOptions } from "./harness/templates.js";
import {
  targetForThreadId,
  threadIdForTarget,
  type AskAnswer,
  type AskAnsweredKind,
  type AskChoice,
  type AskDetails,
  type AskImpact,
  type AskStatus,
  type Bot,
  type Group,
  type MessageBlock,
  type Run,
  type ThreadMessage,
  type ThreadSnapshot,
  type ProductEvent,
  type ThreadTarget,
} from "./harness/types.js";
import { buildHandlers, runHandler } from "./ipc.js";
import { mimeTypeFor } from "./harness/chat-outputs.js";
import type { RuntimeSettings, Routine } from "./harness/types.js";
import type { PublicPlan } from "./harness/plan-types.js";
import {
  emptyDurableIndex,
  LOCAL_BACKEND_CAPABILITIES,
  LOCAL_PROVIDERS,
  normalizeDurableIndex,
  type DurableIndex,
  type DurableVoiceCall,
  type AgentManagementResult,
  type LocalRoutineEventChanges,
  type LocalRoutineEventType,
  type LocalTeamEvent,
  type RecruitmentResult,
} from "./sidecar-contract.js";
import { LocalEventHub, serveEventStream } from "./local-events.js";
import {
  resolveVoiceBinding,
  VoiceTaskError,
  type VoiceBinding,
  type VoiceCallMutationResponse,
  type VoiceCallSnapshot,
  type VoiceCallState,
} from "./voice-tasks.js";
import { acquireStateLock, readStrictJson, repairStateLock } from "./sidecar-state.js";
import { BIZOS_TOOL_SPECS, CONTEXT_TOOL_SPECS, LOCAL_TEAM_TOOL_SPECS, isCloudToolName } from "./local-team-mcp.js";
import { ContextReferenceError } from "./harness/context-reference.js";
import { COMPUTER_TOOL_SPECS, isComputerToolName } from "./computer/tools.js";
import { BoatError, CloudComputer, CloudComputerError } from "./computer/cloud.js";
import { RemoteServerComputerBackend } from "./computer/remote-server.js";
import { Storage } from "./harness/storage.js";
import { AgencyService } from "./harness/agency.js";
import { EcommerceService } from "./harness/ecommerce.js";
import { PackError, type PackService, type PackState } from "./harness/pack.js";
import { isAgencyToolName } from "./harness/agency-tools.js";
import { isCommerceToolName } from "./harness/commerce-tools.js";
import { parseAvatarDataUrl, safeAvatarDataUrl } from "./harness/avatar.js";
import { AvatarGenerationError, type AvatarWorkerReport } from "./harness/bots.js";
import { newId, newMessageId } from "./harness/ids.js";
import type { PackHost } from "./harness/pack.js";
import { cronForTrigger, endsAtFromToolInput, publicRoutine, publicRoutineRun, routineVersion, triggerFromToolInput, type PublicRoutine, type PublicRoutineRun } from "./routines-public.js";
import { pairingAdminRoute } from "./mobile/admin-routes.js";
import { createMobileBackend } from "./mobile/backend.js";
import { RelayConnector } from "./mobile/connector.js";
import { readLocalDashboardSummary, type DashboardPlan, type DashboardProvider } from "./dashboard-summary.js";
import { CloudLink, CloudLinkError, DEFAULT_WEB_ORIGIN, webOrigin } from "./cloud-link.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_ROOT_VARIABLE = "LOCALBIZOS_SIDECAR_STATE";
const defaultStateRoot = resolve(join(homedir(), "Library", "Application Support", "BizOS-local-harness"));
const stateRoot = resolve(process.env[STATE_ROOT_VARIABLE] ?? defaultStateRoot);
const descriptorPath = resolve(
  process.env.LOCALBIZOS_SIDECAR_DESCRIPTOR
    ?? join(homedir(), "Library", "Application Support", "BizOS-desktop", "local-harness.json"),
);
const harnessRoot = join(stateRoot, "runtime");
/** Absolute paths the desktop asks the shield to cover (JSON array, e.g. its
 * cookie store). Malformed input protects nothing extra rather than failing. */
function desktopProtectedPaths(): string[] {
  try {
    const parsed: unknown = JSON.parse(process.env.LOCALBIZOS_PROTECTED_PATHS ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.startsWith("/")) : [];
  } catch {
    return [];
  }
}
const instancePath = join(stateRoot, "instance.json");
const indexPath = join(stateRoot, "collaboration-index.json");
const logPath = join(stateRoot, "sidecar.log");
const lockPath = join(stateRoot, "sidecar.lock");
const action = process.argv[2] ?? "status";
const MAX_BODY_BYTES = 64 * 1024;
// Chat text is separate from the small control API payloads. Keep a transport
// safety bound while avoiding the old 20,000-character product limit.
const MAX_COLLABORATION_MESSAGE_BYTES = 32 * 1024 * 1024;
const NATIVE_COMPUTER_DESCRIPTOR_VARIABLE = "LOCALBIZOS_NATIVE_COMPUTER_DESCRIPTOR";

interface Descriptor {
  version: 1;
  origin: string;
  token: string;
  instanceId: string;
  pid: number;
}

/** One file or image an agent sent (docs/specs/chat-outputs/01, 02). The
 * bytes are at `path` in the workspace; `url` serves the same bytes from
 * this sidecar under the owner bearer (`GET /api/local/attachments/<id>`),
 * for a client that would rather not read the disk itself. */
export interface CollaborationAttachment {
  id: string;
  kind: "image" | "file";
  fileName: string;
  contentType: string;
  size?: number;
  width?: number;
  height?: number;
  alt?: string;
  path?: string;
  url: string;
  status: "ready";
}

/** The card for a reply's first external link (03-links.md §6). */
export interface CollaborationPreview {
  url: string;
  title?: string;
  description?: string;
  domain?: string;
  date?: string;
  image?: { id: string; url: string; contentType: string; size: number; width?: number; height?: number };
}

/** A permission or question card, with the weight fields of 04-approvals.md. */
export interface CollaborationAsk {
  askId: string;
  runId: string;
  requestType: "permission" | "question";
  tool: string;
  summary: string;
  detailText?: string;
  choices?: AskChoice[];
  action?: string;
  target?: string;
  impact?: AskImpact;
  reversible?: boolean;
  allowAlways?: boolean;
  details?: AskDetails;
  status: AskStatus;
  answered?: { kind: AskAnsweredKind; at: string };
}

interface CollaborationMessage {
  deliveryState?: "complete";
  setupError?: "ai-unavailable";
  id: string;
  threadId: string;
  role: "user" | "assistant";
  /** The words, exactly as before attachments existed: an older desktop
   * sees the same text it always did. */
  content: string;
  createdAt: string;
  senderType: "human" | "agent" | "assistant";
  senderUserId: string | null;
  senderAgentId: string | null;
  senderName: string;
  clientMessageId: string | null;
  runId: string | null;
  replyToMessageId: string | null;
  /** Additive (2026-09-26): absent when there is nothing of the kind. */
  attachments?: CollaborationAttachment[];
  links?: Array<{ label: string; url: string }>;
  preview?: CollaborationPreview;
  /** The latest ask card on this message, when it carries one. */
  ask?: CollaborationAsk;
  /** Onboarding in the chat (2026-09-26): short tappable answers under this
   * reply, and one proposal the person accepts or changes. Absent otherwise. */
  quickReplies?: string[];
  proposal?: { kind: "company-name"; value: string };
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
    // The local plan tier override (entitlement.ts) is read by the harness.
    "BIZOS_LOCAL_PLAN",
  ]) {
    if (key === "BIZOS_LOCAL_PLAN" && process.env[MANAGED_ENTITLEMENT_ENV] === "1") continue;
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

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, max);
}

const ROLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASSIGNMENT_MARKER = "\n\n<!-- local-bizos-current-assignment -->\n## Current bounded assignment\n";

interface RoleBlueprint {
  templateId: "lead-gen-agency" | "service-based-business" | "software";
  slug: string;
  name: string;
  title: string;
  description: string;
  system: string;
}

function assignmentInstructions(base: string, context?: string, instructions?: string): string {
  const blueprint = base.split(ASSIGNMENT_MARKER)[0]!.trim();
  const assignment = [context, instructions].filter(Boolean).join("\n\n").trim();
  return assignment ? `${blueprint}${ASSIGNMENT_MARKER}${assignment}` : blueprint;
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

function brainOpenPath(value: unknown, mode: string): string {
  if (value === "" && mode === "reveal") return "";
  return requiredString(value, "path", 1024);
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

async function bodyOf(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new HttpError(413, "payload_too_large", "Request body is too large.");
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
  // The one error with a flat shape: the desktop reads `error === "pro_required"`
  // and shows the upgrade sheet for `feature`.
  if (error instanceof ProRequiredError) {
    sendJson(response, 402, { error: "pro_required", feature: error.feature, message: error.message });
    return;
  }
  if (error instanceof ContinuityBridgeError) {
    const message = error.code === "budget_exhausted" ? "Your BizOS credit is insufficient for this run." : error.message;
    sendJson(response, error.status, { error: { code: error.code, message: message.slice(0, 500) } });
    return;
  }
  const failure = error instanceof HttpError
    ? error
    : new HttpError(500, "local_runtime_error", error instanceof Error ? error.message : String(error));
  sendJson(response, failure.status, { error: { code: failure.code, message: failure.message.slice(0, 500) } });
}

/** A cloud computer failure, as the local HTTP contract speaks it. */
function cloudHttpError(error: unknown): unknown {
  if (error instanceof CloudComputerError) {
    if (error.code === "pro_required") return new ProRequiredError("cloudComputer");
    const status = error.code === "invalid_payload" ? 400 : error.code === "not_configured" ? 409 : 502;
    return new HttpError(status, error.code, error.message);
  }
  if (error instanceof BoatError) return new HttpError(502, `boat_${error.code}`, error.message);
  return error;
}

function routeId(pathname: string, pattern: RegExp): string | null {
  const match = pathname.match(pattern);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function processCommand(pid: number): string {
  if (process.platform === 'win32') {
    const command = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
  }
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
  if (process.platform === 'win32') return '';
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
  if (process.platform === 'win32') return false;
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

function textOf(blocks: readonly MessageBlock[], maxChars = 20_000): string {
  return blocks.flatMap((block) => {
    if (block.kind === "text" || block.kind === "meta") return [block.text];
    if (block.kind === "card") return [[block.title, block.body].filter(Boolean).join("\n")];
    if (block.kind === "ask") return [block.summary];
    if (block.kind === "progress") return [[block.phase, block.detail].filter(Boolean).join(": ")];
    return [];
  }).filter(Boolean).join("\n\n").slice(0, maxChars);
}

/** `/api/local/attachments/<id>`, relative to this sidecar's origin. */
function attachmentUrl(id: string): string {
  return `/api/local/attachments/${encodeURIComponent(id)}`;
}

/** The `image` / `file` blocks of a message as the desktop contract. Only
 * an agent's attachment (one with an `id` and a `path`) is listed: a
 * person's own upload already reached the desktop as a data URL. */
function attachmentsOf(blocks: readonly MessageBlock[]): CollaborationAttachment[] {
  const out: CollaborationAttachment[] = [];
  for (const block of blocks) {
    if (block.kind === "image" && block.id && block.path) {
      out.push({
        id: block.id, kind: "image", fileName: block.fileName ?? basename(block.path),
        contentType: block.mimeType ?? "application/octet-stream",
        ...(block.size !== undefined ? { size: block.size } : {}),
        ...(block.width !== undefined && block.height !== undefined ? { width: block.width, height: block.height } : {}),
        ...(block.alt ? { alt: block.alt } : {}),
        path: block.path, url: attachmentUrl(block.id), status: "ready",
      });
    } else if (block.kind === "file" && block.id && block.path) {
      out.push({
        id: block.id, kind: "file", fileName: block.name, contentType: block.mimeType ?? "application/octet-stream",
        ...(block.size !== undefined ? { size: block.size } : {}),
        path: block.path, url: attachmentUrl(block.id), status: "ready",
      });
    }
  }
  return out;
}

function askOf(block: Extract<MessageBlock, { kind: "ask" }>, status: AskStatus = block.status): CollaborationAsk {
  return {
    askId: block.askId,
    runId: block.runId,
    requestType: block.requestType,
    tool: block.tool,
    summary: block.summary,
    ...(block.detailText ? { detailText: block.detailText } : {}),
    ...(block.choices ? { choices: block.choices } : {}),
    ...(block.action ? { action: block.action } : {}),
    ...(block.target ? { target: block.target } : {}),
    ...(block.impact ? { impact: block.impact } : {}),
    ...(block.reversible !== undefined ? { reversible: block.reversible } : {}),
    ...(block.allowAlways !== undefined ? { allowAlways: block.allowAlways } : {}),
    ...(block.details ? { details: block.details } : {}),
    status,
    ...(block.answered ? { answered: block.answered } : {}),
  };
}

function previewOfMessage(message: ThreadMessage): CollaborationPreview | undefined {
  const preview = message.preview;
  if (!preview) return undefined;
  return {
    url: preview.url,
    ...(preview.title ? { title: preview.title } : {}),
    ...(preview.description ? { description: preview.description } : {}),
    ...(preview.domain ? { domain: preview.domain } : {}),
    ...(preview.date ? { date: preview.date } : {}),
    ...(preview.image ? { image: {
      id: preview.image.id, url: attachmentUrl(preview.image.id), contentType: preview.image.contentType, size: preview.image.size,
      ...(preview.image.width !== undefined && preview.image.height !== undefined ? { width: preview.image.width, height: preview.image.height } : {}),
    } } : {}),
  };
}

/**
 * The files this sidecar may serve, by attachment id.
 *
 * Filled from the messages it serialises — the transcript is the record of
 * what an agent sent — never from a request. Serving checks the file is still
 * the same regular file (no symlink swapped in since) before a byte leaves.
 */
class AttachmentRegistry {
  private readonly paths = new Map<string, { path: string; threads: Set<string> }>();

  remember(id: string, path: string, threadId: string): void {
    if (!/^(?:att|prv)_[A-Za-z0-9]+$/.test(id) || !path) return;
    const record = this.paths.get(id) ?? { path, threads: new Set<string>() };
    record.threads.add(threadId);
    this.paths.set(id, record);
  }

  forgetThread(threadId: string): void {
    for (const [id, record] of this.paths) {
      record.threads.delete(threadId);
      if (!record.threads.size) this.paths.delete(id);
    }
  }

  /** The path, or null when unknown or no longer a plain file at that path. */
  resolve(id: string): string | null {
    const path = this.paths.get(id)?.path;
    if (!path) return null;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) return null;
      if (realpathSync(path) !== path) return null;
      return path;
    } catch {
      return null;
    }
  }
}

interface TeamCapability {
  botId: string;
  threadId: string;
  runId: string;
  expiresAt: number;
  /** A voice run: the team tools are mounted (same resume fingerprint as a
   * typed turn) but every call is refused by `authorize`. */
  teamDelegationBlocked?: boolean;
}

/** `GET /api/local/agency` and `GET /api/local/ecommerce` — the desktop
 * contract for a pack: the public agency shape, plus the bound vault. */
export interface PackStatus {
  installed: boolean;
  status: "not-installed" | "installing" | "ready" | "error";
  template: { id: string; name: string; version: number };
  dashboardUrl: string | null;
  bots: Array<{ id: string; name: string; slug: string; threadId: string }>;
  teamThreadId: string | null;
  skillsCount: number;
  rootId: string | null;
  vaultPath: string | null;
  boundTemplateId: string | null;
  error?: string;
}

/** The two packs the sidecar hosts, by the route that names them. */
export interface Packs {
  agency: PackService;
  ecommerce: PackService;
}

export class LocalTeamBroker {
  private readonly tickets = new Map<string, TeamCapability>();
  private readonly sessions = new Map<string, TeamCapability>();
  private authorityCheck?: (capability: TeamCapability) => void;
  setAuthorityCheck(check: (capability: TeamCapability) => void): void { this.authorityCheck = check; }

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

  /** Every team and pack tool call passes here (dynamic tools and the Claude
   * MCP bridge alike), so this is where a voice run's calls are refused. */
  authorize(session: string, options: { allowDuringVoice?: boolean } = {}): TeamCapability {
    const capability = this.sessions.get(session);
    if (!capability || capability.expiresAt <= Date.now()) {
      this.sessions.delete(session);
      throw new HttpError(401, "invalid_team_capability", "Local team capability is invalid or expired.");
    }
    if (capability.teamDelegationBlocked && !options.allowDuringVoice) {
      throw new HttpError(
        403,
        "team_delegation_unavailable_in_voice",
        "Team recruitment and handoff are unavailable during a voice task. Do the work yourself or tell the user to continue in the chat.",
      );
    }
    this.authorityCheck?.(capability);
    return capability;
  }
}

export class CollaborationFacade {
  private readonly handlers;
  private cloudController?: CloudExecution;
  private readonly bizos: BizosInferenceSelection;
  private get cloud(): CloudExecution {
    return this.cloudController ??= new CloudExecution(this.harness.storage, this.harness.continuity);
  }
  private mutationTail: Promise<unknown> = Promise.resolve();
  private readonly importedRemote: Set<string>;
  private quickChatIndexDirty = false;
  readonly userId: string;
  readonly workspaceId: string;

  constructor(
    private readonly harness: LocalBizosHarness,
    readonly instanceId: string,
    private readonly teamBroker: LocalTeamBroker,
    private readonly index: DurableIndex = durableIndex(),
    private readonly packs: Packs | null = null,
    private readonly persistIndex: (value: DurableIndex) => void = saveIndex,
    inferenceBridge?: ReturnType<typeof desktopContinuityTransport>,
  ) {
    this.bizos = new BizosInferenceSelection(harness.storage, inferenceBridge);
    this.handlers = buildHandlers(harness);
    this.importedRemote = new Set(harness.storage.readJsonStrict<string[]>("continuity-imported-remote.json", []));
    this.userId = `local:${instanceId}:user`;
    this.workspaceId = `local:${instanceId}:workspace`;
    // Routine events are recorded whether or not a desktop is listening; the
    // bus is cleared (and this listener with it) when the harness stops.
    harness.events?.subscribe((event) => this.onHarnessEvent(event));
    // Startup expiry runs before a facade exists. Replay opaque tombstones to
    // erase its separate idempotency journal after a crash/restart as well.
    for (const id of harness.quickChats?.expiredIds?.() ?? []) this.purgeQuickChatIndex(`chat:${id}`);
  }

  /** Open `GET /api/local/events` streams. */
  readonly streams = new LocalEventHub();

  /** Files agents sent, for `GET /api/local/attachments/<id>`. */
  readonly attachments = new AttachmentRegistry();

  private purgeQuickChatIndex(threadId: string): void {
    let changed = false;
    for (const [requestId, record] of Object.entries(this.index.messages)) {
      if (record.threadId !== threadId) continue;
      if (record.state === "completed") for (const runId of record.runIds) delete this.index.runTriggers[runId];
      delete this.index.messages[requestId];
      changed = true;
    }
    this.attachments.forgetThread(threadId);
    this.quickChatIndexDirty ||= changed;
    if (this.quickChatIndexDirty) { this.persistIndex(this.index); this.quickChatIndexDirty = false; }
  }

  private onHarnessEvent(event: ProductEvent): void {
    try {
      if (event.type === "quick-chat.expired") {
        this.purgeQuickChatIndex(event.threadId);
        this.streams.publish({ event: "thread", data: {
          threadId: this.publicThreadId({ chatId: event.chatId }), change: "deleted", reason: "expired",
        } });
        return;
      }
      if (event.type === "thread.message.created" || event.type === "thread.message.updated") {
        const target = targetForThreadId(event.threadId);
        // Only what `messagePage` would serve: no system lines, no private
        // control records (a silent routine's turn leaves one of those).
        if (!target || !this.message(event.message, target, [])) return;
        this.streams.publish({ event: "message", data: {
          threadId: this.publicThreadId(target),
          messageId: this.messageId(event.message.id),
          change: event.type === "thread.message.created" ? "created" : "updated",
        } });
        return;
      }
      if (event.type === "run.started" || event.type === "run.waiting_input" || event.type === "run.completed"
        || event.type === "run.failed" || event.type === "run.cancelled") {
        const target = targetForThreadId(event.threadId);
        if (!target) return;
        const state = event.type === "run.completed" ? "done" as const
          : event.type === "run.failed" ? "failed" as const
          : event.type === "run.cancelled" ? "cancelled" as const
          : "running" as const;
        this.streams.publish({ event: "run", data: { runId: this.runId(event.runId), threadId: this.publicThreadId(target), state } });
        return;
      }
      if (event.type === "routine.fired") {
        const target = targetForThreadId(event.threadId) ?? { botId: event.botId };
        const current = this.harness.routines.peek?.(event.routineId);
        this.recordTeamEvent("routine.fired", {
          actorBotId: event.botId,
          ownerBotId: event.botId,
          runId: this.runId(event.runId),
          threadId: this.publicThreadId(target),
          createdAt: event.at,
          changes: this.routineChanges({
            id: event.routineId,
            name: event.routine.name,
            trigger: event.routine.trigger,
            ...(event.routine.endsAt ? { endsAt: event.routine.endsAt } : {}),
            ...(current ? { enabled: current.enabled, ...(current.nextRunAt ? { nextRunAt: current.nextRunAt } : {}) } : {}),
          }),
        });
        return;
      }
      if (event.type === "routine.updated") {
        const routine = this.harness.routines.peek?.(event.routineId);
        if (!routine) return;
        this.recordTeamEvent("routine.updated", {
          actorBotId: routine.botId,
          ownerBotId: routine.botId,
          runId: this.runId("none"),
          threadId: this.publicThreadId({ botId: routine.botId }),
          createdAt: event.at,
          changes: { ...this.routineChanges(routine), reason: event.reason },
        });
      }
    } catch (error) {
      process.stderr.write(`[localbizos] event projection: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  private routineChanges(routine: Pick<Routine, "id" | "name" | "trigger"> & Partial<Pick<Routine, "endsAt" | "enabled" | "nextRunAt">>): LocalRoutineEventChanges {
    return {
      routineId: routine.id,
      routineName: routine.name,
      schedule: cronForTrigger(routine.trigger),
      trigger: routine.trigger,
      nextRunAt: routine.enabled === false ? null : routine.nextRunAt ?? null,
      endsAt: routine.endsAt ?? null,
      ...(routine.enabled === undefined ? {} : { enabled: routine.enabled }),
    };
  }

  /** Append a routine team event to the durable index and push it. */
  private recordTeamEvent(type: LocalRoutineEventType, input: {
    actorBotId: string;
    ownerBotId: string;
    runId: string;
    threadId: string;
    createdAt?: string;
    changes: LocalRoutineEventChanges;
  }): LocalTeamEvent {
    const event: LocalTeamEvent = {
      eventId: `local:${this.instanceId}:team-event:${randomUUID()}`,
      type,
      actorAgentId: this.agentId(input.actorBotId),
      subjectAgentId: this.agentId(input.ownerBotId),
      runId: input.runId,
      threadId: input.threadId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      changes: input.changes,
    };
    this.index.events = [...this.index.events, event].slice(-1_000);
    this.persistIndex(this.index);
    this.streams.publish({ event: "team-event", data: event });
    return event;
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

  private agent(bot: Bot, desktopBootstrap = false) {
    const avatar = safeAvatarDataUrl(bot.avatarUrl);
    return {
      agentId: this.agentId(bot.id),
      slug: this.slug(bot),
      name: bot.name,
      title: bot.title ?? null,
      description: bot.description ?? null,
      avatarKind: avatar ? (bot.avatarKind === "generated" ? "generated" as const : "upload" as const) : "procedural" as const,
      avatarHash: avatar?.hash ?? null,
      ...(bot.avatarGeneration ? { avatarGeneration: bot.avatarGeneration } : {}),
      ...(desktopBootstrap ? { avatarDataUrl: avatar?.dataUrl ?? null } : {}),
    };
  }

  /** Resolve a role only from this workspace's verified bound company vault.
   * Every path component and file is lstat'ed so a user-visible role library
   * cannot be replaced by a link into another company or arbitrary folder. */
  private roleBlueprint(roleSlug: string): RoleBlueprint {
    if (!ROLE_SLUG.test(roleSlug)) throw new HttpError(422, "invalid_role", "role_slug must be a lowercase role slug.");
    const binding = this.harness.workspaceTemplate.current();
    if (!binding || !["lead-gen-agency", "service-based-business", "software"].includes(binding.templateId)) {
      throw new HttpError(409, "role_catalog_unavailable", "The current company has no on-demand role catalog.");
    }
    try {
      const rolesDir = join(binding.path, "Roles");
      const roleDir = join(rolesDir, roleSlug);
      const jsonPath = join(roleDir, "role.json");
      const systemPath = join(roleDir, "system.md");
      for (const [path, label, kind] of [
        [binding.path, "bound vault", "directory"],
        [rolesDir, "Roles", "directory"],
        [roleDir, `role ${roleSlug}`, "directory"],
        [jsonPath, "role.json", "file"],
        [systemPath, "system.md", "file"],
      ] as const) {
        const stats = lstatSync(path);
        if (stats.isSymbolicLink() || (kind === "directory" ? !stats.isDirectory() : !stats.isFile())) {
          throw new Error(`${label} is not a regular ${kind}`);
        }
      }
      if (realpathSync(roleDir) !== join(realpathSync(rolesDir), roleSlug)) throw new Error("role path leaves Roles");
      if (lstatSync(jsonPath).size > 8_192 || lstatSync(systemPath).size > 15_000) throw new Error("role data is too large");
      const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
      const name = requiredString(raw.name, "role name", 60);
      const title = requiredString(raw.title, "role title", 80);
      const description = requiredString(raw.description, "role description", 600);
      const system = readFileSync(systemPath, "utf8").trim();
      if (raw.version !== 1 || raw.templateId !== binding.templateId || raw.slug !== roleSlug || /[\r\n]/.test(name) || /[\r\n]/.test(title) || !system) {
        throw new Error("role metadata does not match the bound company");
      }
      return { templateId: binding.templateId as RoleBlueprint["templateId"], slug: roleSlug, name, title, description, system };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, "invalid_role", `Role ${roleSlug} is missing, linked or corrupt; nothing was recruited.`);
    }
  }

  private clientIdForMessage(messageId: string): string | null {
    return Object.entries(this.index.messages)
      .find(([, value]) => value.state === "completed" && value.messageId === messageId)?.[0] ?? null;
  }

  private message(message: ThreadMessage, target: ThreadTarget, bots: readonly Bot[]): CollaborationMessage | null {
    // A run's control line (e.g. "permissions are off") is a note about the
    // turn, kept in the transcript for the record — never a chat bubble:
    // bubbles are what the agents actually say.
    if (message.role === "system" || message.deliveryState === "control") return null;
    const publicBlocks = message.blocks.filter(block => block.kind !== "meta");
    if (message.role === "bot" && !textOf(publicBlocks) && message.blocks.length > 0 && message.blocks.every(block => block.kind === "meta")) return null;
    const publicThreadId = this.publicThreadId(target);
    const botId = message.botId ?? ("botId" in target ? target.botId : undefined);
    const bot = botId ? bots.find((candidate) => candidate.id === botId) : undefined;
    const attachments = message.role === "bot" ? attachmentsOf(publicBlocks) : [];
    for (const attachment of attachments) if (attachment.path) this.attachments.remember(attachment.id, attachment.path, message.threadId);
    const preview = message.role === "bot" ? previewOfMessage(message) : undefined;
    if (message.preview?.image) this.attachments.remember(message.preview.image.id, message.preview.image.path, message.threadId);
    const askBlock = [...publicBlocks].reverse().find((block): block is Extract<MessageBlock, { kind: "ask" }> => block.kind === "ask");
    const quickReplies = message.role === "bot" ? [...publicBlocks].reverse().find((block): block is Extract<MessageBlock, { kind: "quick_replies" }> => block.kind === "quick_replies")?.choices : undefined;
    const proposal = message.role === "bot" ? [...publicBlocks].reverse().find((block): block is Extract<MessageBlock, { kind: "proposal" }> => block.kind === "proposal") : undefined;
    return {
      id: this.messageId(message.id),
      threadId: publicThreadId,
      role: message.role === "user" ? "user" : "assistant",
      content: textOf(publicBlocks, message.role === "user" ? Number.MAX_SAFE_INTEGER : 20_000),
      ...(message.setupError ? { setupError: message.setupError } : {}),
      ...(message.deliveryState === "complete" ? { deliveryState: "complete" as const } : {}),
      createdAt: message.createdAt,
      senderType: message.role === "user" ? "human" : "chatId" in target ? "assistant" : "agent",
      senderUserId: message.role === "user" ? this.userId : null,
      senderAgentId: message.role === "bot" && botId && !("chatId" in target) ? this.agentId(botId) : null,
      senderName: message.role === "user" ? "Local owner" : "chatId" in target ? "Assistant" : bot?.name ?? "Local agent",
      clientMessageId: this.clientIdForMessage(message.id),
      runId: message.runId ? this.runId(message.runId) : null,
      replyToMessageId: message.replyToMessageId ? this.messageId(message.replyToMessageId) : null,
      ...(attachments.length ? { attachments } : {}),
      ...(message.links?.length ? { links: message.links } : {}),
      ...(preview ? { preview } : {}),
      ...(askBlock ? { ask: askOf(askBlock) } : {}),
      ...(quickReplies?.length ? { quickReplies } : {}),
      ...(proposal ? { proposal: { kind: proposal.proposalKind, value: proposal.value } } : {}),
    };
  }

  /** `GET /api/local/attachments/<id>`: the bytes of a file an agent sent,
   * or of a link-preview image, from the transcript's own record. */
  attachment(id: string): { path: string; contentType: string; size: number } | null {
    this.harness.quickChats?.expiredIds?.();
    const path = this.attachments.resolve(id);
    if (!path) return null;
    const contentType = mimeTypeFor(basename(path));
    return { path, contentType, size: statSync(path).size };
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
    if ("chatId" in target) {
      const snapshot = await this.harness.quickChats.get(target.chatId);
      return { id: this.publicThreadId(target), kind: "chat" as const, name: snapshot.chat.title,
        updatedAt: snapshot.chat.updatedAt, expiresAt: snapshot.chat.expiresAt, humanUserIds: [this.userId], agentIds: [],
        canPost: true, canManage: false, lastMessage: messages.at(-1) ?? null };
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
    // A team group made by a recruitment is the agents' own channel: the
    // person reads it from each member's chat, it is not a group of theirs.
    const teamOnly = Object.values(this.index.recruiterGroups).includes(group.id)
      || Object.values(this.index.roleBindings).some((binding) => binding.groupId === group.id);
    return {
      id: this.publicThreadId(target), kind: "group" as const, name: group.name,
      updatedAt: snapshot.updatedAt, humanUserIds: [this.userId], agentIds: group.memberIds.map((id) => this.agentId(id)),
      canPost: true, canManage: true, lastMessage: messages.at(-1) ?? null, teamOnly,
    };
  }

  async bootstrap() {
    for (const id of this.harness.quickChats?.expiredIds?.() ?? []) this.purgeQuickChatIndex(`chat:${id}`);
    const [bots, groups, plans, settings, quickChats, inference] = await Promise.all([
      this.invoke<Bot[]>("lbz:bots:list"),
      this.invoke<Group[]>("lbz:groups:list"),
      this.invoke<PublicPlan[]>("lbz:plans:list"),
      this.invoke<RuntimeSettings>("lbz:runtime:getSettings"),
      this.harness.quickChats.list(),
      this.invoke<{ providers: Array<{ id: string; kind: string }> }>("lbz:inference:list"),
    ]);
    const selectedExternal = inference.providers.find(provider => provider.id === settings.local.inferenceProviderId);
    const visibleBots = bots.filter((bot) => !bot.archived);
    const visibleGroups = groups.filter((group) => !group.archived);
    const threads = (await Promise.all([
      ...quickChats.chats.map(async chat => {
        try { return await this.thread({ chatId: chat.id }, visibleBots, visibleGroups); }
        catch (error) {
          // Expiry can cross the awaits between the list and its snapshots.
          if (this.harness.quickChats.expiredIds().includes(chat.id)) return null;
          throw error;
        }
      }),
      ...visibleBots.map((bot) => this.thread({ botId: bot.id }, visibleBots, visibleGroups)),
      ...visibleGroups.map((group) => this.thread({ groupId: group.id }, visibleBots, visibleGroups)),
    ])).filter(thread => thread !== null);
    return {
      contractVersion: 1 as const,
      backend: {
        mode: "local" as const,
        instanceId: this.instanceId,
        workspaceId: this.workspaceId,
        companyName: this.harness.workspaceTemplate.companyName(),
        persistence: "device" as const,
        runtime: "byo-cli-and-ollama" as const,
        cloudOrgId: null,
      },
      session: { userId: this.userId, workspaceId: this.workspaceId, access: "owner" as const },
      capabilities: { ...LOCAL_BACKEND_CAPABILITIES, computer: this.harness.computerToolsAvailable() },
      providers: {
        supported: LOCAL_PROVIDERS,
        configured: [...new Set([...plans.filter((plan) => plan.status !== "disconnected").map((plan) => plan.provider), ...(inference.providers.some(provider => provider.kind === "ollama") ? ["ollama"] : [])])],
        selected: selectedExternal?.kind === "ollama" ? "ollama" : settings.local.provider ?? null,
        recruitment: { codex: true, claude: true, cursor: true, ollama: true },
      },
      humans: [{ userId: this.userId, displayName: "Local owner", email: null, isSelf: true }],
      agents: visibleBots.map((bot) => this.agent(bot, true)),
      threads,
      teamEvents: this.index.events.slice(-100),
    };
  }

  async threads() {
    return { threads: (await this.bootstrap()).threads };
  }

  private async ensureAutoLinked(target: ThreadTarget): Promise<boolean> {
    const continuity = this.harness.continuity;
    if (!continuity.backupEnabled()) return false;
    const localId = threadIdForTarget(target);
    if (continuity.store.status(localId)) return true;
    const identity = await continuity.identity();
    if (!identity.orgId || !identity.userId) return false;
    const bots = await this.invoke<Bot[]>("lbz:bots:list");
    const groups = await this.invoke<Group[]>("lbz:groups:list");
    const title = "botId" in target ? bots.find(bot => bot.id === target.botId)?.name
      : "groupId" in target ? groups.find(group => group.id === target.groupId)?.name
      : (await this.harness.quickChats.get(target.chatId)).chat.title;
    if (!title) return false;
    const roster = await continuity.agents() as { agents: Array<{ agentId: string; name: string }> };
    const agentId = roster.agents.find(agent => agent.name.toLocaleLowerCase() === title.toLocaleLowerCase())?.agentId ?? "ceo";
    const history = this.harness.threads.transcript(target);
    const listing = await continuity.list() as { conversations: Array<{ conversationId: string; agentId: string; title: string }> };
    const attached = new Set(continuity.store.links().map(link => link.link.conversationId));
    const candidates = listing.conversations.filter(row => row.agentId === agentId && row.title === title && !attached.has(row.conversationId));
    if (candidates.length === 1) await continuity.attach(localId, candidates[0]!.conversationId);
    else await continuity.link(localId, { agentId, audience: "private", title: title.slice(0, 80) });
    continuity.importRecentHistory(localId, history);
    await continuity.sync(localId);
    return true;
  }

  async autoLinkAll(): Promise<{ linked: number; failed: number }> {
    return this.exclusive(async () => {
      if (!this.harness.continuity.backupEnabled()) return { linked: 0, failed: 0 };
      let linked = 0, failed = 0;
      // A new Mac has no local threads yet. Materialize the account's saved
      // conversations in the normal list before linking work created here.
      try {
        const continuity = this.harness.continuity;
        const listing = await continuity.list() as { conversations: Array<{
          conversationId: string; agentId: string; audience: string; title: string; localConversationId: string | null;
        }> };
        const seen = new Set<string>();
        const bots = await this.invoke<Bot[]>("lbz:bots:list");
        for (const row of listing.conversations) {
          const remoteThreadId = row.localConversationId ?? "";
          if (seen.has(row.conversationId) || row.audience !== "private"
            || !/^(?:bot:[^:]+|group:[^:]+|chat:qchat_[a-f0-9]{32})$/.test(remoteThreadId)) continue;
          seen.add(row.conversationId);
          if (this.importedRemote.has(row.conversationId)) continue;
          if (continuity.store.links().some(link => link.link.conversationId === row.conversationId)) continue;
          try {
            let threadId: string;
            if (remoteThreadId.startsWith("bot:")) {
              let bot = bots.find(candidate => !candidate.archived && candidate.name === row.title
                && !continuity.store.status(`bot:${candidate.id}`));
              if (!bot) {
                bot = await this.invoke<Bot>("lbz:bots:create", [{ name: row.title }]);
                bots.push(bot);
              }
              threadId = `bot:${bot.id}`;
            } else if (remoteThreadId.startsWith("group:")) {
              const groups = await this.invoke<Group[]>("lbz:groups:list");
              let group = groups.find(candidate => !candidate.archived && candidate.name === row.title
                && !continuity.store.status(`group:${candidate.id}`));
              group ??= await this.invoke<Group>("lbz:groups:create", [{ name: row.title, memberIds: [] }]);
              threadId = `group:${group.id}`;
            } else {
              const chat = await this.invoke<{ id: string }>("lbz:quickChats:create", [{ requestId: `cloud:${row.conversationId}` }]);
              threadId = `chat:${chat.id}`;
            }
            await continuity.attach(threadId, row.conversationId);
            await continuity.sync(threadId);
            this.importedRemote.add(row.conversationId);
            this.harness.storage.writeJson("continuity-imported-remote.json", [...this.importedRemote]);
            linked++;
          } catch { failed++; }
        }
      } catch { /* An offline account must not block local conversations. */ }
      const [bots, groups, chats] = await Promise.all([
        this.invoke<Bot[]>("lbz:bots:list"), this.invoke<Group[]>("lbz:groups:list"), this.harness.quickChats.list(),
      ]);
      const targets: ThreadTarget[] = [
        ...bots.filter(bot => !bot.archived && !bot.id.startsWith("qchat_")).map(bot => ({ botId: bot.id })),
        ...groups.filter(group => !group.archived).map(group => ({ groupId: group.id })),
        ...chats.chats.map(chat => ({ chatId: chat.id })),
      ];
      for (const target of targets) {
        try { if (await this.ensureAutoLinked(target)) linked++; }
        catch { failed++; }
      }
      return { linked, failed };
    });
  }

  async setConversationBackup(enabled: boolean): Promise<void> {
    await this.exclusive(async () => {
      if (!enabled) await this.cloud.disableBackup();
      this.harness.continuity.setBackupEnabled(enabled);
      if (enabled) void this.autoLinkAll().catch(() => {});
    });
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
      agentId: run.threadId.startsWith("chat:") ? null : this.agentId(run.botId),
      triggerMessageId: this.messageId(triggerOverride ?? this.index.runTriggers[run.id] ?? run.messageId ?? `trigger-${run.id}`),
      state,
      ...(run.inference ? { inference: run.inference } : {}),
      ...(run.usage ? { usage: run.usage } : {}),
      error: run.error ?? (run.state === "cancelled" ? "cancelled" : null),
      createdAt: run.startedAt,
      updatedAt: run.endedAt ?? run.startedAt,
    };
  }

  async postMessage(threadId: string, raw: unknown): Promise<{ status: number; body: unknown }> {
    return this.exclusive(async () => {
      const target = this.target(threadId);
      await this.ensureAutoLinked(target).catch(() => false);
      if ("chatId" in target) await this.harness.quickChats.get(target.chatId);
      const input = objectBody(raw, ["clientMessageId", "content", "mentionAgentIds"]);
      const clientMessageId = uuid(input.clientMessageId, "clientMessageId");
      const content = requiredString(input.content, "content", Number.MAX_SAFE_INTEGER);
      const mentionAgentIds = stringList(input.mentionAgentIds ?? [], "mentionAgentIds", 32);
      const requestedBotIds = mentionAgentIds.map((id) => this.internalAgentId(id));
      const allowedBotIds = "chatId" in target ? [] : "botId" in target
        ? [target.botId]
        : (await this.invoke<Group[]>("lbz:groups:list")).find((group) => group.id === target.groupId)?.memberIds;
      if (!allowedBotIds || requestedBotIds.some((id) => !allowedBotIds.includes(id))) {
        throw new HttpError(422, "invalid_agent_target", "Agent is not in this thread.");
      }
      const localThreadId = threadIdForTarget(target);
      if (this.cloud.ownsRequest(clientMessageId)) {
        if (mentionAgentIds.length) throw new HttpError(422, "invalid_agent_target", "Cloud execution uses the linked conversation agent.");
        const sent = await this.cloud.send(localThreadId, clientMessageId, content);
        this.index.messages[clientMessageId] = {
          state: "completed", fingerprint: JSON.stringify({ threadId, content, mentionAgentIds: [] }),
          threadId: localThreadId, messageId: sent.eventId, runIds: sent.runs.map(run => `cloud_${run.runId}`), createdAt: new Date().toISOString(),
        };
        this.persistIndex(this.index);
        const original = await this.invoke<ThreadMessage | null>("lbz:threads:message", [target, sent.eventId]);
        if (!original) throw new HttpError(503, "history_unavailable", "The cloud message is not in the synchronized conversation yet.");
        const bots = await this.invoke<Bot[]>("lbz:bots:list");
        return { status: sent.duplicate ? 200 : 201, body: {
          message: this.message(original, target, bots), duplicate: sent.duplicate,
          runs: await Promise.all(sent.runs.map(run => this.cloudRun(`cloud_${run.runId}`))),
        } };
      }
      // Explicit mentions win; otherwise the harness routes the text itself
      // (`mentions.resolveGroupTargets`): `@everyone` reaches every member,
      // and a message naming nobody goes to ONE lead (the CEO, else the first
      // member), whose turn is told it answers for the group.
      const mentionBotIds = requestedBotIds;
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
      this.persistIndex(this.index);
      const before = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
      const known = new Set(before.messages.map((message) => message.id));
      const sent = "chatId" in target
        ? await this.harness.quickChats.send(target.chatId, content, clientMessageId)
        : await this.invoke<{ runIds: string[] }>("lbz:threads:send", [target, { text: content, mentionBotIds }]);
      const after = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
      const userMessage = [...after.messages].reverse().find((message) => message.role === "user" && !known.has(message.id));
      if (!userMessage) throw new HttpError(500, "message_not_persisted", "The local message was not persisted.");
      this.index.messages[clientMessageId] = {
        state: "completed", fingerprint, threadId: threadIdForTarget(target), messageId: userMessage.id,
        runIds: sent.runIds, createdAt: new Date().toISOString(),
      };
      for (const runId of sent.runIds) this.index.runTriggers[runId] = userMessage.id;
      this.persistIndex(this.index);
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const message = this.message(userMessage, target, bots);
      const runs = await Promise.all(sent.runIds.map((id) => this.run(id, userMessage.id)));
      return { status: 201, body: { message, duplicate: false, runs } };
    });
  }

  private voiceRecord(callId: string): DurableVoiceCall {
    const record = this.index.voiceCalls[callId];
    if (!record) throw new HttpError(404, "voice_call_not_found", "Voice task call not found.");
    return record;
  }

  private expectedVoiceBinding(value: unknown): VoiceBinding | undefined {
    if (value === undefined || value === null) return undefined;
    const input = objectBody(value, ["planId", "provider"]);
    const planId = requiredString(input.planId, "expectedBinding.planId", 64);
    if (input.provider !== "codex" && input.provider !== "claude") {
      throw new HttpError(400, "invalid_payload", "expectedBinding.provider must be codex or claude.");
    }
    return { planId, provider: input.provider };
  }

  private async resolveVoiceBindingFor(bot: Bot, expectedBinding?: VoiceBinding): Promise<VoiceBinding> {
    try {
      return resolveVoiceBinding({
        bot,
        settings: await this.harness.runtime.getSettings(),
        plans: await this.harness.plans.list(),
        ...(expectedBinding ? { expectedBinding } : {}),
      });
    } catch (error) {
      if (error instanceof VoiceTaskError) throw new HttpError(error.status, error.code, error.message);
      throw error;
    }
  }

  /** Prepare one delegation. The caller may pin the first call's returned
   * binding into later calls; the supplied value is only an expectation and
   * can never override the server's independently resolved account. */
  async prepareVoiceCall(raw: unknown): Promise<VoiceCallMutationResponse> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["requestId", "agentId", "expectedBinding"]);
      const requestId = uuid(input.requestId, "requestId");
      const agentId = requiredString(input.agentId, "agentId", 200);
      const expectedBinding = this.expectedVoiceBinding(input.expectedBinding);
      const fingerprint = JSON.stringify({ agentId, expectedBinding: expectedBinding ?? null });
      const previousCallId = this.index.voiceRequests[requestId];
      if (previousCallId) {
        const previous = this.voiceRecord(previousCallId);
        if (previous.fingerprint !== fingerprint) {
          throw new HttpError(409, "idempotency_conflict", "This voice request id was already used.");
        }
        return { ...(await this.voiceCall(previous.callId)), duplicate: true };
      }

      const botId = this.internalAgentId(agentId);
      const bot = (await this.harness.bots.list()).find((candidate) => candidate.id === botId);
      if (!bot) throw new HttpError(404, "voice_agent_not_found", "Selected local agent not found.");
      const binding = await this.resolveVoiceBindingFor(bot, expectedBinding);
      const now = new Date().toISOString();
      const callId = `vcall_${randomBytes(18).toString("base64url")}`;
      const record: DurableVoiceCall = {
        callId,
        requestId,
        fingerprint,
        botId,
        threadId: threadIdForTarget({ botId }),
        binding,
        cancelled: false,
        createdAt: now,
        updatedAt: now,
      };
      this.index.voiceCalls[callId] = record;
      this.index.voiceRequests[requestId] = callId;
      this.persistIndex(this.index);
      return { ...(await this.voiceCall(callId)), duplicate: false };
    });
  }

  /** Persist one real collaboration message and start one direct-agent run
   * under the call's exact plan. Pending journal entries are never retried
   * automatically after an uncertain crash. */
  async dispatchVoiceCall(callId: string, raw: unknown): Promise<VoiceCallMutationResponse> {
    return this.exclusive(async () => {
      const record = this.voiceRecord(callId);
      const input = objectBody(raw, ["operationId", "content"]);
      const operationId = uuid(input.operationId, "operationId");
      const content = requiredString(input.content, "content", 20_000);
      const fingerprint = JSON.stringify({ operationId, content });
      if (record.cancelled) throw new HttpError(409, "voice_call_cancelled", "This voice task call was cancelled.");
      if (record.dispatch) {
        if (record.dispatch.fingerprint !== fingerprint) {
          throw new HttpError(409, "voice_call_already_dispatched", "This voice task call already owns another operation.");
        }
        if (record.dispatch.state === "pending") {
          throw new HttpError(409, "idempotency_in_doubt", "The earlier voice dispatch has an uncertain outcome and will not be sent again automatically.");
        }
        return { ...(await this.voiceCall(callId)), duplicate: true };
      }

      const bot = (await this.harness.bots.list()).find((candidate) => candidate.id === record.botId);
      if (!bot) throw new HttpError(404, "voice_agent_not_found", "Selected local agent not found.");
      await this.resolveVoiceBindingFor(bot, record.binding);
      const messageId = `msg_voice_${operationId.replaceAll("-", "")}`;
      record.dispatch = { state: "pending", operationId, fingerprint, messageId };
      record.updatedAt = new Date().toISOString();
      this.persistIndex(this.index);

      const sent = await this.harness.threads.send(
        { botId: record.botId },
        {
          text: content,
          messageId,
          executionPolicy: {
            source: "voice",
            binding: record.binding,
            allowTeamDelegation: false,
          },
        },
      );
      record.dispatch = { state: "completed", operationId, fingerprint, messageId, runIds: sent.runIds };
      record.updatedAt = new Date().toISOString();
      for (const runId of sent.runIds) this.index.runTriggers[runId] = messageId;
      this.persistIndex(this.index);
      return { ...(await this.voiceCall(callId)), duplicate: false };
    });
  }

  private voiceState(record: DurableVoiceCall, states: VoiceCallState[]): VoiceCallState {
    if (!record.dispatch) return record.cancelled ? "cancelled" : "prepared";
    // A crash after journalling but before run ids were recorded is uncertain,
    // never a confirmed cancellation.
    if (record.dispatch.state === "pending") return record.cancelled ? "failed" : "running";
    // STOP is a request. Keep reporting the observed provider/run state until
    // it actually settles so voice never announces a cancellation too early.
    if (states.includes("running")) return "running";
    if (states.includes("queued")) return "queued";
    if (!states.length || states.includes("failed")) return "failed";
    if (states.includes("cancelled")) return "cancelled";
    return "done";
  }

  /** Polled by the desktop several times a second while a task runs. A run's
   * `content` is its latest public bot message, so while `state` is still
   * `running` it is the agent's newest progress message, not its answer. */
  async voiceCall(callId: string): Promise<VoiceCallSnapshot> {
    const record = this.voiceRecord(callId);
    const target = { botId: record.botId } as const;
    // Each thread read parses the whole transcript file: a prepared call
    // needs none, and the trigger is normally in the page already read.
    const thread = record.dispatch ? await this.harness.threads.get(target) : null;
    const internalRunIds = record.dispatch?.state === "completed" ? record.dispatch.runIds : [];
    const runRows = await Promise.all(internalRunIds.map(async (runId) => {
      const run = await this.run(runId, record.dispatch?.messageId);
      const contents = (thread?.messages ?? [])
        .filter((message) => message.role === "bot" && message.runId === runId && message.deliveryState !== "control")
        .map((message) => textOf(message.blocks).trim())
        .filter(Boolean);
      return {
        runId: run.runId,
        state: run.state,
        content: contents.at(-1) ?? null,
        error: run.error,
        updatedAt: run.updatedAt,
      };
    }));
    const triggerId = record.dispatch?.messageId;
    const trigger = triggerId
      ? thread?.messages.find((message) => message.id === triggerId) ?? await this.harness.threads.message(target, triggerId)
      : undefined;
    const states = runRows.map((run) => run.state);
    const updatedAt = runRows.map((run) => run.updatedAt).sort().at(-1) ?? record.updatedAt;
    return {
      callId: record.callId,
      agentId: this.agentId(record.botId),
      threadId: this.publicThreadId(target),
      binding: record.binding,
      state: this.voiceState(record, states),
      operationId: record.dispatch?.operationId ?? null,
      message: trigger ? textOf(trigger.blocks) || null : null,
      runs: runRows.map(({ runId, state }) => ({ runId, state })),
      results: runRows.map(({ runId, state, content, error }) => ({ runId, state, content, error })),
      createdAt: record.createdAt,
      updatedAt,
    };
  }

  async cancelVoiceCall(callId: string): Promise<VoiceCallMutationResponse> {
    return this.exclusive(async () => {
      const record = this.voiceRecord(callId);
      if (record.cancelled) return { ...(await this.voiceCall(callId)), duplicate: true };
      const runIds = record.dispatch?.state === "completed" ? record.dispatch.runIds : [];
      let stopped = false;
      for (const runId of runIds) {
        const run = await this.harness.runs.get(runId);
        if (!run || (run.state !== "queued" && run.state !== "working" && run.state !== "waiting_input")) continue;
        stopped = (await this.harness.threads.cancelRun(runId)) || stopped;
      }
      if (!record.dispatch || record.dispatch.state === "pending" || stopped) {
        record.cancelled = true;
        record.updatedAt = new Date().toISOString();
        this.persistIndex(this.index);
      }
      if (stopped) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const active = await Promise.all(runIds.map((runId) => this.harness.runs.get(runId)));
          if (active.every((run) => !run || (run.state !== "queued" && run.state !== "working" && run.state !== "waiting_input"))) break;
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
      }
      return { ...(await this.voiceCall(callId)), duplicate: !stopped && Boolean(record.dispatch) };
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
    return { runs: await Promise.all([...selected.map((run) => this.run(run.id)), ...this.cloud.runIds(threadId, input.active).map(id => this.cloudRun(id))]) };
  }

  private async cloudRun(id: string, stop = false) {
    const saved = await this.cloud.run(id, stop);
    const target = targetForThreadId(saved.threadId);
    if (!target) throw new Error("Cloud thread unavailable.");
    return { ...saved.run, runId: this.runId(id), threadId: this.publicThreadId(target),
      agentId: "botId" in target ? this.agentId(target.botId) : null, triggerMessageId: this.messageId(saved.eventId) };
  }

  async executionDestination(threadId: string, destination?: 'personal' | 'bizos') {
    return this.exclusive(async () => {
      const target = this.target(threadId), localId = threadIdForTarget(target);
      const runs = await this.invoke<Run[]>("lbz:runs:list", [{ limit: 200 }]);
      const running = runs.some(run => run.threadId === localId && ['queued', 'working', 'waiting_input'].includes(run.state));
      if (destination && running) throw new HttpError(409, "run_active", "Stop the active run before changing execution.");
      return destination ? this.bizos.select(localId, destination) : this.bizos.status(localId);
    });
  }

  bizosDestination(threadId: string): 'personal' | 'bizos' { return this.bizos.destination(threadId); }
  async bizosScope(threadId: string) { return this.bizos.requireSelected(threadId); }

  async getRun(publicRunId: string) {
    const id = this.internalRunId(publicRunId);
    return this.cloud.ownsRun(id) ? this.cloudRun(id) : this.run(id);
  }

  async cancel(publicRunId: string) {
    const runId = this.internalRunId(publicRunId);
    if (this.cloud.ownsRun(runId)) return this.cloudRun(runId, true);
    const run = await this.invoke<Run | null>("lbz:runs:get", [runId]);
    if (!run) throw new HttpError(404, "not_found", "Run not found.");
    const active = publicRunState(run.state) === "running" || publicRunState(run.state) === "queued";
    // Target the run's own mission chain. An ended parent may still own a
    // recruited child, while a newer unrelated run can share the same DM.
    const stoppedMission = await this.harness.threads.cancelMission(runId);
    if (!stoppedMission && active) await this.harness.threads.cancelRun(runId);
    this.teamBroker.revoke(runId);
    if (!active) return this.getRun(publicRunId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const stopped = await this.getRun(publicRunId);
      if (stopped.state !== "running" && stopped.state !== "queued") return stopped;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    return this.getRun(publicRunId);
  }

  async approvals(publicRunId: string) {
    const runId = this.internalRunId(publicRunId);
    if (this.cloud.ownsRun(runId)) { await this.cloud.run(runId); return { runId: publicRunId, approvals: [] }; }
    const run = await this.invoke<Run | null>("lbz:runs:get", [runId]);
    if (!run) throw new HttpError(404, "not_found", "Run not found.");
    const target = targetForThreadId(run.threadId);
    if (!target) throw new HttpError(500, "invalid_local_run", "Run thread is invalid.");
    const terminal = publicRunState(run.state) !== "running" && publicRunState(run.state) !== "queued";
    const snapshot = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
    const approvals = snapshot.messages.flatMap((message) => message.blocks.flatMap((block) => {
      if (block.kind !== "ask" || block.runId !== runId) return [];
      return [askOf(block, terminal && block.status === "pending" ? "expired" : block.status)];
    }));
    return { runId: publicRunId, approvals };
  }

  async answer(publicRunId: string, raw: unknown) {
    const runId = this.internalRunId(publicRunId);
    const run = await this.invoke<Run | null>("lbz:runs:get", [runId]);
    if (!run) throw new HttpError(404, "not_found", "Run not found.");
    const ended = publicRunState(run.state) !== "running" && publicRunState(run.state) !== "queued";
    const input = objectBody(raw, ["askId", "answer"]);
    const askId = requiredString(input.askId, "askId", 64);
    const answer = input.answer as AskAnswer;
    if (ended) {
      // An ended run takes one kind of answer only: a late answer to an
      // approval that expired while its task waited, which resumes the task.
      // A separate channel, so nothing else of an ended run can be answered.
      try {
        await this.invoke<void>("lbz:threads:answerExpired", [{ runId, askId, answer }]);
      } catch {
        throw new HttpError(409, "run_finished", "This run has ended; its requests can no longer be answered.");
      }
      return this.approvals(publicRunId);
    }
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
      providers: {
        supported: LOCAL_PROVIDERS,
        recruitment: { codex: true, claude: true, cursor: true, ollama: true },
        toolSurface: {
          computer: { codex: true, claude: true, api: true, ollama: true, cursor: true },
        },
      },
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
  // ── plan tier (local stub, see `harness/entitlement.ts`) ──────────────
  // `GET/PUT /api/local/entitlement` is a local dev/test switch: nothing is
  // verified against billing. Real account/billing linkage is future work.
  entitlement() { return this.harness.entitlement.get(); }
  async setEntitlement(raw: unknown) {
    const input = objectBody(raw, ["tier"]);
    if (input.tier !== "free" && input.tier !== "pro") throw new HttpError(400, "invalid_payload", "tier must be \"free\" or \"pro\".");
    return this.harness.entitlement.set(input.tier);
  }
  /** 402 `pro_required` on the free tier. */
  private requirePro(feature: ProFeature): void { this.harness.entitlement.require(feature); }

  selectModel(raw: unknown) { return this.invoke("lbz:runtime:selectModel", [raw]); }
  async setInference(raw: unknown) {
    return this.invoke("lbz:runtime:setInference", [raw]);
  }
  async setModel(raw: unknown) {
    const input = objectBody(raw, ["model"]);
    const model = requiredString(input.model, "model", 120);
    return this.invoke("lbz:runtime:setSettings", [{ mode: "local", local: { model } }]);
  }
  inferenceProviders() { return this.invoke("lbz:inference:list"); }
  async addInferenceProvider(raw: unknown) { return this.invoke("lbz:inference:add", [raw]); }
  async updateInferenceProvider(id: string, raw: unknown) { return this.invoke("lbz:inference:update", [id, raw]); }
  removeInferenceProvider(id: string) { return this.invoke("lbz:inference:remove", [id]); }
  testInferenceProvider(id: string) { return this.invoke("lbz:inference:test", [id]); }
  disconnectPlan(id: string) { return this.invoke("lbz:plans:disconnect", [id]); }

  async createQuickChat(raw: unknown) {
    const chat = await this.invoke<{ id: string; title: string; createdAt: string; updatedAt: string }>("lbz:quickChats:create", [raw]);
    return { ...chat, thread: await this.thread({ chatId: chat.id }, [], []) };
  }

  quickChats(action: "list" | "create" | "get" | "messages" | "send" | "stop" | "answer", args: unknown[] = []) {
    return this.invoke(`lbz:quickChats:${action}`, args);
  }

  bots() { return this.invoke<Bot[]>("lbz:bots:list"); }
  localDashboardSummary() {
    return readLocalDashboardSummary({
      workspaceId: this.workspaceId,
      binding: () => this.harness.workspaceTemplate.verifiedCurrent(),
      bots: () => this.bots(),
      routines: async () => (await this.crons()).items,
      runs: () => this.invoke<Run[]>("lbz:runs:list", [{ limit: 200 }]),
      runLimit: 200,
      publicThreadId: (threadId) => { const target = targetForThreadId(threadId); return target ? this.publicThreadId(target) : null; },
      plans: () => this.invoke<DashboardPlan[]>("lbz:plans:list"),
      providers: async () => (await this.invoke<{ providers: DashboardProvider[] }>("lbz:inference:list")).providers,
      settings: async () => (await this.invoke<RuntimeSettings>("lbz:runtime:getSettings")).local,
      publicRunId: (runId) => this.runId(runId),
      pendingAsks: async (run) => {
        const target = targetForThreadId(run.threadId);
        if (!target || !run.id) return [];
        const snapshot = await this.invoke<ThreadSnapshot>("lbz:threads:get", [target]);
        return snapshot.messages.flatMap((message) => message.blocks.flatMap((block) =>
          block.kind === "ask" && block.runId === run.id && block.status === "pending"
            ? [{ askId: block.askId, requestType: block.requestType, summary: block.summary, ...(block.choices ? { choices: block.choices } : {}), createdAt: message.createdAt }]
            : []));
      },
    });
  }
  async createBot(raw: unknown) {
    // `language` is the owner's app language for the greeting, not a bot field.
    let language: "fr" | "en" = "fr";
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "language" in raw) {
      const { language: requested, ...rest } = raw as Record<string, unknown>;
      if (requested !== undefined && requested !== "fr" && requested !== "en") throw new HttpError(400, "invalid_payload", "language must be \"fr\" or \"en\".");
      if (requested === "en") language = "en";
      raw = rest;
    }
    const created = await this.invoke<Bot>("lbz:bots:create", [raw]);
    // An agent the owner creates says hello first (Grok-bot style): a
    // complete bot message in its chat, no model run.
    const bot = await this.harness.bots.greet(created.id, language);
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
  /** The owner's own photo for an agent: stops any generation, replaces the picture. */
  async setBotAvatar(id: string, raw: unknown) {
    const input = objectBody(raw, ["dataUrl"]);
    if (!(await this.bots()).some((bot) => bot.id === id)) throw new HttpError(404, "not_found", "Bot not found.");
    let avatar: { dataUrl: string } | null = null;
    if (input.dataUrl !== null) {
      try { avatar = { dataUrl: parseAvatarDataUrl(input.dataUrl).dataUrl }; }
      catch (error) { throw new HttpError(400, "invalid_avatar", error instanceof Error ? error.message : String(error)); }
    }
    const bot = await this.invoke<Bot>("lbz:bots:setAvatar", [id, avatar]);
    const bootstrap = await this.bootstrap();
    const agent = this.agent(bot);
    const thread = bootstrap.threads.find((candidate) => candidate.kind === "agent" && candidate.agentIds.includes(agent.agentId));
    return { bot, agent, thread };
  }
  claimAvatarWorker(raw: unknown) {
    const input = objectBody(raw, ["workerId", "configured"]);
    const workerId = requiredString(input.workerId, "workerId", 128);
    if (input.configured !== true && input.configured !== false) {
      throw new HttpError(400, "invalid_payload", "configured must be a boolean.");
    }
    return this.harness.avatarGeneration.claim(workerId, input.configured);
  }
  reportAvatarWorker(raw: unknown) {
    const input = objectBody(raw, ["jobId", "leaseToken", "event", "taskId", "dataUrl", "errorCode"]);
    const jobId = requiredString(input.jobId, "jobId", 80);
    const leaseToken = requiredString(input.leaseToken, "leaseToken", 128);
    const event = requiredString(input.event, "event", 40);
    const errorCode = input.errorCode === undefined ? undefined : requiredString(input.errorCode, "errorCode", 80);
    if (errorCode && !/^[a-z0-9_.-]+$/i.test(errorCode)) {
      throw new HttpError(400, "invalid_payload", "errorCode has an invalid format.");
    }
    let report: AvatarWorkerReport;
    if (event === "submitted") {
      if (input.dataUrl !== undefined || errorCode !== undefined) throw new HttpError(400, "invalid_payload", "submitted accepts only taskId.");
      report = { jobId, leaseToken, event, taskId: requiredString(input.taskId, "taskId", 512) };
    } else if (event === "ready") {
      if (input.taskId !== undefined || errorCode !== undefined) throw new HttpError(400, "invalid_payload", "ready accepts only dataUrl.");
      try {
        report = { jobId, leaseToken, event, dataUrl: parseAvatarDataUrl(input.dataUrl).dataUrl };
      } catch (error) {
        throw new HttpError(400, "invalid_avatar", error instanceof Error ? error.message : String(error));
      }
    } else if (event === "failed") {
      if (input.taskId !== undefined || input.dataUrl !== undefined) throw new HttpError(400, "invalid_payload", "failed accepts only errorCode.");
      report = { jobId, leaseToken, event, errorCode: errorCode ?? requiredString(input.errorCode, "errorCode", 80) };
    } else if (event === "submission_unknown") {
      if (input.taskId !== undefined || input.dataUrl !== undefined) throw new HttpError(400, "invalid_payload", "submission_unknown accepts only errorCode.");
      report = { jobId, leaseToken, event, ...(errorCode ? { errorCode } : {}) };
    } else {
      throw new HttpError(400, "invalid_payload", "event is not supported.");
    }
    try {
      return this.harness.avatarGeneration.report(report);
    } catch (error) {
      if (error instanceof AvatarGenerationError) {
        throw new HttpError(error.code === "avatar_job_not_found" ? 404 : 409, error.code, error.message);
      }
      throw error;
    }
  }
  async generateAvatar(id: string, raw: unknown) {
    const input = objectBody(raw, ["avatarPrompt"]);
    const prompt = optionalString(input.avatarPrompt, "avatarPrompt", 2_000);
    if (!(await this.bots()).some((bot) => bot.id === id)) throw new HttpError(404, "not_found", "Bot not found.");
    let bot;
    try {
      bot = await this.harness.avatarGeneration.generate(id, prompt);
    } catch (error) {
      if (error instanceof AvatarGenerationError) {
        throw new HttpError(error.code === "avatar_job_not_found" ? 404 : 409, error.code, error.message);
      }
      throw error;
    }
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
  /** Settings → proactive heartbeat: `{enabled, everyMinutes}` (10–240). */
  async setHeartbeat(raw: unknown) {
    const input = objectBody(raw, ["enabled", "everyMinutes"]);
    if (typeof input.enabled !== "boolean") throw new HttpError(400, "invalid_settings", "enabled must be a boolean.");
    const everyMinutes = input.everyMinutes === undefined ? 30 : input.everyMinutes;
    return this.invoke("lbz:runtime:setSettings", [{ mode: "local", local: { heartbeat: { enabled: input.enabled, everyMinutes } } }]);
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
    if (input.custom !== undefined) {
      this.requirePro("customConnectors");
      return this.invoke("lbz:apps:addCustom", [input.custom]);
    }
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
    const input = objectBody(raw, ["status", "expected_updated_at", "agent_id", "name", "description", "trigger", "ends_at", "endsAt"]);
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
    const endsAtInput = input.ends_at !== undefined ? input.ends_at : input.endsAt;
    if (endsAtInput !== undefined) {
      if (endsAtInput !== null && (typeof endsAtInput !== "string" || Number.isNaN(Date.parse(endsAtInput)))) {
        throw new HttpError(400, "invalid_ends_at", "ends_at must be an ISO instant or null.");
      }
      patch.endsAt = endsAtInput;
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, "invalid_body", "Nothing to change.");
    const updated = await this.invoke<Routine>("lbz:routines:update", [id, patch]);
    const bots = await this.invoke<Bot[]>("lbz:bots:list");
    // The person edited it in Apps → Routines: the line lands in the owner's DM.
    this.recordTeamEvent("routine.updated", {
      actorBotId: updated.botId,
      ownerBotId: updated.botId,
      runId: this.runId("none"),
      threadId: this.publicThreadId({ botId: updated.botId }),
      changes: this.routineChanges(updated),
    });
    return { item: publicRoutine(updated, bots, (botId) => this.agentId(botId)) };
  }
  async deleteCron(id: string): Promise<{ removed: boolean }> {
    const routines = await this.invoke<Routine[]>("lbz:routines:list", []);
    const routine = routines.find((candidate) => candidate.id === id);
    if (!routine) throw new HttpError(404, "not_found", "No such routine.");
    await this.invoke("lbz:routines:remove", [id]);
    this.recordTeamEvent("routine.deleted", {
      actorBotId: routine.botId,
      ownerBotId: routine.botId,
      runId: this.runId("none"),
      threadId: this.publicThreadId({ botId: routine.botId }),
      changes: { ...this.routineChanges(routine), enabled: false, nextRunAt: null },
    });
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

  /** `send_to_chat`, under the calling run's capability: the files land on
   * that run's next reply, in that run's thread, and nowhere else. */
  sendToChat(capability: TeamCapability, raw: unknown) {
    try {
      return this.harness.sendToChat(capability, raw);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, "invalid_attachment", error instanceof Error ? error.message : String(error));
    }
  }

  /** `offer_quick_replies` / `propose_company_name`: staged on the calling
   * run's next reply, like `send_to_chat`. */
  offerQuickReplies(capability: TeamCapability, raw: unknown) {
    try {
      return this.harness.offerQuickReplies(capability, raw);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, "invalid_payload", error instanceof Error ? error.message : String(error));
    }
  }

  proposeCompanyName(capability: TeamCapability, raw: unknown) {
    try {
      return this.harness.proposeCompanyName(capability, raw);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, "invalid_payload", error instanceof Error ? error.message : String(error));
    }
  }

  async scheduleRoutine(authorize: () => TeamCapability, raw: unknown): Promise<{ routine: PublicRoutine; nextRunAt: string | null; endsAt: string | null; note: string }> {
    return this.exclusive(async () => {
      const capability = authorize();
      const input = objectBody(raw, ["name", "prompt", "frequency", "time", "weekdays", "every_minutes", "at", "until", "owner_agent_id"]);
      const name = requiredString(input.name, "name", 80);
      const prompt = requiredString(input.prompt, "prompt", 6000);
      let trigger;
      let endsAt: string | null;
      try {
        trigger = triggerFromToolInput(input);
        endsAt = endsAtFromToolInput(input);
      } catch (error) {
        throw new HttpError(400, "invalid_trigger", error instanceof Error ? error.message : "invalid trigger");
      }
      const acceptedRun = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      this.requireActiveTeamRun(acceptedRun, capability, "A routine can be scheduled only while its source run is active.");
      // Anti-recursion: a routine that schedules routines is a fork bomb with
      // a timetable. Only a turn the person started may create one.
      if (acceptedRun.routineId || acceptedRun.heartbeat) {
        throw new HttpError(403, "routine_recursion",
          "A routine or heartbeat run cannot create routines. Report what you found in your reply instead.");
      }
      const ownerId = input.owner_agent_id === undefined
        ? capability.botId
        : this.internalAgentId(requiredString(input.owner_agent_id, "owner_agent_id", 160));
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const actor = bots.find((bot) => bot.id === capability.botId && !bot.archived);
      if (!actor || (ownerId !== capability.botId && !this.isCeoAgent(actor)))
        throw new HttpError(403, "invalid_team_scope", "Only the CEO can set a teammate's routine.");
      if (!bots.some((bot) => bot.id === ownerId && !bot.archived)) throw new HttpError(404, "not_found", "That owner is not an active agent here.");
      // Keep the run lookup and session validation at the commit edge. Both
      // bot lookup and this facade's serializer can yield; STOP must win if
      // it lands during either wait, even though this request was accepted.
      const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      this.requireActiveTeamRun(run, capability, "A routine can be scheduled only while its source run is active.");
      const current = authorize();
      if (current.runId !== capability.runId || current.botId !== capability.botId || current.threadId !== capability.threadId) {
        throw new HttpError(403, "invalid_team_scope", "The routine capability changed before it could be committed.");
      }
      const routine = await this.invoke<Routine>("lbz:routines:create", [{
        botId: ownerId, name, prompt, trigger, enabled: true, ...(endsAt ? { endsAt } : {}),
      }]);
      this.recordTeamEvent("routine.created", {
        actorBotId: capability.botId,
        ownerBotId: ownerId,
        runId: this.runId(capability.runId),
        threadId: this.publicThreadId(targetForThreadId(capability.threadId) ?? { botId: capability.botId }),
        changes: this.routineChanges(routine),
      });
      const item = publicRoutine(routine, bots, (botId) => this.agentId(botId));
      return {
        routine: item,
        nextRunAt: item.nextRunAt,
        endsAt: item.endsAt,
        note: "Scheduled. Tell the person in one short line what you'll watch and when (next run, and the end if any). No confirmation question.",
      };
    });
  }

  async listAgentRoutines(capability: TeamCapability): Promise<{ items: PublicRoutine[] }> {
    const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
    this.requireActiveTeamRun(run, capability, "Routines can be listed only during an active run.");
    const bots = await this.invoke<Bot[]>("lbz:bots:list");
    const actor = bots.find((bot) => bot.id === capability.botId && !bot.archived);
    if (!actor) throw new HttpError(403, "invalid_team_scope", "Agent is unavailable.");
    const ceo = this.isCeoAgent(actor);
    const routines = await this.invoke<Routine[]>("lbz:routines:list", []);
    return { items: routines.filter((routine) => ceo || routine.botId === actor.id)
      .map((routine) => publicRoutine(routine, bots, (botId) => this.agentId(botId))) };
  }

  async cancelAgentRoutine(capability: TeamCapability, raw: unknown): Promise<{ removed: boolean }> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["routine_id"]);
      const id = requiredString(input.routine_id, "routine_id", 160);
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const actor = bots.find((bot) => bot.id === capability.botId && !bot.archived);
      const ceo = this.isCeoAgent(actor);
      const routines = await this.invoke<Routine[]>("lbz:routines:list", []);
      const routine = routines.find((item) => item.id === id);
      if (!routine) throw new HttpError(404, "not_found", "No such routine.");
      if (!actor || (!ceo && routine.botId !== actor.id)) throw new HttpError(403, "invalid_team_scope", "This routine belongs to another agent.");
      const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      this.requireActiveTeamRun(run, capability, "Routine cancellation requires an active run.");
      await this.invoke("lbz:routines:remove", [id]);
      this.recordTeamEvent("routine.deleted", {
        actorBotId: actor.id, ownerBotId: routine.botId, runId: this.runId(capability.runId),
        threadId: this.publicThreadId(targetForThreadId(capability.threadId) ?? { botId: actor.id }),
        changes: { ...this.routineChanges(routine), enabled: false, nextRunAt: null },
      });
      return { removed: true };
    });
  }

  private requireActiveTeamRun(run: Run | null, capability: TeamCapability, inactiveMessage: string): asserts run is Run {
    if (!run || run.botId !== capability.botId || run.threadId !== capability.threadId) {
      throw new HttpError(403, "invalid_team_scope", "The routine capability does not match this turn.");
    }
    if (!(["queued", "working", "waiting_input"] as const).includes(run.state as "queued" | "working" | "waiting_input")) {
      throw new HttpError(409, "run_not_active", inactiveMessage);
    }
  }

  private isCeoAgent(bot: Bot | undefined): boolean {
    if (!bot || !/\bCEO\b/i.test(bot.title ?? "")) return false;
    // A recruited specialist cannot acquire CEO privileges by choosing that
    // title; the durable recruitment ledger identifies its origin.
    return !Object.values(this.index.recruitments).some((entry) =>
      entry.state === "completed" && entry.result.agent.agentId === this.agentId(bot.id));
  }

  private async revalidateActiveTeamRun(capability: TeamCapability, inactiveMessage: string): Promise<Run> {
    const run = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
    if (!run || run.botId !== capability.botId || run.threadId !== capability.threadId) {
      throw new HttpError(403, "invalid_team_scope", "The team capability does not match this turn.");
    }
    if (!(["queued", "working", "waiting_input"] as const).includes(run.state as "queued" | "working" | "waiting_input")) {
      this.teamBroker.revoke(capability.runId);
      throw new HttpError(409, "run_not_active", inactiveMessage);
    }
    return run;
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
  // The template catalogue and its one write. An id that is not in the
  // built-in catalogue is 404 here, the way a note that is not in the vault
  // is; a payload that is not even an id stays 400. Applying goes through
  // the workspace binding (`rootId` optional: the bound root, else `new`),
  // and is serialised with the other roster writes (`recruit`,
  // `manageAgent`): both create agents, and neither should see the other's
  // half-written roster.
  brainTemplates() { return this.brainCall("lbz:brain:templates", []); }
  async applyBrainTemplate(raw: unknown) {
    const input = objectBody(raw, ["id", "rootId", "owner", "language", "companyName", "context"]);
    const id = requiredString(input.id, "id", 64);
    if (!isTemplateId(id)) throw new HttpError(404, "not_found", "That template is not in the catalogue.");
    const rootId = input.rootId === undefined || input.rootId === null ? undefined : requiredString(input.rootId, "rootId", 64);
    // Optional (onboarding in the chat): the account's name and the app's
    // language. A value of the wrong shape is ignored, never a 400 — an
    // older or newer desktop still installs the same company.
    const owner = input.owner && typeof input.owner === "object" && !Array.isArray(input.owner) ? input.owner as Record<string, unknown> : {};
    const name = typeof owner.name === "string" && owner.name.trim() && owner.name.trim().length <= 80 ? owner.name.trim() : undefined;
    const language = input.language === "fr" || input.language === "en" ? input.language : undefined;
    let options: ReturnType<typeof parseCreationOptions>;
    try { options = parseCreationOptions({ ...(name ? { owner: { name } } : {}), ...(language ? { language } : {}), ...(input.companyName !== undefined ? { companyName: input.companyName } : {}), ...(input.context !== undefined ? { context: input.context } : {}) }); }
    catch (error) { throw new HttpError(400, "invalid_payload", error instanceof Error ? error.message : String(error)); }
    const args: unknown[] = Object.keys(options).length ? [id, rootId ?? null, options] : rootId ? [id, rootId] : [id];
    return this.exclusive(() => this.brainCall("lbz:brain:applyTemplate", args));
  }
  /** The workspace's template and vault: the catalogue, the candidate
   * vaults, the binding. `bind` is the one write; the same request twice is
   * one binding, a different one is 409. */
  workspaceTemplate() { return this.brainCall("lbz:brain:workspaceTemplate", []); }
  async bindWorkspaceTemplate(raw: unknown) {
    const input = objectBody(raw, ["templateId", "rootId"]);
    const templateId = requiredString(input.templateId, "templateId", 64);
    if (!isTemplateId(templateId)) throw new HttpError(404, "not_found", "That template is not in the catalogue.");
    const rootId = requiredString(input.rootId, "rootId", 64);
    return this.exclusive(() => this.brainCall("lbz:brain:bindTemplate", [{ templateId, rootId }]));
  }

  // The packs: their state for the desktop, their install (through the
  // binding), their dashboard, and the one door their agents' tools come
  // through. Ids are the public collaboration ids (`local:<instance>:agent:…`,
  // `local:<instance>:thread:…`) so the desktop can open a chat from the
  // list; no path a renderer sent, and no secret.
  private requirePack(name: keyof Packs): PackService {
    if (!this.packs) throw new HttpError(503, "pack_unavailable", "Business packs are not available in this runtime.");
    return this.packs[name];
  }

  private publicPack(state: PackState): PackStatus {
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
      rootId: state.rootId,
      vaultPath: state.vaultPath,
      boundTemplateId: state.boundTemplateId,
      ...(state.error ? { error: state.error } : {}),
    };
  }

  private async packCall<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PackError) throw new HttpError(error.status, error.code, error.message);
      if (error instanceof HttpError) throw error;
      // The installer's refusals (`BrainError`): the same statuses the brain routes answer.
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      const status = BRAIN_ERROR_STATUS[code];
      if (status) throw new HttpError(status, code, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  packStatus(name: keyof Packs): Promise<PackStatus> {
    return this.packCall(async () => this.publicPack(await this.requirePack(name).status()));
  }

  /** `POST install {}` or `{ rootId }`: bind the workspace to this pack
   * (`new` unless a vault is named), then install; serialised with the
   * roster writes like the catalogue's apply. */
  packInstall(name: keyof Packs, raw: unknown): Promise<PackStatus> {
    return this.packCall(async () => {
      const input = objectBody(raw, ["rootId"]);
      const rootId = input.rootId === undefined || input.rootId === null ? undefined : requiredString(input.rootId, "rootId", 64);
      return this.publicPack(await this.exclusive(() => this.requirePack(name).install(rootId)));
    });
  }

  packOpen(name: keyof Packs): Promise<PackStatus> {
    return this.packCall(async () => this.publicPack(await this.requirePack(name).open()));
  }

  /** An agent's own `computer_*` call (Claude's MCP twin of the dynamic
   * tools); the capability already named the agent. */
  computerTool(capability: Pick<TeamCapability, "botId" | "threadId" | "runId">, name: string, args: unknown) {
    return this.harness.computerTool(capability.botId, name, args, {
      threadId: capability.threadId,
      runId: capability.runId,
    });
  }

  /** The panel's view of one agent's computer; with `full`, its latest
   * full-size frame too (for the viewer window). */
  async computerState(id: string, full = false) {
    const botId = this.computerBotId(id);
    const state = await this.harness.computer.get(botId);
    if (!full || state.status === "none") return state;
    const frame = await this.harness.computer.frame(botId);
    return frame ? { ...state, fullDataUrl: frame.full } : state;
  }

  /** The owner set the computer up from the panel. */
  computerSetUp(id: string) {
    return this.harness.computer.setUp(this.computerBotId(id));
  }

  /** The owner takes control from the panel. The session URL is a secret
   * (it opens the live seat): owner-bearer only, never logged, never in a
   * thread. */
  computerControl(id: string) {
    return this.harness.computer.control(this.computerBotId(id));
  }

  /** The owner gives the seat back; the agent may act again. */
  async computerRelease(id: string, raw: unknown) {
    const input = objectBody(raw, ["handoffId"]);
    const handoffId = optionalString(input.handoffId, "handoffId", 64);
    try {
      return handoffId
        ? await this.harness.computer.giveBack(this.computerBotId(id), handoffId)
        : await this.harness.computer.giveBack(this.computerBotId(id));
    } catch (error) {
      throw new HttpError(409, "stale_handoff", error instanceof Error ? error.message : String(error));
    }
  }

  /** The panel names an agent by its public id (`local:<instance>:agent:…`);
   * a bare bot id is accepted too. */
  private computerBotId(id: string): string {
    // The desktop tags an agent's chat with its THREAD id
    // (`local:<instance>:thread:bot:<botId>`): that names the same agent.
    const thread = /^local:[^:]+:thread:bot:([A-Za-z0-9_-]+)$/.exec(id);
    if (thread) return thread[1]!;
    return id.startsWith("local:") ? this.internalAgentId(id) : id;
  }

  /** A pack tool call from the MCP twin: `{ tool, arguments }`, under the
   * run's capability — the same check the dynamic tools make. The tool's
   * prefix names the pack; the pack refuses a bot that is not its own. */
  packTool(capability: TeamCapability, raw: unknown): Promise<unknown> {
    return this.packCall(async () => {
      const input = objectBody(raw, ["tool", "arguments"]);
      const pack = isAgencyToolName(input.tool) ? "agency" : isCommerceToolName(input.tool) ? "ecommerce" : null;
      if (!pack) throw new HttpError(404, "unknown_tool", "Unknown pack tool.");
      return this.requirePack(pack).callTool(
        { botId: capability.botId, threadId: capability.threadId, runId: capability.runId },
        input.tool as string,
        input.arguments ?? {},
      );
    });
  }
  openBrainEntry(raw: unknown) {
    const input = objectBody(raw, ["root", "path", "mode"]);
    const mode = requiredString(input.mode, "mode", 20);
    if (!BRAIN_OPEN_MODES.includes(mode)) {
      throw new HttpError(400, "invalid_payload", `mode must be one of ${BRAIN_OPEN_MODES.join(", ")}.`);
    }
    return this.brainCall("lbz:brain:open", [
      requiredString(input.root, "root", 64),
      brainOpenPath(input.path, mode),
      mode,
    ]);
  }

  async recruit(capability: TeamCapability, raw: unknown): Promise<RecruitmentResult> {
    return this.exclusive(async () => {
      try { this.harness.assertOnboardingRecruitment(capability); }
      catch (error) { throw new HttpError(409, "onboarding_sequence", error instanceof Error ? error.message : String(error)); }
      const input = objectBody(raw, ["role_slug", "name", "title", "description", "instructions", "context", "mission", "initial_task", "avatar_data_url", "avatar_prompt"]);
      const roleSlug = optionalString(input.role_slug, "role_slug", 80);
      const blueprint = roleSlug ? this.roleBlueprint(roleSlug) : undefined;
      const legacyMission = optionalString(input.mission, "mission", 2_000);
      const name = optionalString(input.name, "name", 60) ?? blueprint?.name;
      const title = optionalString(input.title, "title", 80) ?? blueprint?.title;
      if (!name || !title) throw new HttpError(400, "invalid_payload", "name and title are required for a custom recruit.");
      if (/\bCEO\b/i.test(title)) throw new HttpError(403, "invalid_team_scope", "A specialist cannot be recruited as CEO.");
      if (/[\r\n]/.test(name) || /[\r\n]/.test(title)) throw new HttpError(400, "invalid_payload", "name and title must be one line.");
      const description = optionalString(input.description, "description", 600) ?? blueprint?.description ?? legacyMission ?? title;
      const context = optionalString(input.context, "context", 2_000) ?? legacyMission;
      const supplemental = optionalString(input.instructions, "instructions", 4_000);
      const initialTask = optionalString(input.initial_task, "initial_task", 12_000);
      const avatarPrompt = optionalString(input.avatar_prompt, "avatar_prompt", 2_000);
      const baseInstructions = blueprint?.system ?? supplemental ?? `You were recruited locally as ${title}. ${description}`;
      const instructions = assignmentInstructions(baseInstructions, context, blueprint ? supplemental : undefined);
      if (instructions.length > 16_000) throw new HttpError(422, "role_too_large", "The role instructions and bounded context exceed the local agent limit.");
      const avatar = input.avatar_data_url === undefined ? undefined : (() => {
        try { return parseAvatarDataUrl(input.avatar_data_url); }
        catch (error) { throw new HttpError(400, "invalid_avatar", error instanceof Error ? error.message : String(error)); }
      })();
      await this.revalidateActiveTeamRun(capability, "Recruitment is available only while its run is active.");
      const fingerprint = JSON.stringify({ roleSlug: roleSlug ?? null, name, title, description, context: context ?? null,
        supplemental: supplemental ?? null, initialTask: initialTask ?? null, avatarHash: avatar?.hash ?? null,
        avatarPrompt: avatarPrompt ?? null });
      const recruitmentId = capability.runId;
      const previous = this.index.recruitments[recruitmentId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, "recruitment_limit", "One turn may recruit only one teammate.");
        if (previous.state === "pending" && !previous.plan) throw new HttpError(409, "idempotency_in_doubt", "The earlier legacy recruitment has an uncertain outcome and will not be repeated.");
        if (previous.state === "pending" && previous.plan) {
          // The task now lands in the team group; older plans put it in the DM.
          const existingMessage = await this.harness.threads.message({ groupId: previous.plan.groupId }, previous.plan.messageId)
            ?? await this.harness.threads.message({ botId: previous.plan.botId }, previous.plan.messageId);
          if (existingMessage) throw new HttpError(409, "idempotency_in_doubt", "The initial task message exists but its launch result was not recorded; it will not be dispatched twice.");
        }
        if (previous.state === "pending") {
          // Continue below from the stable planned identities.
        } else {
          return previous.result;
        }
      }
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const identity = blueprint ? `${blueprint.templateId}:${blueprint.slug}` : null;
      const boundRole = identity ? this.index.roleBindings[identity] : undefined;
      const earlierPendingReservation = boundRole ? Object.values(this.index.recruitments).find((entry) =>
        entry.state === "pending" && entry.plan?.botId === boundRole.botId && entry.plan.groupId === boundRole.groupId) : undefined;
      const reservedByEarlierPendingTurn = Boolean(earlierPendingReservation);
      const recoverableUncreatedRole = earlierPendingReservation?.state === "pending"
        && earlierPendingReservation.plan?.botCreated !== true ? earlierPendingReservation.plan : undefined;
      let bot = boundRole ? bots.find((candidate) => candidate.id === boundRole.botId) : undefined;
      if (boundRole && bot?.archived) {
        throw new HttpError(409, "role_not_active", "That company role was deleted or suspended and will not be recreated or reactivated implicitly.");
      }

      const groups = await this.invoke<Group[]>("lbz:groups:list");
      let existingGroup: Group | undefined;
      if (capability.threadId.startsWith("group:")) {
        const groupId = capability.threadId.slice(6);
        existingGroup = groups.find((candidate) => candidate.id === groupId && !candidate.archived);
        if (!existingGroup || !existingGroup.memberIds.includes(capability.botId)) throw new HttpError(403, "invalid_team_scope", "Recruiter is not a member of this team.");
      } else {
        const recruiterGroupId = this.index.recruiterGroups[capability.botId];
        const fallbackGroupId = recruiterGroupId ? undefined : boundRole?.groupId;
        const stableGroupId = recruiterGroupId ?? fallbackGroupId;
        const candidateGroup = stableGroupId ? groups.find((candidate) => candidate.id === stableGroupId && !candidate.archived) : undefined;
        existingGroup = candidateGroup?.memberIds.includes(capability.botId) ? candidateGroup : undefined;
        const recoveringReservedGroup = previous?.state === "pending" && previous.plan?.groupId === stableGroupId;
        if (recruiterGroupId && (!existingGroup || !existingGroup.memberIds.includes(capability.botId))) {
          throw new HttpError(409, "role_team_unavailable", "The recruiter's team was deleted, suspended, or lost its recruiter and will not be recreated implicitly.");
        }
        if (fallbackGroupId && !candidateGroup && !recoveringReservedGroup && !reservedByEarlierPendingTurn) {
          throw new HttpError(409, "role_team_unavailable", "The role's team was deleted or suspended and will not be recreated implicitly.");
        }
        if (recoveringReservedGroup && candidateGroup && !existingGroup) {
          throw new HttpError(409, "idempotency_in_doubt", "The reserved team no longer contains the recruiter.");
        }
      }
      const recruiter = bots.find((candidate) => candidate.id === capability.botId && !candidate.archived);
      if (!recruiter) throw new HttpError(404, "not_found", "Recruiting agent no longer exists.");
      const sourceRun = await this.invoke<Run | null>("lbz:runs:get", [capability.runId]);
      const observedBinding = sourceRun?.inference?.kind === "ollama"
        ? { providerId: sourceRun.inference.providerId, model: sourceRun.inference.model } : undefined;
      const planned = previous?.state === "pending" && previous.plan ? previous.plan : {
        botId: bot?.id ?? recoverableUncreatedRole?.botId ?? newId("bot"),
        groupId: existingGroup?.id ?? recoverableUncreatedRole?.groupId ?? newId("grp"),
        messageId: newMessageId(),
        botCreated: Boolean(bot),
        ...(recoverableUncreatedRole?.ollamaBinding ?? observedBinding
          ? { ollamaBinding: recoverableUncreatedRole?.ollamaBinding ?? observedBinding } : {}),
      };
      const inheritedOllama = planned.ollamaBinding;
      // An API-backed recruiter (Gemini, OpenRouter…) hands its provider and
      // model to the recruit, so the teammate starts working on the same
      // provider instead of waiting for a plan nobody connected.
      const inheritedApi = !inheritedOllama && sourceRun?.inference?.kind === "api"
        ? { providerId: sourceRun.inference.providerId, model: sourceRun.inference.model }
        : !inheritedOllama && recruiter.providerId ? { providerId: recruiter.providerId, ...(recruiter.model ? { model: recruiter.model } : {}) } : undefined;
      if (previous?.state === "pending") {
        if (boundRole && (boundRole.botId !== planned.botId || boundRole.groupId !== planned.groupId)) {
          throw new HttpError(409, "idempotency_in_doubt", "The reserved role identity no longer matches the pending recruitment.");
        }
        bot ??= bots.find((candidate) => candidate.id === planned.botId);
        if (bot?.archived || (!bot && planned.botCreated === true)) {
          throw new HttpError(409, "idempotency_in_doubt", "The reserved recruit was created and is now missing or inactive; it will not be recreated implicitly.");
        }
      } else if (boundRole && !bot && !recoverableUncreatedRole) {
        throw new HttpError(409, "role_not_active", "That company role was deleted and will not be recreated implicitly.");
      }
      const appliedName = input.name === undefined && bot ? bot.name : name;
      const appliedTitle = input.title === undefined && bot?.title ? bot.title : title;
      const appliedDescription = input.description === undefined && bot?.description ? bot.description : description;
      if (!bot && bots.filter((candidate) => !candidate.archived).length >= 32) throw new HttpError(409, "team_limit", "The local workspace is limited to 32 active agents.");

      if (!previous) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before its identities could be reserved.");
        this.index.recruitments[recruitmentId] = {
          state: "pending", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
          sourceThreadId: capability.threadId, plan: planned, createdAt: new Date().toISOString(),
        };
        if (blueprint && identity) {
          this.index.roleBindings[identity] = {
            templateId: blueprint.templateId,
            roleSlug: blueprint.slug,
            botId: planned.botId,
            groupId: planned.groupId,
          };
        }
        this.persistIndex(this.index);
      }
      const createdNow = !bot;
      if (!bot) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before the agent could be created.");
        bot = await this.harness.bots.create({
          name: appliedName,
          title: appliedTitle,
          description: appliedDescription,
          instructions,
          notifyOnFinish: true,
          ...(blueprint ? { roleSlug: blueprint.slug } : {}),
          ...(avatarPrompt ? { avatarPrompt } : {}),
          ...(avatar ? { avatarDataUrl: avatar.dataUrl } : {}),
          ...(inheritedOllama ? { providerId: inheritedOllama.providerId, model: inheritedOllama.model }
            : inheritedApi ? inheritedApi
            : recruiter.planId ? { planId: recruiter.planId } : {}),
        }, planned.botId);
      } else {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before the role assignment could be updated.");
        bot = await this.harness.bots.update(bot.id, {
          name: appliedName,
          title: appliedTitle,
          description: appliedDescription,
          instructions,
          ...(!bot.providerId && !bot.planId && inheritedOllama
            ? { providerId: inheritedOllama.providerId, model: inheritedOllama.model }
            : !bot.providerId && !bot.planId && inheritedApi ? inheritedApi
            : !bot.providerId && !bot.planId && recruiter.planId ? { planId: recruiter.planId } : {}),
        });
      }
      await this.revalidateActiveTeamRun(capability, "Recruitment stopped while the agent was being prepared.");
      let markedCreated = false;
      for (const pendingRecruitment of Object.values(this.index.recruitments)) {
        if (pendingRecruitment.state !== "pending" || pendingRecruitment.plan?.botId !== bot.id
          || pendingRecruitment.plan.botCreated === true) continue;
        pendingRecruitment.plan.botCreated = true;
        markedCreated = true;
      }
      if (markedCreated) this.persistIndex(this.index);
      if (blueprint && identity) {
        this.index.roleAffiliations[bot.id] = { templateId: blueprint.templateId, roleSlug: blueprint.slug };
        this.persistIndex(this.index);
      }
      // Reconcile the requested visual intent on every recovery. Equality is
      // the idempotency proof: a persisted upload/prompt is kept, while a
      // different intent whose earlier write failed is attempted again.
      if (avatar && !createdNow && safeAvatarDataUrl(bot.avatarUrl)?.hash !== avatar.hash) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before the avatar could be set.");
        bot = await this.harness.bots.setAvatar(bot.id, { dataUrl: avatar.dataUrl });
      } else if (!avatar && avatarPrompt && !createdNow) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before avatar generation could be requested.");
        try {
          bot = await this.harness.avatarGeneration.ensureIntent(bot.id, avatarPrompt);
        } catch (error) {
          if (error instanceof AvatarGenerationError) {
            throw new HttpError(error.code === "avatar_job_not_found" ? 404 : 409, error.code, error.message);
          }
          throw error;
        }
      }
      let group = existingGroup ?? groups.find((candidate) => candidate.id === planned.groupId && !candidate.archived);
      if (!group) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before the team could be created.");
        group = await this.harness.groups.create({ name: `${recruiter.name} team`.slice(0, 60), memberIds: [recruiter.id, bot.id] }, planned.groupId);
      } else if (!group.memberIds.includes(bot.id) || !group.memberIds.includes(recruiter.id)) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before the team could be updated.");
        group = await this.harness.groups.update(group.id, { memberIds: [...new Set([...group.memberIds, recruiter.id, bot.id])] });
      }
      await this.revalidateActiveTeamRun(capability, "Recruitment stopped while the team was being prepared.");
      this.index.recruiterGroups[capability.botId] = group.id;
      if (blueprint && identity) {
        this.index.roleBindings[identity] = { templateId: blueprint.templateId, roleSlug: blueprint.slug, botId: bot.id, groupId: group.id };
        this.index.roleAffiliations[bot.id] = { templateId: blueprint.templateId, roleSlug: blueprint.slug };
      }
      this.persistIndex(this.index);

      const task = initialTask ?? `Introduce yourself briefly as ${appliedName}, confirm your bounded responsibility (${appliedDescription}), and state the first concrete step you can take.`;
      // A recruit's own DM is visible to the person from its first turn. The
      // model writes the greeting, so it can sound human and reflect its real
      // brief. The stable id makes crash recovery refuse duplicate greetings.
      const greetingId = `${planned.messageId}_intro`;
      if ((createdNow || previous?.state === "pending") &&
          !await this.harness.threads.message({ botId: bot.id }, greetingId)) {
        await this.revalidateActiveTeamRun(capability, "Recruitment stopped before the introduction could start.");
        const briefer = this.isCeoAgent(recruiter) ? `The CEO ${recruiter.name}` : `Your teammate ${recruiter.name}`;
        try {
          await this.harness.threads.dispatchChild(
            { botId: capability.botId, threadId: capability.threadId, runId: capability.runId },
            { botId: bot.id },
            { text: `${briefer} has briefed you to work as ${appliedTitle}: ${appliedDescription}. Introduce yourself to the person in this direct chat in one short, warm, natural message. Say what you will work on and that they can ask you for help. Write in the person's language, defaulting to French when unknown. Write your own words; no fixed template.`, messageId: greetingId },
          );
        } catch {
          // The task launch below still gets a truthful dispatch receipt.
          // A failed model start cannot fabricate a greeting in the DM.
        }
      }
      let dispatch: RecruitmentResult["dispatch"];
      try {
        const launched = await this.harness.threads.dispatchChild(
          { botId: capability.botId, threadId: capability.threadId, runId: capability.runId },
          { botId: bot.id, groupId: group.id },
          { text: `@${bot.name} ${task}`, messageId: planned.messageId, allowPreviouslyVisited: true },
        );
        dispatch = {
          status: launched.state === "queued" ? "queued"
            : launched.state === "working" || launched.state === "waiting_input" || launched.state === "completed" ? "started"
              : "failed",
          parentRunId: this.runId(capability.runId),
          runId: this.runId(launched.runId),
          messageId: this.messageId(launched.messageId),
          ...(launched.error ? { error: launched.error } : {}),
        };
      } catch (error) {
        const existingMessage = await this.harness.threads.message({ groupId: group.id }, planned.messageId);
        dispatch = {
          status: "failed",
          parentRunId: this.runId(capability.runId),
          runId: null,
          messageId: existingMessage ? this.messageId(existingMessage.id) : null,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        };
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
        dispatch,
      };
      this.index.recruitments[recruitmentId] = {
        state: "completed", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
        sourceThreadId: capability.threadId, createdAt: new Date().toISOString(), result,
      };
      this.index.events = [...this.index.events, event].slice(-1_000);
      this.persistIndex(this.index);
      return result;
    });
  }

  async manageAgent(capability: TeamCapability, raw: unknown): Promise<AgentManagementResult> {
    return this.exclusive(async () => {
      const input = objectBody(raw, ["agent_id", "name", "title", "description", "instructions", "context", "mission", "active", "avatar_data_url"]);
      const publicAgentId = requiredString(input.agent_id, "agent_id", 160);
      const targetBotId = this.internalAgentId(publicAgentId);
      if (targetBotId === capability.botId) throw new HttpError(422, "invalid_agent_target", "An agent cannot manage itself through the team tool.");
      const name = input.name === undefined ? undefined : requiredString(input.name, "name", 60);
      const title = input.title === undefined ? undefined : requiredString(input.title, "title", 80);
      if ((name && /[\r\n]/.test(name)) || (title && /[\r\n]/.test(title))) {
        throw new HttpError(400, "invalid_payload", "name and title must be one line.");
      }
      const mission = input.mission === undefined ? undefined : requiredString(input.mission, "mission", 2_000);
      const description = input.description === undefined ? undefined : requiredString(input.description, "description", 600);
      const instructions = input.instructions === undefined ? undefined : requiredString(input.instructions, "instructions", 4_000);
      const context = input.context === undefined ? undefined : requiredString(input.context, "context", 2_000);
      const avatarProvided = Object.prototype.hasOwnProperty.call(input, "avatar_data_url");
      const avatar = !avatarProvided || input.avatar_data_url === null ? null : (() => {
        try { return parseAvatarDataUrl(input.avatar_data_url); }
        catch (error) { throw new HttpError(400, "invalid_avatar", error instanceof Error ? error.message : String(error)); }
      })();
      if (input.active !== undefined && typeof input.active !== "boolean") throw new HttpError(400, "invalid_payload", "active must be a boolean.");
      if (!name && !title && !description && !instructions && !context && !mission && input.active === undefined && !avatarProvided) throw new HttpError(400, "invalid_payload", "At least one bounded agent update is required.");
      await this.revalidateActiveTeamRun(capability, "Agent management is available only while its run is active.");
      const fingerprint = JSON.stringify({ publicAgentId, name: name ?? null, title: title ?? null, description: description ?? null,
        instructions: instructions ?? null, context: context ?? null, mission: mission ?? null, active: input.active ?? null,
        avatarHash: avatar?.hash ?? (avatarProvided ? null : undefined) });
      const managementId = `${capability.runId}:${targetBotId}`;
      const previous = this.index.managements[managementId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new HttpError(409, "idempotency_conflict", "This run already managed that teammate with a different request.");
        if (previous.state === "pending") throw new HttpError(409, "idempotency_in_doubt", "The earlier agent update has an uncertain outcome and will not be repeated.");
        return previous.result;
      }
      const changesThisRun = Object.values(this.index.managements).filter((entry) => entry.sourceRunId === capability.runId).length;
      if (changesThisRun >= 4) throw new HttpError(409, "management_limit", "One run may manage at most four teammates.");
      const bots = await this.invoke<Bot[]>("lbz:bots:list");
      const targetBot = bots.find((candidate) => candidate.id === targetBotId);
      if (!targetBot) throw new HttpError(404, "not_found", "Managed agent does not exist.");
      if (/\bCEO\b/i.test(targetBot.title ?? "") || (title && /\bCEO\b/i.test(title)))
        throw new HttpError(403, "invalid_team_scope", "Agent management cannot change the CEO role.");
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
      await this.revalidateActiveTeamRun(capability, "Agent management stopped before its update could be recorded.");
      this.index.managements[managementId] = {
        state: "pending", fingerprint, sourceBotId: capability.botId, sourceRunId: capability.runId,
        sourceThreadId: capability.threadId, targetBotId, createdAt: new Date().toISOString(),
      };
      this.persistIndex(this.index);
      await this.revalidateActiveTeamRun(capability, "Agent management stopped before the agent could be updated.");
      let updated = await this.harness.bots.update(targetBotId, {
        ...(name ? { name } : {}),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(instructions || context || mission
          ? { instructions: assignmentInstructions(targetBot.instructions ?? "", context ?? mission, instructions) }
          : {}),
        ...(typeof input.active === "boolean" ? { archived: !input.active } : {}),
      });
      if (avatarProvided) {
        await this.revalidateActiveTeamRun(capability, "Agent management stopped before the avatar could be updated.");
        updated = await this.harness.bots.setAvatar(targetBotId, avatar ? { dataUrl: avatar.dataUrl } : null);
      }
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
      this.persistIndex(this.index);
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
  const managedEntitlement = process.env[MANAGED_ENTITLEMENT_ENV] === "1";
  const token = randomBytes(48).toString("base64url");
  const teamBroker = new LocalTeamBroker();
  const localTeamMcpScriptPath = join(dirname(fileURLToPath(import.meta.url)), "local-team-mcp.js");
  let facade: CollaborationFacade | null = null;
  let connector: RelayConnector | null = null;
  let packs: Packs | null = null;
  let cloud: CloudComputer | null = null;
  let cloudLink: CloudLink | null = null;
  let nativeToolScope: { orgId: string; workspaceId: string } | null = null;
  let nativeToolsTransport: ReturnType<typeof desktopContinuityTransport> | null = null;
  const refreshNativeToolScope = async (): Promise<void> => {
    if (!nativeToolsTransport) { nativeToolScope = null; return; }
    try {
      const status = await nativeToolsTransport<{ linked?: boolean; toolsAvailable?: boolean; orgId?: string; workspaceId?: string }>("status", {});
      nativeToolScope = status.linked === true && status.toolsAvailable === true && typeof status.orgId === "string" && typeof status.workspaceId === "string"
        ? { orgId: status.orgId, workspaceId: status.workspaceId } : null;
    } catch { nativeToolScope = null; }
  };
  const bizosToolOperation: Record<string, string> = {
    bizos_email_send: "tools/email-send", bizos_email_inbox: "tools/email-inbox",
    bizos_site_publish: "tools/site-publish", bizos_site_unpublish: "tools/site-unpublish", bizos_image_generate: "tools/image-generate",
  };
  const invokeBizosTool = async (tool: string, raw: unknown): Promise<unknown> => {
    if (!nativeToolsTransport || !bizosToolOperation[tool]) throw new HttpError(503, "bizos_tools_unavailable", "BizOS server tools are unavailable without the desktop bridge.");
    await refreshNativeToolScope();
    const scope = nativeToolScope;
    if (!scope || scope.workspaceId !== `local:${id}:workspace`) throw new HttpError(403, "bizos_account_unlinked", "Sign in to BizOS and link this workspace to an organization to use this tool.");
    const args = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return nativeToolsTransport(bizosToolOperation[tool]!, { ...args, orgId: scope.orgId, workspaceId: scope.workspaceId });
  };
  const packOf = (botId: string): PackService | null =>
    packs?.agency.isPackBot(botId) ? packs.agency : packs?.ecommerce.isPackBot(botId) ? packs.ecommerce : null;
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
      if (method === "POST" && url.pathname.startsWith("/api/internal/local-team/")) {
        const operation = url.pathname.slice("/api/internal/local-team/".length);
        const capability = teamBroker.authorize(bearer, {allowDuringVoice: operation === "cloud"});
        if (!localComputerEnabled() && (operation === "computer" || operation === "cloud")) {
          throw new HttpError(503, "computer_disabled", "Computer is unavailable in this release.");
        }
        // A 128 KiB text payload can expand sixfold when JSON escapes control
        // characters. Only this explicit document route has the larger bound.
        const input = await bodyOf(request, operation === "publish-artifact" ? 1024 * 1024 : MAX_BODY_BYTES);
        const parsed = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string,unknown> : {};
        const continuityTool = Object.hasOwn(CONTINUITY_MCP_OPERATIONS, operation) ? CONTINUITY_MCP_OPERATIONS[operation] : undefined;
        if (continuityTool) return sendJson(response, 200, await harness.continuity.invokePortableTool(
          capability.threadId, capability.runId, continuityTool, input, () => { teamBroker.authorize(bearer); },
        ));
        const toolName = typeof parsed.tool === "string" ? parsed.tool : operation;
        const result = await harness.continuity.execute(capability.threadId,capability.runId,toolName,input,async () => {
          // Recheck immediately before dispatch after the network admission.
          teamBroker.authorize(bearer, {allowDuringVoice: operation === "cloud"});
          if (operation === "recruit") return facade!.recruit(capability,input);
          if (operation === "manage") return facade!.manageAgent(capability,input);
          if (operation === "routine") return facade!.scheduleRoutine(() => teamBroker.authorize(bearer),input);
          if (operation === "list-routines") return facade!.listAgentRoutines(capability);
          if (operation === "cancel-routine") return facade!.cancelAgentRoutine(capability,input);
          if (operation === "bizos") {
            if (!BIZOS_TOOL_SPECS.some(tool => tool.name === parsed.tool)) throw new HttpError(404, "unknown_tool", "Unknown BizOS server tool.");
            return invokeBizosTool(String(parsed.tool), parsed.arguments);
          }
          if (operation === "checkpoint") return facade!.checkpointTask(capability,input);
          if (operation === "send") return facade!.sendToChat(capability,input);
          if (operation === "quick-replies") return facade!.offerQuickReplies(capability,input);
          if (operation === "propose-name") return facade!.proposeCompanyName(capability,input);
          if (operation === "context") {
            if (harness.continuity.linked(capability.threadId) || !CONTEXT_TOOL_SPECS.some(tool => tool.name === parsed.tool)) throw new HttpError(403, "forbidden", "This local context tool is unavailable for this conversation.");
            try { return await harness.contextTool(capability.botId, String(parsed.tool), parsed.arguments ?? {}); }
            catch (error) {
              if (error instanceof ContextReferenceError) throw new HttpError(409, "context_reference_unavailable", error.message);
              throw error;
            }
          }
          if (operation === "agency" || operation === "pack") return facade!.packTool(capability,input);
          if (operation === "cloud") {
            if (!cloud || !isCloudToolName(parsed.tool)) throw new HttpError(404,"not_found","Unknown cloud computer tool.");
            const args=parsed.arguments&&typeof parsed.arguments === "object"&&!Array.isArray(parsed.arguments)?parsed.arguments as Record<string,unknown>:{};
            return cloud.tool(capability.botId,String(parsed.tool),args);
          }
          if (operation === "computer") {
            if (!isComputerToolName(parsed.tool)) throw new HttpError(404,"not_found","Unknown computer tool.");
            const result=await facade!.computerTool(capability,parsed.tool,parsed.arguments??{});
            return {ok:true,text:result.text,...(result.image?{image:result.image}:{})};
          }
          throw new HttpError(404,"not_found","Unknown local team operation.");
        });
        return sendJson(response, operation === "recruit" || operation === "routine" ? 201 : 200, result);
      }
      if (!secureEqual(authorization, `Bearer ${token}`)) throw new HttpError(401, "unauthorized", "Local bearer token required.");
      if (url.pathname === "/api/local/continuity/preference") {
        if (method === "GET") return sendJson(response, 200, { saveConversations: harness.continuity.backupEnabled() });
        if (method === "POST") {
          const input = objectBody(await bodyOf(request), ["saveConversations"]);
          if (typeof input.saveConversations !== "boolean") throw new HttpError(400, "invalid_body", "Choose whether to save conversations.");
          await facade.setConversationBackup(input.saveConversations);
          return sendJson(response, 200, { saveConversations: input.saveConversations });
        }
      }
      if (url.pathname === "/api/local/continuity/auto-link" && method === "POST")
        return sendJson(response, 200, await facade.autoLinkAll());
      if (url.pathname === "/api/local/execution-destination") {
        if (method === "GET") {
          const threadId = url.searchParams.get("threadId");
          if (!threadId) throw new HttpError(400, "invalid_body", "Conversation required.");
          return sendJson(response, 200, await facade.executionDestination(threadId));
        }
        if (method === "POST") {
          const input = objectBody(await bodyOf(request), ["threadId", "destination"]);
          if (typeof input.threadId !== "string" || !["personal", "bizos"].includes(String(input.destination))) throw new HttpError(400, "invalid_body", "Choose an execution destination.");
          return sendJson(response, 200, await facade.executionDestination(input.threadId, input.destination as "personal" | "bizos"));
        }
      }
      if (url.pathname === "/api/local/continuity/prepare-shutdown" && method === "POST") return sendJson(response,200,{results:await harness.continuity.prepareShutdown()});
      if (url.pathname === "/api/local/continuity/transfers" && method === "GET") return sendJson(response,200,await harness.continuity.pendingTransfers());
      if (url.pathname === "/api/local/continuity/status" && method === "GET") {
        const threadId = url.searchParams.get("threadId");
        return sendJson(response, 200, threadId ? harness.continuity.store.status(threadId) : harness.continuity.store.links().map(row => ({threadId:row.threadId, ...harness.continuity.store.status(row.threadId)})));
      }
      if (url.pathname === "/api/local/continuity/policy" && method === "GET") {
        const threadId=url.searchParams.get("threadId");if(!threadId)throw new HttpError(400,"invalid_body","Conversation required.");
        return sendJson(response,200,await harness.continuity.policy(threadId));
      }
      if (url.pathname === "/api/local/continuity/agents" && method === "GET") return sendJson(response, 200, await harness.continuity.agents());
      if (url.pathname === "/api/local/continuity/conversations" && method === "GET") return sendJson(response, 200, await harness.continuity.list());
      if (url.pathname.startsWith("/api/local/continuity/") && method === "POST") {
        const input = objectBody(await bodyOf(request), ["threadId", "agentId", "audience", "cloudThreadId", "title", "conversationId", "artifactId", "version", "previousHash", "name", "mimeType", "contentBase64", "transferId", "destination", "summary", "runId", "epoch", "checkpointId", "expectedHead", "manifestHash", "modelRuntime"]);
        if (typeof input.threadId !== "string" || input.threadId.length > 128 || !/^(bot|group|chat):/.test(input.threadId)) throw new HttpError(400,"invalid_body","A local conversation is required.");
        const threadId = input.threadId;
        if (threadId.startsWith("chat:")) {
          // A QuickChat is saved like any conversation, but only while it exists.
          try { await harness.quickChats.get(threadId.slice("chat:".length)); }
          catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(404, "not_found", "That QuickChat is no longer available.");
          }
        }
        if (url.pathname.endsWith("/link")) {
          if (typeof input.agentId !== "string" || !["private","thread"].includes(String(input.audience)) || typeof input.title !== "string") throw new HttpError(400,"invalid_body","Choose an authorized cloud agent and conversation audience.");
          return sendJson(response, 200, await harness.continuity.link(threadId,{agentId:input.agentId,audience:input.audience as "private"|"thread",title:input.title,...(typeof input.cloudThreadId === "string" ? {threadId:input.cloudThreadId}: {})}));
        }
        if (url.pathname.endsWith("/attach")) {
          if (typeof input.conversationId !== "string") throw new HttpError(400,"invalid_body","Choose an authorized conversation.");
          return sendJson(response,200,await harness.continuity.attach(threadId,input.conversationId));
        }
        if (url.pathname.endsWith("/sync")) { await harness.continuity.sync(threadId); return sendJson(response,200,harness.continuity.store.status(threadId)); }
        if (url.pathname.endsWith("/transfer/prepare")) {
          const d=input.destination&&typeof input.destination === "object"&&!Array.isArray(input.destination)?input.destination as Record<string,unknown>:{};
          if(typeof input.transferId!=="string"||!((d.kind==="cloud"&&typeof d.model==="string")||(d.kind==="installation"&&typeof d.installationId==="string"&&["claude","codex"].includes(String(d.modelRuntime)))))throw new HttpError(400,"invalid_body","Choose an authorized transfer destination.");
          return sendJson(response,200,await harness.continuity.prepareTransfer(threadId,{transferId:input.transferId,destination:d as {kind:"installation";installationId:string;modelRuntime:"claude"|"codex"}|{kind:"cloud";model:string},...(typeof input.summary==="string"?{summary:input.summary}:{})}));
        }
        if (url.pathname.endsWith("/transfer/accept")) {
          if([input.transferId,input.runId,input.checkpointId,input.expectedHead,input.manifestHash].some(value=>typeof value!=="string")||!Number.isSafeInteger(input.epoch)||!["claude","codex"].includes(String(input.modelRuntime)))throw new HttpError(400,"invalid_body","The complete transfer receipt is required.");
          return sendJson(response,200,await harness.continuity.acceptTransfer(threadId,{transferId:String(input.transferId),runId:String(input.runId),epoch:Number(input.epoch),checkpointId:String(input.checkpointId),expectedHead:String(input.expectedHead),manifestHash:String(input.manifestHash),modelRuntime:input.modelRuntime as "claude"|"codex"}));
        }
        if (url.pathname.endsWith("/artifact/read")) {
          if(typeof input.artifactId !== "string" || !Number.isSafeInteger(input.version)) throw new HttpError(400,"invalid_body","Artifact and version are required.");
          return sendJson(response,200,await harness.continuity.readArtifact(threadId,input.artifactId,Number(input.version)));
        }
        if (url.pathname.endsWith("/artifact/put")) {
          if(!Number.isSafeInteger(input.version)||typeof input.name!=="string"||typeof input.mimeType!=="string"||typeof input.contentBase64!=="string"||(input.previousHash!==null&&typeof input.previousHash!=="string"))throw new HttpError(400,"invalid_body","A bounded artifact version is required.");
          return sendJson(response,200,await harness.continuity.putArtifact(threadId,{version:Number(input.version),name:input.name,mimeType:input.mimeType,contentBase64:input.contentBase64,previousHash:input.previousHash,...(typeof input.artifactId==="string"?{artifactId:input.artifactId}:{})}));
        }
        throw new HttpError(404,"not_found","Unknown continuity operation.");
      }
      // A file an agent sent to the chat, or a link preview's image: the
      // bytes, from the path the transcript recorded, owner-bearer only.
      const attachmentId = routeId(url.pathname, /^\/api\/local\/attachments\/([^/]+)$/);
      if (attachmentId && method === "GET") {
        const found = facade.attachment(decodeURIComponent(attachmentId));
        if (!found) throw new HttpError(404, "not_found", "Attachment not found.");
        response.writeHead(200, {
          "content-type": found.contentType,
          "content-length": found.size,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(found.path))}`,
          "referrer-policy": "no-referrer",
        });
        createReadStream(found.path).on("error", () => response.destroy()).pipe(response);
        return;
      }
      // An agent's computer as the desktop panel draws it: status, page and
      // its latest screen (the agent's own seat — never anybody else's).
      if (!localComputerEnabled() && url.pathname.startsWith("/api/local/computer/")) {
        throw new HttpError(503, "computer_disabled", "Computer is unavailable in this release.");
      }
      const computerBot = routeId(url.pathname, /^\/api\/local\/computer\/([^/]+)$/);
      if (computerBot && method === "GET") {
        return sendJson(response, 200, await facade.computerState(computerBot, url.searchParams.get("full") === "1"));
      }
      const computerSetUp = routeId(url.pathname, /^\/api\/local\/computer\/([^/]+)\/setup$/);
      if (computerSetUp && method === "POST") return sendJson(response, 200, await facade.computerSetUp(computerSetUp));
      const computerControl = routeId(url.pathname, /^\/api\/local\/computer\/([^/]+)\/control$/);
      if (computerControl && method === "POST") {
        try {
          return sendJson(response, 200, await facade.computerControl(computerControl));
        } catch (error) {
          throw cloudHttpError(error);
        }
      }
      const computerRelease = routeId(url.pathname, /^\/api\/local\/computer\/([^/]+)\/release$/);
      if (computerRelease && method === "POST") {
        return sendJson(response, 200, await facade.computerRelease(computerRelease, await bodyOf(request)));
      }
      if (method === "GET" && url.pathname === "/api/local/dashboard-summary") return sendJson(response, 200, await facade.localDashboardSummary());
      // The web dashboard link (device-code flow + snapshot push). The device
      // token never crosses this boundary; only status does.
      if (url.pathname === "/api/local/cloud-link" || url.pathname === "/api/local/cloud-link/start" || url.pathname === "/api/local/cloud-link/cancel") {
        if (!cloudLink) throw new HttpError(503, "starting", "The web dashboard link is starting.");
        try {
          if (method === "GET" && url.pathname === "/api/local/cloud-link") return sendJson(response, 200, cloudLink.status());
          if (method === "PATCH" && url.pathname === "/api/local/cloud-link") {
            const input = objectBody(await bodyOf(request), ["workspaceName"]);
            cloudLink.setWorkspaceName(requiredString(input.workspaceName, "workspaceName", 120));
            return sendJson(response, 200, cloudLink.status());
          }
          if (method === "POST" && url.pathname === "/api/local/cloud-link/start") {
            const input = objectBody(await bodyOf(request), ["workspaceName"]);
            const workspaceName = optionalString(input.workspaceName, "workspaceName", 120);
            if (workspaceName) cloudLink.setWorkspaceName(workspaceName);
            return sendJson(response, 200, await cloudLink.start());
          }
          if (method === "POST" && url.pathname === "/api/local/cloud-link/cancel") {
            return sendJson(response, 200, { cancelled: cloudLink.cancelPending() });
          }
          if (method === "DELETE" && url.pathname === "/api/local/cloud-link") {
            await cloudLink.unlink();
            return sendJson(response, 200, cloudLink.status());
          }
        } catch (error) {
          if (error instanceof CloudLinkError) throw new HttpError(error.status, error.code, error.message);
          throw error;
        }
        throw new HttpError(405, "method_not_allowed", "Method not allowed.");
      }
      if (url.pathname === "/api/local/quick-chats" && method === "GET") return sendJson(response, 200, await facade.quickChats("list"));
      if (url.pathname === "/api/local/quick-chats" && method === "POST") return sendJson(response, 201, await facade.createQuickChat(await bodyOf(request)));
      const quickChat = /^\/api\/local\/quick-chats\/(qchat_[a-f0-9]{32})(?:\/(messages|stop|answer))?$/.exec(url.pathname);
      if (quickChat) {
        const chatId = quickChat[1];
        const action = quickChat[2];
        if (!action && method === "GET") return sendJson(response, 200, await facade.quickChats("get", [chatId]));
        if (action === "messages" && method === "GET") return sendJson(response, 200, await facade.quickChats("messages", [chatId, url.searchParams.get("before")]));
        if (method === "POST" && action) return sendJson(response, 200, await facade.quickChats(action === "messages" ? "send" : action as "stop" | "answer", [chatId, await bodyOf(request)]));
      }
      // The packs, for the desktop: state, install, dashboard URL. The desktop
      // MAIN process fetches `open` and embeds the page in an isolated view;
      // nothing is launched from here and no browser is opened.
      for (const pack of ["agency", "ecommerce"] as const) {
        if (method === "GET" && url.pathname === `/api/local/${pack}`) return sendJson(response, 200, await facade.packStatus(pack));
        if (method === "POST" && url.pathname === `/api/local/${pack}/install`) {
          return sendJson(response, 200, await facade.packInstall(pack, await bodyOf(request)));
        }
        if (method === "POST" && url.pathname === `/api/local/${pack}/open`) {
          objectBody(await bodyOf(request), []);
          return sendJson(response, 200, await facade.packOpen(pack));
        }
      }
      if (method === "GET" && url.pathname === "/api/local/workspace-template") return sendJson(response, 200, await facade.workspaceTemplate());
      if (method === "POST" && url.pathname === "/api/local/workspace-template/bind") {
        return sendJson(response, 200, await facade.bindWorkspaceTemplate(await bodyOf(request)));
      }
      if (method === "GET" && url.pathname === "/api/local/health") {
        return sendJson(response, 200, { ok: true, mode: "local-harness", contractVersion: 1, instanceId: id });
      }
      if (method === "POST" && url.pathname === "/api/local/voice/calls") {
        const result = await facade.prepareVoiceCall(await bodyOf(request));
        return sendJson(response, result.duplicate ? 200 : 201, result);
      }
      const dispatchVoiceCallId = routeId(url.pathname, /^\/api\/local\/voice\/calls\/([^/]+)\/dispatch$/);
      if (dispatchVoiceCallId && method === "POST") {
        const result = await facade.dispatchVoiceCall(dispatchVoiceCallId, await bodyOf(request));
        return sendJson(response, result.duplicate ? 200 : 201, result);
      }
      const cancelVoiceCallId = routeId(url.pathname, /^\/api\/local\/voice\/calls\/([^/]+)\/cancel$/);
      if (cancelVoiceCallId && method === "POST") {
        objectBody(await bodyOf(request), []);
        return sendJson(response, 200, await facade.cancelVoiceCall(cancelVoiceCallId));
      }
      const voiceCallId = routeId(url.pathname, /^\/api\/local\/voice\/calls\/([^/]+)$/);
      if (voiceCallId && method === "GET") return sendJson(response, 200, await facade.voiceCall(voiceCallId));
      if (method === "GET" && url.pathname === "/api/collaboration/bootstrap") return sendJson(response, 200, await facade.bootstrap());
      if (method === "GET" && url.pathname === "/api/collaboration/threads") return sendJson(response, 200, await facade.threads());
      if (method === "POST" && url.pathname === "/api/collaboration/threads") {
        const result = await facade.createGroup(await bodyOf(request));
        return sendJson(response, result.status, result.body);
      }
      const messageThreadId = routeId(url.pathname, /^\/api\/collaboration\/threads\/([^/]+)\/messages$/);
      if (messageThreadId && method === "GET") return sendJson(response, 200, await facade.messagePage(messageThreadId, url));
      if (messageThreadId && method === "POST") {
        const result = await facade.postMessage(messageThreadId, await bodyOf(request, MAX_COLLABORATION_MESSAGE_BYTES));
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
      if (method === "GET" && url.pathname === "/api/local/events") {
        if (!serveEventStream(request, response, facade.streams)) {
          throw new HttpError(429, "too_many_streams", "Too many local event streams are open.");
        }
        return;
      }
      if (method === "POST" && url.pathname === "/api/local/runtime/heartbeat") return sendJson(response, 200, { settings: await facade.setHeartbeat(await bodyOf(request)) });
      if (method === "POST" && url.pathname === "/api/local/runtime/sandbox") return sendJson(response, 200, { settings: await facade.setSandbox(await bodyOf(request)) });
      if (method === "POST" && url.pathname === "/api/local/runtime/permissions") return sendJson(response, 200, { settings: await facade.setPermissions(await bodyOf(request)) });
      if (method === "GET" && url.pathname === "/api/local/bots") return sendJson(response, 200, { bots: await facade.bots() });
      if (method === "POST" && url.pathname === "/api/local/bots") return sendJson(response, 201, await facade.createBot(await bodyOf(request)));
      if (method === "POST" && url.pathname === "/api/local/avatar-worker/claim") {
        return sendJson(response, 200, facade.claimAvatarWorker(await bodyOf(request)));
      }
      if (method === "POST" && url.pathname === "/api/local/avatar-worker/report") {
        return sendJson(response, 200, facade.reportAvatarWorker(await bodyOf(request)));
      }
      const generateAvatarBotId = routeId(url.pathname, /^\/api\/local\/bots\/([^/]+)\/avatar\/generate$/);
      if (generateAvatarBotId && method === "POST") {
        return sendJson(response, 200, await facade.generateAvatar(generateAvatarBotId, await bodyOf(request)));
      }
      const avatarBotId = routeId(url.pathname, /^\/api\/local\/bots\/([^/]+)\/avatar$/);
      if (avatarBotId && method === "POST") return sendJson(response, 200, await facade.setBotAvatar(avatarBotId, await bodyOf(request)));
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
      if (method === "POST" && url.pathname === "/api/local/model-selection") return sendJson(response, 200, await facade.selectModel(await bodyOf(request)));
      if (method === "POST" && url.pathname === "/api/local/runtime/inference") {
        return sendJson(response, 200, { settings: await facade.setInference(await bodyOf(request)) });
      }
      if (method === "POST" && url.pathname === "/api/local/runtime/model") {
        return sendJson(response, 200, { settings: await facade.setModel(await bodyOf(request)) });
      }
      if (url.pathname.startsWith("/api/local/entitlement/")) {
        if (!managedEntitlement) throw new HttpError(404,"not_found","Managed entitlement unavailable.");
        if (request.headers.origin || request.headers["sec-fetch-site"]) throw new HttpError(403,"forbidden","Native owner requests only.");
        if (method === "POST" && url.pathname === "/api/local/entitlement/owner-session") {
          objectBody(await bodyOf(request), []);
          return sendJson(response,200,harness.entitlement.beginOwnerSession());
        }
        if (method === "POST" && url.pathname === "/api/local/entitlement/projection") {
          const projection = await bodyOf(request);
          try { return sendJson(response, 200, harness.entitlement.applyManaged(projection)); }
          catch { throw new HttpError(400, "invalid_entitlement", "Local feature projection refused."); }
        }
        throw new HttpError(405,"method_not_allowed","Method not allowed.");
      }
      if (managedEntitlement && method !== "GET" && url.pathname === "/api/local/entitlement") throw new HttpError(403,"forbidden","Managed entitlement cannot be set locally.");
      if (method === "GET" && url.pathname === "/api/local/entitlement") return sendJson(response, 200, await facade.entitlement());
      // The cloud computer (one Boat sandbox for this workspace). Status and
      // settings carry no secret; `desktop` returns a secret-bearing stream
      // URL, which is why it is owner-bearer only like everything here.
      if (url.pathname === "/api/local/cloud-computer" || url.pathname.startsWith("/api/local/cloud-computer/")) {
        if (!cloud) throw new HttpError(503, "starting", "Local harness is starting.");
        const machine = cloud;
        const action = url.pathname.slice("/api/local/cloud-computer".length);
        if (!localComputerEnabled() && !(method === "POST" && action === "/sleep")) {
          throw new HttpError(503, "computer_disabled", "Computer is unavailable in this release.");
        }
        try {
          if (method === "GET" && action === "") return sendJson(response, 200, await machine.status());
          if (method === "PUT" && action === "") {
            const input = objectBody(await bodyOf(request), ["machineClass", "idleMinutes"]);
            return sendJson(response, 200, machine.setSettings(input));
          }
          if (method === "POST" && action === "/key") {
            const input = objectBody(await bodyOf(request), ["apiKey", "scope"]);
            return sendJson(response, 200, machine.setApiKey(input.apiKey, input.scope ?? "company"));
          }
          if (method === "POST" && (action === "/wake" || action === "/sleep" || action === "/desktop")) {
            objectBody((await bodyOf(request)) ?? {}, []);
            if (action !== "/sleep" && !(await facade.entitlement()).features.cloudComputer) throw new ProRequiredError("cloudComputer");
            if (action === "/wake") return sendJson(response, 200, await machine.wake());
            if (action === "/sleep") return sendJson(response, 200, await machine.sleep("owner"));
            return sendJson(response, 200, await machine.desktop());
          }
        } catch (error) {
          throw cloudHttpError(error);
        }
        throw new HttpError(404, "not_found", "Local endpoint not found.");
      }
      if (method === "PUT" && url.pathname === "/api/local/entitlement") return sendJson(response, 200, await facade.setEntitlement(await bodyOf(request)));
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
      if (method === "GET" && url.pathname === "/api/local/brain/templates") {
        return sendJson(response, 200, await facade.brainTemplates());
      }
      if (method === "POST" && url.pathname === "/api/local/brain/templates/apply") {
        return sendJson(response, 200, await facade.applyBrainTemplate(await bodyOf(request, 4 * 1024 * 1024)));
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
  const nativeDescriptorPath = process.env[NATIVE_COMPUTER_DESCRIPTOR_VARIABLE]?.trim();
  // A signed installation uses only the server seat. Do not even load the old
  // local Boat configuration in that sidecar process.
  const cloudComputer: CloudComputer | null = nativeDescriptorPath ? null : new CloudComputer({
    storage: new Storage(harnessRoot),
    isAllowed: async (): Promise<boolean> => (await harness.entitlement.get()).features.cloudComputer,
    log: (line) => process.stderr.write(`[localbizos] ${line}\n`),
  });
  cloud = cloudComputer;
  const continuityTransport = nativeDescriptorPath
    ? desktopContinuityTransport(resolve(nativeDescriptorPath)) : undefined;
  // The same signed bridge carries the BizOS server tools (email, inbox,
  // landing publication, image generation) and the per-agent computer seat.
  nativeToolsTransport = continuityTransport ?? null;
  let computerOrgId: string | null = null;
  let computerWorkspaceId = "";
  if (continuityTransport) {
    const refreshComputerAvailability = async () => {
      if (process.env.BIZOS_DESKTOP_COMPUTER_OPT_OUT === "true") {
        process.env.BIZOS_LOCAL_COMPUTER_ENABLED = "false";
        return;
      }
      try {
        const scope = await continuityTransport<Record<string, unknown>>("status", {});
        computerOrgId = scope.linked === true && typeof scope.orgId === "string" ? scope.orgId : null;
        computerWorkspaceId = typeof scope.workspaceId === "string" ? scope.workspaceId : "";
        if (!computerOrgId) { process.env.BIZOS_LOCAL_COMPUTER_ENABLED = "false"; return; }
        const status = await continuityTransport<Record<string, unknown>>("computer/status", {
          orgId: computerOrgId, workspaceId: computerWorkspaceId, agentId: "ceo",
        });
        process.env.BIZOS_LOCAL_COMPUTER_ENABLED = status.available === true && status.configured === true ? "true" : "false";
      } catch {
        process.env.BIZOS_LOCAL_COMPUTER_ENABLED = "false";
      }
    };
    await refreshComputerAvailability();
    setInterval(() => { void refreshComputerAvailability(); }, 60_000).unref();
  }
  const serverComputer = continuityTransport && nativeDescriptorPath
    ? new RemoteServerComputerBackend(continuityTransport, () => computerOrgId, () => computerWorkspaceId)
    : undefined;
  const harness: LocalBizosHarness = new LocalBizosHarness({
    ...(managedEntitlement ? { managedEntitlementInstanceId: id } : {}),
    rootDir: harnessRoot,
    ...(continuityTransport ? { continuityTransport } : {}),
    bizosSelected: (threadId) => facade?.bizosDestination(threadId) === "bizos",
    ...(continuityTransport ? { bizosChat: async (threadId: string, body: Record<string, unknown>, signal: AbortSignal) => {
      if (signal.aborted || !facade) throw new Error("BizOS inference was stopped.");
      const messages = body.messages;
      if (!Array.isArray(messages)) throw new Error("BizOS inference messages are invalid.");
      const scope = await facade.bizosScope(threadId);
      if (scope.workspaceId !== `local:${id}:workspace`) throw new Error("BizOS workspace changed.");
      return continuityTransport("inference/chat", { ...body, orgId: scope.orgId, workspaceId: scope.workspaceId });
    } } : {}),
    ...(cloudComputer ? { cloudComputer } : {}),
    ...(serverComputer ? { computerBackend: serverComputer } : {}),
    baseUrl: origin,
    readSessionCookie: async () => "",
    orgName: () => harness.workspaceTemplate.companyName() ?? cloudLink?.status().orgName ?? "Local workspace",
    execPath: process.execPath,
    packaged: false,
    runAsNodeAvailable: false,
    // Deliberately absent: the sidecar exposes no BizOS/cloud MCP tool surface.
    mcpScriptPath: join(stateRoot, "disabled-bizos-mcp.mjs"),
    environment: safeHarnessEnvironment(),
    homeDir: homedir(),
    deniedDirs: [stateRoot, dirname(descriptorPath)],
    // What an agent's commands may never read, whatever the mode: the runtime
    // state (owner bearer, provider keys, plans, MCP configs, transcripts),
    // the desktop's own secrets, and the OTHER CLI's credentials.
    protectedPaths: ({ provider, codexHome, claudeConfigDir }) => [
      ...runtimeProtectedPaths({
        storageRoot: harnessRoot,
        stateRoot,
        descriptorPath,
        ...(nativeDescriptorPath ? { nativeDescriptorPath } : {}),
        ...(process.env.BOAT_API_KEY_FILE?.trim() ? { boatKeyFile: process.env.BOAT_API_KEY_FILE.trim() } : {}),
        extra: desktopProtectedPaths(),
      }),
      ...cliCredentialPaths({
        ...(codexHome ? { codexHome } : {}),
        ...(claudeConfigDir ? { claudeConfigDir } : {}),
        own: provider === "codex" ? "codex" : provider === "claude" ? "claude" : undefined,
      }),
    ],
    devices: false,
    // Agents with unfinished work pick it back up by themselves (gated, cheap).
    heartbeat: true,
    localTeamTools: ({ bot, threadId, runId, teamDelegationBlocked }) => {
      // Exchange the one-shot ticket inside the trusted host. Neither token
      // reaches Codex, its prompt, argv, environment, or the renderer.
      const session = teamBroker.exchange(teamBroker.issue({ botId: bot.id, threadId, runId, teamDelegationBlocked }));
      const teamTools = LOCAL_TEAM_TOOL_SPECS.filter(tool => !isCloudToolName(tool.name) || (!serverComputer && localComputerEnabled())).filter(tool => !tool.name.startsWith("read_conversation_")).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        call: async (argumentsValue: unknown) => {
          if (!facade) throw new HttpError(503, "not_ready", "Local team runtime is not ready.");
          if (isCloudToolName(tool.name)) {
            if (!cloud) throw new HttpError(503, "not_ready", "Local team runtime is not ready.");
            const { botId } = teamBroker.authorize(session, { allowDuringVoice: true });
            const args = argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue) ? argumentsValue as Record<string, unknown> : {};
            return cloud.tool(botId, tool.name, args);
          }
          if (tool.name === "schedule_routine") return facade.scheduleRoutine(() => teamBroker.authorize(session), argumentsValue);
          const capability = teamBroker.authorize(session);
          if (tool.name === "list_routines") return facade.listAgentRoutines(capability);
          if (tool.name === "cancel_routine") return facade.cancelAgentRoutine(capability, argumentsValue);
          if (tool.name === "recruit_agent") return facade.recruit(capability, argumentsValue);
          if (tool.name === "checkpoint_task") return facade.checkpointTask(capability, argumentsValue);
          if (tool.name === "send_to_chat") return facade.sendToChat(capability, argumentsValue);
          if (tool.name === "offer_quick_replies") return facade.offerQuickReplies(capability, argumentsValue);
          if (tool.name === "propose_company_name") return facade.proposeCompanyName(capability, argumentsValue);
          return facade.manageAgent(capability, argumentsValue);
        },
      }));
      // The pack's tools, for the pack's own agents only, under the SAME
      // capability: STOP or the end of the run revokes them with the rest.
      const pack = packOf(bot.id);
      const packTools = pack
        ? pack.dynamicTools(() => {
          const capability = teamBroker.authorize(session);
          return { botId: capability.botId, threadId: capability.threadId, runId: capability.runId };
        })
        : [];
      // The agent's own computer (a seat on the cloud computer), under the
      // SAME capability: nothing outside this run can drive it.
      const computerTools = harness.computerToolsAvailable()
        ? COMPUTER_TOOL_SPECS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
          call: async (argumentsValue: unknown) => {
            const capability = teamBroker.authorize(session);
            return harness.computerTool(capability.botId, tool.name, argumentsValue, {
              threadId: capability.threadId,
              runId: capability.runId,
            });
          },
        }))
        : [];
      const contextTools = !harness.continuity.linked(threadId) && harness.contextToolsAvailableFor(bot.id)
        ? CONTEXT_TOOL_SPECS.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
          call: async (argumentsValue: unknown) => {
            const capability = teamBroker.authorize(session);
            if (harness.continuity.linked(capability.threadId)) throw new HttpError(403, "forbidden", "Local context is unavailable in a linked conversation.");
            return harness.contextTool(capability.botId, tool.name, argumentsValue);
          },
        })) : [];
      const bizosTools = nativeToolScope
        ? BIZOS_TOOL_SPECS.map((tool) => ({
          name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
          call: async (argumentsValue: unknown) => {
            teamBroker.authorize(session);
            return invokeBizosTool(tool.name, argumentsValue);
          },
        })) : [];
      return [...teamTools, ...packTools, ...computerTools, ...contextTools, ...bizosTools];
    },
    // The same tools for Claude Code, which has no dynamic-tool slot:
    // a stdio MCP server, one per turn, holding a one-shot ticket that only
    // the child exchanges (it never reaches the CLI's argv or prompt). The
    // toolset rides in argv, per server; the sidecar re-checks every call.
    localTeamMcpScriptPath,
    localTeamMcp: ({ bot, threadId, runId, teamDelegationBlocked }) => ({
      command: process.execPath,
      args: [
        localTeamMcpScriptPath,
        `--toolset=${packs?.agency.isPackBot(bot.id) ? "team,agency" : packs?.ecommerce.isPackBot(bot.id) ? "team,commerce" : "team"}${harness.computerToolsAvailable() ? ",computer" : ""}${!serverComputer && localComputerEnabled() ? ",cloud" : ""}${!harness.continuity.linked(threadId) && harness.contextToolsAvailableFor(bot.id) ? ",context" : ""}${harness.continuity.linked(threadId) ? ",continuity" : ""}${nativeToolScope ? ",bizos" : ""}`,
      ],
      env: { LOCALBIZOS_TEAM_ORIGIN: origin },
      forwarded: { LBZ_LOCAL_TEAM_TICKET: teamBroker.issue({ botId: bot.id, threadId, runId, teamDelegationBlocked }) },
      preApproved: true,
    }),
    // STOP: the capability dies now and every request it has in flight with
    // it — before the CLI has settled. What a cockpit already accepted stays.
    onLocalRunStopped: (runId) => {
      teamBroker.revoke(runId);
      packs?.agency.abortRun(runId);
      packs?.ecommerce.abortRun(runId);
    },
    onLocalRunSettled: (runId) => {
      teamBroker.revoke(runId);
      packs?.agency.abortRun(runId);
      packs?.ecommerce.abortRun(runId);
    },
    localArchitecture: ({ bot, threadId, workspaceDir, sharedBrainPath, sandbox, peers }) => ({
        mode: "local",
        instanceId: id,
        workspaceId: `local:${id}:workspace`,
        agentId: `local:${id}:agent:${bot.id}`,
        threadId: `local:${id}:thread:${threadId}`,
        workspaceDir,
        ...(sharedBrainPath ? { sharedBrainPath } : {}),
        sandbox,
        supportedProviders: ["codex", "claude", "cursor", "ollama"],
        peers: peers.map((peer) => ({ agentId: `local:${id}:agent:${peer.id}`, name: peer.name, ...(peer.title ? { title: peer.title } : {}) })),
        mcpToolNames: [
          ...LOCAL_TEAM_TOOL_SPECS.filter(tool => !isCloudToolName(tool.name) || (!serverComputer && localComputerEnabled())).map(tool => tool.name),
          ...(harness.computerToolsAvailable() ? COMPUTER_TOOL_SPECS.map(tool => tool.name) : []),
          ...(nativeToolScope ? BIZOS_TOOL_SPECS.map(tool => tool.name) : []),
          ...(harness.continuity.linked(threadId) ? ["list_accessible_computers"] : []),
        ],
        recruitment: "autonomous-local-tools",
      }),
  });
  teamBroker.setAuthorityCheck(capability => {
    if (harness.continuity.linked(capability.threadId)) harness.continuity.guard.assert(capability.threadId);
  });
  // The packs share this harness: their agents are roster bots the generic
  // installer made, their cockpits run on demand in the bound vault and
  // close with the sidecar.
  const index = durableIndex();
  const packHost: PackHost = {
    rootDir: harnessRoot,
    binding: () => harness.workspaceTemplate.current(),
    installation: (templateId) => harness.workspaceTemplate.installation(templateId),
    install: (templateId, rootId) => harness.workspaceTemplate.install(templateId, rootId),
    listBots: () => harness.bots.list(),
    run: (runId) => harness.runs.get(runId),
    roleBots: (templateId) => Object.fromEntries(Object.entries(index.roleAffiliations)
      .filter(([, affiliation]) => affiliation.templateId === templateId)
      .map(([botId, affiliation]) => [affiliation.roleSlug, botId])),
  };
  const log = (line: string) => process.stderr.write(`[localbizos] ${line}\n`);
  cloudComputer?.start();
  packs = {
    agency: new AgencyService({ host: packHost, log }),
    ecommerce: new EcommerceService({ host: packHost, log }),
  };
  const localFacade = new CollaborationFacade(harness, id, teamBroker, index, packs, saveIndex, continuityTransport);
  await refreshNativeToolScope();
  await startLocalHarness(harness, existsSync(join(harnessRoot, "settings.json")), () => {
    facade = localFacade;
  });
  const nativeToolPoll = setInterval(() => { void refreshNativeToolScope(); }, 10_000);
  nativeToolPoll.unref();
  const autoLinkTimer = setInterval(() => { void localFacade.autoLinkAll().catch(() => {}); }, 30_000);
  autoLinkTimer.unref();
  void localFacade.autoLinkAll().catch(() => {});
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
  let webOriginValue = DEFAULT_WEB_ORIGIN;
  try {
    webOriginValue = webOrigin(process.env.BIZOS_WEB_ORIGIN);
  } catch (error) {
    log(`web dashboard: ${error instanceof Error ? error.message : String(error)}; using ${DEFAULT_WEB_ORIGIN}`);
  }
  // One company per sidecar: the id the desktop bootstrap and the summary
  // already report. Its display name comes from the desktop (PATCH / start).
  cloudLink = new CloudLink({
    root: harnessRoot,
    origin: webOriginValue,
    workspaceId: localFacade.workspaceId,
    summary: () => localFacade.localDashboardSummary(),
    subscribe: (listener) => harness.events.subscribe(() => listener()),
    log,
  });
  cloudLink.begin();
  const descriptor: Descriptor = { version: 1, origin, token, instanceId: id, pid: process.pid };
  privateWrite(descriptorPath, `${JSON.stringify(descriptor)}\n`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(autoLinkTimer);
    const current = readDescriptor();
    if (current?.pid === process.pid && current.instanceId === id) {
      try { unlinkSync(descriptorPath); } catch {}
    }
    connector?.stop();
    cloudLink?.stop();
    clearInterval(nativeToolPoll);
    // Graceful close can hand off only while main's signer and this source
    // process are still available. A hard kill never fabricates quiescence.
    await harness.continuity.prepareShutdown().catch(error=>process.stderr.write(`[localbizos] continuity shutdown: ${String(error).slice(0,200)}\n`));
    harness.stop();
    // Stop accepting calls immediately, but keep the process and state lock
    // until the CLI/MCP groups have exited (including SIGKILL escalation).
    server.close();
    server.closeAllConnections();
    // The cockpits go with the sidecar: their ports close and each `db.lock`
    // is released, so the next start does not find a live lock of its own.
    for (const pack of packs ? [packs.agency, packs.ecommerce] : []) {
      await pack.close().catch((error: unknown) => {
        process.stderr.write(`[localbizos] ${pack.templateId} cockpit close: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    }
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
