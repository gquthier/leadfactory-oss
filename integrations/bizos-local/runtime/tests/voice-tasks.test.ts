import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalBizosHarness } from "../src/harness/harness.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import type { ConnectedPlan } from "../src/harness/plan-types.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";
import { resolveVoiceBinding, VoiceTaskError } from "../src/voice-tasks.js";

const INSTANCE = "voice-test-instance";
const REQUEST_A = "019a1551-7642-7000-8123-123456789abc";
const REQUEST_B = "019a1551-7642-7000-8123-123456789abd";
const OPERATION_A = "019a1551-7642-7000-8123-123456789abe";
const OPERATION_B = "019a1551-7642-7000-8123-123456789abf";
const createdAt = "2026-09-21T00:00:00.000Z";

function plan(id: string, provider: "codex" | "claude" | "cursor", patch: Partial<ConnectedPlan> = {}): ConnectedPlan {
  return {
    id,
    provider,
    label: id,
    authKind: "oauth",
    status: "connected",
    createdAt,
    priority: 0,
    ...(provider === "codex" ? { codexHome: `/plans/${id}` }
      : provider === "claude" ? { configDir: `/plans/${id}` }
        : { cursorHome: `/plans/${id}` }),
    ...patch,
  };
}

function expectVoiceError(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error("expected voice binding to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(VoiceTaskError);
    expect((error as VoiceTaskError).code).toBe(code);
  }
}

describe("voice plan binding", () => {
  const codex = plan("pln_codex_a", "codex");
  const claude = plan("pln_claude_b", "claude");
  const base = {
    bot: { archived: false, planId: undefined, providerId: undefined },
    settings: {
      mode: "local" as const,
      local: { sandbox: "read-only" as const, autoApproveReads: false, activePlanId: codex.id, provider: "codex" as const },
      appearance: { theme: "system" as const },
      access: { grants: [], fullDiskRead: false },
    },
    plans: [codex, claude],
  };

  it("binds the exact bot override before the current plan and verifies a session pin", () => {
    const binding = resolveVoiceBinding({ ...base, bot: { ...base.bot, planId: claude.id } });
    expect(binding).toEqual({ planId: claude.id, provider: "claude" });
    expect(resolveVoiceBinding({ ...base, bot: { ...base.bot, planId: claude.id }, expectedBinding: binding })).toEqual(binding);
    expectVoiceError(
      () => resolveVoiceBinding({ ...base, bot: { ...base.bot, planId: claude.id }, expectedBinding: { planId: codex.id, provider: "codex" } }),
      "voice_binding_changed",
    );
  });

  it("picks the preferred connected plan once when none is selected, then stays pinned", () => {
    const unselected = { ...base, settings: { ...base.settings, local: { ...base.settings.local, activePlanId: undefined } } };
    const cursor = plan("pln_cursor", "cursor", { priority: -1 });
    const exhausted = plan("pln_codex_full", "codex", { priority: 0, usage: { at: createdAt, planType: "pro", email: null, reached: true, windows: [] } });
    const second = plan("pln_claude_second", "claude", { priority: 1 });
    const first = resolveVoiceBinding({ ...unselected, plans: [cursor, exhausted, second] });
    expect(first).toEqual({ planId: second.id, provider: "claude" });
    // A later task of the same call keeps its binding even if another plan
    // becomes preferred meanwhile.
    const preferred = plan("pln_codex_new", "codex", { priority: -5 });
    expect(resolveVoiceBinding({ ...unselected, plans: [preferred, second], expectedBinding: first })).toEqual(first);
    expectVoiceError(() => resolveVoiceBinding({ ...unselected, plans: [cursor] }), "voice_plan_not_selected");
  });

  it("rejects external providers, Cursor, disconnected and exhausted plans instead of falling back", () => {
    expectVoiceError(() => resolveVoiceBinding({ ...base, bot: { ...base.bot, providerId: "prv_external" } }), "voice_external_provider_not_allowed");
    expectVoiceError(() => resolveVoiceBinding({ ...base, settings: { ...base.settings, local: { ...base.settings.local, inferenceProviderId: "prv_external" } } }), "voice_external_provider_not_allowed");
    expectVoiceError(() => resolveVoiceBinding({ ...base, bot: { ...base.bot, planId: "pln_cursor" }, plans: [plan("pln_cursor", "cursor")] }), "voice_plan_provider_not_allowed");
    expectVoiceError(() => resolveVoiceBinding({ ...base, plans: [plan(codex.id, "codex", { status: "disconnected" })] }), "voice_plan_unavailable");
    expectVoiceError(() => resolveVoiceBinding({ ...base, plans: [plan(codex.id, "codex", { usage: { at: createdAt, planType: "pro", email: null, reached: true, windows: [] } })] }), "voice_plan_quota_exhausted");
  });
});

interface Fixture {
  root: string;
  harness: LocalBizosHarness;
  facade: CollaborationFacade;
  broker: LocalTeamBroker;
  turns: CodexTurnInput[];
  stops: string[];
  teamMounts(): number;
  /** `teamDelegationBlocked` of each dynamic-tool / MCP mount, in order. */
  toolMounts: boolean[];
  mcpMounts: Array<{ blocked: boolean; ticket: string }>;
  botId: string;
  agentId: string;
  binding: { planId: string; provider: "codex" };
}

const fixtures: Fixture[] = [];

async function fixture(options: { stopDelayMs?: number } = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "lbz-voice-"));
  const selected = plan("pln_voice_codex", "codex", { codexHome: join(root, "codex-a") });
  const fallback = plan("pln_voice_fallback", "codex", { codexHome: join(root, "codex-b"), priority: 1 });
  writeFileSync(join(root, "plans.json"), `${JSON.stringify({ plans: [selected, fallback], routing: { pins: {}, defaultPolicy: "priority", activePlanId: selected.id } })}\n`);
  const turns: CodexTurnInput[] = [];
  const stops: string[] = [];
  let teamMounts = 0;
  const toolMounts: boolean[] = [];
  const mcpMounts: Array<{ blocked: boolean; ticket: string }> = [];
  const broker = new LocalTeamBroker();
  const harness = new LocalBizosHarness({
    rootDir: root,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Workspace",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: "/fake/none.mjs",
    devices: false,
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") },
    // Wired like the sidecar: every call re-authorizes the run's capability.
    localTeamTools: ({ bot, threadId, runId, teamDelegationBlocked }) => {
      teamMounts += 1;
      toolMounts.push(teamDelegationBlocked);
      const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId, teamDelegationBlocked }));
      return [{ name: "recruit_agent", description: "test", inputSchema: { type: "object" }, call: async () => ({ botId: broker.authorize(session).botId }) }];
    },
    localTeamMcp: ({ bot, threadId, runId, teamDelegationBlocked }) => {
      const ticket = broker.issue({ botId: bot.id, threadId, runId, teamDelegationBlocked });
      mcpMounts.push({ blocked: teamDelegationBlocked, ticket });
      return { command: "/fake/node", args: ["/fake/local-team-mcp.js"], forwarded: { LBZ_LOCAL_TEAM_TICKET: ticket }, preApproved: true };
    },
    localArchitecture: ({ bot, threadId, workspaceDir, sandbox, peers }) => ({
      mode: "local",
      instanceId: INSTANCE,
      workspaceId: `local:${INSTANCE}:workspace`,
      agentId: `local:${INSTANCE}:agent:${bot.id}`,
      threadId: `local:${INSTANCE}:thread:${threadId}`,
      workspaceDir,
      sandbox,
      supportedProviders: ["codex", "claude"],
      peers: peers.map((peer) => ({ agentId: `local:${INSTANCE}:agent:${peer.id}`, name: peer.name })),
      recruitment: "autonomous-codex-claude",
    }),
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      const index = turns.length - 1;
      return {
        stop: () => {
          stops.push(`turn-${index}`);
          const settle = () => input.onEvent({ type: "turn.completed", ok: false, stopReason: "interrupted" });
          if (options.stopDelayMs === undefined) settle();
          else setTimeout(settle, options.stopDelayMs);
        },
        respond: () => "allowed-once",
        sessionId: () => null,
        settled: () => false,
      };
    },
  });
  await harness.runtime.setInference({ source: "plan", planId: selected.id });
  const bot = await harness.bots.create({ name: "Voice agent" });
  const index = emptyDurableIndex();
  const facade = new CollaborationFacade(harness, INSTANCE, broker, index, null, () => undefined);
  const result: Fixture = {
    root,
    harness,
    facade,
    broker,
    turns,
    stops,
    teamMounts: () => teamMounts,
    toolMounts,
    mcpMounts,
    botId: bot.id,
    agentId: `local:${INSTANCE}:agent:${bot.id}`,
    binding: { planId: selected.id, provider: "codex" },
  };
  fixtures.push(result);
  return result;
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    value.harness.stop();
    await rm(value.root, { recursive: true, force: true });
  }
});

function finish(turn: CodexTurnInput, text: string): void {
  turn.onEvent({ type: "item.completed", itemId: "final", itemType: "assistant_text", phase: "final_answer", text, ok: true });
  turn.onEvent({ type: "turn.completed", ok: true, stopReason: null });
}

describe("voice task lifecycle", () => {
  it("prepares idempotently, dispatches once, persists the real result and refuses team delegation", async () => {
    const f = await fixture();
    const first = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    const replay = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    expect(first).toMatchObject({ agentId: f.agentId, binding: f.binding, state: "prepared", duplicate: false });
    expect(replay).toMatchObject({ callId: first.callId, duplicate: true });

    const dispatched = await f.facade.dispatchVoiceCall(first.callId, { operationId: OPERATION_A, content: "Do the selected-plan task" });
    expect(dispatched).toMatchObject({ operationId: OPERATION_A, message: "Do the selected-plan task", state: "running", duplicate: false });
    expect(dispatched.runs).toHaveLength(1);
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]!.environment?.CODEX_HOME).toBe(join(f.root, "codex-a"));
    // Mounted exactly like a typed turn, refused at call time.
    expect(f.turns[0]!.dynamicTools?.map((tool) => tool.name)).toEqual(["recruit_agent"]);
    expect(f.turns[0]!.system).toContain("recruitment: unavailable");
    expect(f.toolMounts).toEqual([true]);
    await expect(f.turns[0]!.dynamicTools![0]!.call({ name: "Helper", title: "Research" })).rejects.toMatchObject({
      status: 403,
      code: "team_delegation_unavailable_in_voice",
    });

    const duplicate = await f.facade.dispatchVoiceCall(first.callId, { operationId: OPERATION_A, content: "Do the selected-plan task" });
    expect(duplicate).toMatchObject({ callId: first.callId, duplicate: true });
    expect(f.turns).toHaveLength(1);
    await expect(f.facade.dispatchVoiceCall(first.callId, { operationId: OPERATION_B, content: "A different task" })).rejects.toMatchObject({ code: "voice_call_already_dispatched" });

    finish(f.turns[0]!, "Observed result from the selected agent");
    expect(await f.facade.voiceCall(first.callId)).toMatchObject({
      state: "done",
      results: [{ state: "done", content: "Observed result from the selected agent", error: null }],
    });
  });

  it("does not quota-fail over a strict voice run and leaves normal dispatch behavior available", async () => {
    const f = await fixture();
    const call = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    await f.facade.dispatchVoiceCall(call.callId, { operationId: OPERATION_A, content: "Use only this account" });
    f.turns[0]!.onEvent({ type: "runtime.error", message: "quota exceeded (429)" });
    f.turns[0]!.onEvent({ type: "turn.completed", ok: false, stopReason: "failed" });
    expect(f.turns).toHaveLength(1);
    expect(await f.facade.voiceCall(call.callId)).toMatchObject({ state: "failed", binding: f.binding });

    await f.harness.threads.send({ botId: f.botId }, { text: "Normal chat still has its ordinary tools and routing" });
    expect(f.turns).toHaveLength(2);
    expect(f.teamMounts()).toBe(2);
    expect(f.toolMounts).toEqual([true, false]);
    expect(f.turns[1]!.dynamicTools?.map((tool) => tool.name)).toContain("recruit_agent");
    await expect(f.turns[1]!.dynamicTools![0]!.call({})).resolves.toEqual({ botId: f.botId });
  });

  it("keeps the typed chat's tool surface so voice and the next typed turn both resume the same CLI thread", async () => {
    const f = await fixture();
    const cursor = "lbz-dynamic-v1:thr_voice_resume";
    await f.harness.threads.send({ botId: f.botId }, { text: "Typed turn before the call" });
    f.turns[0]!.onEvent({ type: "session.started", sessionId: cursor, model: null });
    finish(f.turns[0]!, "Typed answer");

    const call = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    await f.facade.dispatchVoiceCall(call.callId, { operationId: OPERATION_A, content: "Voice task" });
    expect(f.turns).toHaveLength(2);
    // Same surface ⇒ same policy fingerprint ⇒ the saved cursor is used and
    // the history is not replayed into a fresh thread.
    expect(f.turns[1]!.resumeCursor).toBe(cursor);
    expect(f.turns[1]!.dynamicTools?.map((tool) => tool.name)).toEqual(f.turns[0]!.dynamicTools?.map((tool) => tool.name));
    f.turns[1]!.onEvent({ type: "session.started", sessionId: cursor, model: null });
    finish(f.turns[1]!, "Voice answer");
    expect((await f.facade.voiceCall(call.callId)).state).toBe("done");

    await f.harness.threads.send({ botId: f.botId }, { text: "Typed turn after the call" });
    expect(f.turns[2]!.resumeCursor).toBe(cursor);
  });

  it("reports the latest public progress message while the run is still running", async () => {
    const f = await fixture();
    const call = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    await f.facade.dispatchVoiceCall(call.callId, { operationId: OPERATION_A, content: "Long voice task" });
    expect((await f.facade.voiceCall(call.callId)).results).toEqual([expect.objectContaining({ state: "running", content: null })]);
    f.turns[0]!.onEvent({ type: "item.completed", itemId: "c1", itemType: "assistant_text", phase: "commentary", text: "Reading the files now", ok: true });
    expect(await f.facade.voiceCall(call.callId)).toMatchObject({
      state: "running",
      message: "Long voice task",
      results: [{ state: "running", content: "Reading the files now" }],
    });
    finish(f.turns[0]!, "All done");
    expect((await f.facade.voiceCall(call.callId)).results).toEqual([expect.objectContaining({ state: "done", content: "All done" })]);
  });

  it("refuses team tool calls from the Claude MCP bridge during a voice run only", async () => {
    const f = await fixture();
    const call = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    await f.facade.dispatchVoiceCall(call.callId, { operationId: OPERATION_A, content: "Voice task" });
    finish(f.turns[0]!, "Voice answer");
    await f.harness.threads.send({ botId: f.botId }, { text: "Typed turn" });
    expect(f.mcpMounts.map((mount) => mount.blocked)).toEqual([true, false]);

    // What `/api/internal/local-team/*` does with the bridge's bearer.
    const voiceSession = f.broker.exchange(f.mcpMounts[0]!.ticket);
    expect(() => f.broker.authorize(voiceSession)).toThrow(expect.objectContaining({
      status: 403,
      code: "team_delegation_unavailable_in_voice",
    }));
    const typedSession = f.broker.exchange(f.mcpMounts[1]!.ticket);
    expect(f.broker.authorize(typedSession).botId).toBe(f.botId);
  });

  it("cancels prepared calls and only the exact queued voice run", async () => {
    const f = await fixture();
    const prepared = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    expect(await f.facade.cancelVoiceCall(prepared.callId)).toMatchObject({ state: "cancelled", runs: [], duplicate: false });
    expect(await f.facade.cancelVoiceCall(prepared.callId)).toMatchObject({ state: "cancelled", duplicate: true });
    await expect(f.facade.dispatchVoiceCall(prepared.callId, { operationId: OPERATION_A, content: "Too late" })).rejects.toMatchObject({ code: "voice_call_cancelled" });

    const first = await f.facade.prepareVoiceCall({ requestId: REQUEST_B, agentId: f.agentId, expectedBinding: f.binding });
    await f.facade.dispatchVoiceCall(first.callId, { operationId: OPERATION_A, content: "Keep running" });
    const second = await f.facade.prepareVoiceCall({ requestId: "019a1551-7642-7000-8123-123456789ac0", agentId: f.agentId, expectedBinding: f.binding });
    await f.facade.dispatchVoiceCall(second.callId, { operationId: OPERATION_B, content: "Queued voice work" });
    expect(f.turns).toHaveLength(1);
    expect((await f.facade.voiceCall(second.callId)).state).toBe("queued");
    expect(await f.facade.cancelVoiceCall(second.callId)).toMatchObject({ state: "cancelled" });
    expect(f.stops).toEqual([]);
    expect((await f.facade.voiceCall(first.callId)).state).toBe("running");
  });

  it("waits for an active provider cancellation acknowledgement before reporting cancelled", async () => {
    const f = await fixture({ stopDelayMs: 25 });
    const call = await f.facade.prepareVoiceCall({ requestId: REQUEST_A, agentId: f.agentId });
    await f.facade.dispatchVoiceCall(call.callId, { operationId: OPERATION_A, content: "Stop after dispatch" });
    const cancelled = await f.facade.cancelVoiceCall(call.callId);
    expect(f.stops).toEqual(["turn-0"]);
    expect(cancelled).toMatchObject({ state: "cancelled", results: [{ state: "cancelled" }] });
  });

  it("fails a changed or disconnected binding before a message is persisted", async () => {
    const f = await fixture();
    await expect(f.facade.prepareVoiceCall({
      requestId: REQUEST_A,
      agentId: f.agentId,
      expectedBinding: { planId: "pln_other", provider: "claude" },
    })).rejects.toMatchObject({ code: "voice_binding_changed" });
    await f.harness.bots.update(f.botId, { planId: f.binding.planId });
    await f.harness.plans.disconnect(f.binding.planId);
    await expect(f.facade.prepareVoiceCall({ requestId: REQUEST_B, agentId: f.agentId })).rejects.toMatchObject({ code: "voice_plan_unavailable" });
    expect((await f.harness.threads.get({ botId: f.botId })).messages).toEqual([]);
  });
});
