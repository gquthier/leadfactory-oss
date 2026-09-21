import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { cronForTrigger, triggerFromToolInput } from "../src/routines-public.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";

const roots: string[] = [];
const harnesses: LocalBizosHarness[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lbz-routine-integrity-"));
  roots.push(root);
  const turns: CodexTurnInput[] = [];
  const broker = new LocalTeamBroker();
  let facade: CollaborationFacade | undefined;
  const harness = new LocalBizosHarness({
    rootDir: root,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Routine fixture",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: join(root, "disabled-cloud-mcp.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") },
    devices: false,
    localTeamTools: ({ bot, threadId, runId }) => {
      const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId }));
      return [{
        name: "schedule_routine",
        description: "Schedule a fixture routine.",
        inputSchema: { type: "object", properties: {} },
        call: (raw) => {
          if (!facade) throw new Error("fixture facade is not ready");
          return facade.scheduleRoutine(() => broker.authorize(session), raw);
        },
      }];
    },
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      return {
        stop: () => input.onEvent({ type: "turn.completed", ok: false, stopReason: "interrupted" }),
        respond: () => "allowed-once",
        sessionId: () => null,
        settled: () => false,
      };
    },
  });
  harnesses.push(harness);
  facade = new CollaborationFacade(harness, "fixture", broker);
  return { harness, broker, facade, turns };
}

async function activeRun(f: ReturnType<typeof fixture>) {
  const bot = await f.harness.bots.create({ name: "Scheduler" });
  const sent = await f.harness.threads.send({ botId: bot.id }, { text: "Keep this turn open." });
  const runId = sent.runIds[0];
  if (!runId) throw new Error("fixture did not start a run");
  const run = await f.harness.runs.get(runId);
  if (!run) throw new Error("fixture run is missing");
  const session = f.broker.exchange(f.broker.issue({ botId: bot.id, threadId: run.threadId, runId }));
  return { bot, run, runId, session, capability: f.broker.authorize(session) };
}

const scheduleInput = {
  name: "Follow up",
  prompt: "Prepare the follow-up.",
  frequency: "interval",
  every_minutes: 5,
};

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("routine authorization and ownership", () => {
  it("refuses an accepted schedule request when STOP revokes it in the mutation queue", async () => {
    const f = fixture();
    const active = await activeRun(f);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (f.facade as unknown as { mutationTail: Promise<unknown> }).mutationTail = gate;

    const pending = f.facade.scheduleRoutine(() => f.broker.authorize(active.session), scheduleInput);
    await Promise.resolve();
    f.broker.revoke(active.runId);
    await f.harness.threads.stop({ botId: active.bot.id });
    release();

    await expect(pending).rejects.toThrow(/invalid|expired|active/i);
    expect(await f.harness.routines.list()).toEqual([]);
  });

  it("rechecks STOP after the initial run check when owner lookup has yielded", async () => {
    const f = fixture();
    const active = await activeRun(f);
    let ownerLookupStarted!: () => void;
    let releaseOwnerLookup!: () => void;
    const started = new Promise<void>((resolve) => { ownerLookupStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseOwnerLookup = resolve; });
    const internals = f.facade as unknown as {
      handlers: Record<string, (args: unknown[]) => Promise<unknown>>;
    };
    const listBots = internals.handlers["lbz:bots:list"];
    if (!listBots) throw new Error("fixture has no bots:list handler");
    internals.handlers["lbz:bots:list"] = async (args) => {
      ownerLookupStarted();
      await gate;
      return listBots(args);
    };

    const pending = f.facade.scheduleRoutine(() => f.broker.authorize(active.session), scheduleInput);
    await started;
    f.broker.revoke(active.runId);
    await f.harness.threads.stop({ botId: active.bot.id });
    releaseOwnerLookup();

    await expect(pending).rejects.toThrow(/invalid|expired|active/i);
    expect(await f.harness.routines.list()).toEqual([]);
  });

  it("commits an authorized Codex dynamic-tool request and keeps the routine executable", async () => {
    const f = fixture();
    const active = await activeRun(f);
    const tool = f.turns[0]?.dynamicTools?.find((candidate) => candidate.name === "schedule_routine");
    if (!tool) throw new Error("fixture did not mount the Codex schedule tool");
    const result = await tool.call(scheduleInput) as { routine: { id: string } };

    expect(await f.harness.routines.list()).toHaveLength(1);
    const started = await f.harness.routines.runNow(result.routine.id);
    expect((await f.harness.runs.get(started.runId))?.botId).toBe(active.bot.id);
  });

  it("refuses terminal and mismatched source runs even while a session can still authorize", async () => {
    const terminal = fixture();
    const active = await activeRun(terminal);
    terminal.turns[0]?.onEvent({ type: "turn.completed", ok: true, stopReason: null });
    await expect(terminal.facade.scheduleRoutine(
      () => terminal.broker.authorize(active.session),
      scheduleInput,
    )).rejects.toThrow(/active/i);
    expect(await terminal.harness.routines.list()).toEqual([]);

    const mismatched = fixture();
    const live = await activeRun(mismatched);
    for (const capability of [
      { botId: "bot_wrong", threadId: live.run.threadId, runId: live.runId },
      { botId: live.bot.id, threadId: "bot:wrong", runId: live.runId },
      { botId: live.bot.id, threadId: live.run.threadId, runId: "run_wrong" },
    ]) {
      const session = mismatched.broker.exchange(mismatched.broker.issue(capability));
      await expect(mismatched.facade.scheduleRoutine(
        () => mismatched.broker.authorize(session),
        scheduleInput,
      )).rejects.toThrow(/match|scope/i);
    }
    expect(await mismatched.harness.routines.list()).toEqual([]);
  });

  it("validates the resulting owner before create or update and leaves rejected updates untouched", async () => {
    const f = fixture();
    const first = await f.harness.bots.create({ name: "First" });
    const second = await f.harness.bots.create({ name: "Second" });
    await expect(f.harness.routines.create({
      botId: "bot_missing",
      name: "Missing",
      prompt: "Never runs",
      trigger: { kind: "schedule", frequency: "interval", everyMinutes: 5 },
      enabled: true,
    })).rejects.toThrow(/owner|agent|bot/i);

    const routine = await f.harness.routines.create({
      botId: first.id,
      name: "Valid",
      prompt: "Run",
      trigger: { kind: "schedule", frequency: "interval", everyMinutes: 5 },
      enabled: true,
    });
    const before = await f.harness.routines.list();
    await expect(f.harness.routines.update(routine.id, { botId: "bot_missing" })).rejects.toThrow(/owner|agent|bot/i);
    expect(await f.harness.routines.list()).toEqual(before);

    await f.harness.bots.update(second.id, { archived: true });
    await expect(f.harness.routines.update(routine.id, { botId: second.id })).rejects.toThrow(/active|archived|owner/i);
    expect(await f.harness.routines.list()).toEqual(before);
  });

  it("reassigns to an eligible owner and executes under that identity", async () => {
    const f = fixture();
    const first = await f.harness.bots.create({ name: "First" });
    const second = await f.harness.bots.create({ name: "Second" });
    const routine = await f.harness.routines.create({
      botId: first.id,
      name: "Valid",
      prompt: "Run",
      trigger: { kind: "schedule", frequency: "interval", everyMinutes: 5 },
      enabled: true,
    });
    await f.harness.routines.update(routine.id, { botId: second.id });
    const started = await f.harness.routines.runNow(routine.id);
    expect((await f.harness.runs.get(started.runId))?.botId).toBe(second.id);
  });
});

describe("routine interval contract", () => {
  it("rejects unsupported boundaries instead of silently clamping them", async () => {
    for (const every_minutes of [1, 4, 10_081]) {
      expect(() => triggerFromToolInput({ frequency: "interval", every_minutes })).toThrow(/5.*10080/);
    }
    expect(triggerFromToolInput({ frequency: "interval", every_minutes: 5 })).toMatchObject({ everyMinutes: 5 });
    expect(triggerFromToolInput({ frequency: "interval", every_minutes: 10_080 })).toMatchObject({ everyMinutes: 10_080 });

    const f = fixture();
    const owner = await f.harness.bots.create({ name: "Owner" });
    for (const everyMinutes of [1, 4, 10_081]) {
      await expect(f.harness.routines.create({
        botId: owner.id,
        name: `Invalid ${everyMinutes}`,
        prompt: "Must be rejected",
        trigger: { kind: "schedule", frequency: "interval", everyMinutes },
      })).rejects.toThrow(/invalid routine trigger/i);
    }
    for (const everyMinutes of [5, 10_080]) {
      await expect(f.harness.routines.create({
        botId: owner.id,
        name: `Valid ${everyMinutes}`,
        prompt: "Must be accepted",
        trigger: { kind: "schedule", frequency: "interval", everyMinutes },
      })).resolves.toMatchObject({ trigger: { everyMinutes } });
    }
  });

  it("describes relative intervals truthfully", () => {
    expect(cronForTrigger({ kind: "schedule", frequency: "interval", everyMinutes: 40 })).toBe("every 40 minutes");
    expect(cronForTrigger({ kind: "schedule", frequency: "interval", everyMinutes: 120 })).toBe("every 120 minutes");
  });
});
