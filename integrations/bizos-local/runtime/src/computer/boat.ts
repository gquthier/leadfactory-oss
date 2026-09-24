// The agent's computer on the SHARED cloud computer (one Boat sandbox per
// workspace, see `cloud.ts`), behind the same `ComputerBackend` seam as the
// native one — so `computer_observe` / `computer_act` / `computer_download`,
// their shapes and the prompts that name them do not change.
//
// Each agent has a seat of its own on that machine — its own X display, its
// own Chrome and profile, its own screenshots (`boat-helper.ts` says how). This
// file is the runtime half: it ships the helper, runs one helper call per tool
// call (serialized per agent, parallel across agents), and keeps the last
// frame of each agent so the panel can show THAT agent's screen without
// waking the machine for it.
import { randomBytes } from "node:crypto";
import { hostOf, parseNavigable } from "./actions.js";
import {
  computerHelperSource,
  helperCommand,
  helperPath,
  helperVersion,
  parseHelperOutput,
  toHelperActions,
  HELPER_MISSING,
  type HelperRequest,
  type HelperResponse,
} from "./boat-helper.js";
import { agentSlug, CloudComputerError, type BoatCommandResult } from "./cloud.js";
import type { CapturedFrame } from "./host.js";
import { readProbe } from "./observe.js";
import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type ComputerAction,
  type ComputerActionResult,
  type ComputerDownloadResult,
  type ComputerObservation,
  type ComputerState,
  type ManagedComputerBackend,
} from "./types.js";

/** What this backend needs from the cloud computer. `CloudComputer` has it;
 * a test hands in a fake. */
export interface BoatMachine {
  isConfigured(): boolean;
  allowed(): Promise<boolean>;
  computerExec(command: string, timeoutSeconds: number): Promise<{ result: BoatCommandResult; wokeFromSleep: boolean; sandboxId: string }>;
  writeFile(path: string, content: string): Promise<void>;
  execAwake(sandboxId: string, command: string, timeoutSeconds: number): Promise<BoatCommandResult>;
  setBeforeSleep(hook: ((sandboxId: string) => Promise<void>) | null): void;
  onSleep(listener: () => void): () => void;
}

export interface BoatBackendOptions {
  machine: BoatMachine;
  nowIso(): string;
  onFrame?(botId: string, frame: CapturedFrame): void;
  onStateChanged?(botId: string): void;
  log?(line: string): void;
}

interface Seat {
  status: "starting" | "ready" | "sleeping" | "error";
  url: string;
  title: string;
  frame: CapturedFrame | null;
  frameAt: string | null;
  cookieHosts: string[] | null;
  display?: string;
  profile?: string;
  error?: string;
  tail: Promise<unknown>;
}

/** One helper call's budget: a wake, a first-ever Xvfb install and a Chrome
 * start, then a batch that may wait on a slow page. */
const HELPER_TIMEOUT_SECONDS = 240;

export const TAKE_CONTROL_UNAVAILABLE =
  "Take control is not available on the cloud computer yet: its screen is shown in the panel, and your agent pauses if you ask it to.";

export class BoatComputerBackend implements ManagedComputerBackend {
  readonly kind = "container" as const;
  private readonly seats = new Map<string, Seat>();
  private readonly source = computerHelperSource();
  private readonly path = helperPath(helperVersion(this.source));
  /** `false` once Boat said the plan does not include it; re-read on use. */
  private allowedCache: boolean | null = null;
  private installing: Promise<void> | null = null;

  constructor(private readonly options: BoatBackendOptions) {
    options.machine.setBeforeSleep((sandboxId) => this.closeBrowsers(sandboxId));
    options.machine.onSleep(() => this.markAllSleeping());
  }

  /** Configured and (as far as we last heard) allowed: pick this backend. */
  usable(): boolean {
    if (!this.options.machine.isConfigured()) return false;
    if (this.allowedCache === null) void this.refreshAllowed();
    return this.allowedCache !== false;
  }

  async refreshAllowed(): Promise<boolean> {
    try {
      this.allowedCache = await this.options.machine.allowed();
    } catch {
      this.allowedCache = null;
    }
    return this.allowedCache !== false;
  }

  has(botId: string): boolean {
    const seat = this.seats.get(botId);
    return Boolean(seat && seat.status !== "error");
  }

  state(botId: string): ComputerState {
    const seat = this.seats.get(botId);
    if (!seat) return { backend: "container", status: "none", apps: [] };
    if (seat.status === "error") {
      return { backend: "container", status: "error", apps: [], error: seat.error ?? "the cloud computer failed" };
    }
    const onAPage = Boolean(seat.url) && seat.url !== "about:blank";
    return {
      backend: "container",
      status: seat.status,
      ...(seat.frame
        ? {
            screen: {
              previewDataUrl: seat.frame.thumbnail,
              capturedAt: seat.frameAt ?? this.options.nowIso(),
              width: seat.frame.width,
              height: seat.frame.height,
            },
          }
        : {}),
      apps: [
        { id: "browser", open: onAPage, ...(seat.title ? { title: seat.title } : {}) },
        { id: "files", open: true, title: "Cloud folder" },
        { id: "terminal", open: true, title: "Cloud shell" },
      ],
      ...(onAPage ? { openUrl: seat.url } : {}),
    };
  }

  /** Where this agent's seat is on the machine, for tests and diagnostics. */
  seatInfo(botId: string): { display?: string; profile?: string } {
    const seat = this.seats.get(botId);
    return { ...(seat?.display ? { display: seat.display } : {}), ...(seat?.profile ? { profile: seat.profile } : {}) };
  }

  async start(botId: string): Promise<ComputerState> {
    const seat = this.seat(botId);
    if (seat.status !== "ready") {
      seat.status = "starting";
      delete seat.error;
      this.options.onStateChanged?.(botId);
    }
    try {
      await this.serial(botId, () => this.call(botId, { op: "observe", agent: agentSlug(botId) }));
    } catch (error) {
      seat.status = "error";
      seat.error = error instanceof Error ? error.message : String(error);
      this.options.onStateChanged?.(botId);
    }
    return this.state(botId);
  }

  async observe(botId: string): Promise<ComputerObservation> {
    const response = await this.serial(botId, () => this.call(botId, { op: "observe", agent: agentSlug(botId) }));
    return this.observation(response);
  }

  async act(botId: string, actions: ComputerAction[], observe: boolean, settleMs = 0): Promise<ComputerActionResult> {
    for (const action of actions) {
      // The last line before the machine, as in the native backend.
      if (action.kind === "navigate" && !parseNavigable(action.url)) throw new Error("that address is not one a computer may open");
    }
    const response = await this.serial(botId, () =>
      this.call(botId, { op: "act", agent: agentSlug(botId), actions: toHelperActions(actions), observe, settleMs }, { allowFailure: true }),
    );
    if (!response.ok) throw new Error(response.error || "that action failed on the cloud computer");
    const completed = typeof response.completed === "number" ? response.completed : actions.length;
    return observe ? { completed, observation: this.observation(response) } : { completed };
  }

  async download(botId: string, url: string): Promise<ComputerDownloadResult> {
    if (!parseNavigable(url)) throw new Error("a computer can only download from an http(s) address");
    const response = await this.serial(botId, () => this.call(botId, { op: "download", agent: agentSlug(botId), url }));
    const saved = response.download;
    if (!saved || typeof saved.path !== "string") throw new Error("the download did not finish on the cloud computer");
    return { path: saved.path, bytes: Number(saved.bytes) || 0, name: String(saved.name ?? "download") };
  }

  async signedInHosts(botId: string): Promise<string[]> {
    const seat = this.seats.get(botId);
    if (seat?.cookieHosts) return seat.cookieHosts;
    const response = await this.serial(botId, () => this.call(botId, { op: "cookies", agent: agentSlug(botId) }));
    return response.cookieHosts ?? [];
  }

  currentUrl(botId: string): string {
    return this.seats.get(botId)?.url ?? "";
  }

  currentHost(botId: string): string {
    return hostOf(this.currentUrl(botId));
  }

  /** The last frame this agent's screen produced. Taking a new one would
   * cost a round trip and keep the machine awake (and billing) for a panel. */
  async capture(botId: string): Promise<CapturedFrame | null> {
    return this.seats.get(botId)?.frame ?? null;
  }

  takeControl(_botId: string): void {
    throw new Error(TAKE_CONTROL_UNAVAILABLE);
  }

  giveBack(_botId: string): void {}

  userHasControl(_botId: string): boolean {
    return false;
  }

  navigateForUser(_botId: string, _what: "back" | "forward" | "reload"): void {
    throw new Error(TAKE_CONTROL_UNAVAILABLE);
  }

  history(_botId: string): { back: boolean; forward: boolean } {
    return { back: false, forward: false };
  }

  forwardInput(_botId: string, _event: Record<string, unknown>): void {
    throw new Error(TAKE_CONTROL_UNAVAILABLE);
  }

  /** This agent is done for now. The machine is shared: it sleeps on its
   * own idle timer, never because one agent stopped. */
  sleep(botId: string): void {
    const seat = this.seats.get(botId);
    if (!seat || seat.status === "sleeping") return;
    seat.status = "sleeping";
    this.options.onStateChanged?.(botId);
  }

  dispose(botId: string): void {
    if (this.seats.delete(botId)) this.options.onStateChanged?.(botId);
  }

  disposeAll(): void {
    this.seats.clear();
  }

  // ── plumbing ──────────────────────────────────────────────────────────

  private seat(botId: string): Seat {
    let seat = this.seats.get(botId);
    if (!seat) {
      seat = { status: "starting", url: "", title: "", frame: null, frameAt: null, cookieHosts: null, tail: Promise.resolve() };
      this.seats.set(botId, seat);
    }
    return seat;
  }

  /** One call at a time per agent — its page is one page — and any number
   * of agents at once. */
  private serial<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const seat = this.seat(botId);
    const next = seat.tail.then(work, work);
    seat.tail = next.catch(() => undefined);
    return next;
  }

  private async exec(command: string): Promise<BoatCommandResult> {
    try {
      const { result } = await this.options.machine.computerExec(command, HELPER_TIMEOUT_SECONDS);
      this.allowedCache = true;
      return result;
    } catch (error) {
      if (error instanceof CloudComputerError && error.code === "pro_required") this.allowedCache = false;
      throw error;
    }
  }

  private async call(botId: string, request: HelperRequest, options: { allowFailure?: boolean } = {}): Promise<HelperResponse> {
    let result = await this.exec(helperCommand(request, this.path));
    if ((result.stdout ?? "").includes(HELPER_MISSING)) {
      // Two agents finding it missing at once upload it once.
      this.installing ??= this.options.machine.writeFile(this.path, this.source).then(
        () => this.options.log?.(`cloud computer: helper ${this.path} installed`),
      ).finally(() => { this.installing = null; });
      await this.installing;
      result = await this.exec(helperCommand(request, this.path));
    }
    const response = parseHelperOutput(result.stdout ?? "");
    if (!response) {
      const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" ").slice(0, 300);
      throw new Error(`the cloud computer did not answer${result.timedOut ? " in time" : ""}${detail ? `: ${detail}` : ""}`);
    }
    this.absorb(botId, response);
    if (!response.ok && !options.allowFailure) throw new Error(response.error || "the cloud computer refused that");
    return response;
  }

  /** Whatever the helper saw becomes this agent's state and panel frame. */
  private absorb(botId: string, response: HelperResponse): void {
    const seat = this.seat(botId);
    if (typeof response.display === "string") seat.display = response.display;
    if (typeof response.profile === "string") seat.profile = response.profile;
    if (Array.isArray(response.cookieHosts)) {
      seat.cookieHosts = response.cookieHosts.filter((host): host is string => typeof host === "string").map((host) => host.toLowerCase());
    }
    const probe = response.probe ? readProbe(response.probe) : null;
    if (probe || typeof response.url === "string") {
      seat.url = probe?.url || (typeof response.url === "string" ? response.url : seat.url);
      seat.title = probe?.title || (typeof response.title === "string" ? response.title : seat.title);
    }
    if (response.display) {
      seat.status = "ready";
      delete seat.error;
    }
    const image = typeof response.image === "string" ? response.image : "";
    const thumb = typeof response.thumb === "string" ? response.thumb : "";
    if (image) {
      const frame: CapturedFrame = {
        full: `data:image/jpeg;base64,${image}`,
        thumbnail: `data:image/jpeg;base64,${thumb || image}`,
        width: positive(response.width, SCREEN_WIDTH),
        height: positive(response.height, SCREEN_HEIGHT),
      };
      seat.frame = frame;
      seat.frameAt = this.options.nowIso();
      this.options.onFrame?.(botId, frame);
    }
    this.options.onStateChanged?.(botId);
  }

  private observation(response: HelperResponse): ComputerObservation {
    const probe = readProbe(response.probe ?? {});
    return {
      frameId: randomBytes(8).toString("hex"),
      capturedAt: this.options.nowIso(),
      mimeType: "image/jpeg",
      imageBase64: typeof response.image === "string" ? response.image : "",
      width: positive(response.width, SCREEN_WIDTH),
      height: positive(response.height, SCREEN_HEIGHT),
      url: probe.url || String(response.url ?? ""),
      title: probe.title || String(response.title ?? ""),
      elements: probe.elements,
      text: probe.text,
    };
  }

  /** Before the machine is stopped: every agent's Chrome closes cleanly. */
  private async closeBrowsers(sandboxId: string): Promise<void> {
    const result = await this.options.machine.execAwake(sandboxId, helperCommand({ op: "shutdown" }, this.path), 60);
    const response = parseHelperOutput(result.stdout ?? "");
    if (response?.closed?.length) this.options.log?.(`cloud computer: closed ${response.closed.length} agent browser(s) before sleep`);
  }

  private markAllSleeping(): void {
    for (const [botId, seat] of this.seats) {
      if (seat.status === "error") continue;
      seat.status = "sleeping";
      seat.cookieHosts = null;
      this.options.onStateChanged?.(botId);
    }
  }
}

function positive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}
