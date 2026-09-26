import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleComputerCall } from "../src/computer/broker.js";
import {
  ComputerManager,
  type ComputerApprovals,
  type ComputerRequester,
} from "../src/computer/manager.js";
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerDownloadResult,
  ComputerObservation,
  ComputerState,
  ManagedComputerBackend,
} from "../src/computer/types.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";

const observation: ComputerObservation = {
  frameId: "frame",
  capturedAt: "2026-09-26T00:00:00.000Z",
  mimeType: "image/jpeg",
  imageBase64: "",
  width: 1280,
  height: 800,
  url: "https://login.example.test/",
  title: "Login",
  elements: [],
  text: "Sign in",
};

class FakeBackend implements ManagedComputerBackend {
  readonly kind = "native" as const;
  readonly controlled = new Set<string>();
  readonly calls: string[] = [];
  signedIn = new Set<string>();
  has(): boolean { return true; }
  async start(botId: string): Promise<ComputerState> { return this.state(botId); }
  state(botId: string): ComputerState {
    return { backend: "native", status: "ready", apps: [], ...(this.controlled.has(botId) ? { userInControl: true } : {}) };
  }
  async observe(botId: string): Promise<ComputerObservation> { this.calls.push(`observe:${botId}`); return observation; }
  async act(botId: string, _actions: ComputerAction[]): Promise<ComputerActionResult> { this.calls.push(`act:${botId}`); return { completed: 1 }; }
  async download(botId: string): Promise<ComputerDownloadResult> { this.calls.push(`download:${botId}`); return { path: "/tmp/x", bytes: 1, name: "x" }; }
  async signedInHosts(): Promise<string[]> { return [...this.signedIn]; }
  currentUrl(): string { return observation.url; }
  async capture() { return null; }
  takeControl(botId: string): void { this.controlled.add(botId); }
  giveBack(botId: string): void { this.controlled.delete(botId); }
  navigateForUser(): void {}
  history() { return { back: false, forward: false }; }
  forwardInput(): void {}
  sleep(): void {}
  dispose(botId: string): void { this.controlled.delete(botId); }
  disposeAll(): void { this.controlled.clear(); }
}

interface Gate {
  approvals: ComputerApprovals;
  answer(runId: string, decision: "allowed" | "denied" | "cancelled"): void;
  active: Set<string>;
  requests: ComputerRequester[];
  waiting: Array<{ runId: string | undefined; waiting: boolean }>;
}

function gate(): Gate {
  const active = new Set(["run_a", "run_b"]);
  const pending = new Map<string, (decision: "allowed" | "denied" | "cancelled") => void>();
  const requests: ComputerRequester[] = [];
  const waiting: Array<{ runId: string | undefined; waiting: boolean }> = [];
  return {
    active,
    requests,
    waiting,
    answer(runId, decision) {
      const settle = pending.get(runId);
      if (!settle) throw new Error(`no pending handoff for ${runId}`);
      pending.delete(runId);
      settle(decision);
    },
    approvals: {
      hasActiveTurn: (requester) => !requester.runId || active.has(requester.runId),
      isRemembered: () => false,
      ask: async () => true,
      requestHandoff: ({ requester }) => {
        requests.push({ ...requester });
        return new Promise((resolve) => pending.set(requester.runId ?? "", resolve));
      },
      setHandoffWaiting: (requester, value) => waiting.push({ runId: requester.runId, waiting: value }),
    },
  };
}

const scope = (botId: string, threadId: string, runId: string): ComputerRequester => ({ botId, threadId, runId });

describe("computer human handoff", () => {
  it("uses the active run's ordinary ask card and never crosses bot/thread identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "lbz-handoff-dispatch-"));
    const turns: CodexTurnInput[] = [];
    const startTurn = (input: CodexTurnInput): CodexTurnHandle => {
      turns.push(input);
      return {
        stop: () => input.onEvent({ type: "turn.completed", ok: false, stopReason: "cancelled" }),
        respond: () => "allowed-once",
        sessionId: () => null,
        settled: () => false,
      };
    };
    const harness = new LocalBizosHarness({
      rootDir: root,
      homeDir: root,
      baseUrl: "",
      readSessionCookie: async () => "",
      orgName: () => "Fixture",
      execPath: "/fake/node",
      packaged: false,
      runAsNodeAvailable: false,
      mcpScriptPath: join(root, "missing-mcp.mjs"),
      environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") },
      devices: false,
      startTurn,
    });
    try {
      const [botA, botB] = await Promise.all([harness.bots.create({ name: "A" }), harness.bots.create({ name: "B" })]);
      const runA = (await harness.threads.send({ botId: botA.id }, { text: "Login" })).runIds[0]!;
      const runB = (await harness.threads.send({ botId: botB.id }, { text: "Other" })).runIds[0]!;
      expect(turns).toHaveLength(2);
      const dispatcher = (harness as unknown as { dispatcher: {
        requestComputerHandoff(input: ComputerRequester & { reason: string }): Promise<"allowed" | "denied" | "cancelled">;
      } }).dispatcher;
      const requested = dispatcher.requestComputerHandoff({ botId: botA.id, threadId: `bot:${botA.id}`, runId: runA, reason: "Complete the CAPTCHA." });
      await Promise.resolve();
      const snapshotA = await harness.threads.get({ botId: botA.id });
      const snapshotB = await harness.threads.get({ botId: botB.id });
      const card = snapshotA.messages.flatMap((message) => message.blocks).find((block) => block.kind === "ask");
      expect(card).toMatchObject({ kind: "ask", runId: runA, tool: "computer_handoff", allowAlways: false, status: "pending" });
      expect(snapshotB.messages.flatMap((message) => message.blocks).some((block) => block.kind === "ask")).toBe(false);
      await expect(dispatcher.requestComputerHandoff({ botId: botA.id, threadId: `bot:${botB.id}`, runId: runB, reason: "Wrong scope" })).resolves.toBe("cancelled");
      await harness.threads.answer({ runId: runA, askId: (card as { askId: string }).askId, answer: { kind: "deny" } });
      await expect(requested).resolves.toBe("denied");
    } finally {
      harness.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isolates two bots/runs and blocks every computer call before acceptance and during human control", async () => {
    const backend = new FakeBackend();
    const approvals = gate();
    const manager = new ComputerManager({ approvals: approvals.approvals, workspaceFor: () => "/tmp", nowIso: () => "now", publish: () => undefined, backend });
    const a = scope("bot_a", "bot:bot_a", "run_a");
    const b = scope("bot_b", "bot:bot_b", "run_b");

    const handoffA = manager.requestHandoff(a, "Please complete the CAPTCHA.");
    const handoffB = manager.requestHandoff(b, "Please enter the 2FA code on screen.");
    await Promise.resolve();
    expect(approvals.requests).toEqual([a, b]);
    await expect(manager.observe(a)).rejects.toThrow("user has taken control");
    expect(backend.calls).toEqual([]);

    approvals.answer("run_a", "denied");
    await expect(handoffA).resolves.toBe("denied");
    await expect(manager.observe(a)).resolves.toMatchObject({ observation: { title: "Login" } });
    await expect(manager.observe(b)).rejects.toThrow("user has taken control");

    approvals.answer("run_b", "allowed");
    await Promise.resolve();
    expect(manager.state("bot_b").userInControl).toBe(true);
    const handoffId = manager.state("bot_b").handoffId;
    expect(handoffId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(manager.act(b, [{ kind: "wait", ms: 1 }], false)).rejects.toThrow("user has taken control");
    manager.giveBack("bot_a");
    expect(manager.state("bot_b").userInControl).toBe(true);
    manager.giveBack("bot_b", handoffId);
    await expect(handoffB).resolves.toBe("given_back");
    expect(approvals.waiting).toEqual([{ runId: "run_b", waiting: true }, { runId: "run_b", waiting: false }]);
  });

  it("cancels an exact run without releasing the human lease or letting a stale Give back resume it", async () => {
    const backend = new FakeBackend();
    const approvals = gate();
    const manager = new ComputerManager({ approvals: approvals.approvals, workspaceFor: () => "/tmp", nowIso: () => "now", publish: () => undefined, backend });
    const a = scope("bot_a", "bot:bot_a", "run_a");
    const handoff = manager.requestHandoff(a, "Please sign in.");
    await Promise.resolve();
    approvals.answer("run_a", "allowed");
    await Promise.resolve();
    const staleHandoffId = manager.state("bot_a").handoffId!;
    approvals.active.delete("run_a");
    expect(manager.cancelHandoff("run_a")).toBe(true);
    await expect(handoff).resolves.toBe("cancelled");
    expect(manager.state("bot_a")).toMatchObject({ userInControl: true, handoffId: staleHandoffId });

    const newer = scope("bot_a", "bot:bot_a", "run_b");
    await expect(manager.requestHandoff(newer, "A newer request.")).rejects.toThrow("still controls");
    manager.giveBack("bot_a", staleHandoffId);
    expect(manager.state("bot_a").userInControl).toBeUndefined();

    const next = manager.requestHandoff(newer, "A newer request.");
    await Promise.resolve();
    approvals.answer("run_b", "allowed");
    await Promise.resolve();
    const newerHandoffId = manager.state("bot_a").handoffId!;
    expect(() => manager.giveBack("bot_a", staleHandoffId)).toThrow("does not match");
    expect(manager.state("bot_a")).toMatchObject({ userInControl: true, handoffId: newerHandoffId });
    manager.giveBack("bot_a", newerHandoffId);
    await expect(next).resolves.toBe("given_back");
  });

  it("does not expose a tool operation that lets the agent release itself", async () => {
    const manager = new ComputerManager({ approvals: gate().approvals, workspaceFor: () => "/tmp", nowIso: () => "now", publish: () => undefined, backend: new FakeBackend() });
    const result = await handleComputerCall(manager, scope("bot_a", "bot:bot_a", "run_a"), { op: "give_back" });
    expect(result).toEqual({ status: 400, payload: { ok: false, error: "unknown computer operation give_back" } });
  });

  it("rechecks the exact run after a host approval so a handoff wins the race before any action", async () => {
    const backend = new FakeBackend();
    backend.signedIn.add("login.example.test");
    const approvals = gate();
    let allowHost!: (allowed: boolean) => void;
    approvals.approvals.ask = () => new Promise((resolve) => { allowHost = resolve; });
    const manager = new ComputerManager({ approvals: approvals.approvals, workspaceFor: () => "/tmp", nowIso: () => "now", publish: () => undefined, backend });
    const a = scope("bot_a", "bot:bot_a", "run_a");

    const oldAction = manager.act(a, [{ kind: "navigate", url: "https://login.example.test/account" }], false);
    await Promise.resolve();
    const handoff = manager.requestHandoff(a, "Please enter the one-time code.");
    await Promise.resolve();
    approvals.answer("run_a", "allowed");
    await Promise.resolve();
    allowHost(true);
    await expect(oldAction).rejects.toThrow("user has taken control");
    expect(backend.calls).not.toContain("act:bot_a");

    const handoffId = manager.state("bot_a").handoffId!;
    manager.giveBack("bot_a", handoffId);
    await expect(handoff).resolves.toBe("given_back");
  });
});
