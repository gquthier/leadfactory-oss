import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(answer: (body: any) => unknown, options: { recruit?: boolean; installedModel?: boolean } = {}) {
  const requests: any[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: options.installedModel === false ? [] : [{ name: "fixture:1" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "tools"], details: { family: "fixture" } }));
    requests.push(body);
    res.end(JSON.stringify(answer(body)));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const root = mkdtempSync(join(tmpdir(), "lbz-ollama-dispatch-"));
  const toolCalls: unknown[] = [];
  const broker = new LocalTeamBroker();
  let facade: CollaborationFacade;
  const harness = new LocalBizosHarness({ rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
    execPath: "/missing/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/missing/mcp", devices: false,
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: "/missing/codex", LBZ_CLAUDE_PATH: "/missing/claude", LBZ_CURSOR_PATH: "/missing/cursor" },
    localTeamTools: ({ bot, threadId, runId }) => options.recruit
      ? [{ name: "recruit_agent", description: "Recruit a local teammate", inputSchema: { type: "object", properties: { name: { type: "string" }, title: { type: "string" }, initial_task: { type: "string" } } },
        call: async args => {
          const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId }));
          await harness.runtime.setInference({ source: "auto" }); // parent binding must survive global change
          return facade.recruit(broker.authorize(session), args);
        } }]
      : [{ name: "read_state", description: "Read fixture state", inputSchema: { type: "object", properties: {} },
          call: async (args, context) => { toolCalls.push({ args, context }); return { value: 42 }; } }],
    onLocalRunStopped: runId => broker.revoke(runId),
    onLocalRunSettled: runId => broker.revoke(runId),
  });
  facade = new CollaborationFacade(harness, "fixture", broker, emptyDurableIndex(), null, () => undefined);
  cleanup.push(() => { harness.stop(); rmSync(root, { recursive: true, force: true }); });
  const provider = await harness.inference.add({ kind: "ollama", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: "fixture:1" });
  await harness.runtime.setInference({ source: "provider", providerId: provider.id });
  return { harness, facade, provider, requests, toolCalls };
}
async function settled(harness: LocalBizosHarness, runId: string) {
  for (let n = 0; n < 200; n++) {
    const run = await harness.runs.get(runId);
    if (run && ["completed", "failed", "cancelled"].includes(run.state)) return run;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("run did not settle");
}

it("answers two quick-chat turns without a CLI or plan and exposes measured local attribution", async () => {
  const f = await fixture(body => ({ model: "fixture:1", done: true, message: { role: "assistant", content: body.messages.at(-1).content === "second" ? "Two" : "One" }, prompt_eval_count: 4, eval_count: 2 }));
  const chat = await f.harness.quickChats.create("chat");
  const first = await f.harness.quickChats.send(chat.id, "first", "one");
  expect((await settled(f.harness, first.runIds[0]!)).state).toBe("completed");
  const second = await f.harness.quickChats.send(chat.id, "second", "two");
  const run = await settled(f.harness, second.runIds[0]!);
  expect(run).toMatchObject({ state: "completed", inference: { kind: "ollama", providerId: f.provider.id, model: "fixture:1", locality: "local" }, usage: { inputTokens: 4, outputTokens: 2 } });
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1].messages[0].content).toContain("One");
  expect(f.requests.every(request => request.model === "fixture:1" && !request.tools)).toBe(true);
  expect((await f.facade.getRun(`local:fixture:run:${second.runIds[0]}`)).inference).toMatchObject({ model: "fixture:1" });
});

it("fails the exact selected model locally when its installed tag disappears", async () => {
  const f = await fixture(() => ({ model: "fixture:1", done: true, message: { role: "assistant", content: "Wrong fallback" } }), { installedModel: false });
  const chat = await f.harness.quickChats.create("missing");
  const sent = await f.harness.quickChats.send(chat.id, "Hello", "missing-model");
  const run = await settled(f.harness, sent.runIds[0]!);
  expect(run.state).toBe("failed");
  expect(run.error).toMatch(/not installed/);
  expect(run.inference).toBeUndefined();
  expect(f.requests).toEqual([]);
});

it("pins an Ollama recruit to its parent's exact verified model when global selection changes", async () => {
  const f = await fixture(body => {
    const last = body.messages.at(-1);
    if (last?.role === "tool") return { model: "fixture:1", done: true, message: { role: "assistant", content: "Teammate created" } };
    if (last?.content === "Recruit") return { model: "fixture:1", done: true, message: { role: "assistant", content: "", tool_calls: [{ function: { name: "recruit_agent", arguments: { name: "Analyst", title: "Analyst", initial_task: "Child task" } } }] } };
    return { model: "fixture:1", done: true, message: { role: "assistant", content: "Child answered" } };
  }, { recruit: true });
  const parent = await f.harness.bots.create({ name: "CEO" });
  const sent = await f.harness.threads.send({ botId: parent.id }, { text: "Recruit" });
  expect((await settled(f.harness, sent.runIds[0]!)).state).toBe("completed");
  const child = (await f.harness.bots.list()).find(bot => bot.name === "Analyst");
  expect(child).toMatchObject({ providerId: f.provider.id, model: "fixture:1" });
  const childRun = (await f.harness.runs.list()).find(run => run.botId === child!.id);
  expect(childRun).toBeDefined();
  expect((await settled(f.harness, childRun!.id)).state).toBe("completed");
  const requests = f.requests.map(body => ({ model: body.model, text: body.messages.at(-1)?.content }));
  expect(requests).toContainEqual({ model: "fixture:1", text: "Child task" });
  await expect(f.facade.localRuntime()).resolves.toMatchObject({ inference: { source: "auto" } });
});

it("executes an agent's mounted host tool once and persists the real step", async () => {
  const f = await fixture(body => body.messages.some((message: any) => message.role === "tool")
    ? { model: "fixture:1", done: true, message: { role: "assistant", content: "Value 42" }, prompt_eval_count: 5, eval_count: 3 }
    : { model: "fixture:1", done: true, message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_state", arguments: {} } }] }, prompt_eval_count: 4, eval_count: 2 });
  const bot = await f.harness.bots.create({ name: "Agent" });
  const sent = await f.harness.threads.send({ botId: bot.id }, { text: "Read state" });
  const run = await settled(f.harness, sent.runIds[0]!);
  expect(run).toMatchObject({ state: "completed", usage: { inputTokens: 9, outputTokens: 5 } });
  expect(f.toolCalls).toHaveLength(1);
  expect(f.requests[1].messages.at(-1)).toMatchObject({ role: "tool", content: '{"value":42}' });
  expect(JSON.stringify(await f.harness.threads.get({ botId: bot.id }))).toContain("Reading state");
});
