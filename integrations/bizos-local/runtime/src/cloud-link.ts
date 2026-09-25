// The web dashboard link: this sidecar mirrors its dashboard summary to
// app.bizos.cc so the owner can watch the local agents' work in a browser.
//
//   1. LINK — a device-code flow. `start()` asks the web for a code, returns
//      the verify URL the desktop opens, and polls every 2 s until the owner
//      approves (or the code expires). The device token comes back ONCE and is
//      stored in `<harness root>/cloud-link.json` (0600). It is never logged,
//      never returned by `status()`, and only ever sent to the origin that
//      issued it.
//   2. PUSH — while linked: every 60 s, and ~5 s after local activity. A
//      snapshot identical to the last one pushed is skipped, but one push is
//      forced every 5 min so the web knows this Mac is alive. Network failures
//      back off exponentially. A 401 means the owner revoked the link on the
//      web: the file is deleted and the loop stops.
//
// What leaves this machine is exactly the `GET /api/local/dashboard-summary`
// object plus the workspace id and display name — never a chat message body,
// a local token or a path.
//
// Everything that touches the outside (fetch, clock, the summary builder, the
// event bus) is injected so tests run against a fake web server in a temp dir.
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./harness/storage.js";

export const CLOUD_LINK_FILE = "cloud-link.json";
export const DEFAULT_WEB_ORIGIN = "https://app.bizos.cc";
export const PUSH_INTERVAL_MS = 60_000;
export const PUSH_DEBOUNCE_MS = 5_000;
export const FORCE_PUSH_MS = 5 * 60_000;
export const POLL_INTERVAL_MS = 2_000;
export const POLL_MAX_MS = 10 * 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;
export const MAX_SNAPSHOT_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export class CloudLinkError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

interface StoredLink {
  version: 1;
  origin: string;
  token: string;
  orgId: string;
  orgName: string;
  dashboardUrl: string;
  linkedAt: string;
  workspaceName?: string;
}

interface Pending {
  code: string;
  pollSecret: string;
  verifyUrl: string;
  expiresAtMs: number;
}

export interface CloudLinkStatus {
  linked: boolean;
  workspaceId: string;
  workspaceName: string;
  orgName?: string;
  dashboardUrl?: string;
  lastPushAt?: string;
  lastError?: string;
  pending?: { code: string; verifyUrl: string };
}

export interface CloudLinkOptions {
  /** The harness root: `cloud-link.json` lives here. */
  root: string;
  workspaceId: string;
  /** The dashboard summary object, built in-process. */
  summary: () => Promise<unknown>;
  /** The local event bus; each event schedules a debounced push. */
  subscribe?: (listener: () => void) => () => void;
  /** `BIZOS_WEB_ORIGIN`, default https://app.bizos.cc. */
  origin?: string;
  deviceName?: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  pushIntervalMs?: number;
  debounceMs?: number;
  forcePushMs?: number;
  pollIntervalMs?: number;
  pollMaxMs?: number;
}

/** A web origin we accept: https, or http on loopback (tests, local dev). */
export function webOrigin(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_WEB_ORIGIN;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("BIZOS_WEB_ORIGIN is not a URL"); }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("BIZOS_WEB_ORIGIN must be https (http only on loopback)");
  }
  return url.origin;
}

export function defaultDeviceName(): string {
  const name = (process.env.LOCALBIZOS_COMPUTER_NAME ?? hostname()).replace(/\.local$/i, "");
  return cleanName(name, 80) || "Mac";
}

function cleanName(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A URL the web handed us, only if it stays on that web origin. */
function sameOriginUrl(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The summary's content hash, ignoring the per-call `generatedAt`. */
export function snapshotHash(workspaceName: string, summary: unknown): string {
  const body = record(summary) ? { ...(summary as Record<string, unknown>), generatedAt: null } : summary;
  return createHash("sha256").update(JSON.stringify([workspaceName, body])).digest("hex");
}

export class CloudLink {
  private readonly path: string;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly pushIntervalMs: number;
  private readonly debounceMs: number;
  private readonly forcePushMs: number;
  private readonly pollIntervalMs: number;
  private readonly pollMaxMs: number;
  private readonly deviceName: string;
  private link: StoredLink | null;
  private workspaceName = "Local BizOS";
  private pending: Pending | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly abort = new AbortController();
  private stopped = false;
  private pushing: Promise<void> | null = null;
  private failures = 0;
  private lastHash: string | null = null;
  private lastPushAtMs: number | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: CloudLinkOptions) {
    this.path = join(options.root, CLOUD_LINK_FILE);
    this.origin = webOrigin(options.origin);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.pushIntervalMs = options.pushIntervalMs ?? PUSH_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? PUSH_DEBOUNCE_MS;
    this.forcePushMs = options.forcePushMs ?? FORCE_PUSH_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollMaxMs = options.pollMaxMs ?? POLL_MAX_MS;
    this.deviceName = cleanName(options.deviceName ?? defaultDeviceName(), 80) || "Mac";
    this.link = this.read();
    if (this.link?.workspaceName) this.workspaceName = this.link.workspaceName;
  }

  /** Start pushing if a link was saved by a previous run. */
  begin(): void {
    if (this.stopped) return;
    this.unsubscribe ??= this.options.subscribe?.(() => this.onLocalEvent()) ?? null;
    if (this.link) this.schedulePush(0);
  }

  /** Sidecar shutdown: no timer survives, the in-flight request is aborted. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.clearPoll();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.abort.abort();
  }

  status(): CloudLinkStatus {
    const pending = this.pending && this.pending.expiresAtMs > this.now() ? this.pending : null;
    return {
      linked: this.link !== null,
      workspaceId: this.options.workspaceId,
      workspaceName: this.workspaceName,
      ...(this.link ? { orgName: this.link.orgName, dashboardUrl: this.link.dashboardUrl } : {}),
      ...(this.lastPushAtMs !== null ? { lastPushAt: new Date(this.lastPushAtMs).toISOString() } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(pending ? { pending: { code: pending.code, verifyUrl: pending.verifyUrl } } : {}),
    };
  }

  /** The owner's name for this company (the desktop knows it; we do not). */
  setWorkspaceName(raw: string): void {
    const name = cleanName(raw, 120);
    if (!name || name === this.workspaceName) return;
    this.workspaceName = name;
    if (this.link) {
      this.link = { ...this.link, workspaceName: name };
      this.write(this.link);
      this.schedulePush(0);
    }
  }

  async start(): Promise<{ code: string; verifyUrl: string }> {
    if (this.stopped) throw new CloudLinkError(503, "stopping", "The local runtime is stopping.");
    if (this.link) throw new CloudLinkError(409, "already_linked", "This workspace is already linked to the web dashboard.");
    if (this.pending && this.pending.expiresAtMs > this.now() + 5_000) {
      return { code: this.pending.code, verifyUrl: this.pending.verifyUrl };
    }
    let response: Response;
    try {
      response = await this.request("POST", "/api/desktop-link/start", { deviceName: this.deviceName });
    } catch {
      throw new CloudLinkError(502, "web_unreachable", "The BizOS web app cannot be reached.");
    }
    if (!response.ok) throw new CloudLinkError(502, "web_refused", `The BizOS web app refused the link (${response.status}).`);
    const body = record(await response.json().catch(() => null));
    const code = body?.code;
    const pollSecret = body?.pollSecret;
    const verifyUrl = sameOriginUrl(body?.verifyUrl, this.origin);
    const expiresAtMs = typeof body?.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (typeof code !== "string" || !CODE.test(code) || typeof pollSecret !== "string" || !pollSecret || !verifyUrl) {
      throw new CloudLinkError(502, "web_invalid", "The BizOS web app answered with an invalid link.");
    }
    const deadline = this.now() + this.pollMaxMs;
    this.pending = { code, pollSecret, verifyUrl, expiresAtMs: Number.isFinite(expiresAtMs) ? Math.min(expiresAtMs, deadline) : deadline };
    this.lastError = null;
    this.clearPoll();
    this.schedulePoll();
    return { code, verifyUrl };
  }

  /** Forget the link here, and revoke it on the web (best effort). */
  async unlink(): Promise<void> {
    const link = this.link;
    this.drop();
    this.pending = null;
    this.clearPoll();
    this.lastError = null;
    if (!link) return;
    try {
      await this.request("DELETE", "/api/desktop-link", undefined, link);
    } catch {
      // Offline: the token is gone from this Mac; the web revokes it later.
    }
  }

  /** One push now (the loop's body; exposed for tests). */
  async pushNow(force = false): Promise<void> {
    if (this.pushing) return this.pushing;
    this.pushing = this.push(force).finally(() => { this.pushing = null; });
    return this.pushing;
  }

  private async push(force: boolean): Promise<void> {
    const link = this.link;
    if (!link || this.stopped) return;
    let next = this.pushIntervalMs;
    try {
      const summary = await this.options.summary();
      const hash = snapshotHash(this.workspaceName, summary);
      const stale = this.lastPushAtMs === null || this.now() - this.lastPushAtMs >= this.forcePushMs;
      if (!force && !stale && hash === this.lastHash) return;
      const generatedAt = typeof record(summary)?.generatedAt === "string"
        ? (summary as { generatedAt: string }).generatedAt
        : new Date(this.now()).toISOString();
      const body = { workspaceId: this.options.workspaceId, workspaceName: this.workspaceName, generatedAt, summary };
      if (Buffer.byteLength(JSON.stringify(body)) > MAX_SNAPSHOT_BYTES) {
        this.lastError = "snapshot_too_large";
        return;
      }
      const response = await this.request("PUT", "/api/desktop-link/snapshot", body, link);
      if (response.status === 401) {
        this.log("web dashboard link revoked by the web; unlinked");
        this.drop();
        this.lastError = "unlinked";
        return;
      }
      if (!response.ok) throw new Error(`snapshot refused (${response.status})`);
      this.lastHash = hash;
      this.lastPushAtMs = this.now();
      this.lastError = null;
      this.failures = 0;
    } catch (error) {
      if (this.stopped) return;
      this.failures += 1;
      next = Math.min(this.pushIntervalMs * 2 ** (this.failures - 1), MAX_BACKOFF_MS);
      // The message is ours or fetch's; neither carries the token.
      this.lastError = error instanceof Error ? error.message.slice(0, 200) : "push_failed";
    } finally {
      if (this.link && !this.stopped) this.schedulePush(next);
    }
  }

  private onLocalEvent(): void {
    // Backing off: local activity does not hammer an unreachable web.
    if (!this.link || this.stopped || this.debounceTimer || this.failures > 0) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.pushNow();
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  private schedulePush(delayMs: number): void {
    if (this.stopped) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushNow();
    }, delayMs);
    this.pushTimer.unref?.();
  }

  private schedulePoll(): void {
    if (this.stopped || !this.pending) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.poll().catch((error: unknown) => {
        this.pending = null;
        this.lastError = error instanceof Error ? error.message.slice(0, 200) : "link_failed";
      });
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  private async poll(): Promise<void> {
    const pending = this.pending;
    if (!pending || this.stopped) return;
    if (this.now() >= pending.expiresAtMs) {
      this.pending = null;
      this.lastError = "expired";
      return;
    }
    let body: Record<string, unknown> | null = null;
    try {
      const response = await this.request("POST", "/api/desktop-link/poll", { code: pending.code, pollSecret: pending.pollSecret });
      if (response.status === 404) {
        body = { status: "expired" };
      } else if (response.ok) {
        body = record(await response.json().catch(() => null));
      }
    } catch {
      // Offline for a moment: keep polling until the code expires.
    }
    if (this.pending !== pending || this.stopped) return;
    if (body?.status === "expired") {
      this.pending = null;
      this.lastError = "expired";
      return;
    }
    if (body?.status === "approved") {
      const token = body.token;
      if (typeof token !== "string" || !token.startsWith("bzd_") || token.length > 200) {
        this.pending = null;
        this.lastError = "web_invalid";
        return;
      }
      this.link = {
        version: 1,
        origin: this.origin,
        token,
        orgId: typeof body.orgId === "string" ? body.orgId.slice(0, 128) : "",
        orgName: typeof body.orgName === "string" ? cleanName(body.orgName, 120) : "",
        dashboardUrl: sameOriginUrl(body.dashboardUrl, this.origin) ?? `${this.origin}/desktop`,
        linkedAt: new Date(this.now()).toISOString(),
        workspaceName: this.workspaceName,
      };
      this.write(this.link);
      this.pending = null;
      this.lastError = null;
      this.lastHash = null;
      this.failures = 0;
      this.log("web dashboard linked");
      this.begin();
      await this.pushNow(true);
      return;
    }
    this.schedulePoll();
  }

  private async request(method: string, path: string, body?: unknown, link?: StoredLink): Promise<Response> {
    const origin = link?.origin ?? this.origin;
    return this.fetchImpl(new URL(path, origin), {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(link ? { authorization: `Bearer ${link.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  }

  private drop(): void {
    this.link = null;
    this.lastHash = null;
    this.failures = 0;
    this.clearTimers();
    try { unlinkSync(this.path); } catch { /* already gone */ }
  }

  private clearTimers(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pushTimer = null;
    this.debounceTimer = null;
  }

  private clearPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private read(): StoredLink | null {
    try {
      const value = record(JSON.parse(readFileSync(this.path, "utf8")));
      if (value?.version !== 1 || typeof value.token !== "string" || typeof value.origin !== "string"
        || typeof value.dashboardUrl !== "string") return null;
      webOrigin(value.origin);
      return {
        version: 1,
        origin: value.origin,
        token: value.token,
        orgId: typeof value.orgId === "string" ? value.orgId : "",
        orgName: typeof value.orgName === "string" ? value.orgName : "",
        dashboardUrl: sameOriginUrl(value.dashboardUrl, value.origin) ?? `${value.origin}/desktop`,
        linkedAt: typeof value.linkedAt === "string" ? value.linkedAt : "",
        ...(typeof value.workspaceName === "string" && value.workspaceName ? { workspaceName: value.workspaceName } : {}),
      };
    } catch {
      return null;
    }
  }

  private write(link: StoredLink): void {
    writeFileAtomic(this.path, `${JSON.stringify(link, null, 2)}\n`);
  }
}
