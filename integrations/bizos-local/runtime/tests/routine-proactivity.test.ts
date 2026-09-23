import { mkdtempSync, rmSync } from "node:fs";
import { createServer, get, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixedClock } from "../src/harness/clock.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import {
  Heartbeat,
  heartbeatTaskKey,
  heartbeatWakeFor,
  HEARTBEAT_COOLDOWN_MS,
  type HeartbeatLedger,
} from "../src/harness/heartbeat.js";
import { classifyRoutineReply, routineRunPrompt } from "../src/harness/routine-run.js";
import { computeNextRun } from "../src/harness/scheduler.js";
import type { TaskCheckpoint } from "../src/harness/task.js";
import type { Run } from "../src/harness/types.js";
import { LocalEventHub, serveEventStream, type LocalStreamFrame } from "../src/local-events.js";
import { emptyDurableIndex, normalizeDurableIndex, type DurableIndex } from "../src/sidecar-contract.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";

const INSTANCE = "rtn";
const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const step of cleanup.splice(0).reverse()) step();
});

/** A local-mode harness whose turns the test answers by hand. 10:00 local. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lbz-routine-proactivity-"));
  const clock = fixedClock(new Date(2026, 8, 23, 10, 0, 0).getTime());
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
    clock,
    localTeamTools: ({ bot, threadId, runId }) => {
      const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId }));
      return [{
        name: "schedule_routine",
        description: "fixture",
        inputSchema: { type: "object", properties: {} },
        call: (raw) => facade!.scheduleRoutine(() => broker.authorize(session), raw),
      }];
    },
    localArchitecture: ({ bot, threadId, workspaceDir, sandbox, peers }) => ({
      mode: "local",
      instanceId: INSTANCE,
      workspaceId: `local:${INSTANCE}:workspace`,
      agentId: `local:${INSTANCE}:agent:${bot.id}`,
      threadId: `local:${INSTANCE}:thread:${threadId}`,
      workspaceDir,
      sandbox,
      supportedProviders: ["codex"],
      peers: peers.map((peer) => ({ agentId: `local:${INSTANCE}:agent:${peer.id}`, name: peer.name })),
      recruitment: "autonomous-local-tools",
    }),
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
  const index: DurableIndex = emptyDurableIndex();
  facade = new CollaborationFacade(harness, INSTANCE, broker, index, null, () => undefined);
  const frames: LocalStreamFrame[] = [];
  facade.streams.subscribe((frame) => frames.push(frame));
  cleanup.push(() => {
    harness.stop();
    rmSync(root, { recursive: true, force: true });
  });
  const reply = (turn: CodexTurnInput | undefined, ...texts: string[]) => {
    if (!turn) throw new Error("no turn to answer");
    texts.forEach((text, n) => turn.onEvent({ type: "item.completed", itemType: "assistant_text", text, itemId: `item-${turns.indexOf(turn)}-${n}` }));
    turn.onEvent({ type: "turn.completed", ok: true, stopReason: null });
  };
  return { root, clock, turns, broker, harness, facade: facade!, index, frames, reply };
}

type Fixture = ReturnType<typeof fixture>;

/** Scheduled fires await the session refresh before starting their turn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function routineFor(f: Fixture, input: { endsAt?: string; everyMinutes?: number } = {}) {
  const bot = await f.harness.bots.create({ name: "Watcher" });
  const routine = await f.harness.routines.create({
    botId: bot.id,
    name: "Colis",
    prompt: "Check the parcel status.",
    trigger: { kind: "schedule", frequency: "interval", everyMinutes: input.everyMinutes ?? 10 },
    ...(input.endsAt ? { endsAt: input.endsAt } : {}),
  });
  return { bot, routine };
}

async function botTexts(f: Fixture, botId: string): Promise<string[]> {
  const snapshot = await f.harness.threads.get({ botId });
  return snapshot.messages.filter((message) => message.role === "bot" && message.deliveryState === "complete")
    .flatMap((message) => message.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []));
}

describe("routine replies", () => {
  it("classifies [SILENT] verdicts and strips [DONE]", () => {
    expect(classifyRoutineReply(["[SILENT]"])).toMatchObject({ silent: true, texts: [] });
    expect(classifyRoutineReply(["  [SILENT]\n"])).toMatchObject({ silent: true });
    expect(classifyRoutineReply(["Checking the tracker…", "[SILENT]"])).toMatchObject({ silent: true, texts: [] });
    expect(classifyRoutineReply(["[SILENT]", "[SILENT]"])).toMatchObject({ silent: true });
    expect(classifyRoutineReply(["btw your parcel is out for delivery"])).toEqual({
      silent: false, done: false, texts: ["btw your parcel is out for delivery"],
    });
    expect(classifyRoutineReply(["btw it arrived 📦 [DONE]"])).toEqual({ silent: false, done: true, texts: ["btw it arrived 📦"] });
  });

  it("wraps the intent with continuity and the watch's end, never 'routine triggered'", () => {
    const prompt = routineRunPrompt({
      name: "Colis",
      prompt: "Check the parcel status.",
      previousReport: { text: "x".repeat(3_000), at: "2026-09-23T08:00:00.000Z" },
      endsAt: "2026-09-23T16:00:00.000Z",
    });
    expect(prompt).toContain("Check the parcel status.");
    expect(prompt).toContain("[SILENT]");
    expect(prompt).toMatch(/don't repeat/i);
    expect(prompt).toContain("[DONE]");
    expect(prompt).toMatch(/Never announce/);
    expect(prompt.match(/x+/)?.[0].length).toBeLessThanOrEqual(1_200);
    expect(routineRunPrompt({ name: "n", prompt: "p", endsAt: "2026-09-23T16:00:00.000Z", finalRun: true })).toMatch(/last check/);
  });

  it("publishes nothing for a silent routine run and records outcome silent", async () => {
    const f = fixture();
    const { bot, routine } = await routineFor(f);
    const started = await f.harness.routines.runNow(routine.id);
    expect(f.turns[0]?.text).toMatch(/^\[routine "Colis"\]/);
    f.reply(f.turns[0], "Let me look…", "[SILENT]");

    expect(await botTexts(f, bot.id)).toEqual([]);
    expect(f.index.events).toEqual([]);
    expect(await f.harness.runs.get(started.runId)).toMatchObject({ state: "completed", outcome: "silent" });
    const row = (await f.facade.crons()).items.find((item) => item.id === routine.id)!;
    expect(row.lastRun).toMatchObject({ outcome: "silent" });
    expect((await f.facade.cronRuns(routine.id)).items[0]).toMatchObject({ outcome: "silent", state: "done" });
    // No "Routine: …" line either: a silent routine leaves no public trace
    // (only the turn's private control record, which is never served).
    const page = await f.facade.messagePage(`local:${INSTANCE}:thread:bot:${bot.id}`, new URL("http://x/"));
    expect(page.messages).toEqual([]);
  });

  it("announces a speaking routine with routine.fired sorted before its reply, then carries continuity", async () => {
    const f = fixture();
    const { bot, routine } = await routineFor(f);
    const started = await f.harness.routines.runNow(routine.id);
    f.reply(f.turns[0], "btw your parcel left the depot");

    expect(await botTexts(f, bot.id)).toEqual(["btw your parcel left the depot"]);
    const fired = f.index.events.find((event) => event.type === "routine.fired");
    expect(fired).toMatchObject({
      actorAgentId: `local:${INSTANCE}:agent:${bot.id}`,
      subjectAgentId: `local:${INSTANCE}:agent:${bot.id}`,
      runId: `local:${INSTANCE}:run:${started.runId}`,
      threadId: `local:${INSTANCE}:thread:bot:${bot.id}`,
      changes: { routineId: routine.id, routineName: "Colis", schedule: "every 10 minutes" },
    });
    const message = (await f.harness.threads.get({ botId: bot.id })).messages.at(-1)!;
    expect(fired!.createdAt <= message.createdAt).toBe(true);
    const teamFrame = f.frames.findIndex((frame) => frame.event === "team-event");
    const messageFrame = f.frames.findIndex((frame) => frame.event === "message" && frame.data.messageId.endsWith(message.id));
    expect(teamFrame).toBeGreaterThanOrEqual(0);
    expect(teamFrame).toBeLessThan(messageFrame);
    expect(await f.harness.runs.get(started.runId)).toMatchObject({ outcome: "ok" });

    f.clock.advance(60_000);
    await f.harness.routines.runNow(routine.id);
    expect(f.turns[1]?.text).toContain("btw your parcel left the depot");
    expect(f.turns[1]?.text).toMatch(/don't repeat/i);
  });

  it("ends the routine when its owner reports [DONE]", async () => {
    const f = fixture();
    const { bot, routine } = await routineFor(f);
    await f.harness.routines.runNow(routine.id);
    f.reply(f.turns[0], "btw it's delivered [DONE]");

    expect(await botTexts(f, bot.id)).toEqual(["btw it's delivered"]);
    const row = (await f.facade.crons()).items.find((item) => item.id === routine.id)!;
    expect(row).toMatchObject({ status: "paused", expired: true, nextRunAt: null });
    expect(f.index.events.map((event) => event.type)).toEqual(["routine.fired", "routine.updated"]);
    expect(f.index.events[1]?.changes).toMatchObject({ reason: "ended", enabled: false });
  });
});

describe("self-expiring watches", () => {
  it("never schedules a window at or after endsAt", () => {
    const from = new Date("2026-09-23T10:00:00.000Z");
    const trigger = { kind: "schedule", frequency: "interval", everyMinutes: 30 } as const;
    expect(computeNextRun(trigger, from, "2026-09-23T10:31:00.000Z")?.toISOString()).toBe("2026-09-23T10:30:00.000Z");
    expect(computeNextRun(trigger, from, "2026-09-23T10:30:00.000Z")).toBeNull();
  });

  it("refuses an end in the past, runs until the end, then disables and marks it expired", async () => {
    const f = fixture();
    const bot = await f.harness.bots.create({ name: "Watcher" });
    const now = f.clock.now().getTime();
    await expect(f.harness.routines.create({
      botId: bot.id, name: "Late", prompt: "p",
      trigger: { kind: "schedule", frequency: "interval", everyMinutes: 10 },
      endsAt: new Date(now - 60_000).toISOString(),
    })).rejects.toThrow(/future/);

    const endsAt = new Date(now + 25 * 60_000).toISOString();
    const routine = await f.harness.routines.create({
      botId: bot.id, name: "Deploy", prompt: "Watch the deploy.",
      trigger: { kind: "schedule", frequency: "interval", everyMinutes: 10 }, endsAt,
    });
    (f.harness as unknown as { scheduler: { start(): void } }).scheduler.start();
    expect((await f.facade.crons()).items[0]).toMatchObject({ endsAt, expired: false });

    f.clock.advance(10 * 60_000); // 10:10 → fires
    await settle();
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]?.text).toContain("This watch ends at");
    f.reply(f.turns[0], "[SILENT]");
    f.clock.advance(10 * 60_000); // 10:20 → last window before 10:25
    await settle();
    expect(f.turns).toHaveLength(2);
    expect(f.turns[1]?.text).toMatch(/last check/);
    f.reply(f.turns[1], "btw deploy still pending, stopping the watch");
    f.clock.advance(30 * 60_000);
    await settle();
    expect(f.turns).toHaveLength(2);
    const row = (await f.facade.crons()).items.find((item) => item.id === routine.id)!;
    expect(row).toMatchObject({ status: "paused", expired: true, nextRunAt: null, endsAt });
    const updated = f.index.events.filter((event) => event.type === "routine.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.changes).toMatchObject({ reason: "expired", routineId: routine.id });
    // Re-arming needs a later end.
    await expect(f.facade.patchCron(routine.id, { status: "active" })).rejects.toThrow(/end/i);
    const later = new Date(f.clock.now().getTime() + 60 * 60_000).toISOString();
    expect((await f.facade.patchCron(routine.id, { status: "active", ends_at: later })).item).toMatchObject({ expired: false, endsAt: later, status: "active" });
  });

  it("expires a watch whose end passed while the app was closed, without a late run", async () => {
    const f = fixture();
    await routineFor(f, { endsAt: new Date(f.clock.now().getTime() + 7 * 60_000).toISOString(), everyMinutes: 5 });
    f.clock.advance(60 * 60_000);
    await settle();
    (f.harness as unknown as { scheduler: { stop(): void; start(): void } }).scheduler.stop();
    (f.harness as unknown as { scheduler: { start(): void } }).scheduler.start();
    await settle();
    expect(f.turns).toHaveLength(0);
    expect((await f.facade.crons()).items[0]).toMatchObject({ expired: true, status: "paused" });
  });
});

describe("routine team events and the schedule tool", () => {
  it("records routine.created in the source thread, returns nextRunAt/endsAt, and refuses recursion", async () => {
    const f = fixture();
    const bot = await f.harness.bots.create({ name: "Scheduler" });
    const sent = await f.harness.threads.send({ botId: bot.id }, { text: "Watch my parcel until 18:00." });
    const tool = f.turns[0]?.dynamicTools?.find((candidate) => candidate.name === "schedule_routine");
    const until = new Date(f.clock.now().getTime() + 8 * 60 * 60_000).toISOString();
    const result = await tool!.call({ name: "Colis", prompt: "Check the tracker.", frequency: "interval", every_minutes: 30, until }) as {
      routine: { id: string }; nextRunAt: string; endsAt: string; note: string;
    };
    expect(result.endsAt).toBe(until);
    expect(result.nextRunAt).toBe(new Date(f.clock.now().getTime() + 30 * 60_000).toISOString());
    expect(result.note).toMatch(/one short line/);
    expect(f.index.events).toHaveLength(1);
    expect(f.index.events[0]).toMatchObject({
      type: "routine.created",
      runId: `local:${INSTANCE}:run:${sent.runIds[0]}`,
      threadId: `local:${INSTANCE}:thread:bot:${bot.id}`,
      changes: { routineId: result.routine.id, routineName: "Colis", schedule: "every 30 minutes", endsAt: until, enabled: true },
    });
    f.reply(f.turns[0], "Done — I'll watch it every 30 min until 18:00.");

    await f.harness.routines.runNow(result.routine.id);
    const routineTool = f.turns[1]?.dynamicTools?.find((candidate) => candidate.name === "schedule_routine");
    await expect(routineTool!.call({ name: "Again", prompt: "p", frequency: "interval", every_minutes: 5 }))
      .rejects.toMatchObject({ status: 403, code: "routine_recursion" });
    expect(await f.harness.routines.list()).toHaveLength(1);
  });

  it("records UI edits and deletions in the owner's direct thread with the public 'none' run id", async () => {
    const f = fixture();
    const { bot, routine } = await routineFor(f);
    await f.facade.patchCron(routine.id, { status: "paused" });
    await f.facade.deleteCron(routine.id);
    expect(f.index.events.map((event) => [event.type, event.runId, event.threadId])).toEqual([
      ["routine.updated", `local:${INSTANCE}:run:none`, `local:${INSTANCE}:thread:bot:${bot.id}`],
      ["routine.deleted", `local:${INSTANCE}:run:none`, `local:${INSTANCE}:thread:bot:${bot.id}`],
    ]);
    expect(f.index.events[0]?.changes).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it("persists routine events in the durable index and still reads older indexes", () => {
    const legacy = { ...emptyDurableIndex(), events: [{
      eventId: "e1", type: "agent.updated", actorAgentId: "a", subjectAgentId: "b", runId: "r", threadId: "t",
      createdAt: "2026-09-23T08:00:00.000Z", changes: { name: "X" },
    }] };
    expect(normalizeDurableIndex(JSON.parse(JSON.stringify(legacy))).events).toHaveLength(1);
    const withRoutine = { ...legacy, events: [...legacy.events, {
      eventId: "e2", type: "routine.fired", actorAgentId: "a", subjectAgentId: "a", runId: "r", threadId: "t",
      createdAt: "2026-09-23T08:01:00.000Z",
      changes: { routineId: "rtn_1", routineName: "Colis", schedule: "every 10 minutes", endsAt: null },
    }] };
    expect(normalizeDurableIndex(JSON.parse(JSON.stringify(withRoutine))).events[1]?.type).toBe("routine.fired");
    const broken = { ...legacy, events: [{ ...withRoutine.events[1], changes: { routineName: "no id" } }] };
    expect(() => normalizeDurableIndex(JSON.parse(JSON.stringify(broken)))).toThrow(/team history/);
  });
});

describe("GET /api/local/events stream", () => {
  async function open(hub: LocalEventHub, pingMs: number) {
    const server: Server = createServer((request, response) => {
      if (!serveEventStream(request, response, hub, { pingMs })) {
        response.writeHead(429).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => server.close());
    const port = (server.address() as { port: number }).port;
    const response = await new Promise<IncomingMessage>((resolve) => get({ host: "127.0.0.1", port, path: "/" }, resolve));
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => { body += chunk; });
    const until = async (predicate: () => boolean) => {
      for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      if (!predicate()) throw new Error(`stream never matched; got ${JSON.stringify(body)}`);
    };
    return { response, body: () => body, until };
  }

  it("sends ready, frames and pings, and cleans its listener up on disconnect", async () => {
    const hub = new LocalEventHub();
    const stream = await open(hub, 30);
    expect(stream.response.headers["content-type"]).toMatch(/^text\/event-stream/);
    await stream.until(() => stream.body().includes("event: ready\ndata: {}\n\n"));
    expect(hub.size).toBe(1);
    hub.publish({ event: "message", data: { threadId: "t", messageId: "m", change: "created" } });
    await stream.until(() => stream.body().includes('event: message\ndata: {"threadId":"t","messageId":"m","change":"created"}\n\n'));
    await stream.until(() => stream.body().includes(": ping\n\n"));
    stream.response.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.size).toBe(0);
  });

  it("projects harness message and run events to public ids", async () => {
    const f = fixture();
    const bot = await f.harness.bots.create({ name: "Talker" });
    const sent = await f.harness.threads.send({ botId: bot.id }, { text: "hi" });
    f.reply(f.turns[0], "hello");
    const threadId = `local:${INSTANCE}:thread:bot:${bot.id}`;
    expect(f.frames).toContainEqual({ event: "run", data: { runId: `local:${INSTANCE}:run:${sent.runIds[0]}`, threadId, state: "running" } });
    expect(f.frames).toContainEqual({ event: "run", data: { runId: `local:${INSTANCE}:run:${sent.runIds[0]}`, threadId, state: "done" } });
    expect(f.frames.filter((frame) => frame.event === "message" && frame.data.change === "created").length).toBeGreaterThanOrEqual(2);
    expect(f.frames.every((frame) => frame.event !== "message" || frame.data.threadId === threadId)).toBe(true);
  });
});

describe("heartbeat wake gate", () => {
  const NOW = new Date(2026, 8, 23, 14, 0, 0);
  const task = (status: TaskCheckpoint["status"]): TaskCheckpoint => ({
    objective: "Ship the landing page", status, summary: "half done", next_step: "write hero", evidence: [],
  });
  const run = (patch: Partial<Run> & { minutesAgo: number }): Run => ({
    id: `run_${patch.minutesAgo}_${patch.threadId ?? "dm"}`,
    threadId: "bot:b1",
    botId: "b1",
    state: "completed",
    startedAt: new Date(NOW.getTime() - (patch.minutesAgo + 1) * 60_000).toISOString(),
    endedAt: new Date(NOW.getTime() - patch.minutesAgo * 60_000).toISOString(),
    ...patch,
  });
  const gate = (runs: Run[], options: { busy?: boolean; ledger?: HeartbeatLedger } = {}) =>
    heartbeatWakeFor({ botId: "b1", now: NOW, busy: options.busy ?? false, runs, ledger: options.ledger ?? {} });

  it("wakes only for pending work, never while busy or right after the person stopped it", () => {
    expect(gate([run({ minutesAgo: 30, task: task("in_progress") })])).toMatchObject({ kind: "continue", threadId: "bot:b1" });
    expect(gate([run({ minutesAgo: 30, state: "failed", task: task("interrupted") })])).toMatchObject({ kind: "continue" });
    expect(gate([run({ minutesAgo: 30, task: task("in_progress") })], { busy: true })).toBeNull();
    expect(gate([run({ minutesAgo: 30, task: task("completed") })])).toBeNull();
    expect(gate([run({ minutesAgo: 5, task: task("in_progress") })])).toBeNull();
    expect(gate([run({ minutesAgo: 30, state: "cancelled", task: task("interrupted") })])).toBeNull();
    expect(gate([run({ minutesAgo: 30 * 60, task: task("in_progress") })])).toBeNull();
    expect(gate([run({ minutesAgo: 30, task: task("in_progress") }), run({ minutesAgo: 0, state: "working", threadId: "group:g" })])).toBeNull();
    expect(gate([])).toBeNull();
  });

  it("does not wake when the person wrote since, but ignores its own silent heartbeat runs", () => {
    const taskRun = run({ minutesAgo: 60, task: task("in_progress") });
    expect(gate([taskRun, run({ minutesAgo: 20 })])).toBeNull();
    expect(gate([taskRun, run({ minutesAgo: 20, heartbeat: true })])).toMatchObject({ kind: "continue" });
  });

  it("nudges a blocked task once, only after two quiet hours", () => {
    expect(gate([run({ minutesAgo: 60, task: task("blocked") })])).toBeNull();
    const wake = gate([run({ minutesAgo: 150, task: task("blocked") })]);
    expect(wake).toMatchObject({ kind: "nudge" });
    const awaiting = run({ minutesAgo: 150, state: "failed", error: "Task paused after denied or expired input; no automatic retry.", task: task("interrupted") });
    expect(gate([awaiting])).toMatchObject({ kind: "nudge" });
    const key = heartbeatTaskKey("b1", task("blocked"));
    const nudged: HeartbeatLedger = { [key]: { wakes: 1, lastAt: new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString(), nudged: true } };
    expect(gate([run({ minutesAgo: 300, task: task("blocked") })], { ledger: nudged })).toBeNull();
  });

  it("wakes a task at most once per two hours and three times in all", () => {
    const pending = [run({ minutesAgo: 30, task: task("in_progress") })];
    const key = heartbeatTaskKey("b1", task("in_progress"));
    const recent = { [key]: { wakes: 1, lastAt: new Date(NOW.getTime() - HEARTBEAT_COOLDOWN_MS + 60_000).toISOString() } };
    expect(gate(pending, { ledger: recent })).toBeNull();
    const old = { [key]: { wakes: 1, lastAt: new Date(NOW.getTime() - HEARTBEAT_COOLDOWN_MS - 60_000).toISOString() } };
    expect(gate(pending, { ledger: old })).toMatchObject({ kind: "continue" });
    expect(gate(pending, { ledger: { [key]: { ...old[key]!, wakes: 3 } } })).toBeNull();
  });

  it("ticks only in waking hours, only when enabled, and records the wake", () => {
    const storage = { data: {} as Record<string, unknown>, readJson<T>(_: string, fallback: T) { return fallback; }, writeJson(name: string, value: unknown) { this.data[name] = value; } };
    const woken: string[] = [];
    let enabled = true;
    const clock = fixedClock(new Date(2026, 8, 23, 22, 0, 0).getTime());
    const runs = [run({ minutesAgo: 30, task: task("in_progress") })].map((row) => ({
      ...row, startedAt: new Date(clock.now().getTime() - 31 * 60_000).toISOString(), endedAt: new Date(clock.now().getTime() - 30 * 60_000).toISOString(),
    }));
    const heartbeat = new Heartbeat({
      clock,
      storage: storage as never,
      settings: () => ({ enabled, everyMinutes: 30 }),
      botIds: () => ["b1"],
      runs: () => runs,
      isBusy: () => false,
      wake: ({ botId, prompt }) => { woken.push(`${botId}:${prompt.split("\n")[0]}`); return { runId: `hb_${woken.length}` }; },
    });
    expect(heartbeat.tick()).toEqual([]); // 22:00: asleep
    const morning = fixedClock(new Date(2026, 8, 24, 9, 0, 0).getTime());
    Object.assign(clock, { now: morning.now, nowIso: morning.nowIso });
    runs[0] = { ...runs[0]!, startedAt: new Date(morning.now().getTime() - 31 * 60_000).toISOString(), endedAt: new Date(morning.now().getTime() - 30 * 60_000).toISOString() };
    enabled = false;
    expect(heartbeat.tick()).toEqual([]);
    enabled = true;
    expect(heartbeat.tick()).toEqual(["hb_1"]);
    expect(woken[0]).toMatch(/^b1:\[heartbeat\]/);
    expect(heartbeat.tick()).toEqual([]); // cooldown
    expect(Object.values(storage.data["heartbeats.json"] as HeartbeatLedger)[0]).toMatchObject({ wakes: 1 });
  });

  it("wakes a real agent quietly: a [SILENT] heartbeat publishes nothing and cannot schedule routines", async () => {
    const f = fixture();
    const bot = await f.harness.bots.create({ name: "Builder" });
    const sent = await f.harness.threads.send({ botId: bot.id }, { text: "Build the page." });
    f.harness.checkpointTask({ botId: bot.id, threadId: `bot:${bot.id}`, runId: sent.runIds[0]! }, {
      objective: "Build the page", status: "blocked", summary: "need the logo", next_step: "get the logo", evidence: [],
    });
    f.reply(f.turns[0], "I need your logo to continue.");
    f.clock.advance(60 * 60_000);
    expect(f.harness.heartbeatTick()).toEqual([]); // blocked for 1 h: not yet
    f.clock.advance(90 * 60_000);
    const [heartbeatRun] = f.harness.heartbeatTick();
    expect(heartbeatRun).toBeTruthy();
    expect(f.turns[1]?.text).toMatch(/^\[heartbeat\]/);
    const tool = f.turns[1]?.dynamicTools?.find((candidate) => candidate.name === "schedule_routine");
    await expect(tool!.call({ name: "x", prompt: "p", frequency: "interval", every_minutes: 5 })).rejects.toMatchObject({ code: "routine_recursion" });
    f.reply(f.turns[1], "[SILENT]");
    expect(await botTexts(f, bot.id)).toEqual(["I need your logo to continue."]);
    expect(await f.harness.runs.get(heartbeatRun!)).toMatchObject({ heartbeat: true, outcome: "silent", state: "completed" });
    f.clock.advance(3 * 60 * 60_000);
    expect(f.harness.heartbeatTick()).toEqual([]); // nudged once already
  });
});
