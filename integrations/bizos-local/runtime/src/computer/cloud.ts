import { localComputerEnabled, assertLocalComputerEnabled } from "./release.js";
// The user's cloud computer: ONE Boat sandbox (https://boat.dev) per local
// workspace, shared by all of the user's agents.
//
// This is a prototype of a per-USER machine, not a per-agent one. What keeps
// agents apart on it is a folder each, not a VM each:
//
//   /home/user/bizos/agents/<botId>/          the agent's working directory
//   /home/user/bizos/agents/<botId>/chrome/   the agent's own Chrome profile
//
// `/home/user` is on the sandbox disk, which Boat snapshots on every stop and
// restores on resume, so an agent's files and its browser cookies survive a
// sleep. Processes do not: a resume is a reboot.
//
// Money is the other half of the design. A cloud computer bills while it
// runs, so it never runs by accident:
//
//   * it only wakes on an explicit wake or a tool call that needs it;
//   * it goes back to sleep after `idleMinutes` without a cloud tool call
//     (timer re-armed from `lastUsedAt` when the sidecar restarts);
//   * Boat's own auto-stop (`ttlSeconds`) is set on every create and resume
//     as a backstop, so a crashed sidecar still cannot leave it on.
//
// The Boat API key comes, in this order, from `cloud-computer.json` (0600, in
// the runtime state directory: this company's own key), from `BOAT_API_KEY`,
// or from the machine-level key file named by `BOAT_API_KEY_FILE` (0600,
// written once from Settings "for all companies" and shared by every
// company's sidecar on this Mac). It is never returned by `status()`.
// The machine is created `noEnv`: none of the Boat account's own secrets are
// exposed to code the agents run on it.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Storage } from "../harness/storage.js";

export const BOAT_API_BASE = "https://boat.dev/api/v1";
export const BOAT_API_KEY_ENV = "BOAT_API_KEY";
/** Path of the machine-level key file, set by the desktop for every sidecar. */
export const BOAT_API_KEY_FILE_ENV = "BOAT_API_KEY_FILE";
export const CLOUD_COMPUTER_FILE = "cloud-computer.json";
export const AGENTS_ROOT = "/home/user/bizos/agents";

export const MACHINE_CLASSES = ["small", "default", "large"] as const;
export type MachineClass = typeof MACHINE_CLASSES[number];
export const DEFAULT_MACHINE_CLASS: MachineClass = "small";
export const DEFAULT_IDLE_MINUTES = 15;
/** Boat's own auto-stop, re-armed on every create and resume. */
export const BACKSTOP_TTL_SECONDS = 2 * 3600;

const MAX_STDOUT_CHARS = 10_000;
const MAX_STDERR_CHARS = 3_000;
// Together under the 16k a dynamic tool result may carry, JSON-escaped.
const MAX_PAGE_TEXT_CHARS = 6_000;
const DEFAULT_RUN_TIMEOUT_SECONDS = 120;
const MAX_RUN_TIMEOUT_SECONDS = 600;

/** Sandbox states, from the Boat v1 `Sandbox.state` enum. */
export type SandboxState =
  | "init" | "provisioning" | "provisioned" | "cloning" | "ready" | "idle" | "running"
  | "archiving" | "archived" | "error";
const USABLE = new Set<string>(["ready", "idle", "running"]);
const ASLEEP = new Set<string>(["archived"]);

export interface BoatSandbox {
  id: string;
  name?: string;
  state: SandboxState;
  type?: MachineClass;
  archiveAfter?: string | null;
  desktopAvailable?: boolean;
  desktopUrl?: string | null;
  snapshotAvailable?: boolean;
}

export interface BoatCommandResult {
  success: boolean;
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  timedOut: boolean;
}

export class BoatError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "BoatError";
  }
}

type FetchImpl = typeof fetch;

/** A thin client over the Boat v1 JSON API. Every response is the v1
 * envelope: `{ ok: true, type, ... }` or `{ ok: false, code, message }`. */
export class BoatClient {
  private readonly fetchImpl: FetchImpl;
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string, options: { baseUrl?: string; fetchImpl?: FetchImpl } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? BOAT_API_BASE).replace(/\/+$/, "");
  }

  async request<T>(method: string, path: string, body?: unknown, options: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
    if (!(method === "POST" && /^\/sandboxes\/[^/]+\/stop$/.test(path))) assertLocalComputerEnabled();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...options.headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new BoatError(0, "network_error", `Boat is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* non-JSON error page */ }
    if (!response.ok || parsed.ok === false) {
      const nested = parsed.error && typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : {};
      const code = String(parsed.code ?? nested.code ?? `http_${response.status}`);
      const message = String(parsed.message ?? nested.message ?? `Boat answered HTTP ${response.status}.`);
      throw new BoatError(response.status, code, message.slice(0, 300));
    }
    return parsed as T;
  }

  async create(input: { type: MachineClass; ttlSeconds: number; noEnv: boolean }, idempotencyKey: string): Promise<BoatSandbox> {
    const body = await this.request<{ sandbox: BoatSandbox }>("POST", "/sandboxes", input, { headers: { "idempotency-key": idempotencyKey } });
    return body.sandbox;
  }

  async get(id: string): Promise<BoatSandbox> {
    return (await this.request<{ sandbox: BoatSandbox }>("GET", `/sandboxes/${encodeURIComponent(id)}`)).sandbox;
  }

  async resume(id: string, input: { type?: MachineClass; ttlSeconds: number }): Promise<void> {
    await this.request("POST", `/sandboxes/${encodeURIComponent(id)}/resume`, input);
  }

  async stop(id: string): Promise<void> {
    await this.request("POST", `/sandboxes/${encodeURIComponent(id)}/stop`, {});
  }

  /** Synchronous exec (`detached: false`): Boat waits for the command, up
   * to `timeoutSeconds` (1–600), and answers with its output and exit code. */
  async command(id: string, command: string, timeoutSeconds: number): Promise<BoatCommandResult> {
    return this.request<BoatCommandResult>("POST", `/sandboxes/${encodeURIComponent(id)}/commands`,
      { command, timeoutSeconds }, { timeoutMs: (timeoutSeconds + 30) * 1000 });
  }

  /** Write a file under /home/user (or /tmp) of the sandbox. */
  async writeFile(id: string, path: string, content: string): Promise<void> {
    await this.request("PUT", `/sandboxes/${encodeURIComponent(id)}/files`, { path, content, encoding: "utf8" }, { timeoutMs: 60_000 });
  }

  async desktop(id: string): Promise<{ desktopUrl?: string | null; provisioning?: boolean; mode?: string }> {
    return this.request("POST", `/sandboxes/${encodeURIComponent(id)}/desktop`, {});
  }

  /** Expose a port of the sandbox on a stable `https://…on.boat.dev` route.
   * `public` clears Boat's own `_token` gate: the service behind it must
   * carry its own secret (the control daemon does). */
  async host(id: string, port: number, options: { title?: string; public?: boolean } = {}): Promise<{ url: string; isProtected?: boolean }> {
    const body = await this.request<{ url?: unknown; isProtected?: unknown }>("POST", `/sandboxes/${encodeURIComponent(id)}/host`,
      { port, ...(options.title ? { title: options.title } : {}), ...(options.public ? { public: true } : {}) });
    if (typeof body.url !== "string" || !/^https:\/\//.test(body.url)) throw new BoatError(502, "host_failed", "Boat did not return a hosted URL.");
    return { url: body.url, ...(typeof body.isProtected === "boolean" ? { isProtected: body.isProtected } : {}) };
  }
}

interface CloudComputerRecord {
  version: 1;
  sandboxId: string | null;
  machineClass: MachineClass;
  idleMinutes: number;
  /** The last cloud tool call or wake, epoch ms. Drives the idle timer. */
  lastUsedAt: number | null;
  /** Reused on a retried create so a lost response never bills twice. */
  pendingCreateKey: string | null;
  apiKey?: string;
}

export type KeySource = "local" | "env" | "machine";

export interface CloudComputerStatus {
  configured: boolean;
  keySource: KeySource | null;
  /** A machine-level key file is configured for this sidecar (whether or
   * not it holds a key yet): Settings may offer "for all companies". */
  machineKeyFile: boolean;
  allowed: boolean;
  sandboxId: string | null;
  state: SandboxState | "none" | "unknown";
  machineClass: MachineClass;
  idleMinutes: number;
  lastUsedAt: string | null;
  autoSleepAt: string | null;
  error?: string;
}

export interface CloudClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  delay(ms: number): Promise<void>;
}

const systemClock: CloudClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
};

export interface CloudComputerOptions {
  storage: Pick<Storage, "readJson" | "writeJson">;
  /** Pro-tier check (`cloudComputer` entitlement). */
  isAllowed: () => boolean | Promise<boolean>;
  environment?: () => NodeJS.ProcessEnv;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  clock?: CloudClock;
  pollIntervalMs?: number;
  readyTimeoutMs?: number;
  log?: (line: string) => void;
}

export class CloudComputerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CloudComputerError";
  }
}

export const NOT_ALLOWED_MESSAGE = "The cloud computer needs BizOS Pro.";
export const NOT_CONFIGURED_MESSAGE = "The cloud computer is not configured: add a Boat API key in Settings (or set BOAT_API_KEY).";

/** `bot_ab:cd` → `bot_ab-cd`: a bot id is a path segment on the machine. */
export function agentSlug(botId: string): string {
  return botId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}
export function agentDir(botId: string): string { return `${AGENTS_ROOT}/${agentSlug(botId)}`; }
export function chromeProfileDir(botId: string): string { return `${agentDir(botId)}/chrome`; }

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.4);
  return { text: `${text.slice(0, head)}\n…[${text.length - max} chars cut]…\n${text.slice(text.length - (max - head))}`, truncated: true };
}

/** Build the shell command that runs `command` in the agent's own folder. */
export function agentCommand(botId: string, command: string): string {
  const dir = shellQuote(agentDir(botId));
  return [
    `mkdir -p ${dir} && cd ${dir} || exit 97`,
    `export BIZOS_AGENT_DIR=${dir} BIZOS_CHROME_PROFILE=${shellQuote(chromeProfileDir(botId))}`,
    `{\n${command}\n}`,
  ].join("\n");
}

const PAGE_MARKER = "__BIZOS_COOKIES__";

/** Headless Chrome on the agent's OWN profile. A stale profile lock from
 * before the last snapshot (another hostname) is cleared when no Chrome
 * holds that profile; the sandboxed launch falls back to --no-sandbox. */
export function browserCommand(botId: string, url: string): string {
  const profile = shellQuote(chromeProfileDir(botId));
  return [
    `P=${profile}; mkdir -p "$P"`,
    `pgrep -f -- "--user-data-dir=$P" >/dev/null || rm -f "$P"/Singleton*`,
    `c() { timeout 60 google-chrome-stable --headless=new --disable-gpu --no-first-run --no-default-browser-check --user-data-dir="$P" "$@" --dump-dom ${shellQuote(url)} 2>/dev/null | head -c 400000; }`,
    `OUT=$(c); [ -n "$OUT" ] || OUT=$(c --no-sandbox)`,
    `printf '%s\\n' "$OUT"`,
    `if [ -s "$P/Default/Cookies" ] || [ -s "$P/Default/Network/Cookies" ]; then echo "${PAGE_MARKER}yes"; else echo "${PAGE_MARKER}no"; fi`,
    `[ -n "$OUT" ]`,
  ].join("\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };
export function pageSummary(dom: string): { title: string; text: string } {
  const decode = (value: string) => value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    if (ENTITIES[name.toLowerCase()]) return ENTITIES[name.toLowerCase()]!;
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return match;
  });
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(dom)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = dom
    .replace(/<(script|style|noscript|template|svg|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return { title, text: decode(body).replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS) };
}

/** The machine-level key: one trimmed line, or nothing. Read on every use
 * so a key saved from another company's Settings is picked up at once. */
export function readMachineKey(path: string | null): string | null {
  if (!path) return null;
  try {
    const key = readFileSync(path, "utf8").trim();
    return key && key.length <= 500 && !/\s/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** Write the machine-level key, 0600 in a 0700 folder; an empty key
 * removes the file. */
export function writeMachineKey(path: string, key: string): void {
  if (!key) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function isMachineClass(value: unknown): value is MachineClass {
  return typeof value === "string" && (MACHINE_CLASSES as readonly string[]).includes(value);
}

export class CloudComputer {
  private readonly clock: CloudClock;
  private readonly environment: () => NodeJS.ProcessEnv;
  private readonly pollIntervalMs: number;
  private readonly readyTimeoutMs: number;
  private record: CloudComputerRecord;
  /** Wake/sleep are serialized: two agents waking at once make one machine. */
  private lifecycleTail: Promise<unknown> = Promise.resolve();
  /** Commands in flight. The idle timer and a teammate's sleep wait for them. */
  private busy = 0;
  private idleTimer: unknown = null;
  private autoSleepAt: number | null = null;
  /** Runs before every stop, while the machine is still up (best effort). */
  private beforeSleepHook: ((sandboxId: string) => Promise<void>) | null = null;
  private readonly sleepListeners = new Set<() => void>();
  /** `sandboxId:port` → hosted URL (Boat returns the same one each time). */
  private readonly hostedUrls = new Map<string, string>();

  constructor(private readonly options: CloudComputerOptions) {
    this.clock = options.clock ?? systemClock;
    this.environment = options.environment ?? (() => process.env);
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 180_000;
    const raw = options.storage.readJson<Partial<CloudComputerRecord> | null>(CLOUD_COMPUTER_FILE, null) ?? {};
    this.record = {
      version: 1,
      sandboxId: typeof raw.sandboxId === "string" && raw.sandboxId ? raw.sandboxId : null,
      machineClass: isMachineClass(raw.machineClass) ? raw.machineClass : DEFAULT_MACHINE_CLASS,
      idleMinutes: typeof raw.idleMinutes === "number" && raw.idleMinutes >= 1 ? Math.min(raw.idleMinutes, 240) : DEFAULT_IDLE_MINUTES,
      lastUsedAt: typeof raw.lastUsedAt === "number" ? raw.lastUsedAt : null,
      pendingCreateKey: typeof raw.pendingCreateKey === "string" ? raw.pendingCreateKey : null,
      ...(typeof raw.apiKey === "string" && raw.apiKey ? { apiKey: raw.apiKey } : {}),
    };
  }

  /** Re-arm the idle timer for a machine a previous sidecar left awake. */
  start(): void {
    if (this.record.sandboxId && this.apiKey()) this.armIdleTimer();
  }

  dispose(): void {
    if (this.idleTimer) this.clock.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.autoSleepAt = null;
  }

  private persist(): void {
    this.options.storage.writeJson(CLOUD_COMPUTER_FILE, this.record);
  }

  /** This company's own key first, then the environment, then the
   * machine-level file every company on this Mac shares. */
  private apiKey(): { key: string; source: KeySource } | null {
    if (this.record.apiKey) return { key: this.record.apiKey, source: "local" };
    const fromEnv = this.environment()[BOAT_API_KEY_ENV]?.trim();
    if (fromEnv) return { key: fromEnv, source: "env" };
    const fromFile = readMachineKey(this.machineKeyFile());
    return fromFile ? { key: fromFile, source: "machine" } : null;
  }

  private machineKeyFile(): string | null {
    const path = this.environment()[BOAT_API_KEY_FILE_ENV]?.trim();
    return path ? path : null;
  }

  private client(): BoatClient {
    const key = this.apiKey();
    if (!key) throw new CloudComputerError("not_configured", NOT_CONFIGURED_MESSAGE);
    return new BoatClient(key.key, {
      ...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
  }

  private async requireAllowed(): Promise<void> {
    assertLocalComputerEnabled();
    if (!(await this.options.isAllowed())) throw new CloudComputerError("pro_required", NOT_ALLOWED_MESSAGE);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lifecycleTail.then(work, work);
    this.lifecycleTail = next.catch(() => undefined);
    return next;
  }

  /** A Boat key is set (env or local). Says nothing about the plan. */
  isConfigured(): boolean {
    return Boolean(this.apiKey());
  }

  /** Is the plan allowed to use it right now? */
  async allowed(): Promise<boolean> {
    return localComputerEnabled() && Boolean(await this.options.isAllowed());
  }

  /** Something that must happen on the machine before it is stopped — the
   * agents' Chromes are closed cleanly so their cookies reach the disk. */
  setBeforeSleep(hook: ((sandboxId: string) => Promise<void>) | null): void {
    this.beforeSleepHook = hook;
  }

  /** Told after the machine was put to sleep (every process on it is gone). */
  onSleep(listener: () => void): () => void {
    this.sleepListeners.add(listener);
    return () => this.sleepListeners.delete(listener);
  }

  // ── settings (owner only) ───────────────────────────────────────────

  /** Store (or, with an empty string, clear) the Boat API key: this
   * company's own (`company`, the default) or the one every company on this
   * Mac shares (`machine`, the 0600 file the desktop named). A machine-wide
   * save also clears this company's own key so the shared one is the one
   * in use. */
  setApiKey(value: unknown, scope: unknown = "company"): CloudComputerStatus {
    assertLocalComputerEnabled();
    if (typeof value !== "string") throw new CloudComputerError("invalid_payload", "apiKey must be a string.");
    const key = value.trim();
    if (key.length > 500 || /\s/.test(key)) throw new CloudComputerError("invalid_payload", "apiKey is not a valid key.");
    if (scope !== "company" && scope !== "machine") throw new CloudComputerError("invalid_payload", "scope must be company or machine.");
    if (scope === "machine") {
      const path = this.machineKeyFile();
      if (!path) throw new CloudComputerError("no_machine_key_file", "This runtime has no machine-level key file; save the key for this company instead.");
      writeMachineKey(path, key);
      delete this.record.apiKey;
    } else if (key) {
      this.record.apiKey = key;
    } else {
      delete this.record.apiKey;
    }
    this.persist();
    return this.localStatus();
  }

  setSettings(input: { machineClass?: unknown; idleMinutes?: unknown }): CloudComputerStatus {
    assertLocalComputerEnabled();
    if (input.machineClass !== undefined) {
      if (!isMachineClass(input.machineClass)) throw new CloudComputerError("invalid_payload", "machineClass must be small, default or large.");
      this.record.machineClass = input.machineClass;
    }
    if (input.idleMinutes !== undefined) {
      if (typeof input.idleMinutes !== "number" || !Number.isInteger(input.idleMinutes) || input.idleMinutes < 1 || input.idleMinutes > 240) {
        throw new CloudComputerError("invalid_payload", "idleMinutes must be an integer from 1 to 240.");
      }
      this.record.idleMinutes = input.idleMinutes;
      if (this.idleTimer) this.armIdleTimer();
    }
    this.persist();
    return this.localStatus();
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  private localStatus(state: CloudComputerStatus["state"] = this.record.sandboxId ? "unknown" : "none", allowed = true, error?: string): CloudComputerStatus {
    const key = this.apiKey();
    return {
      configured: Boolean(key),
      keySource: key?.source ?? null,
      machineKeyFile: Boolean(this.machineKeyFile()),
      allowed,
      sandboxId: this.record.sandboxId,
      state,
      machineClass: this.record.machineClass,
      idleMinutes: this.record.idleMinutes,
      lastUsedAt: this.record.lastUsedAt ? new Date(this.record.lastUsedAt).toISOString() : null,
      autoSleepAt: this.autoSleepAt ? new Date(this.autoSleepAt).toISOString() : null,
      ...(error ? { error } : {}),
    };
  }

  /** Live status from Boat. No secret in it: no key, no desktop URL. */
  async status(): Promise<CloudComputerStatus> {
    if (!localComputerEnabled()) return this.localStatus(undefined, false, "Computer is unavailable in this release.");
    const allowed = Boolean(await this.options.isAllowed());
    if (!this.apiKey() || !this.record.sandboxId) return this.localStatus(undefined, allowed);
    try {
      const sandbox = await this.client().get(this.record.sandboxId);
      return this.localStatus(sandbox.state, allowed);
    } catch (error) {
      if (error instanceof BoatError && error.status === 404) return this.localStatus("none", allowed, "The previous machine no longer exists; the next wake creates a new one.");
      return this.localStatus("unknown", allowed, error instanceof Error ? error.message : String(error));
    }
  }

  private async waitUntilUsable(client: BoatClient, id: string): Promise<BoatSandbox> {
    const until = this.clock.now() + this.readyTimeoutMs;
    for (;;) {
      const sandbox = await client.get(id);
      if (USABLE.has(sandbox.state)) return sandbox;
      if (sandbox.state === "error") throw new CloudComputerError("machine_error", "The cloud computer failed to start (Boat state: error).");
      if (ASLEEP.has(sandbox.state)) throw new CloudComputerError("machine_asleep", "The cloud computer went back to sleep while starting.");
      if (this.clock.now() >= until) throw new CloudComputerError("wake_timeout", `The cloud computer is still ${sandbox.state} after ${Math.round(this.readyTimeoutMs / 1000)}s; try again shortly.`);
      await this.clock.delay(this.pollIntervalMs);
    }
  }

  private async waitUntilArchived(client: BoatClient, id: string): Promise<void> {
    const until = this.clock.now() + this.readyTimeoutMs;
    for (;;) {
      const sandbox = await client.get(id);
      if (sandbox.state !== "archiving") return;
      if (this.clock.now() >= until) throw new CloudComputerError("wake_timeout", "The cloud computer is still saving its disk; try again shortly.");
      await this.clock.delay(this.pollIntervalMs);
    }
  }

  private async createSandbox(client: BoatClient): Promise<BoatSandbox> {
    this.record.pendingCreateKey ??= randomUUID();
    this.persist();
    const input = { type: this.record.machineClass, ttlSeconds: BACKSTOP_TTL_SECONDS, noEnv: true };
    let sandbox: BoatSandbox;
    try {
      sandbox = await client.create(input, this.record.pendingCreateKey);
    } catch (error) {
      // A lost response or a 5xx is safe to retry once with the same key.
      if (!(error instanceof BoatError) || !(error.status === 0 || error.status >= 500 || error.code === "idempotency_in_progress")) throw error;
      await this.clock.delay(this.pollIntervalMs);
      sandbox = await client.create(input, this.record.pendingCreateKey);
    }
    this.record.sandboxId = sandbox.id;
    this.record.pendingCreateKey = null;
    this.persist();
    this.options.log?.(`cloud computer created ${sandbox.id} (${this.record.machineClass})`);
    return sandbox;
  }

  /** Create (first time) or resume the machine, then wait until it runs. */
  async wake(): Promise<{ state: SandboxState; sandboxId: string; wokeFromSleep: boolean; created: boolean }> {
    await this.requireAllowed();
    const client = this.client();
    const result = await this.exclusive(async () => {
      let created = false;
      let wokeFromSleep = false;
      let sandbox: BoatSandbox | null = null;
      if (this.record.sandboxId) {
        try {
          sandbox = await client.get(this.record.sandboxId);
        } catch (error) {
          if (!(error instanceof BoatError && error.status === 404)) throw error;
          this.record.sandboxId = null;
          this.persist();
        }
      }
      if (!sandbox) {
        sandbox = await this.createSandbox(client);
        created = true;
      } else if (!USABLE.has(sandbox.state)) {
        if (sandbox.state === "archiving") await this.waitUntilArchived(client, sandbox.id);
        const current = sandbox.state === "archiving" ? await client.get(sandbox.id) : sandbox;
        if (ASLEEP.has(current.state) || current.state === "error") {
          await client.resume(sandbox.id, { type: this.record.machineClass, ttlSeconds: BACKSTOP_TTL_SECONDS });
          wokeFromSleep = true;
        }
      }
      const ready = await this.waitUntilUsable(client, sandbox.id);
      return { state: ready.state, sandboxId: ready.id, wokeFromSleep, created };
    });
    this.touch();
    return result;
  }

  /** Stop the machine. Boat snapshots the disk first: files and Chrome
   * profiles under /home/user are kept; running processes are not. */
  async sleep(reason: "agent" | "owner" | "idle" = "owner"): Promise<{ state: string; sandboxId: string | null; note: string }> {
    const client = this.client();
    if (reason === "agent" && this.busy > 0) {
      return { state: "running", sandboxId: this.record.sandboxId, note: "Another agent is using the cloud computer right now; it will go to sleep by itself when idle." };
    }
    return this.exclusive(async () => {
      this.dispose();
      const id = this.record.sandboxId;
      if (!id) return { state: "none", sandboxId: null, note: "There is no cloud computer yet." };
      // When withdrawn, stop the existing machine directly. No browser helper,
      // state polling or wake is needed to terminate compute.
      if (!localComputerEnabled()) {
        await client.stop(id);
        for (const listener of [...this.sleepListeners]) { try { listener(); } catch {} }
        return { state: "archiving", sandboxId: id, note: "Computer stopped." };
      }
      let state: string;
      try {
        state = (await client.get(id)).state;
      } catch (error) {
        if (error instanceof BoatError && error.status === 404) return { state: "none", sandboxId: id, note: "The machine no longer exists." };
        throw error;
      }
      if (state !== "archived" && state !== "archiving") {
        if (this.beforeSleepHook && USABLE.has(state)) {
          try {
            await this.beforeSleepHook(id);
          } catch (error) {
            this.options.log?.(`cloud computer pre-sleep step failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        await client.stop(id);
        state = "archiving";
        this.options.log?.(`cloud computer ${id} stopped (${reason})`);
      }
      for (const listener of [...this.sleepListeners]) {
        try { listener(); } catch { /* one listener must not stop the rest */ }
      }
      return { state, sandboxId: id, note: "Asleep. Its disk, your folder and your Chrome profile (cookies) are kept; running processes are not." };
    });
  }

  private touch(): void {
    this.record.lastUsedAt = this.clock.now();
    this.persist();
    this.armIdleTimer();
  }

  private armIdleTimer(): void {
    if (this.idleTimer) this.clock.clearTimeout(this.idleTimer);
    const last = this.record.lastUsedAt ?? this.clock.now();
    const at = last + this.record.idleMinutes * 60_000;
    this.autoSleepAt = at;
    this.idleTimer = this.clock.setTimeout(() => void this.onIdle(), Math.max(0, at - this.clock.now()));
  }

  private async onIdle(): Promise<void> {
    this.idleTimer = null;
    if (this.busy > 0) {
      // A long command is still running: check again one idle period later.
      this.record.lastUsedAt = this.clock.now();
      this.armIdleTimer();
      return;
    }
    try {
      await this.sleep("idle");
    } catch (error) {
      this.options.log?.(`cloud computer auto-sleep failed: ${error instanceof Error ? error.message : String(error)}`);
      // Retry soon rather than leave it billing.
      this.idleTimer = this.clock.setTimeout(() => void this.onIdle(), 60_000);
    }
  }

  // ── agent work ──────────────────────────────────────────────────────

  /** Run a shell command in the agent's own folder, waking the machine if
   * needed, and wait for it (Boat's synchronous exec, ≤600 s). */
  async run(botId: string, command: string, timeoutSeconds = DEFAULT_RUN_TIMEOUT_SECONDS) {
    if (typeof command !== "string" || !command.trim()) throw new CloudComputerError("invalid_payload", "command must be a non-empty string.");
    if (command.length > 20_000) throw new CloudComputerError("invalid_payload", "command is too long.");
    const timeout = Math.max(1, Math.min(MAX_RUN_TIMEOUT_SECONDS, Math.round(Number(timeoutSeconds) || DEFAULT_RUN_TIMEOUT_SECONDS)));
    const woke = await this.wake();
    const raw = await this.exec(woke.sandboxId, agentCommand(botId, command), timeout);
    const stdout = truncate(raw.stdout ?? "", MAX_STDOUT_CHARS);
    const stderr = truncate(raw.stderr ?? "", MAX_STDERR_CHARS);
    return {
      exitCode: raw.exitCode,
      timedOut: raw.timedOut,
      stdout: stdout.text,
      stderr: stderr.text,
      ...(stdout.truncated || stderr.truncated || raw.stdoutTruncated || raw.stderrTruncated ? { truncated: true } : {}),
      cwd: agentDir(botId),
      wokeFromSleep: woke.wokeFromSleep,
    };
  }

  /** Headless Chrome on the agent's own profile: page title and text. */
  async browserFetch(botId: string, url: string) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new CloudComputerError("invalid_payload", "url must be an absolute http(s) URL."); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new CloudComputerError("invalid_payload", "url must be an absolute http(s) URL.");
    const woke = await this.wake();
    const raw = await this.exec(woke.sandboxId, browserCommand(botId, parsed.href), 120);
    const stdout = raw.stdout ?? "";
    const marker = stdout.lastIndexOf(PAGE_MARKER);
    const dom = marker === -1 ? stdout : stdout.slice(0, marker);
    const page = pageSummary(dom);
    return {
      ok: raw.exitCode === 0 && Boolean(dom.trim()),
      url: parsed.href,
      title: page.title,
      text: page.text,
      chromeProfile: chromeProfileDir(botId),
      profileHasCookies: marker !== -1 && stdout.slice(marker + PAGE_MARKER.length).trim().startsWith("yes"),
      wokeFromSleep: woke.wokeFromSleep,
      ...(raw.exitCode === 0 ? {} : { exitCode: raw.exitCode, stderr: truncate(raw.stderr ?? "", 1_000).text }),
    };
  }

  private async exec(id: string, command: string, timeoutSeconds: number): Promise<BoatCommandResult> {
    this.busy += 1;
    try {
      const client = this.client();
      try {
        return await client.command(id, command, timeoutSeconds);
      } catch (error) {
        // 409 boat_starting is retryable: the machine is still coming up.
        if (!(error instanceof BoatError && error.code === "boat_starting")) throw error;
        await this.waitUntilUsable(client, id);
        return await client.command(id, command, timeoutSeconds);
      }
    } finally {
      this.busy -= 1;
      this.touch();
    }
  }

  /** Wake if needed, then run `command` as is (no agent folder prefix) —
   * the computer backend's own seam, for the helper it ships. */
  async computerExec(command: string, timeoutSeconds: number): Promise<{ result: BoatCommandResult; wokeFromSleep: boolean; sandboxId: string }> {
    const woke = await this.wake();
    const result = await this.exec(woke.sandboxId, command, Math.max(1, Math.min(MAX_RUN_TIMEOUT_SECONDS, Math.round(timeoutSeconds))));
    return { result, wokeFromSleep: woke.wokeFromSleep, sandboxId: woke.sandboxId };
  }

  /** Put a file on the machine (it must be awake: call after `computerExec`). */
  async writeFile(path: string, content: string): Promise<void> {
    assertLocalComputerEnabled();
    const id = this.record.sandboxId;
    if (!id) throw new CloudComputerError("machine_asleep", "The cloud computer is not running.");
    await this.client().writeFile(id, path, content);
  }

  /** Run a command on a machine that is ALREADY awake — never wakes it (the
   * pre-sleep step runs inside `sleep`, which holds the lifecycle lock). */
  async execAwake(sandboxId: string, command: string, timeoutSeconds: number): Promise<BoatCommandResult> {
    return this.client().command(sandboxId, command, timeoutSeconds);
  }

  /** The secret-bearing desktop stream URL, for the local owner only. */
  async desktop(): Promise<{ desktopUrl: string; sandboxId: string }> {
    const woke = await this.wake();
    const client = this.client();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const answer = await client.desktop(woke.sandboxId);
      if (answer.desktopUrl) {
        this.touch();
        return { desktopUrl: answer.desktopUrl, sandboxId: woke.sandboxId };
      }
      await this.clock.delay(this.pollIntervalMs);
    }
    throw new CloudComputerError("desktop_unavailable", "The desktop stream is still being prepared; try again shortly.");
  }

  /** Expose a port of the (awake) machine on its own `on.boat.dev` route,
   * for the control daemon. The URL names a public route: the daemon
   * behind it checks its own per-session secret. Boat answers the same
   * URL for the same port, so it is cached per machine. */
  async hostPort(port: number, title: string): Promise<{ url: string; sandboxId: string }> {
    const woke = await this.wake();
    const cached = this.hostedUrls.get(`${woke.sandboxId}:${port}`);
    if (cached) return { url: cached, sandboxId: woke.sandboxId };
    const hosted = await this.client().host(woke.sandboxId, port, { title, public: true });
    this.hostedUrls.set(`${woke.sandboxId}:${port}`, hosted.url);
    this.touch();
    return { url: hosted.url, sandboxId: woke.sandboxId };
  }

  /** The agent tools. A refusal (free tier, no key) is a one-line result,
   * not an exception, so the agent can tell the person plainly. */
  async tool(botId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
    if (!localComputerEnabled() && name !== "cloud_computer_sleep") return { ok: false, error: "computer_disabled", message: "Computer is unavailable in this release." };
    if (!(await this.options.isAllowed())) return { ok: false, error: "pro_required", message: NOT_ALLOWED_MESSAGE };
    if (!this.apiKey()) return { ok: false, error: "not_configured", message: NOT_CONFIGURED_MESSAGE };
    if (name === "cloud_computer_wake") return this.wake();
    if (name === "cloud_computer_sleep") return this.sleep("agent");
    if (name === "cloud_computer_status") {
      const status = await this.status();
      return { state: status.state, sandboxId: status.sandboxId, machineClass: status.machineClass, idleMinutes: status.idleMinutes, autoSleepAt: status.autoSleepAt, yourFolder: agentDir(botId), yourChromeProfile: chromeProfileDir(botId) };
    }
    if (name === "cloud_computer_run") {
      return this.run(botId, String(input.command ?? ""), input.timeout_seconds === undefined ? undefined : Number(input.timeout_seconds));
    }
    if (name === "cloud_browser_fetch") return this.browserFetch(botId, String(input.url ?? ""));
    throw new CloudComputerError("unknown_tool", `Unknown cloud computer tool: ${name}`);
  }
}
