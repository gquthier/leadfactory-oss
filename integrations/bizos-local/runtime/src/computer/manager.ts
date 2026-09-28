import { localComputerEnabled, assertLocalComputerEnabled } from "./release.js";
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
import { randomUUID } from "node:crypto";
import { hostOf, hostsNeedingApproval, hostsTouched } from "./actions.js";
import type { CapturedFrame } from "./host.js";
import { formatObservation } from "./observe.js";
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerControlSession,
  ComputerDownloadResult,
  ComputerObservation,
  ComputerState,
  ManagedComputerBackend,
} from "./types.js";

/** What the manager needs from the turn machinery. Implemented by the harness
 * on top of the Dispatcher; a test implements it in six lines. */
export interface ComputerApprovals {
  /** Is this agent answering somebody right now? */
  hasActiveTurn(requester: ComputerRequester): boolean;
  /** Has the user already said "always" for this agent on this host? */
  isRemembered(botId: string, host: string): boolean;
  /**
   * Put a card in the thread and wait for it.
   *
   * Resolves `true` on allow (once or always), `false` on deny — and on the
   * turn ending underneath it, which is the same thing from here: nothing was
   * agreed to.
   */
  ask(input: { requester: ComputerRequester; host: string }): Promise<boolean>;
  /** Ask the person to take the exact run's seat. Unlike a host approval this
   * can never be remembered, and cancellation is distinct from refusal. */
  requestHandoff(input: { requester: ComputerRequester; reason: string }): Promise<"allowed" | "denied" | "cancelled">;
  /** Keep the run visibly waiting after the person accepts, until Give back. */
  setHandoffWaiting(requester: ComputerRequester, waiting: boolean): void;
}

/** The authority behind an agent computer call. `threadId` and `runId` are
 * mandatory on real tool bridges; optional only for old embedders/tests. */
export interface ComputerRequester {
  botId: string;
  threadId?: string;
  runId?: string;
}
export type ComputerRequesterInput = ComputerRequester | string;

function requesterOf(input: ComputerRequesterInput): ComputerRequester {
  return typeof input === "string" ? { botId: input } : input;
}

export type ComputerHandoffResult = "given_back" | "denied" | "cancelled";

interface PendingHandoff {
  id: string;
  requester: ComputerRequester;
  cancelled: boolean;
  resolve(result: ComputerHandoffResult): void;
  abort?: AbortController;
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
   * whole feature answers `backend: "none"` rather than half-existing.
   *
   * A function is a CHOICE made per call: the cloud computer when a Boat key
   * is configured and the plan allows it, the native one otherwise. `null`
   * from it means there is no computer at all right now. */
  backend?: ManagedComputerBackend | (() => ManagedComputerBackend | null);
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
  private readonly pick: () => ManagedComputerBackend | null;
  private readonly watchers = new Map<string, { cancel(): void }>();
  private readonly frameListeners = new Map<
    string,
    Set<(frame: CapturedFrame, state: ComputerState) => void>
  >();
  private readonly frameTimers = new Map<string, { cancel(): void }>();
  private readonly interval: (fn: () => void, ms: number) => { cancel(): void };
  private readonly provisioned: Set<string>;
  private readonly handoffRequests = new Map<string, ComputerRequester>();
  private readonly handoffs = new Map<string, PendingHandoff>();

  constructor(private readonly options: ComputerManagerOptions) {
    const backend = options.backend;
    this.pick = typeof backend === "function" ? backend : () => backend ?? null;
    this.interval = options.setInterval ?? defaultInterval;
    this.provisioned = new Set(options.provisioned?.read() ?? []);
  }

  /** Whichever machine serves this call. */
  private get backend(): ManagedComputerBackend | null {
    return localComputerEnabled() ? this.pick() : null;
  }

  /** Which kind of machine an agent would get right now. */
  backendKind(): ManagedComputerBackend["kind"] {
    return this.backend?.kind ?? "none";
  }

  /** `none` in a build without Electron, and in the cloud runtime, which has no
   * desktop to run a browser on. The panel says so in one sentence. */
  state(botId: string): ComputerState {
    const backend = this.backend;
    if (!backend) return { backend: "none", status: "none", apps: [] };
    const live = backend.state(botId);
    if (live.status !== "none") return this.withHandoff(botId, live);
    // It exists, it is simply not running: its partition and everything it is
    // signed into are on disk, waiting for the next task.
    if (this.provisioned.has(botId)) {
      return { backend: backend.kind, status: "sleeping", apps: [{ id: "browser", open: false }] };
    }
    return live;
  }

  private withHandoff(botId: string, state: ComputerState): ComputerState {
    const handoff = this.handoffs.get(botId);
    return handoff ? { ...state, userInControl: true, handoffId: handoff.id } : state;
  }

  async setUp(botId: string): Promise<ComputerState> {
    assertLocalComputerEnabled();
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
  private async ensure(requester: ComputerRequester): Promise<ManagedComputerBackend> {
    const { botId } = requester;
    const backend = this.machineFor(requester);
    if (!backend.has(botId)) {
      this.remember(botId);
      await backend.start(botId);
      this.publishStatus(botId);
    }
    assertLocalComputerEnabled();
    // Starting/waking is an await boundary: STOP may have won while the
    // backend came up. Never return a machine to an ended requester.
    if (!this.options.approvals.hasActiveTurn(requester)) {
      throw new Error("This computer only runs while this exact agent run is active.");
    }
    return backend;
  }

  /** A tool call arrived. Everything that can refuse it, refuses it here. */
  private machineFor(requester: ComputerRequester): ManagedComputerBackend {
    assertLocalComputerEnabled();
    const { botId } = requester;
    const backend = this.backend;
    if (!backend) {
      throw new Error("Computers run on the desktop app. This runtime does not have one.");
    }
    if (!this.options.approvals.hasActiveTurn(requester)) {
      throw new Error(
        "This computer only runs while you are answering someone. There is no turn in flight for this agent.",
      );
    }
    return backend;
  }

  async observe(input: ComputerRequesterInput): Promise<{ observation: ComputerObservation; text: string }> {
    const requester = requesterOf(input);
    const { botId } = requester;
    const backend = await this.ensure(requester);
    this.requireAgentControl(backend, requester);
    const observation = await backend.observe(botId);
    // Do not hand a screenshot containing a password/2FA entry back to a
    // model if the person took control while capture was in flight.
    this.requireAgentControl(backend, requester);
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
  async act(input: ComputerRequesterInput, actions: ComputerAction[], observe: boolean, settleMs = 0): Promise<ComputerActionResult> {
    const requester = requesterOf(input);
    const { botId } = requester;
    const backend = await this.ensure(requester);
    this.requireAgentControl(backend, requester);
    const touched = hostsTouched(actions, backend.currentUrl(botId));
    const signedIn = await backend.signedInHosts(botId);
    this.requireAgentControl(backend, requester);
    const needed = hostsNeedingApproval(touched, signedIn, (host) =>
      this.options.approvals.isRemembered(botId, host),
    );
    for (const host of needed) {
      const allowed = await this.options.approvals.ask({ requester, host });
      if (!allowed) {
        throw new Error(`Your user did not allow acting on ${host}. Tell them what you wanted to do there.`);
      }
      this.requireAgentControl(backend, requester);
    }
    this.requireAgentControl(backend, requester);
    const result = await backend.act(botId, actions, observe, settleMs);
    this.publishScreen(botId);
    return result;
  }

  /**
   * Save a file into the agent's own Downloads folder.
   *
   * Same host rule as `act`: fetching from a host the agent is signed in to is
   * fetching something only that account can see.
   */
  async download(input: ComputerRequesterInput, url: string): Promise<ComputerDownloadResult> {
    const requester = requesterOf(input);
    const { botId } = requester;
    const backend = await this.ensure(requester);
    this.requireAgentControl(backend, requester);
    const host = hostOf(url);
    const signedIn = await backend.signedInHosts(botId);
    this.requireAgentControl(backend, requester);
    const needed = hostsNeedingApproval([host], signedIn, (candidate) =>
      this.options.approvals.isRemembered(botId, candidate),
    );
    if (needed.length && !(await this.options.approvals.ask({ requester, host }))) {
      throw new Error(`Your user did not allow downloading from ${host}.`);
    }
    this.requireAgentControl(backend, requester);
    return backend.download(botId, url);
  }

  /** Pause this exact run while the person completes a secret-bearing step.
   * Acceptance takes the backend lease before this promise is exposed as
   * waiting, so no concurrent agent request can slip into the seat. */
  async requestHandoff(input: ComputerRequesterInput, reason: string): Promise<ComputerHandoffResult> {
    const requester = requesterOf(input);
    const { botId } = requester;
    if (!reason.trim() || reason.length > 500) throw new Error("reason must be a short non-empty sentence");
    const backend = await this.ensure(requester);
    if (!this.options.approvals.hasActiveTurn(requester)) {
      throw new Error("This computer only runs while this exact agent run is active.");
    }
    if (backend.state(botId).userInControl) {
      throw new Error("the user still controls this computer; wait for them to give it back");
    }
    if (this.handoffRequests.has(botId) || this.handoffs.has(botId)) {
      throw new Error("this computer already has a human handoff in progress");
    }
    // Block every other tool call before the card is shown. A second request
    // from the same model process cannot click while the person is deciding.
    this.handoffRequests.set(botId, requester);
    let decision: "allowed" | "denied" | "cancelled";
    try {
      decision = await this.options.approvals.requestHandoff({ requester, reason: reason.trim() });
    } catch (error) {
      this.handoffRequests.delete(botId);
      throw error;
    }
    if (decision !== "allowed") {
      this.handoffRequests.delete(botId);
      return decision;
    }
    // STOP or a terminal turn may have won while the answer crossed the
    // process boundary. An old card never opens a fresh lease.
    if (!this.options.approvals.hasActiveTurn(requester)) {
      this.handoffRequests.delete(botId);
      return "cancelled";
    }
    let serverHandoffId: string | null = null;
    try {
      assertLocalComputerEnabled();
      if (backend.requestServerHandoff) {
        serverHandoffId = await backend.requestServerHandoff(botId, reason.trim());
      }
      backend.takeControl(botId);
    } catch (error) {
      this.handoffRequests.delete(botId);
      throw error;
    }
    return new Promise<ComputerHandoffResult>((resolve) => {
      this.handoffRequests.delete(botId);
      const id = serverHandoffId ?? randomUUID();
      const abort = serverHandoffId ? new AbortController() : undefined;
      this.handoffs.set(botId, { id, requester, cancelled: false, resolve, abort });
      this.publishStatus(botId);
      this.options.approvals.setHandoffWaiting(requester, true);
      if (serverHandoffId && backend.waitForGiveBack && abort) {
        const poll = async () => {
          while (!abort.signal.aborted) {
            try {
              await backend.waitForGiveBack!(botId, id, abort.signal);
              if (!abort.signal.aborted) this.giveBack(botId, id);
              return;
            } catch {
              await new Promise<void>(next => setTimeout(next, 2_000));
            }
          }
        };
        void poll();
      }
    });
  }

  private requireAgentControl(backend: ManagedComputerBackend, requester: ComputerRequester): void {
    assertLocalComputerEnabled();
    const { botId } = requester;
    if (!this.options.approvals.hasActiveTurn(requester)) {
      throw new Error("This computer only runs while this exact agent run is active.");
    }
    if (this.handoffRequests.has(botId) || this.handoffs.has(botId) || backend.state(botId).userInControl) {
      throw new Error("the user has taken control of this computer; wait until they give it back");
    }
  }

  // ── the user's side ───────────────────────────────────────────────────

  takeControl(botId: string): ComputerState {
    assertLocalComputerEnabled();
    this.backend?.takeControl(botId);
    return this.state(botId);
  }

  /** Async Take control: wake a sleeping / post-relaunch computer first. */
  async takeControlAsync(botId: string): Promise<ComputerState> {
    await this.wake(botId);
    return this.takeControl(botId);
  }

  /**
   * Take control the live way: wake the seat, then ask the backend for a
   * session the desktop connects to. A backend without one (the native
   * browser) is simply marked as user-driven; its input arrives through
   * `forwardInput`.
   */
  async controlSession(botId: string): Promise<{ state: ComputerState; session: ComputerControlSession | null }> {
    await this.wake(botId);
    const backend = this.backend;
    if (!backend) return { state: this.state(botId), session: null };
    const session = backend.controlSession ? await backend.controlSession(botId) : null;
    if (!session) backend.takeControl(botId);
    this.publishStatus(botId);
    return { state: this.state(botId), session };
  }

  giveBack(botId: string, handoffId?: string): ComputerState {
    assertLocalComputerEnabled();
    const pending = this.handoffs.get(botId);
    if (pending) {
      if (!handoffId || pending.id !== handoffId) {
        throw new Error("this Give back request does not match the current human handoff");
      }
      this.backend?.giveBack(botId);
      pending.abort?.abort();
      this.handoffs.delete(botId);
      if (!pending.cancelled) {
        this.options.approvals.setHandoffWaiting(pending.requester, false);
        pending.resolve("given_back");
      }
    } else {
      if (handoffId) throw new Error("this human handoff is stale");
      this.backend?.giveBack(botId);
    }
    return this.state(botId);
  }

  /** STOP/terminal outcome cancels the waiter, but deliberately leaves the
   * human lease held. Only the owner-facing Give back path releases it. */
  cancelHandoff(runId: string): boolean {
    for (const [botId, requester] of this.handoffRequests) {
      if (requester.runId !== runId) continue;
      this.handoffRequests.delete(botId);
      return true;
    }
    for (const [botId, pending] of this.handoffs) {
      if (pending.requester.runId !== runId) continue;
      // Keep the lease and its id until the person explicitly gives it back.
      // Only the tool waiter is cancelled; a stale run never regains control.
      pending.cancelled = true;
      pending.resolve("cancelled");
      return true;
    }
    return false;
  }

  navigateForUser(botId: string, what: "back" | "forward" | "reload"): void {
    assertLocalComputerEnabled();
    this.backend?.navigateForUser(botId, what);
  }

  history(botId: string): { back: boolean; forward: boolean } {
    return this.backend?.history(botId) ?? { back: false, forward: false };
  }

  forwardInput(botId: string, event: Record<string, unknown>): void {
    assertLocalComputerEnabled();
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

  /** The latest frame of this agent's screen, for the viewer window. */
  async frame(botId: string): Promise<CapturedFrame | null> {
    return (await this.backend?.capture(botId)) ?? null;
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
    if (!localComputerEnabled()) return;
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
    this.handoffRequests.delete(botId);
    const pending = this.handoffs.get(botId);
    if (pending) {
      this.handoffs.delete(botId);
      pending.resolve("cancelled");
    }
    this.watchers.get(botId)?.cancel();
    this.watchers.delete(botId);
    this.frameTimers.get(botId)?.cancel();
    this.frameTimers.delete(botId);
    this.frameListeners.delete(botId);
    this.pick()?.dispose(botId);
  }

  stop(): void {
    this.handoffRequests.clear();
    for (const pending of this.handoffs.values()) pending.resolve("cancelled");
    for (const pending of this.handoffs.values()) pending.abort?.abort();
    this.handoffs.clear();
    for (const watcher of this.watchers.values()) watcher.cancel();
    for (const timer of this.frameTimers.values()) timer.cancel();
    this.watchers.clear();
    this.frameTimers.clear();
    this.frameListeners.clear();
    this.pick()?.disposeAll();
  }
}
