import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalBizosHarness, PERMISSION_REVOCATION_FILE } from "../src/harness/harness.js";
import type { CodexTurnInput } from "../src/harness/codex-driver.js";
import type { Dispatcher } from "../src/harness/dispatch.js";

const processes = vi.hoisted(() => ({ drained: vi.fn<() => Promise<boolean>>() }));
vi.mock("../src/harness/procs.js", async original => ({
  ...await original<object>(), waitForCliShutdown: processes.drained,
}));

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lbz-permissions-")));
  processes.drained.mockReset().mockResolvedValue(true);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function setup() {
  const turns: Array<{ input: CodexTurnInput; stop: ReturnType<typeof vi.fn>; finish: () => void; respond: ReturnType<typeof vi.fn> }> = [];
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Synthetic",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "fake-codex") }, devices: false, linkPreviews: false,
    startTurn: input => {
      let settled = false;
      const stop = vi.fn();
      const respond = vi.fn(() => "allowed-once" as const);
      const finish = () => { settled = true; input.onEvent({ type: "turn.completed", ok: false, stopReason: "interrupted" }); };
      turns.push({ input, stop, finish, respond });
      return { stop, respond, sessionId: () => null, settled: () => settled };
    },
    localTeamTools: () => [],
  });
  const dispatcher = (harness as unknown as { dispatcher: Dispatcher }).dispatcher;
  const start = async (name: string) => {
    const bot = await harness.bots.create({ name });
    const result = await harness.threads.send({ botId: bot.id }, { text: "Synthetic task" });
    return { bot, runId: result.runIds[0]! };
  };
  return { harness, dispatcher, turns, start };
}

const permission = { requestType: "permission", tool: "shell", detail: "fixture-command" } as const;

it("enables bypass only for new turns, leaving native and host approvals pending", async () => {
  const { harness, dispatcher, turns, start } = setup();
  const { bot, runId } = await start("Existing");
  let hostAnswered = false;
  const pending = dispatcher.askLocally({ botId: bot.id, summary: "Synthetic host action", approvalKey: "host-1" }).then(value => { hostAnswered = true; return value; });
  turns[0]!.input.onEvent({ type: "request.opened", requestId: "native-1", requestType: "permission", tool: "shell", summary: "Synthetic command", detail: "fixture-command" });
  const result = await harness.runtime.setPermissions({ permissions: "skip-all" });
  expect(result).toMatchObject({ local: { permissions: "skip-all" }, permissionTransition: { effect: "new-turns", continuingRunIds: [runId], stoppedRunIds: [] } });
  expect(hostAnswered).toBe(false);
  expect(turns[0]!.input.isAlwaysAllowed!(permission)).toBe(false);
  expect(turns[0]!.respond).not.toHaveBeenCalled();
  let newHostAnswered = false;
  const newPending = dispatcher.askLocally({ botId: bot.id, summary: "Another host action", approvalKey: "host-2" }).then(value => { newHostAnswered = true; return value; });
  await Promise.resolve();
  expect(newHostAnswered).toBe(false);
  const next = await start("New");
  expect(turns[1]!.input.skipPermissions).toBe(true);
  await expect(dispatcher.askLocally({ botId: next.bot.id, summary: "New host action", approvalKey: "host-3" })).resolves.toBe(true);
  turns.forEach(turn => turn.finish());
  await expect(pending).resolves.toBe(false);
  await expect(newPending).resolves.toBe(false);
});

it("revokes every bypass mission and waits for run settlement and CLI descendants before confirming", async () => {
  const { harness, turns, start } = setup();
  await harness.runtime.setPermissions({ permissions: "skip-all" });
  const first = await start("First");
  const second = await start("Second");
  const writes = vi.spyOn(harness.storage, "writeJson");
  let drained!: (gone: boolean) => void;
  processes.drained.mockImplementation(() => new Promise(resolve => { drained = resolve; }));
  let confirmed = false;
  const revoking = harness.runtime.setPermissions({ permissions: "ask" }).then(value => { confirmed = true; return value; });
  await vi.waitFor(() => expect(turns.every(turn => turn.stop.mock.calls.length === 1)).toBe(true));
  expect((await harness.runtime.getSettings()).local.permissions).toBe("ask");
  expect(existsSync(join(root, "state", PERMISSION_REVOCATION_FILE))).toBe(true);
  expect(writes.mock.calls.findIndex(([name]) => name === PERMISSION_REVOCATION_FILE)).toBeLessThan(writes.mock.calls.findIndex(([name]) => name === "settings.json"));
  expect(turns[0]!.input.isAlwaysAllowed!(permission)).toBe(false);
  expect(confirmed).toBe(false);
  turns.forEach(turn => turn.finish());
  await Promise.resolve();
  expect(confirmed).toBe(false);
  drained(true);
  await expect(revoking).resolves.toMatchObject({ permissionTransition: { effect: "revoked", continuingRunIds: [], stoppedRunIds: [first.runId, second.runId] } });
  expect(existsSync(join(root, "state", PERMISSION_REVOCATION_FILE))).toBe(false);
  expect((await harness.runs.list({ limit: 10 })).every(run => run.state === "cancelled")).toBe(true);
  expect(turns).toHaveLength(2);
  await harness.threads.send({ botId: first.bot.id }, { text: "Explicit new task" });
  expect(turns[2]!.input.skipPermissions).toBe(false);
  turns[2]!.finish();
});

it("does not approve a pending card or accept a late answer while revocation stops its run", async () => {
  const { harness, turns, start } = setup();
  await harness.runtime.setPermissions({ permissions: "skip-all" });
  const { bot, runId } = await start("Pending");
  turns[0]!.input.onEvent({ type: "request.opened", requestId: "native-1", requestType: "permission", tool: "shell", summary: "Synthetic command", detail: "fixture-command" });
  const card = (await harness.threads.get({ botId: bot.id })).messages.flatMap(message => message.blocks).find(block => block.kind === "ask");
  if (card?.kind !== "ask") throw new Error("missing fixture card");
  const revoking = harness.runtime.setPermissions({ permissions: "ask" });
  await vi.waitFor(() => expect(turns[0]!.stop).toHaveBeenCalledOnce());
  await expect(harness.threads.answer({ runId, askId: card.askId, answer: { kind: "allow_once" } })).rejects.toThrow("no longer open");
  expect(turns[0]!.respond).not.toHaveBeenCalled();
  turns[0]!.finish();
  await revoking;
  expect(turns).toHaveLength(1);
});

it("serializes a later enable behind revocation and fails closed if process shutdown is unverified", async () => {
  const { harness, turns, start } = setup();
  await harness.runtime.setPermissions({ permissions: "skip-all" });
  await start("Failure");
  let drained!: (gone: boolean) => void;
  processes.drained.mockImplementation(() => new Promise(resolve => { drained = resolve; }));
  const revoking = harness.runtime.setPermissions({ permissions: "ask" });
  const rejected = expect(revoking).rejects.toThrow(/could not confirm/i);
  await vi.waitFor(() => expect(turns[0]!.stop).toHaveBeenCalledOnce());
  const enabling = harness.runtime.setPermissions({ permissions: "skip-all" });
  await Promise.resolve();
  expect((await harness.runtime.getSettings()).local.permissions).toBe("ask");
  turns[0]!.finish();
  drained(false);
  await rejected;
  expect(existsSync(join(root, "state", PERMISSION_REVOCATION_FILE))).toBe(true);
  // A failed revocation must be retried successfully before enabling again.
  await expect(enabling).rejects.toThrow(/could not confirm/i);
  expect((await harness.runtime.getSettings()).local.permissions).toBe("ask");
  processes.drained.mockResolvedValue(true);
  await expect(harness.runtime.setPermissions({ permissions: "ask" })).resolves.toMatchObject({ local: { permissions: "ask" } });
  expect(existsSync(join(root, "state", PERMISSION_REVOCATION_FILE))).toBe(false);
});

it("routes legacy settings patches through the same revocation barrier", async () => {
  const { harness, turns, start } = setup();
  await harness.runtime.setSettings({ local: { permissions: "skip-all" } });
  await start("Legacy");
  let confirmed = false;
  const revoking = harness.runtime.setSettings({ local: { permissions: "ask" } }).then(value => { confirmed = true; return value; });
  await vi.waitFor(() => expect(turns[0]!.stop).toHaveBeenCalledOnce());
  expect(confirmed).toBe(false);
  turns[0]!.finish();
  await revoking;
});

it("cancels queued descendants without stopping an unrelated protected run or restarting the mission", async () => {
  const { harness, turns, start } = setup();
  const protectedRun = await start("Protected");
  await harness.runtime.setPermissions({ permissions: "skip-all" });
  const parent = await start("Parent");
  const child = await harness.threads.dispatchChild(
    { botId: parent.bot.id, threadId: `bot:${parent.bot.id}`, runId: parent.runId },
    { botId: protectedRun.bot.id }, { text: "Synthetic child", messageId: "synthetic-child" },
  );
  expect(child.state).toBe("queued");
  const revoking = harness.runtime.setPermissions({ permissions: "ask" });
  await vi.waitFor(() => expect(turns[1]!.stop).toHaveBeenCalledOnce());
  expect(turns[0]!.stop).not.toHaveBeenCalled();
  turns[1]!.finish();
  await expect(revoking).resolves.toMatchObject({ permissionTransition: { stoppedRunIds: [parent.runId], continuingRunIds: [protectedRun.runId] } });
  expect((await harness.runs.get(child.runId))!.state).toBe("cancelled");
  turns[0]!.finish();
  expect(turns).toHaveLength(2);
});

it("reports unconfirmed revocation when a driver ignores STOP, and permits an explicit stop retry", async () => {
  const { harness, turns, start } = setup();
  await harness.runtime.setPermissions({ permissions: "skip-all" });
  await start("Unresponsive");
  vi.useFakeTimers();
  try {
    const revoking = harness.runtime.setPermissions({ permissions: "ask" });
    const rejected = expect(revoking).rejects.toThrow(/could not confirm/i);
    await vi.advanceTimersByTimeAsync(10_020);
    await rejected;
    expect((await harness.runtime.getSettings()).permissionTransition?.effect).toBe("revocation-failed");
    const retry = harness.runtime.setPermissions({ permissions: "ask" });
    await vi.advanceTimersByTimeAsync(0);
    expect(turns[0]!.stop).toHaveBeenCalledTimes(2);
    turns[0]!.finish();
    await vi.advanceTimersByTimeAsync(20);
    await expect(retry).resolves.toMatchObject({ permissionTransition: { effect: "revoked" } });
  } finally { vi.useRealTimers(); }
});

it.each(["{\"version\":1}", "corrupt"])("fails closed after restart with a revocation marker, even before ask was persisted (%s)", async contents => {
  const original = setup();
  await original.harness.runtime.setPermissions({ permissions: "skip-all" });
  // Crash window: durable intent exists but settings still say skip-all.
  writeFileSync(join(root, "state", PERMISSION_REVOCATION_FILE), contents);
  const restarted = setup();
  expect(await restarted.harness.runtime.getSettings()).toMatchObject({ local: { permissions: "ask" }, permissionTransition: { effect: "revocation-failed", manualReviewRequired: true } });
  await expect(restarted.harness.runtime.setPermissions({ permissions: "skip-all" })).rejects.toThrow(/could not confirm/i);
  await expect(restarted.harness.runtime.setPermissions({ permissions: "ask" })).rejects.toThrow(/previous runtime/i);
  expect(processes.drained).not.toHaveBeenCalled();
  expect(existsSync(join(root, "state", PERMISSION_REVOCATION_FILE))).toBe(true);
  const resume = vi.spyOn(restarted.dispatcher, "resumeInterruptedTasks");
  // Startup recovery is real, but account discovery is deliberately disabled.
  vi.spyOn(restarted.harness as unknown as { seedPlansFromMachine(): Promise<void> }, "seedPlansFromMachine").mockResolvedValue();
  try {
    await restarted.harness.start();
    expect(resume).not.toHaveBeenCalled();
  } finally { restarted.harness.stop(); }
});

it("does not create revocation intent for an invalid legacy patch", async () => {
  const { harness } = setup();
  await harness.runtime.setPermissions({ permissions: "skip-all" });
  await expect(harness.runtime.setSettings({ local: { permissions: "ask", model: "not a model id" } })).rejects.toThrow();
  expect(existsSync(join(root, "state", PERMISSION_REVOCATION_FILE))).toBe(false);
  expect((await harness.runtime.getSettings()).local.permissions).toBe("skip-all");
});
