import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startOpenAiTurn } from "../src/harness/openai-driver.js";
import { ContinuityBridgeError } from "../src/continuity-bridge.js";
import { BizosInferenceSelection } from "../src/harness/bizos-inference.js";
import { Storage } from "../src/harness/storage.js";
import type { RuntimeEvent } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { LOCAL_TEAM_TOOL_SPECS } from "../src/local-team-mcp.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";
import type { ContinuityTransport } from "../src/continuity-bridge.js";
import { canonicalEventHash } from "../src/harness/continuity-sync.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("runs BizOS tool calls through the host and sends only opaque completions over the bridge", async () => {
  const requests: Record<string, unknown>[] = [];
  const events: RuntimeEvent[] = [];
  const effects: string[] = [];
  const reasoningDetails = [{ type: "reasoning.encrypted", data: "bizos-reasoning:11111111-1111-4111-8111-111111111111" }];
  const complete = async (body: Record<string, unknown>) => {
    requests.push(structuredClone(body));
    const last = (body.messages as Array<Record<string, unknown>>).at(-1)!;
    if (last.role === "tool" && effects.length === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "routine", type: "function", function: { name: "schedule_routine", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
    if (last.role === "tool") return { choices: [{ message: { role: "assistant", content: "L'agent et la routine existent." }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 } };
    return { choices: [{ message: { role: "assistant", content: "Agent créé avant vérification", reasoning_details: reasoningDetails, tool_calls: [{ id: "recruit", type: "function", function: { name: "recruit_agent", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
  };
  await new Promise<void>((resolve) => {
    startOpenAiTurn({
      baseUrl: "", apiKey: "", model: "bizos-mixture", label: "BizOS Mixture of Models",
      system: "Never announce an action without a successful tool result.", text: "Recrute et programme", threadId: "bot:ceo", runId: "run_fixture", agent: true,
      dynamicTools: ["recruit_agent", "schedule_routine"].map((name) => ({ name, description: name, inputSchema: { type: "object" }, call: async () => { effects.push(name); return { ok: true }; } })),
      chatCompletion: complete,
      onEvent(event) { events.push(event); if (event.type === "turn.completed") resolve(); },
    });
  });
  expect(effects).toEqual(["recruit_agent", "schedule_routine"]);
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
  expect(JSON.stringify(events)).not.toContain("Agent créé avant vérification");
  expect(requests).toHaveLength(3);
  expect(requests[0]).not.toHaveProperty("previousRequestId");
  expect(requests[1]!.previousRequestId).toBe(requests[0]!.requestId);
  expect(requests[2]!.previousRequestId).toBe(requests[1]!.requestId);
  expect((requests[1]!.messages as unknown[]).slice(0, (requests[0]!.messages as unknown[]).length)).toEqual(requests[0]!.messages);
  expect((requests[2]!.messages as unknown[]).slice(0, (requests[1]!.messages as unknown[]).length)).toEqual(requests[1]!.messages);
  expect((requests[1]!.messages as Array<Record<string, unknown>>).find((message) => message.role === "assistant")?.reasoning_details).toEqual(reasoningDetails);
  const turnIds = requests.map((body) => body.clientTurnId);
  const requestIds = requests.map((body) => body.requestId);
  expect(new Set(turnIds).size).toBe(1);
  expect(new Set(requestIds).size).toBe(3);
  for (const id of [...turnIds, ...requestIds]) expect(String(id)).toMatch(/^[a-f0-9-]{36}$/);
  for (const body of requests) {
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("stream");
    expect(body).not.toHaveProperty("apiKey");
    expect((body.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name)).toEqual(["recruit_agent", "schedule_routine"]);
  }
  expect(JSON.stringify(requests)).not.toMatch(/deepseek|openrouter|sk-/i);
});

it("persists BizOS selection per local thread and refuses a changed signed workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "bizos-inference-selection-")); roots.push(root);
  const storage = new Storage(root);
  let scope = { linked: true, toolsAvailable: true, orgId: randomUUID(), workspaceId: randomUUID() };
  const bridge = async (operation: string) => { expect(operation).toBe("status"); return scope; };
  const selection = new BizosInferenceSelection(storage, bridge);
  const id = `chat:qchat_${"a".repeat(32)}`;
  expect(await selection.select(id, "bizos")).toMatchObject({ destination: "bizos", available: true, model: "bizos-mixture" });
  expect(new BizosInferenceSelection(storage, bridge).destination(id)).toBe("bizos");
  scope = { ...scope, workspaceId: randomUUID() };
  expect(await selection.status(id)).toMatchObject({ destination: "bizos", available: false });
  await expect(selection.requireSelected(id)).rejects.toThrow(/workspace|account/i);
  scope = { ...scope, toolsAvailable: false };
  expect(await selection.status(id)).toMatchObject({ destination: "bizos", available: false });
});

it("shows a clear Work Credits error without exposing an upstream provider", async () => {
  const events: RuntimeEvent[] = [];
  await new Promise<void>((resolve) => {
    startOpenAiTurn({ baseUrl: "", apiKey: "", model: "bizos-mixture", system: "", text: "Hello", threadId: "bot:ceo", runId: "run_fixture", dynamicTools: [],
      chatCompletion: async () => { throw new ContinuityBridgeError(402, "insufficient_work_credits", "deepseek/internal-sku refused", true); },
      onEvent(event) { events.push(event); if (event.type === "turn.completed") resolve(); },
    });
  });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
  expect(JSON.stringify(events)).toContain("Crédits BizOS insuffisants");
  expect(JSON.stringify(events)).not.toMatch(/deepseek|internal-sku/);
});

it("dispatches a BizOS CEO turn locally and persists the recruited agent and routine", async () => {
  const root = mkdtempSync(join(tmpdir(), "bizos-local-ceo-")); roots.push(root);
  const broker = new LocalTeamBroker();
  const workspaceId = "local:fixture:workspace";
  const orgId = randomUUID();
  const conversationId = randomUUID();
  const continuityEvents: Array<Record<string, unknown>> = [];
  const bridgeOperations: string[] = [];
  const bridge: ContinuityTransport = async <T>(operation: string, body: Record<string, unknown>) => {
    bridgeOperations.push(operation);
    let result: unknown;
    if (operation === "status") result = { linked: true, toolsAvailable: true, orgId, workspaceId, userId: "owner", installationId: "install" };
    else if (operation === "policies/get") result = { policy: { enabled: true, modelRuntime: "codex", cloudFallback: null, autoContinue: false } };
    else if (operation === "conversations/read") result = { events: continuityEvents.filter((row) => Number(row.sequence) > Number(body.after)), hasMore: false, latestCheckpointId: null };
    else if (operation === "conversations/append") {
      for (const event of body.events as Array<Record<string, unknown>>) if (!continuityEvents.some((row) => row.eventId === event.eventId)) continuityEvents.push({ ...event, sequence: String(continuityEvents.length + 1), contentHash: canonicalEventHash(event as never), createdAt: new Date().toISOString() });
      result = { head: String(continuityEvents.length), receipts: [] };
    }
    else if (operation === "conversations/ack") result = { acknowledgedThrough: body.through };
    else if (operation === "devices/list") result = { devices: [] };
    else if (operation === "runs/start") result = { runId: randomUUID(), epoch: 1, leaseUntil: new Date(Date.now() + 60_000).toISOString() };
    else if (operation === "runs/claim") result = { turnId: randomUUID(), leaseToken: "fixture-lease", leaseUntil: new Date(Date.now() + 60_000).toISOString() };
    else if (operation === "runs/finish") {
      for (const event of (body.finalEvents ?? []) as Array<Record<string, unknown>>) if (!continuityEvents.some((row) => row.eventId === event.eventId)) continuityEvents.push({ ...event, sequence: String(continuityEvents.length + 1), contentHash: canonicalEventHash(event as never), createdAt: new Date().toISOString() });
      result = { finished: true };
    }
    else throw new Error(`unexpected continuity operation ${operation}`);
    return result as T;
  };
  let facade!: CollaborationFacade;
  const requests: Record<string, unknown>[] = [];
  const harness = new LocalBizosHarness({
    rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
    execPath: "/missing/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/missing/mcp", devices: false,
    environment: { PATH: "/nowhere", BIZOS_LOCAL_PLAN: "pro" },
    continuityTransport: bridge,
    bizosSelected: (threadId) => facade.bizosDestination(threadId) === "bizos",
    bizosChat: async (_threadId, body) => {
      requests.push(body);
      const last = (body.messages as Array<Record<string, unknown>>).at(-1)!;
      const tools = body.tools as Array<{ function: { name: string } }>;
      if (last.role === "tool" && JSON.stringify(last.content).includes("routine")) return { choices: [{ message: { role: "assistant", content: "Agent et routine créés." }, finish_reason: "stop" }] };
      if (last.role === "tool") return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "schedule", type: "function", function: { name: "schedule_routine", arguments: JSON.stringify({ name: "Market watch", prompt: "Review market signals", frequency: "once", at: new Date(Date.now() + 600_000).toISOString() }) } }] }, finish_reason: "tool_calls" }] };
      expect(tools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(["recruit_agent", "schedule_routine", "list_routines", "manage_agent"]));
      return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "recruit", type: "function", function: { name: "recruit_agent", arguments: JSON.stringify({ name: "Analyst", title: "Market analyst", description: "Track market signals", initial_task: "Review three signals" }) } }] }, finish_reason: "tool_calls" }] };
    },
    localTeamTools: ({ bot, threadId, runId }) => {
      const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId }));
      return LOCAL_TEAM_TOOL_SPECS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        call: async (args: unknown) => {
          if (tool.name === "schedule_routine") return facade.scheduleRoutine(() => broker.authorize(session), args);
          const capability = broker.authorize(session);
          if (tool.name === "recruit_agent") return facade.recruit(capability, args);
          if (tool.name === "list_routines") return facade.listAgentRoutines(capability);
          return facade.manageAgent(capability, args);
        },
      }));
    },
    onLocalRunStopped: (runId) => broker.revoke(runId), onLocalRunSettled: (runId) => broker.revoke(runId),
  });
  facade = new CollaborationFacade(harness, "fixture", broker, emptyDurableIndex(), null, () => undefined, bridge);
  const ceo = await harness.bots.create({ name: "CEO" });
  harness.continuity.store.link(`bot:${ceo.id}`, { conversationId, installationId: "install", accountId: "owner", orgId, agentId: "ceo", workspaceId });
  const publicThread = `local:fixture:thread:bot:${ceo.id}`;
  expect(await facade.executionDestination(publicThread, "bizos")).toMatchObject({ destination: "bizos", available: true, creditCost: 1 });
  const sent = await harness.threads.send({ botId: ceo.id }, { text: "Hire Analyst and schedule a market watch" });
  let run;
  for (let n = 0; n < 500; n++) {
    run = await harness.runs.get(sent.runIds[0]!);
    if (run && ["completed", "failed"].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(run).toMatchObject({ state: "completed", inference: { kind: "bizos", model: "bizos-mixture" } });
  expect((await harness.bots.list()).some((bot) => bot.name === "Analyst")).toBe(true);
  expect((await harness.routines.list()).some((routine) => routine.name === "Market watch")).toBe(true);
  expect(bridgeOperations).toContain("runs/claim");
  expect(bridgeOperations).not.toContain("cloud/send");
  expect(requests).toHaveLength(3);
  expect(JSON.stringify(requests)).not.toMatch(/openrouter|deepseek/i);
  harness.stop();
});
