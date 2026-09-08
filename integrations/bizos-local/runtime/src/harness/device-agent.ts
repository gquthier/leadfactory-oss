// The device agent: what this machine says about itself to BizOS.
//
// Three responsibilities, and nothing else:
//
//   1. REGISTER once (as soon as a BizOS session exists in the window), and
//      store the token it gets back in `<userData>/localbizos/device.json`, at
//      0600 like everything else. The token is only ever returned by that call:
//      losing it means having to register the machine again.
//   2. BEAT every 60 s while the app runs, and one last time on the way out
//      with `capabilities.shuttingDown = true`. That beat, and it alone, is
//      what makes the other end say "online": nothing here writes an `online`
//      boolean, because a machine somebody unplugs cannot write that it is
//      switched off. A beat the server REFUSES FOR RATE (429) is not a failed
//      beat: it changes no state at all and is simply retried a window later
//      (`HEARTBEAT_RETRY_MS`), because a full bucket says nothing about this
//      machine — only that it already spoke.
//   3. CLAIM a task every 30 s — ONLY when the owner has armed the toggle. The
//      flag that counts is the one the beat's RESPONSE reports, not the one we
//      thought we had: turning remote tasks off from the app therefore reaches
//      the machine in under a minute, and a machine that can no longer beat
//      does not start working on its last conviction.
//
// Nothing is ever run without that explicit toggle, and everything that is runs
// gets written into a thread visible in the app (see `harness.runRemoteTask`):
// a remote task nobody can read back is a backdoor, not a feature.
//
// Everything is injected (fetch, clock, storage, running the turn) so the file
// runs under vitest with no Electron, no network and no waiting.
import { join } from "node:path";
import type { Clock } from "./clock.js";
import type { Storage } from "./storage.js";
import type { DeviceCapabilities, DeviceAgentState, DevicePlatform } from "./types.js";

export const DEVICE_FILE = "device.json";
/** The other end considers a machine online for 2 minutes after its last
 * beat; beating every 60 s therefore leaves room for ONE failure. */
export const HEARTBEAT_MS = 60_000;
export const POLL_MS = 30_000;
/**
 * The server's heartbeat bucket: ONE beat per 20 s and per device
 * (`src/lib/devices/limits.ts`, `DEVICE_HEARTBEAT_WINDOW_SECS`).
 *
 * It is three times our cadence on purpose, so a catch-up after a wake never
 * trips it. What DOES trip it is two beats inside the same window, and the
 * screen produces exactly that on demand: flipping "Allow remote tasks" calls
 * `bridge.refresh()`, which beats immediately, while the periodic beat keeps
 * its own minute and knows nothing about it.
 */
export const HEARTBEAT_BUCKET_MS = 20_000;
/**
 * How soon we beat again after a 429 the server did not put a `Retry-After` on.
 *
 * A FULL window from now is the only delay we can be sure covers the bucket:
 * the window opened on whichever beat spent it, not on ours, so we cannot know
 * how much of it is left. The extra second is margin against two clocks that
 * round in opposite directions — retrying one millisecond early would only earn
 * a second 429 and push the real beat another window away.
 */
export const HEARTBEAT_RETRY_MS = HEARTBEAT_BUCKET_MS + 1_000;

/**
 * `Retry-After` in milliseconds, or `null` when the answer carries none.
 *
 * Both forms RFC 9110 allows are read — delta-seconds and an HTTP-date —
 * because what answers a beat is not always the app: a proxy or an edge in
 * front of it may rate-limit on its own terms, and we have no say in which form
 * it picks. The result is CLAMPED into `[1 s, HEARTBEAT_MS]` at both ends, and
 * both ends matter: `Retry-After: 0` from a misconfigured proxy would otherwise
 * turn a refused beat into a spin against the very limiter that refused it,
 * and honouring a `Retry-After: 600` would keep the machine silent for ten
 * minutes — long past the two-minute presence window — when the beat already
 * scheduled a minute out costs nothing and is now harmless if it, too, is
 * refused.
 */
export function retryAfterMs(response: Response, nowMs: number): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const value = header.trim();
  const ms = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - nowMs;
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 1_000), HEARTBEAT_MS);
}
/** After which a task that has returned nothing is closed as failed. Aligned
 * on how long an approval is waited for: past that, nobody will answer. */
export const TASK_TIMEOUT_MS = 15 * 60_000;
/** What the server accepts in `result` (column constraint). */
export const RESULT_MAX = 4000;

/** What is persisted on this machine. The token is a bearer: it never leaves
 * the main process and is never written anywhere but here. */
export interface DeviceRecord {
  id: string;
  token: string;
  /** The origin this token is good for. A changed `LOCALBIZOS_APP_URL`
   * (dev → prod) has to REGISTER AGAIN, not reuse a token the other database
   * does not know — otherwise the machine believes it is registered and takes
   * a 401 on every beat, in silence. */
  baseUrl: string;
  name: string;
  registeredAt: string;
}

export interface DeviceTask {
  id: string;
  prompt: string;
}

export interface DeviceAgentDependencies {
  baseUrl: string;
  appVersion: string;
  platform: NodeJS.Platform;
  hostname(): string;
  storage: Storage;
  clock: Clock;
  fetch: typeof fetch;
  /** The window's BizOS cookies. Empty = not signed in yet: the agent waits,
   * it does not register under an identity it does not have. */
  readSessionCookie(): Promise<string>;
  /** What the machine can say about itself at beat time. */
  capabilities(): Promise<DeviceCapabilities>;
  /** Runs the task locally. Provided by the harness: an agent turn in the
   * "Remote tasks" thread. */
  runTask(prompt: string): Promise<{ status: "done" | "failed"; result: string }>;
  /** The state changed — the Devices screen redraws it. */
  onState?(state: DeviceAgentState): void;
}

/** `MacBook-Pro-de-Gauthier.local` → `MacBook Pro de Gauthier`.
 *
 * A hostname is not a device name: macOS replaces the spaces in it with dashes
 * and sticks `.local` on the end. We return the name the user recognises, and
 * bound it to what the column accepts (80). An empty host, or one that reduces
 * to nothing, falls back to a generic name rather than failing registration. */
export function deviceNameFromHostname(hostname: string, platform: NodeJS.Platform): string {
  const cleaned = hostname
    .trim()
    .replace(/\.(local|lan|home|localdomain)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned) return cleaned;
  return platform === "darwin" ? "This Mac" : platform === "win32" ? "This PC" : "This computer";
}

/** The platforms the database accepts. An exotic value (`aix`, `sunos`) is no
 * reason not to register the machine: it is filed under `linux`, which is what
 * it is from this product's point of view. */
export function devicePlatform(platform: NodeJS.Platform): DevicePlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

function readRecord(storage: Storage, baseUrl: string): DeviceRecord | null {
  const raw = storage.readJson<Record<string, unknown> | null>(DEVICE_FILE, null);
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  const origin = typeof raw.baseUrl === "string" ? raw.baseUrl : "";
  if (!id || !/^[0-9a-f]{64}$/.test(token) || origin !== baseUrl) return null;
  return {
    id,
    token,
    baseUrl: origin,
    name: typeof raw.name === "string" ? raw.name : "",
    registeredAt: typeof raw.registeredAt === "string" ? raw.registeredAt : "",
  };
}

export class DeviceAgent {
  private record: DeviceRecord | null;
  private remoteTasksEnabled = false;
  private lastSeenAt: string | null = null;
  private lastError: string | null = null;
  private working = false;
  private stopped = true;
  private cancelHeartbeat: (() => void) | null = null;
  private cancelPoll: (() => void) | null = null;
  /** The delay before the NEXT beat — a minute, unless the last answer asked
   * for something sooner. Only a 429 does, and only for the one beat that
   * follows it (see `takeHeartbeatDelay`). */
  private nextHeartbeatMs = HEARTBEAT_MS;

  constructor(private readonly deps: DeviceAgentDependencies) {
    this.record = readRecord(deps.storage, deps.baseUrl);
  }

  state(): DeviceAgentState {
    return {
      registered: this.record !== null,
      deviceId: this.record?.id ?? null,
      name: this.record?.name ?? deviceNameFromHostname(this.deps.hostname(), this.deps.platform),
      platform: devicePlatform(this.deps.platform),
      appVersion: this.deps.appVersion,
      remoteTasksEnabled: this.remoteTasksEnabled,
      lastSeenAt: this.lastSeenAt,
      busy: this.working,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  private announce(): void {
    this.deps.onState?.(this.state());
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleHeartbeat(0);
    this.schedulePoll(POLL_MS);
  }

  /** Clean shutdown: one last beat that SAYS we are closing, so the other end
   * does not have to sit through two minutes of silence to understand that a
   * machine was switched off deliberately. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelHeartbeat?.();
    this.cancelPoll?.();
    this.cancelHeartbeat = null;
    this.cancelPoll = null;
    if (!this.record) return;
    await this.heartbeat({ shuttingDown: true }).catch(() => undefined);
  }

  /**
   * Which arming of the timer is the live one.
   *
   * A beat can re-arm the timer from inside itself (a 429, below), and the
   * cadence must not then walk over the shorter delay it just posted: the beat
   * that finishes compares the generation it was started with, and stays quiet
   * if it is no longer the one that counts.
   */
  private heartbeatGeneration = 0;

  private scheduleHeartbeat(delay: number): void {
    if (this.stopped) return;
    // Exactly one timer: re-arming replaces the pending beat instead of adding
    // a second one that would beat twice.
    this.cancelHeartbeat?.();
    this.heartbeatGeneration += 1;
    const generation = this.heartbeatGeneration;
    this.cancelHeartbeat = this.deps.clock.setTimeout(() => {
      void this.tick().finally(() => {
        if (this.heartbeatGeneration !== generation) return;
        this.scheduleHeartbeat(this.takeHeartbeatDelay());
      });
    }, delay);
  }

  /** How long before the next beat, CONSUMED: a shortened delay asked for by a
   * 429 applies to exactly one beat and then the cadence goes back to a minute.
   * Reading it without resetting it would turn one refused beat into a machine
   * that beats every twenty seconds for the rest of the session — which is the
   * bucket's next 429, forever. */
  private takeHeartbeatDelay(): number {
    const delay = this.nextHeartbeatMs;
    this.nextHeartbeatMs = HEARTBEAT_MS;
    return delay;
  }

  private schedulePoll(delay: number): void {
    if (this.stopped) return;
    this.cancelPoll = this.deps.clock.setTimeout(() => {
      void this.pollOnce().finally(() => this.schedulePoll(POLL_MS));
    }, delay);
  }

  /** One beat, plus the registration if it is still missing. */
  async tick(): Promise<void> {
    if (!this.record) {
      const registered = await this.register();
      if (!registered) return;
    }
    await this.heartbeat();
  }

  private async authorizedFetch(path: string, init: RequestInit): Promise<Response | null> {
    const record = this.record;
    if (!record) return null;
    return this.deps.fetch(new URL(path, record.baseUrl).href, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        "content-type": "application/json",
        authorization: `Bearer ${record.token}`,
      },
    });
  }

  /**
   * `POST /api/devices/register`, with the window's session.
   *
   * Without a cookie we try nothing: registering means knowing WHOSE this
   * machine is, and a 401 answer repeated every minute teaches nobody
   * anything. `false` means "not yet", never "never".
   */
  async register(): Promise<boolean> {
    const cookie = await this.deps.readSessionCookie().catch(() => "");
    if (!cookie) {
      this.lastError = null;
      return false;
    }
    const name = deviceNameFromHostname(this.deps.hostname(), this.deps.platform);
    try {
      const response = await this.deps.fetch(new URL("/api/devices/register", this.deps.baseUrl).href, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name,
          platform: devicePlatform(this.deps.platform),
          appVersion: this.deps.appVersion,
          capabilities: await this.deps.capabilities(),
        }),
      });
      if (!response.ok) {
        this.lastError = `register: ${response.status}`;
        this.announce();
        return false;
      }
      const body = (await response.json()) as { device?: { id?: unknown }; token?: unknown };
      const id = typeof body.device?.id === "string" ? body.device.id : "";
      const token = typeof body.token === "string" ? body.token : "";
      if (!id || !token) {
        this.lastError = "register: the server did not return a device token";
        this.announce();
        return false;
      }
      this.record = {
        id,
        token,
        baseUrl: this.deps.baseUrl,
        name,
        registeredAt: this.deps.clock.nowIso(),
      };
      // 0600, like everything `Storage` writes: this file holds a bearer token.
      this.deps.storage.writeJson(DEVICE_FILE, this.record);
      this.lastError = null;
      this.announce();
      return true;
    } catch (error) {
      this.lastError = `register: ${error instanceof Error ? error.message : String(error)}`;
      this.announce();
      return false;
    }
  }

  /** One beat. The remote-tasks flag comes from the RESPONSE. */
  async heartbeat(extra: Partial<DeviceCapabilities> = {}): Promise<void> {
    if (!this.record) return;
    try {
      const capabilities = { ...(await this.deps.capabilities()), ...extra };
      const response = await this.authorizedFetch("/api/devices/heartbeat", {
        method: "POST",
        body: JSON.stringify({ capabilities }),
      });
      if (!response) return;
      if (response.status === 401) {
        // A 401 is only a REVOCATION when the server says so in as many words.
        //
        // The routes turn any auth-lookup failure into 401, so a Supabase
        // timeout during one heartbeat used to delete `device.json` — the
        // machine unregistered itself over a blip, re-registered under a new
        // row, and left the old one orphaned in the org's list. A transient
        // failure is retried at the next beat; only `device_revoked` and
        // `unknown_device` mean the token is genuinely dead.
        if (await this.isRevoked(response)) {
          this.forget();
          this.lastError = "this device was revoked";
        } else {
          this.lastError = "heartbeat: 401";
        }
        this.remoteTasksEnabled = false;
        this.announce();
        return;
      }
      if (response.status === 429) {
        // A REFUSED beat is a no-op. It is not a failed beat.
        //
        // The bucket is one beat per 20 s per device, and the screen spends it
        // deliberately: flipping "Allow remote tasks" calls `bridge.refresh()`,
        // which beats immediately, while the periodic beat keeps its own minute
        // and knows nothing about it. Two beats inside one window is therefore
        // an ORDINARY sequence, not an abuse — and the branch below used to
        // answer it by disarming the machine. The admin saw an armed switch,
        // this Mac believed itself disarmed for up to a minute, and every task
        // an admin posted in that minute was accepted by the route and left
        // `queued`, claimed by nobody, until it expired.
        //
        // So nothing is written here. Not the permission — a full bucket says
        // nothing about the toggle. Not `lastSeenAt` — we did not learn when
        // the row was last touched. Not `lastError` — the server is up and
        // answering, and there is nothing for a person to read. And no
        // `announce()`: a state identical to the one already on screen is not
        // an event. The single effect of a 429 is that the next beat comes
        // sooner, once the window has had time to drain.
        this.nextHeartbeatMs =
          retryAfterMs(response, this.deps.clock.now().getTime()) ?? HEARTBEAT_RETRY_MS;
        // And the delay is APPLIED here, not merely computed. A MANUAL beat —
        // the Devices screen's refresh, which is precisely what spends the
        // server's window — left the periodic timer sitting on its full minute,
        // so the shortened delay was consumed by the next scheduled beat up to
        // 60 s later and this machine spent that minute unable to confirm its
        // own permission. Re-arming here covers every road to a 429, the
        // periodic one included (which then leaves the cadence alone, see
        // `scheduleHeartbeat`).
        this.scheduleHeartbeat(this.takeHeartbeatDelay());
        return;
      }
      if (!response.ok) {
        this.lastError = `heartbeat: ${response.status}`;
        // A machine that can no longer hear the server does not keep working on
        // what it last believed it was allowed to do. `device-agent.ts` says
        // exactly this at the top of the file; nothing enforced it.
        this.remoteTasksEnabled = false;
        this.announce();
        return;
      }
      const body = (await response.json()) as { remoteTasksEnabled?: unknown };
      this.remoteTasksEnabled = body.remoteTasksEnabled === true;
      this.lastSeenAt = this.deps.clock.nowIso();
      this.lastError = null;
      this.announce();
    } catch (error) {
      this.lastError = `heartbeat: ${error instanceof Error ? error.message : String(error)}`;
      // Offline, DNS gone, the laptop asleep: the toggle the machine acts on is
      // the one the LAST successful beat reported, and there is no such beat.
      this.remoteTasksEnabled = false;
      this.announce();
    }
  }

  /** Only two answers mean "this token is dead". Anything else — an empty body,
   * a 503 dressed as a 401, HTML from a proxy — is treated as transient. */
  private async isRevoked(response: Response): Promise<boolean> {
    try {
      const body = (await response.clone().json()) as { error?: unknown };
      return body.error === "device_revoked" || body.error === "unknown_device";
    } catch {
      return false;
    }
  }

  private forget(): void {
    this.record = null;
    this.remoteTasksEnabled = false;
    this.deps.storage.removeFile(join(this.deps.storage.layout.root, DEVICE_FILE));
  }

  /**
   * Claim and run at most ONE task.
   *
   * Three refusals, in this order, and each has its reason: no token (nothing
   * to claim), toggle off (the user has authorised nothing — the route checks
   * it again too, but a machine does not ASK for what it knows it has no right
   * to run), already busy (two simultaneous turns on the same thread would
   * step on each other).
   */
  async pollOnce(): Promise<DeviceTask | null> {
    if (!this.record || !this.remoteTasksEnabled || this.working) return null;
    let task: DeviceTask | null = null;
    try {
      const response = await this.authorizedFetch("/api/devices/tasks/next", { method: "GET" });
      if (!response || !response.ok) return null;
      const body = (await response.json()) as { task?: { id?: unknown; prompt?: unknown } | null };
      const id = typeof body.task?.id === "string" ? body.task.id : "";
      const prompt = typeof body.task?.prompt === "string" ? body.task.prompt : "";
      if (!id || !prompt) return null;
      task = { id, prompt };
    } catch {
      return null;
    }

    this.working = true;
    this.announce();
    let outcome: { status: "done" | "failed"; result: string };
    try {
      outcome = await this.deps.runTask(task.prompt);
    } catch (error) {
      outcome = { status: "failed", result: error instanceof Error ? error.message : String(error) };
    } finally {
      this.working = false;
    }
    // The result is sent EVEN on failure: a task whose outcome nobody ever
    // learns is worth less than a task that was refused.
    await this.report(task.id, outcome).catch(() => undefined);
    this.announce();
    return task;
  }

  private async report(
    taskId: string,
    outcome: { status: "done" | "failed"; result: string },
  ): Promise<void> {
    const response = await this.authorizedFetch(
      `/api/devices/tasks/${encodeURIComponent(taskId)}/result`,
      {
        method: "POST",
        body: JSON.stringify({
          status: outcome.status,
          result: outcome.result.slice(0, RESULT_MAX),
        }),
      },
    );
    if (response && !response.ok) this.lastError = `result: ${response.status}`;
  }
}
