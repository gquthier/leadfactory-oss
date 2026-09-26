// The native Electron browser lives in the desktop main process while this
// harness runs in its Node sidecar. This adapter keeps the existing
// ComputerManager policy boundary in the sidecar and forwards only validated
// computer operations to the desktop's private loopback bridge.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CapturedFrame } from "./host.js";
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerDownloadResult,
  ComputerObservation,
  ComputerState,
  ManagedComputerBackend,
} from "./types.js";

interface NativeBridgeDescriptor {
  version: 1;
  origin: string;
  workspaceId: string;
  secret: string;
}

export interface RemoteNativeComputerOptions {
  descriptorPath: string;
  workspaceFor(botId: string): string;
  fetchImpl?: typeof fetch;
}

type BridgeOperation =
  | "state"
  | "start"
  | "observe"
  | "act"
  | "download"
  | "signedInHosts"
  | "takeControl"
  | "giveBack"
  | "navigate"
  | "input"
  | "capture"
  | "history"
  | "sleep"
  | "dispose"
  | "disposeAll";

const EMPTY: ComputerState = { backend: "native", status: "none", apps: [] };

function descriptor(path: string): NativeBridgeDescriptor {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("The desktop computer bridge is not ready.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The desktop computer bridge descriptor is invalid.");
  const row = raw as Record<string, unknown>;
  const origin = typeof row.origin === "string" ? row.origin : "";
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("The desktop computer bridge descriptor is invalid."); }
  if (row.version !== 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The desktop computer bridge descriptor is invalid.");
  }
  if (typeof row.workspaceId !== "string" || !row.workspaceId || typeof row.secret !== "string" || !/^[a-f0-9]{64}$/.test(row.secret)) {
    throw new Error("The desktop computer bridge descriptor is invalid.");
  }
  return { version: 1, origin: url.origin, workspaceId: row.workspaceId, secret: row.secret };
}

function botCapability(secret: string, workspaceId: string, botId: string): string {
  return createHmac("sha256", secret).update(`${workspaceId}\0${botId}`).digest("hex");
}

function stateOf(value: unknown): ComputerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY, status: "error", error: "The desktop returned an invalid computer state." };
  const row = value as Record<string, unknown>;
  const status = row.status === "starting" || row.status === "ready" || row.status === "sleeping" || row.status === "error" ? row.status : "none";
  const apps = Array.isArray(row.apps)
    ? row.apps.filter((item): item is ComputerState["apps"][number] => Boolean(item && typeof item === "object" && !Array.isArray(item) && ["browser", "files", "terminal"].includes(String((item as { id?: unknown }).id))))
    : [];
  const screenRow = row.screen && typeof row.screen === "object" && !Array.isArray(row.screen) ? row.screen as Record<string, unknown> : null;
  const screen = screenRow && typeof screenRow.previewDataUrl === "string" && screenRow.previewDataUrl.startsWith("data:image/")
    ? {
        previewDataUrl: screenRow.previewDataUrl,
        capturedAt: typeof screenRow.capturedAt === "string" ? screenRow.capturedAt : new Date(0).toISOString(),
        width: Math.max(1, Number(screenRow.width) || 1280),
        height: Math.max(1, Number(screenRow.height) || 800),
      }
    : undefined;
  return {
    backend: "native",
    status,
    apps,
    ...(typeof row.openUrl === "string" ? { openUrl: row.openUrl } : {}),
    ...(row.userInControl === true ? { userInControl: true } : {}),
    ...(typeof row.error === "string" ? { error: row.error.slice(0, 300) } : {}),
    ...(screen ? { screen } : {}),
  };
}

/** One sidecar workspace, one desktop bridge, one serialized queue per bot. */
export class RemoteNativeComputerBackend implements ManagedComputerBackend {
  readonly kind = "native" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly states = new Map<string, ComputerState>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly histories = new Map<string, { back: boolean; forward: boolean }>();

  constructor(private readonly options: RemoteNativeComputerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private serial<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(botId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.tails.set(botId, next.catch(() => undefined));
    return next;
  }

  private async call<T>(botId: string, operation: BridgeOperation, payload: Record<string, unknown> = {}): Promise<T> {
    const bridge = descriptor(this.options.descriptorPath);
    const response = await this.fetchImpl(`${bridge.origin}/v1/computer`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${botCapability(bridge.secret, bridge.workspaceId, botId)}`,
        "content-type": "application/json",
        "x-bizos-workspace": bridge.workspaceId,
        "x-bizos-bot": botId,
      },
      body: JSON.stringify({ operation, ...payload }),
      signal: AbortSignal.timeout(operation === "download" ? 120_000 : 30_000),
    });
    const text = await response.text();
    let row: Record<string, unknown> = {};
    try {
      const parsed = text ? JSON.parse(text) as unknown : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) row = parsed as Record<string, unknown>;
    } catch { /* bounded error below */ }
    if (!response.ok || row.ok !== true) throw new Error(typeof row.error === "string" ? row.error.slice(0, 300) : `The desktop computer bridge refused the request (${response.status}).`);
    return row.result as T;
  }

  has(botId: string): boolean { return (this.states.get(botId)?.status ?? "none") !== "none"; }
  state(botId: string): ComputerState { return this.states.get(botId) ?? EMPTY; }

  async start(botId: string): Promise<ComputerState> {
    return this.serial(botId, async () => {
      const state = stateOf(await this.call(botId, "start", { workspaceDir: this.options.workspaceFor(botId) }));
      this.states.set(botId, state);
      return state;
    });
  }

  async observe(botId: string): Promise<ComputerObservation> {
    return this.serial(botId, async () => {
      const observation = await this.call<ComputerObservation>(botId, "observe");
      this.states.set(botId, { ...this.state(botId), status: "ready", openUrl: observation.url });
      return observation;
    });
  }

  async act(botId: string, actions: ComputerAction[], observe: boolean, settleMs = 0): Promise<ComputerActionResult> {
    return this.serial(botId, async () => {
      const result = await this.call<ComputerActionResult>(botId, "act", { actions, observe, settleMs });
      if (result.observation) this.states.set(botId, { ...this.state(botId), status: "ready", openUrl: result.observation.url });
      return result;
    });
  }

  download(botId: string, url: string): Promise<ComputerDownloadResult> {
    return this.serial(botId, () => this.call(botId, "download", { url }));
  }

  signedInHosts(botId: string): Promise<string[]> {
    return this.serial(botId, async () => {
      const result = await this.call<unknown>(botId, "signedInHosts");
      return Array.isArray(result) ? result.filter((host): host is string => typeof host === "string").slice(0, 500) : [];
    });
  }

  currentUrl(botId: string): string { return this.state(botId).openUrl ?? ""; }

  capture(botId: string): Promise<CapturedFrame | null> {
    return this.serial(botId, () => this.call<CapturedFrame | null>(botId, "capture"));
  }

  takeControl(botId: string): void {
    this.states.set(botId, { ...this.state(botId), userInControl: true });
    void this.serial(botId, () => this.call<ComputerState>(botId, "takeControl").then((value) => { this.states.set(botId, stateOf(value)); }));
  }

  giveBack(botId: string): void {
    const { userInControl: _ignored, ...state } = this.state(botId);
    this.states.set(botId, state);
    void this.serial(botId, () => this.call<ComputerState>(botId, "giveBack").then((value) => { this.states.set(botId, stateOf(value)); }));
  }

  navigateForUser(botId: string, what: "back" | "forward" | "reload"): void {
    void this.serial(botId, () => this.call(botId, "navigate", { what }));
  }

  history(botId: string): { back: boolean; forward: boolean } { return this.histories.get(botId) ?? { back: false, forward: false }; }

  forwardInput(botId: string, event: Record<string, unknown>): void {
    void this.serial(botId, () => this.call(botId, "input", { event }));
  }

  sleep(botId: string): void {
    this.states.set(botId, { ...this.state(botId), status: "sleeping" });
    void this.serial(botId, () => this.call(botId, "sleep"));
  }

  dispose(botId: string): void {
    this.states.delete(botId);
    this.histories.delete(botId);
    void this.serial(botId, () => this.call(botId, "dispose"));
  }

  disposeAll(): void {
    this.states.clear();
    this.histories.clear();
    void this.call("__workspace__", "disposeAll").catch(() => undefined);
  }
}
