/** A local agent's private Boat computer, reached only through Electron main.
 * The signed installation key and provider key never enter this process. */
import { randomUUID } from "node:crypto";
import type { ContinuityTransport } from "../continuity-bridge.js";
import type { CapturedFrame } from "./host.js";
import type {
  ComputerAction, ComputerActionResult, ComputerDownloadResult, ComputerObservation,
  ComputerState, ManagedComputerBackend,
} from "./types.js";

type ServerObservation = {
  url: string; title: string; text: string;
  elements: Array<{ id: string; tag: string; text?: string; label?: string; href?: string }>;
};
type ServerResult = {
  completed?: number;
  observation?: ServerObservation;
  screenshot?: { mimeType: string; imageBase64: string };
  file?: { path: string; name: string; bytes: number };
  hosts?: string[];
  handoff?: { id: string; status: string };
  computer?: { state: string; provisioned: boolean; lastUsedAt: string | null };
  awake?: boolean;
};

const empty = (): ComputerState => ({ backend: "container", status: "none", apps: [] });

export function serverActions(actions: ComputerAction[]): Array<Record<string, unknown>> {
  return actions.map((action) => {
    if (action.kind === "navigate") return { type: "navigate", url: action.url };
    if (action.kind === "clickSelector") {
      if (!/^e\d{1,4}$/.test(action.selector)) throw new Error("Observe this page again before clicking an element.");
      return { type: "click", elementId: action.selector, button: action.button };
    }
    if (action.kind === "pointer") return { type: action.type === "click" ? "click" : "pointer", phase: action.type, x: action.x, y: action.y, button: action.button };
    if (action.kind === "type") {
      if (action.selector && !/^e\d{1,4}$/.test(action.selector)) throw new Error("Observe this page again before typing into an element.");
      return { type: "type", text: action.text, ...(action.selector ? { elementId: action.selector } : {}) };
    }
    if (action.kind === "key") return { type: "key", key: action.key, modifiers: action.modifiers };
    if (action.kind === "scroll") return { type: "scroll", deltaX: 0, deltaY: (action.direction === "up" ? -1 : 1) * action.amount * 300 };
    if (action.kind === "wait") return { type: "wait", ms: action.ms };
    throw new Error("This computer action is not supported by the server.");
  });
}

export class RemoteServerComputerBackend implements ManagedComputerBackend {
  readonly kind = "container" as const;
  private readonly states = new Map<string, ComputerState>();
  private readonly frames = new Map<string, CapturedFrame>();

  constructor(
    private readonly transport: ContinuityTransport,
    private readonly orgId: () => string | null,
    private readonly workspaceId: () => string,
  ) {}

  private async call(botId: string, op: string, extra: Record<string, unknown> = {}): Promise<ServerResult> {
    const orgId = this.orgId();
    if (!orgId) throw new Error("Link this workspace to a BizOS organization to use Computer.");
    return this.transport<ServerResult>(`computer/${op}`, { orgId, workspaceId: this.workspaceId(), agentId: botId, ...extra });
  }

  private remember(botId: string, result: ServerResult): ComputerObservation {
    const observation = result.observation;
    if (!observation || !result.screenshot || result.screenshot.mimeType !== "image/jpeg"
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.screenshot.imageBase64)) {
      throw new Error("The server returned an invalid computer observation.");
    }
    const imageBase64 = result.screenshot.imageBase64;
    this.frames.set(botId, { full: `data:image/jpeg;base64,${imageBase64}`, thumbnail: `data:image/jpeg;base64,${imageBase64}`, width: 1440, height: 900 });
    this.states.set(botId, {
      backend: "container", status: "ready", apps: [{ id: "browser", open: true }], openUrl: observation.url,
      screen: { previewDataUrl: `data:image/jpeg;base64,${imageBase64}`, capturedAt: new Date().toISOString(), width: 1440, height: 900 },
    });
    return {
      frameId: randomUUID(), capturedAt: new Date().toISOString(), mimeType: "image/jpeg", imageBase64,
      width: 1440, height: 900, url: observation.url, title: observation.title,
      text: observation.text, elements: observation.elements.map(element => ({
        selector: element.id, role: element.tag, label: element.label ?? element.text ?? "",
        ...(element.href ? { href: element.href } : {}), x: 0, y: 0,
      })),
    };
  }

  has(botId: string): boolean { return this.states.has(botId); }
  state(botId: string): ComputerState { return this.states.get(botId) ?? empty(); }
  async start(botId: string): Promise<ComputerState> {
    await this.call(botId, "wake");
    const state: ComputerState = { backend: "container", status: "ready", apps: [{ id: "browser", open: true }] };
    this.states.set(botId, state);
    return state;
  }
  async observe(botId: string): Promise<ComputerObservation> { return this.remember(botId, await this.call(botId, "observe")); }
  async act(botId: string, actions: ComputerAction[], observe: boolean, settleMs = 0): Promise<ComputerActionResult> {
    const converted = serverActions(actions);
    if (settleMs > 0 && converted.length < 24) converted.push({ type: "wait", ms: Math.min(settleMs, 10_000) });
    const result = await this.call(botId, "act", { actions: converted });
    const observation = this.remember(botId, result);
    return { completed: result.completed ?? actions.length, ...(observe ? { observation } : {}) };
  }
  async download(botId: string, url: string): Promise<ComputerDownloadResult> {
    const result = await this.call(botId, "download", { url });
    if (!result.file) throw new Error("The server returned no download receipt.");
    return { path: result.file.path, name: result.file.name, bytes: result.file.bytes };
  }
  async signedInHosts(botId: string): Promise<string[]> {
    const result = await this.call(botId, "signed_in_hosts");
    return Array.isArray(result.hosts) ? result.hosts : [];
  }
  currentUrl(botId: string): string { return this.state(botId).openUrl ?? ""; }
  async capture(botId: string): Promise<CapturedFrame | null> { return this.frames.get(botId) ?? null; }
  takeControl(botId: string): void { this.states.set(botId, { ...this.state(botId), userInControl: true }); }
  giveBack(botId: string): void { this.states.set(botId, { ...this.state(botId), userInControl: false }); }
  navigateForUser(_botId: string, _what: "back" | "forward" | "reload"): void { /* main owns the viewer */ }
  history(_botId: string): { back: boolean; forward: boolean } { return { back: false, forward: false }; }
  forwardInput(_botId: string, _event: Record<string, unknown>): void { /* main owns the viewer */ }
  sleep(botId: string): void { this.states.set(botId, { ...this.state(botId), status: "sleeping" }); }
  dispose(botId: string): void { this.states.delete(botId); this.frames.delete(botId); }
  disposeAll(): void { this.states.clear(); this.frames.clear(); }
  async requestServerHandoff(botId: string, reason: string): Promise<string> {
    const result = await this.call(botId, "request_handoff", { reason });
    if (!result.handoff?.id) throw new Error("The server did not accept the computer handoff.");
    return result.handoff.id;
  }
  async waitForGiveBack(botId: string, handoffId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await new Promise<void>(resolve => setTimeout(resolve, 2_000));
      if (signal.aborted) return;
      const status = await this.call(botId, "status");
      if ((status as ServerResult & { handoff?: { id: string } | null }).handoff?.id !== handoffId) return;
    }
  }
}
