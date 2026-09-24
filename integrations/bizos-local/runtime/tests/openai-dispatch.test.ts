// An API-backed agent (Gemini through its OpenAI-compatible endpoint) runs on
// the native driver with the same host team tools as Ollama: a PLAIN bot —
// created like POST /api/local/bots, no company template, no vault — calls
// recruit_agent, and the recruit starts working at once on the same provider.
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { LOCAL_TEAM_TOOL_SPECS } from "../src/local-team-mcp.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(answer: (body: any) => unknown) {
  const requests: Array<{ url: string; authorization?: string; body: any }> = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ url: req.url ?? "", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), body });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(answer(body)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const root = mkdtempSync(join(tmpdir(), "lbz-openai-dispatch-"));
  const broker = new LocalTeamBroker();
  let facade: CollaborationFacade;
  const harness = new LocalBizosHarness({
    rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
    execPath: "/missing/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/missing/mcp", devices: false,
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: "/missing/codex", LBZ_CLAUDE_PATH: "/missing/claude", LBZ_CURSOR_PATH: "/missing/cursor", BIZOS_LOCAL_PLAN: "pro" },
    // The sidecar's own wiring: every team tool, authorized per run.
    localTeamTools: ({ bot, threadId, runId }) => {
      const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId }));
      return LOCAL_TEAM_TOOL_SPECS.map((tool) => ({
        name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        call: async (args: unknown) => {
          if (tool.name === "schedule_routine") return facade.scheduleRoutine(() => broker.authorize(session), args);
          const capability = broker.authorize(session);
          if (tool.name === "recruit_agent") return facade.recruit(capability, args);
          if (tool.name === "checkpoint_task") return facade.checkpointTask(capability, args);
          return facade.manageAgent(capability, args);
        },
      }));
    },
    onLocalRunStopped: (runId) => broker.revoke(runId),
    onLocalRunSettled: (runId) => broker.revoke(runId),
  });
  facade = new CollaborationFacade(harness, "fixture", broker, emptyDurableIndex(), null, () => undefined);
  cleanup.push(() => { harness.stop(); rmSync(root, { recursive: true, force: true }); });
  const provider = await facade.addInferenceProvider({
    kind: "openai-compatible", label: "Gemini", apiKey: "gm-key",
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1beta/openai`, model: "gemini-2.5-flash",
  }) as { id: string };
  await facade.setInference({ source: "provider", providerId: provider.id });
  return { harness, facade, provider, requests };
}

async function settled(harness: LocalBizosHarness, runId: string) {
  for (let n = 0; n < 400; n++) {
    const run = await harness.runs.get(runId);
    if (run && ["completed", "failed", "cancelled"].includes(run.state)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("run did not settle");
}

it("a plain API-backed bot recruits a teammate that immediately works on the same provider", async () => {
  const f = await fixture((body) => {
    const last = body.messages.at(-1);
    if (last?.role === "tool") return { choices: [{ message: { role: "assistant", content: "Recruited Analyst." }, finish_reason: "stop" }] };
    if (String(last?.content).includes("Hire an analyst")) {
      return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: {
        name: "recruit_agent", arguments: JSON.stringify({ name: "Analyst", title: "Market analyst", initial_task: "Child task: size the market" }),
      } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    }
    return { choices: [{ message: { role: "assistant", content: "Child answered" }, finish_reason: "stop" }] };
  });
  const { bot: parent } = await f.facade.createBot({ name: "Ada" });
  const sent = await f.harness.threads.send({ botId: parent.id }, { text: "Hire an analyst" });
  const parentRun = await settled(f.harness, sent.runIds[0]!);
  expect(parentRun).toMatchObject({ state: "completed", inference: { kind: "api", providerId: f.provider.id, model: "gemini-2.5-flash", locality: "remote" } });

  const first = f.requests[0]!;
  expect(first.url).toBe("/v1beta/openai/chat/completions");
  expect(first.authorization).toBe("Bearer gm-key");
  expect(first.body.tools.map((tool: any) => tool.function.name)).toEqual(expect.arrayContaining(["recruit_agent", "schedule_routine", "manage_agent", "checkpoint_task"]));
  expect(JSON.stringify(first.body)).not.toContain("gm-key");

  const child = (await f.harness.bots.list()).find((bot) => bot.name === "Analyst");
  expect(child).toMatchObject({ title: "Market analyst", providerId: f.provider.id, model: "gemini-2.5-flash" });
  const childRun = (await f.harness.runs.list()).find((run) => run.botId === child!.id);
  expect(childRun).toBeDefined();
  expect(await settled(f.harness, childRun!.id)).toMatchObject({ state: "completed", inference: { kind: "api", providerId: f.provider.id } });
  expect(f.requests.some((request) => String(request.body.messages.at(-1)?.content).includes("Child task: size the market"))).toBe(true);
  // The task and the answer live in the recruiter's team channel.
  const team = (await f.harness.groups.list()).find((group) => group.memberIds.includes(child!.id));
  expect(team).toBeDefined();
  expect(JSON.stringify(await f.harness.threads.get({ groupId: team!.id }))).toContain("Child answered");
});
