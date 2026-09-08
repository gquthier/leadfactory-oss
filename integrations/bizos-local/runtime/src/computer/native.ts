// The v1 computer: a browser of the agent's own, on this Mac.
//
// It is not a desktop and does not pretend to be one. What an agent gets is
// (a) a browser with its OWN partition — its own cookies, its own storage, its
// own cache, sharing nothing with the user's Safari or with another agent's
// computer — (b) the workspace folder it already had, and (c) the shell its
// codex harness already had. That is three of the four things Grok Bot's
// "computer" is, and the fourth (a Linux desktop with arbitrary applications)
// needs a container runtime this machine does not have — see `container.ts`,
// which says so rather than faking it.
//
// Every Electron primitive arrives through `ComputerHost`, so what is below is
// the POLICY: where it may go, what it may save, when it sleeps, and what it
// answers when asked for something it will not do.
import { randomBytes } from "node:crypto";
import { hostOf, parseNavigable } from "./actions.js";
import type { AgentBrowser, CapturedFrame, ComputerHost } from "./host.js";
import { clickSelectorScript, formatObservation, pageProbeScript, readProbe, scrollScript, typeIntoScript } from "./observe.js";
import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  SLEEP_AFTER_MS,
  type ComputerAction,
  type ComputerActionResult,
  type ComputerBackend,
  type ComputerDownloadResult,
  type ComputerObservation,
  type ComputerState,
} from "./types.js";

/** The blank page a fresh computer sits on. It is `about:blank` and not a
 * welcome page, because a welcome page is a page: it would have a host, and a
 * host is the unit approvals are keyed on. */
export const BLANK_PAGE = "about:blank";

/** `persist:` so the agent keeps its own logins between runs — that is the
 * whole point of a computer of its own — and one partition per agent so no
 * agent can ever read another's session. */
export function partitionFor(botId: string): string {
  return `persist:agent-${botId}`;
}

export interface NativeBackendOptions {
  host: ComputerHost;
  /** The agent's folder on this Mac; `Downloads` is created inside it. */
  workspaceFor(botId: string): string;
  nowIso(): string;
  now(): number;
  /** Raised with a fresh frame whenever one is worth sending. */
  onFrame?(botId: string, frame: CapturedFrame): void;
  /** Raised whenever `state(botId)` would answer something new. */
  onStateChanged?(botId: string): void;
  /** How long a computer stays up untouched. Injected for the sleep test. */
  sleepAfterMs?: number;
  /** A timer seam, so a test does not wait ten minutes. */
  setTimer?(fn: () => void, ms: number): { cancel(): void };
}

interface Machine {
  browser: AgentBrowser;
  startedAt: number;
  lastUsedAt: number;
  sleeping: boolean;
  userInControl: boolean;
  lastFrame: CapturedFrame | null;
  sleepTimer: { cancel(): void } | null;
  error?: string;
}

const defaultTimer = (fn: () => void, ms: number): { cancel(): void } => {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return { cancel: () => clearTimeout(handle) };
};

export class NativeComputerBackend implements ComputerBackend {
  readonly kind = "native" as const;
  private readonly machines = new Map<string, Machine>();
  private readonly sleepAfterMs: number;
  private readonly timer: (fn: () => void, ms: number) => { cancel(): void };

  constructor(private readonly options: NativeBackendOptions) {
    this.sleepAfterMs = options.sleepAfterMs ?? SLEEP_AFTER_MS;
    this.timer = options.setTimer ?? defaultTimer;
  }

  /** Whether this agent has ever been given a computer. A machine that has
   * gone to sleep still HAS one — that is what `sleeping` means. */
  has(botId: string): boolean {
    return this.machines.has(botId);
  }

  async start(botId: string): Promise<ComputerState> {
    const existing = this.machines.get(botId);
    if (existing && !existing.browser.isDestroyed()) {
      this.touch(botId);
      return this.state(botId);
    }
    try {
      const browser = this.options.host.createBrowser({
        botId,
        partition: partitionFor(botId),
        downloadDir: `${this.options.workspaceFor(botId)}/Downloads`,
      });
      const machine: Machine = {
        browser,
        startedAt: this.options.now(),
        lastUsedAt: this.options.now(),
        sleeping: false,
        userInControl: false,
        lastFrame: null,
        sleepTimer: null,
      };
      this.machines.set(botId, machine);
      browser.onNavigated(() => this.options.onStateChanged?.(botId));
      await browser.loadURL(BLANK_PAGE);
      this.armSleep(botId);
      this.options.onStateChanged?.(botId);
      return this.state(botId);
    } catch (error) {
      this.machines.set(botId, {
        browser: brokenBrowser(),
        startedAt: this.options.now(),
        lastUsedAt: this.options.now(),
        sleeping: false,
        userInControl: false,
        lastFrame: null,
        sleepTimer: null,
        error: error instanceof Error ? error.message : String(error),
      });
      this.options.onStateChanged?.(botId);
      return this.state(botId);
    }
  }

  state(botId: string): ComputerState {
    const machine = this.machines.get(botId);
    if (!machine) return { backend: "native", status: "none", apps: [] };
    if (machine.error) {
      return { backend: "native", status: "error", apps: [], error: machine.error };
    }
    const url = machine.browser.isDestroyed() ? "" : machine.browser.getURL();
    const title = machine.browser.isDestroyed() ? "" : machine.browser.getTitle();
    const onAPage = Boolean(url) && url !== BLANK_PAGE;
    return {
      backend: "native",
      status: machine.sleeping ? "sleeping" : "ready",
      ...(machine.lastFrame
        ? {
            screen: {
              previewDataUrl: machine.lastFrame.thumbnail,
              capturedAt: this.options.nowIso(),
              width: machine.lastFrame.width,
              height: machine.lastFrame.height,
            },
          }
        : {}),
      apps: [
        { id: "browser", open: onAPage, ...(title ? { title } : {}) },
        { id: "files", open: true, title: "Workspace" },
        { id: "terminal", open: true, title: "Shell" },
      ],
      ...(onAPage ? { openUrl: url } : {}),
      ...(machine.userInControl ? { userInControl: true } : {}),
    };
  }

  /** The machine, awake, or a refusal that names what is missing. */
  private require(botId: string): Machine {
    const machine = this.machines.get(botId);
    if (!machine) throw new Error("this agent has no computer yet — set one up from its panel");
    if (machine.error) throw new Error(machine.error);
    if (machine.browser.isDestroyed()) throw new Error("this agent's computer is no longer running");
    machine.sleeping = false;
    this.touch(botId);
    return machine;
  }

  /**
   * The user is driving. The agent is not.
   *
   * This is a lease, not a suggestion: while it is held, every tool call is
   * refused with a sentence that says why. Rakazo calls the same thing an
   * exclusive lease on the viewer, and it exists for the case the whole feature
   * is built around — a password, a 2FA code, a CAPTCHA — where the ONE thing
   * that must not happen is the model watching the keystrokes and acting on
   * what it saw.
   */
  takeControl(botId: string): void {
    const machine = this.require(botId);
    machine.userInControl = true;
    this.options.onStateChanged?.(botId);
  }

  giveBack(botId: string): void {
    const machine = this.machines.get(botId);
    if (!machine) return;
    machine.userInControl = false;
    this.options.onStateChanged?.(botId);
  }

  userHasControl(botId: string): boolean {
    return this.machines.get(botId)?.userInControl === true;
  }

  /** The viewer's own controls. They are the USER's hands, so they are allowed
   * while the user holds control and refused while the agent is working. */
  navigateForUser(botId: string, what: "back" | "forward" | "reload"): void {
    const machine = this.require(botId);
    if (what === "back") machine.browser.goBack();
    else if (what === "forward") machine.browser.goForward();
    else machine.browser.reload();
  }

  /** An input event from the viewer, forwarded to the agent's surface. Only
   * ever accepted while the user holds the lease. */
  forwardInput(botId: string, event: Record<string, unknown>): void {
    const machine = this.require(botId);
    if (!machine.userInControl) throw new Error("take control first");
    machine.browser.sendInputEvent(event);
  }

  async observe(botId: string): Promise<ComputerObservation> {
    const machine = this.require(botId);
    const probe = readProbe(await machine.browser.executeJavaScript(pageProbeScript()));
    const frame = await this.captureInto(botId, machine);
    return {
      frameId: randomBytes(8).toString("hex"),
      capturedAt: this.options.nowIso(),
      mimeType: "image/jpeg",
      imageBase64: frame ? frame.full.slice(frame.full.indexOf(",") + 1) : "",
      width: frame?.width ?? SCREEN_WIDTH,
      height: frame?.height ?? SCREEN_HEIGHT,
      url: probe.url || machine.browser.getURL(),
      title: probe.title || machine.browser.getTitle(),
      elements: probe.elements,
      text: probe.text,
    };
  }

  async act(botId: string, actions: ComputerAction[], observe: boolean): Promise<ComputerActionResult> {
    const machine = this.require(botId);
    if (machine.userInControl) {
      throw new Error("the user has taken control of this computer; wait until they give it back");
    }
    let completed = 0;
    for (const action of actions) {
      await this.run(machine, action);
      completed += 1;
    }
    await this.captureInto(botId, machine);
    this.options.onStateChanged?.(botId);
    if (!observe) return { completed };
    return { completed, observation: await this.observe(botId) };
  }

  private async run(machine: Machine, action: ComputerAction): Promise<void> {
    switch (action.kind) {
      case "navigate": {
        // Re-checked HERE and not only at parse time: this is the last line
        // before Chromium, and it is the one that has to hold if anything ever
        // reaches `act` without going through `parseComputerActions`.
        if (!parseNavigable(action.url)) throw new Error("that address is not one a computer may open");
        await machine.browser.loadURL(action.url);
        return;
      }
      case "clickSelector": {
        const outcome = (await machine.browser.executeJavaScript(
          clickSelectorScript(action.selector),
        )) as { ok?: boolean; reason?: string };
        if (!outcome?.ok) throw new Error(outcome?.reason ?? "that click did not land on anything");
        return;
      }
      case "pointer": {
        const button = action.button;
        if (action.type === "click") {
          machine.browser.sendInputEvent({ type: "mouseMove", x: action.x, y: action.y });
          machine.browser.sendInputEvent({ type: "mouseDown", x: action.x, y: action.y, button, clickCount: 1 });
          machine.browser.sendInputEvent({ type: "mouseUp", x: action.x, y: action.y, button, clickCount: 1 });
          return;
        }
        const type = action.type === "move" ? "mouseMove" : action.type === "down" ? "mouseDown" : "mouseUp";
        machine.browser.sendInputEvent({ type, x: action.x, y: action.y, button, clickCount: 1 });
        return;
      }
      case "type": {
        if (action.selector) {
          const outcome = (await machine.browser.executeJavaScript(
            typeIntoScript(action.selector, action.text),
          )) as { ok?: boolean; reason?: string };
          if (!outcome?.ok) throw new Error(outcome?.reason ?? "there was nothing there to type into");
          return;
        }
        // No selector: type where the focus already is, one character at a
        // time, which is what a page's own key handlers expect to see.
        for (const character of action.text) {
          machine.browser.sendInputEvent({ type: "char", keyCode: character });
        }
        return;
      }
      case "key": {
        const modifiers = action.modifiers;
        machine.browser.sendInputEvent({ type: "keyDown", keyCode: action.key, modifiers });
        machine.browser.sendInputEvent({ type: "keyUp", keyCode: action.key, modifiers });
        return;
      }
      case "scroll": {
        await machine.browser.executeJavaScript(scrollScript(action.direction, action.amount));
        return;
      }
      case "wait": {
        await new Promise<void>((resolve) => {
          const handle = setTimeout(resolve, action.ms);
          handle.unref?.();
        });
        return;
      }
    }
  }

  async download(botId: string, url: string): Promise<ComputerDownloadResult> {
    const machine = this.require(botId);
    if (!parseNavigable(url)) throw new Error("a computer can only download from an http(s) address");
    const outcome = await machine.browser.download(url);
    return outcome;
  }

  async signedInHosts(botId: string): Promise<string[]> {
    if (!this.machines.has(botId)) return [];
    return this.options.host.cookieHosts(partitionFor(botId));
  }

  /** The current URL, for the approval rule: acting on a page acts on the host
   * that page is on. */
  currentUrl(botId: string): string {
    const machine = this.machines.get(botId);
    if (!machine || machine.browser.isDestroyed()) return "";
    return machine.browser.getURL();
  }

  currentHost(botId: string): string {
    return hostOf(this.currentUrl(botId));
  }

  /** What the viewer's two arrows should look like. */
  history(botId: string): { back: boolean; forward: boolean } {
    const machine = this.machines.get(botId);
    if (!machine || machine.error || machine.browser.isDestroyed()) return { back: false, forward: false };
    return { back: machine.browser.canGoBack(), forward: machine.browser.canGoForward() };
  }

  /** Take a frame now — what the panel's 1 fps clock and every action ask for. */
  async capture(botId: string): Promise<CapturedFrame | null> {
    const machine = this.machines.get(botId);
    if (!machine || machine.error || machine.browser.isDestroyed()) return null;
    return this.captureInto(botId, machine);
  }

  private async captureInto(botId: string, machine: Machine): Promise<CapturedFrame | null> {
    const frame = await machine.browser.capture();
    if (!frame) return machine.lastFrame;
    machine.lastFrame = frame;
    this.options.onFrame?.(botId, frame);
    return frame;
  }

  private touch(botId: string): void {
    const machine = this.machines.get(botId);
    if (!machine) return;
    machine.lastUsedAt = this.options.now();
    if (machine.sleeping) {
      machine.sleeping = false;
      this.options.onStateChanged?.(botId);
    }
    this.armSleep(botId);
  }

  /** Sleep is a STATE, not a teardown: the partition, the page and the login
   * survive it, and the next task wakes the machine where it left off. Rakazo
   * sleeps after ten minutes and so does this. */
  private armSleep(botId: string): void {
    const machine = this.machines.get(botId);
    if (!machine) return;
    machine.sleepTimer?.cancel();
    machine.sleepTimer = this.timer(() => this.sleep(botId), this.sleepAfterMs);
  }

  sleep(botId: string): void {
    const machine = this.machines.get(botId);
    if (!machine || machine.sleeping) return;
    machine.sleeping = true;
    machine.sleepTimer?.cancel();
    machine.sleepTimer = null;
    this.options.onStateChanged?.(botId);
  }

  dispose(botId: string): void {
    const machine = this.machines.get(botId);
    if (!machine) return;
    machine.sleepTimer?.cancel();
    machine.browser.destroy();
    this.machines.delete(botId);
    this.options.onStateChanged?.(botId);
  }

  disposeAll(): void {
    for (const botId of [...this.machines.keys()]) this.dispose(botId);
  }
}

/** Stands in for a browser that never came up, so `state()` can answer `error`
 * with a sentence instead of throwing on every field. */
function brokenBrowser(): AgentBrowser {
  const dead = (): never => {
    throw new Error("this agent's computer failed to start");
  };
  return {
    loadURL: async () => dead(),
    getURL: () => "",
    getTitle: () => "",
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => undefined,
    goForward: () => undefined,
    reload: () => undefined,
    executeJavaScript: async () => dead(),
    sendInputEvent: () => undefined,
    capture: async () => null,
    onFrame: () => undefined,
    onNavigated: () => undefined,
    download: async () => dead(),
    isDestroyed: () => true,
    destroy: () => undefined,
  };
}

export { formatObservation };
