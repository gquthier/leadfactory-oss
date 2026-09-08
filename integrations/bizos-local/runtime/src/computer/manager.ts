// The rules ABOVE the machine: when an agent may touch it, when the user is
// asked first, and who gets told what changed.
//
// The backend knows how to click. This file knows whether clicking is allowed,
// and it is where the three sentences of the security story live:
//
//   1. **No action without a turn.** A computer is a thing an agent uses while
//      it is answering somebody. Outside a turn there is no user watching, no
//      thread the action would appear in, and no card anybody would see — so a
//      tool call arriving then is refused. That also bounds what a leaked
//      broker token is worth: nothing, until the user speaks to that agent.
//   2. **A session cookie is a password.** Acting on a host this agent's
//      partition holds cookies for is acting AS the user on an account they
//      logged into by hand. It raises a card — "Allow Vega to act on
//      github.com?" — with the ordinary three answers, and `Always allow` is
//      remembered against `(bot, host)` in the SAME store as every other
//      standing approval, so Settings → Approvals already lists it and
//      `bots.clearApprovals` already revokes it.
//   3. **The user's screen is never captured.** The only surface this process
//      can capture is the agent's own offscreen one (see `host.ts`).
import { hostOf, hostsNeedingApproval, hostsTouched } from "./actions.js";
import type { CapturedFrame } from "./host.js";
import { formatObservation } from "./observe.js";
import { NativeComputerBackend } from "./native.js";
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerDownloadResult,
  ComputerObservation,
  ComputerState,
} from "./types.js";

/** What the manager needs from the turn machinery. Implemented by the harness
 * on top of the Dispatcher; a test implements it in six lines. */
export interface ComputerApprovals {
  /** Is this agent answering somebody right now? */
  hasActiveTurn(botId: string): boolean;
  /** Has the user already said "always" for this agent on this host? */
  isRemembered(botId: string, host: string): boolean;
  /**
   * Put a card in the thread and wait for it.
   *
   * Resolves `true` on allow (once or always), `false` on deny — and on the
   * turn ending underneath it, which is the same thing from here: nothing was
   * agreed to.
   */
  ask(input: { botId: string; host: string }): Promise<boolean>;
}

/** What the renderer is told. `computer.status` and `computer.screen` are the
 * two names from the spec; they travel on their own channel rather than through
 * the thread reducer, because a frame a second has nothing to do with a
 * transcript and would re-render one on every tick. */
export type ComputerEvent =
  | { kind: "computer.status"; botId: string; state: ComputerState }
  | { kind: "computer.screen"; botId: string; state: ComputerState };

export interface ComputerManagerOptions {
  approvals: ComputerApprovals;
  workspaceFor(botId: string): string;
  nowIso(): string;
  now?(): number;
  publish(event: ComputerEvent): void;
  /** Built in `application.ts`. Absent in a build with no Electron — then the
   * whole feature answers `backend: "none"` rather than half-existing. */
  backend?: NativeComputerBackend;
  /** The 1 fps clock the panel turns on. Injected for tests. */
  setInterval?(fn: () => void, ms: number): { cancel(): void };
  /**
   * Which agents have a computer, across restarts.
   *
   * A partition survives a quit — that is what `persist:` means, and it is what
   * makes a computer worth having — but the running browser does not. Without
   * this, an agent that had logged into a site came back as "doesn't have a
   * computer yet" while its cookies were still on disk, which is the panel
   * telling the user something that is not true.
   */
  provisioned?: { read(): string[]; write(botIds: string[]): void };
}

/** The panel's refresh rate while it is on screen. */
export const WATCH_INTERVAL_MS = 1000;
/** The "Open" window's refresh rate. A person driving a page needs to see the
 * cursor land; a thumbnail does not. */
export const VIEWER_INTERVAL_MS = 250;

const defaultInterval = (fn: () => void, ms: number): { cancel(): void } => {
  const handle = setInterval(fn, ms);
  handle.unref?.();
  return { cancel: () => clearInterval(handle) };
};

export class ComputerManager {
  private readonly backend: NativeComputerBackend | null;
  private readonly watchers = new Map<string, { cancel(): void }>();
  private readonly frameListeners = new Map<
    string,
    Set<(frame: CapturedFrame, state: ComputerState) => void>
  >();
  private readonly frameTimers = new Map<string, { cancel(): void }>();
  private readonly interval: (fn: () => void, ms: number) => { cancel(): void };
  private readonly provisioned: Set<string>;

  constructor(private readonly options: ComputerManagerOptions) {
    this.backend = options.backend ?? null;
    this.interval = options.setInterval ?? defaultInterval;
    this.provisioned = new Set(options.provisioned?.read() ?? []);
  }

  /** `none` in a build without Electron, and in the cloud runtime, which has no
   * desktop to run a browser on. The panel says so in one sentence. */
  state(botId: string): ComputerState {
    if (!this.backend) return { backend: "none", status: "none", apps: [] };
    const live = this.backend.state(botId);
    if (live.status !== "none") return live;
    // It exists, it is simply not running: its partition and everything it is
    // signed into are on disk, waiting for the next task.
    if (this.provisioned.has(botId)) {
      return { backend: "native", status: "sleeping", apps: [{ id: "browser", open: false }] };
    }
    return live;
  }

  async setUp(botId: string): Promise<ComputerState> {
    if (!this.backend) return this.state(botId);
    this.remember(botId);
    this.publishStatus(botId);
    const state = await this.backend.start(botId);
    this.publishStatus(botId);
    return state;
  }

  /**
   * Bring the agent's browser up for the USER — Open / Take control.
   *
   * Unlike a tool call, this does not need a turn in flight: the human is
   * looking at the screen, and a quit leaves every provisioned computer in
   * `sleeping` with no process behind it. Opening an empty window was the
   * lie; waking first is the fix. Cookies stay in `persist:agent-<id>`.
   * Same path as Set up when the machine was never started this process.
   */
  async wake(botId: string): Promise<ComputerState> {
    return this.setUp(botId);
  }

  private remember(botId: string): void {
    if (this.provisioned.has(botId)) return;
    this.provisioned.add(botId);
    this.options.provisioned?.write([...this.provisioned]);
  }

  /** The agent has (or is about to have) a running machine. */
  private async ensure(botId: string): Promise<NativeComputerBackend> {
    const backend = this.machineFor(botId);
    if (!backend.has(botId)) {
      this.remember(botId);
      await backend.start(botId);
      this.publishStatus(botId);
    }
    return backend;
  }

  /** A tool call arrived. Everything that can refuse it, refuses it here. */
  private machineFor(botId: string): NativeComputerBackend {
    if (!this.backend) {
      throw new Error("Computers run on the desktop app. This runtime does not have one.");
    }
    if (!this.options.approvals.hasActiveTurn(botId)) {
      throw new Error(
        "This computer only runs while you are answering someone. There is no turn in flight for this agent.",
      );
    }
    return this.backend;
  }

  async observe(botId: string): Promise<{ observation: ComputerObservation; text: string }> {
    const backend = await this.ensure(botId);
    const observation = await backend.observe(botId);
    this.publishScreen(botId);
    return { observation, text: formatObservation(observation) };
  }

  /**
   * Do something, once the user has agreed to whatever needs agreeing to.
   *
   * The hosts are computed BEFORE anything runs: the current page (because a
   * click acts on where the page already is) plus every host the batch would
   * navigate to. Each one that this agent holds cookies for, and that is not
   * already remembered, gets its own card — in order, so the user is never
   * shown two questions at once and never agrees to a host by agreeing to
   * another.
   */
  async act(botId: string, actions: ComputerAction[], observe: boolean): Promise<ComputerActionResult> {
    const backend = await this.ensure(botId);
    const touched = hostsTouched(actions, backend.currentUrl(botId));
    const signedIn = await backend.signedInHosts(botId);
    const needed = hostsNeedingApproval(touched, signedIn, (host) =>
      this.options.approvals.isRemembered(botId, host),
    );
    for (const host of needed) {
      const allowed = await this.options.approvals.ask({ botId, host });
      if (!allowed) {
        throw new Error(`Your user did not allow acting on ${host}. Tell them what you wanted to do there.`);
      }
    }
    const result = await backend.act(botId, actions, observe);
    this.publishScreen(botId);
    return result;
  }

  /**
   * Save a file into the agent's own Downloads folder.
   *
   * Same host rule as `act`: fetching from a host the agent is signed in to is
   * fetching something only that account can see.
   */
  async download(botId: string, url: string): Promise<ComputerDownloadResult> {
    const backend = await this.ensure(botId);
    const host = hostOf(url);
    const signedIn = await backend.signedInHosts(botId);
    const needed = hostsNeedingApproval([host], signedIn, (candidate) =>
      this.options.approvals.isRemembered(botId, candidate),
    );
    if (needed.length && !(await this.options.approvals.ask({ botId, host }))) {
      throw new Error(`Your user did not allow downloading from ${host}.`);
    }
    return backend.download(botId, url);
  }

  // ── the user's side ───────────────────────────────────────────────────

  takeControl(botId: string): ComputerState {
    this.backend?.takeControl(botId);
    return this.state(botId);
  }

  /** Async Take control: wake a sleeping / post-relaunch computer first. */
  async takeControlAsync(botId: string): Promise<ComputerState> {
    await this.wake(botId);
    return this.takeControl(botId);
  }

  giveBack(botId: string): ComputerState {
    this.backend?.giveBack(botId);
    return this.state(botId);
  }

  navigateForUser(botId: string, what: "back" | "forward" | "reload"): void {
    this.backend?.navigateForUser(botId, what);
  }

  history(botId: string): { back: boolean; forward: boolean } {
    return this.backend?.history(botId) ?? { back: false, forward: false };
  }

  forwardInput(botId: string, event: Record<string, unknown>): void {
    this.backend?.forwardInput(botId, event);
  }

  /**
   * The panel is on screen: refresh its thumbnail once a second.
   *
   * Off screen, nothing ticks — the frames are only ever taken when an action
   * happens. A capture is not free, and a panel nobody is looking at is a
   * capture nobody sees.
   */
  watch(botId: string, on: boolean): void {
    this.watchers.get(botId)?.cancel();
    this.watchers.delete(botId);
    if (!on || !this.backend) return;
    this.watchers.set(
      botId,
      this.interval(() => {
        void this.backend?.capture(botId).then(() => this.publishScreen(botId));
      }, WATCH_INTERVAL_MS),
    );
  }

  publishStatus(botId: string): void {
    this.options.publish({ kind: "computer.status", botId, state: this.state(botId) });
  }

  private publishScreen(botId: string): void {
    this.options.publish({ kind: "computer.screen", botId, state: this.state(botId) });
  }

  /**
   * The "Open" window's frame feed.
   *
   * A viewer wants the screen at a rate a person reads as live, not once a
   * second; the panel's thumbnail does not. So they are two clocks, refcounted
   * per agent, and the FULL frame only ever leaves this process towards a
   * window the user opened themselves.
   */
  subscribeFrames(botId: string, listener: (frame: CapturedFrame, state: ComputerState) => void): () => void {
    const listeners = this.frameListeners.get(botId) ?? new Set<(frame: CapturedFrame, state: ComputerState) => void>();
    listeners.add(listener);
    this.frameListeners.set(botId, listeners);
    if (!this.frameTimers.has(botId)) {
      this.frameTimers.set(
        botId,
        this.interval(() => {
          void this.backend?.capture(botId);
        }, VIEWER_INTERVAL_MS),
      );
    }
    void this.backend?.capture(botId);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      this.frameTimers.get(botId)?.cancel();
      this.frameTimers.delete(botId);
      this.frameListeners.delete(botId);
    };
  }

  /** Handed to the backend as `onFrame`: one capture, fanned out to whoever is
   * watching. */
  onFrame(botId: string, frame: CapturedFrame): void {
    const listeners = this.frameListeners.get(botId);
    if (!listeners?.size) return;
    const state = this.state(botId);
    for (const listener of listeners) listener(frame, state);
  }

  /** The bot is gone. Its computer goes with it — including the fact that it
   * ever had one, which is what stops a reused id from inheriting a stranger's
   * logged-in browser. The partition itself is cleared by the caller that owns
   * the workspace, on the same path that deletes the transcript. */
  forget(botId: string): void {
    this.dispose(botId);
    if (!this.provisioned.delete(botId)) return;
    this.options.provisioned?.write([...this.provisioned]);
  }

  dispose(botId: string): void {
    this.watchers.get(botId)?.cancel();
    this.watchers.delete(botId);
    this.frameTimers.get(botId)?.cancel();
    this.frameTimers.delete(botId);
    this.frameListeners.delete(botId);
    this.backend?.dispose(botId);
  }

  stop(): void {
    for (const watcher of this.watchers.values()) watcher.cancel();
    for (const timer of this.frameTimers.values()) timer.cancel();
    this.watchers.clear();
    this.frameTimers.clear();
    this.frameListeners.clear();
    this.backend?.disposeAll();
  }
}
