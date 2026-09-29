// A real disposable sidecar and scheduler, with a local fake OpenAI-compatible
// endpoint. No connected CLI, production account, email or external API.
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(runtime, "dist/sidecar.js");
const built = existsSync(script) && existsSync(join(runtime, "dist/agency-kit/lib/app.mjs"));
let root: string, child: ChildProcess, provider: Server, bridge: Server, descriptor: { origin: string; token: string };
let providerOrigin = "", workerId = "", cancelId = "", ceoId = "", ceoThread = "", calls = 0;
let bridgeCalls: Array<{ operation: string; body: Record<string, unknown> }> = [];
let linked = true, statusWorkspaceId = "", computerAvailable = false;
let offeredTools: string[] = [];
let logs = "";

async function waitFor<T>(probe: () => Promise<T | null> | T | null, what: string, timeout = 50_000): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    let value: T | null = null;
    try { value = await probe(); } catch { /* wait for the process */ }
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}; sidecar tail: ${logs.slice(-600)}`);
}
async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(new URL(path, descriptor.origin), { method, headers: {
    authorization: `Bearer ${descriptor.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
async function send(threadId: string, content: string) {
  const result = await api("POST", `/api/collaboration/threads/${encodeURIComponent(threadId)}/messages`, { content, clientMessageId: randomUUID() });
  expect(result.status).toBe(201);
  return result;
}
async function settle(result: { body: any }, what: string) {
  const runId = result.body.runs?.[0]?.runId;
  expect(runId).toBeTruthy();
  return waitFor(async () => {
    const run = (await api("GET", `/api/collaboration/runs/${encodeURIComponent(runId)}`)).body;
    return ["done", "failed", "cancelled"].includes(run.state) ? run : null;
  }, what, 30_000);
}

describe.skipIf(!built)("real sidecar CEO routine ownership", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "lbz-routine-real-"));
    mkdirSync(join(root, "home"));
    mkdirSync(join(root, "codex"));
    mkdirSync(join(root, "claude"));
    mkdirSync(join(root, "state"));
    const instance = randomUUID();
    const workspaceId = `os_${randomUUID().replaceAll("-", "")}`;
    statusWorkspaceId = workspaceId;
    const orgId = randomUUID();
    const bridgeSecret = randomBytes(32).toString("hex");
    writeFileSync(join(root, "state", "instance.json"), JSON.stringify({ version: 1, instanceId: instance }));
    bridge = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const expected = createHmac("sha256", bridgeSecret).update(`${workspaceId}\0continuity`).digest("hex");
      if (request.url !== "/v1/continuity" || request.headers.authorization !== `Bearer ${expected}` || request.headers["x-bizos-workspace"] !== workspaceId) {
        response.writeHead(403); response.end(); return;
      }
      const call = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { operation: string; body: Record<string, unknown> };
      bridgeCalls.push(call);
      const result = call.operation === "status"
        ? { linked, toolsAvailable: linked, orgId, workspaceId: statusWorkspaceId }
        : call.operation === "computer/status"
          ? { available: computerAvailable, configured: computerAvailable }
        : call.operation === "tools/email-inbox"
          ? { address: "fixture@createbizos.com", items: [{ subject: "Fixture inbox" }] }
          : call.operation === "tools/site-unpublish"
            ? { unpublished: true, siteId: call.body.site_id }
          : null;
      response.writeHead(result ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(result ? { ok: true, result } : { ok: false, code: "not_found" }));
    });
    await new Promise<void>(resolveListen => bridge.listen(0, "127.0.0.1", resolveListen));
    const bridgePath = join(root, "bridge.json");
    writeFileSync(bridgePath, JSON.stringify({ version: 1, origin: `http://127.0.0.1:${(bridge.address() as { port: number }).port}`, workspaceId, secret: bridgeSecret }));
    provider = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Array<{ role: string; content?: string }>; tools?: Array<{ function?: { name?: string } }> };
      offeredTools = (body.tools ?? []).map(tool => tool.function?.name ?? "");
      calls += 1;
      const last = body.messages.at(-1);
      let message: Record<string, unknown>;
      if (last?.role === "tool") message = { role: "assistant", content: "Done." };
      else if (String(last?.content).includes("SCHEDULE_WORKER")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: {
        name: "schedule_routine", arguments: JSON.stringify({ name: "Worker check", prompt: "ROUTINE_WORKER_MARKER: give a short status", frequency: "once", at: new Date(Date.now() + 5_000).toISOString(), owner_agent_id: workerId }),
      } }] };
      else if (String(last?.content).includes("SCHEDULE_CANCEL")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: {
        name: "schedule_routine", arguments: JSON.stringify({ name: "Cancelled check", prompt: "Never run this", frequency: "once", at: new Date(Date.now() + 600_000).toISOString(), owner_agent_id: workerId }),
      } }] };
      else if (String(last?.content).includes("SCHEDULE_FOR_CEO")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: {
        name: "schedule_routine", arguments: JSON.stringify({ name: "Unauthorized check", prompt: "Should never run", frequency: "once", at: new Date(Date.now() + 600_000).toISOString(), owner_agent_id: ceoId }),
      } }] };
      else if (String(last?.content).includes("LIST_ROUTINES")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: { name: "list_routines", arguments: "{}" } }] };
      else if (String(last?.content).includes("CANCEL_ROUTINE")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: { name: "cancel_routine", arguments: JSON.stringify({ routine_id: cancelId }) } }] };
      else if (String(last?.content).includes("SEND_INBOX_TOOL")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: { name: "bizos_email_inbox", arguments: "{}" } }] };
      else if (String(last?.content).includes("UNPUBLISH_SITE_TOOL")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: { name: "bizos_site_unpublish", arguments: JSON.stringify({ site_id: "site-fixture", operation_id: "operation-fixture" }) } }] };
      else if (String(last?.content).includes("CHECK_COMPUTER_TOOL")) message = { role: "assistant", content: "Computer tools checked." };
      else if (String(last?.content).includes("RECRUIT_SPECIALIST")) message = { role: "assistant", content: null, tool_calls: [{ id: randomUUID(), type: "function", function: { name: "recruit_agent", arguments: JSON.stringify({ name: "Lena", title: "Market researcher", description: "Research the market and report practical findings", initial_task: "Find three useful market signals" }) } }] };
      else if (String(last?.content).includes("Introduce yourself to the person")) message = { role: "assistant", content: "Hello, j'espère que tu vas bien. Ari m'a briefée pour étudier le marché et te partager des pistes concrètes. Tu peux me solliciter quand tu veux." };
      else message = { role: "assistant", content: "Routine ran for worker." };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
    await new Promise<void>(resolveListen => provider.listen(0, "127.0.0.1", resolveListen));
    providerOrigin = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
    const descriptorPath = join(root, "descriptor.json");
    child = spawn(process.execPath, [script, "serve"], { cwd: runtime, env: {
      HOME: join(root, "home"), CODEX_HOME: join(root, "codex"), CLAUDE_CONFIG_DIR: join(root, "claude"),
      PATH: "/usr/bin:/bin", TMPDIR: root, LOCALBIZOS_SIDECAR_STATE: join(root, "state"), LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath,
      LOCALBIZOS_NATIVE_COMPUTER_DESCRIPTOR: bridgePath,
    }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", chunk => { logs += chunk.toString(); });
    child.stderr?.on("data", chunk => { logs += chunk.toString(); });
    descriptor = await waitFor(() => { try { return JSON.parse(readFileSync(descriptorPath, "utf8")); } catch { return null; } }, "descriptor", 30_000);
    await waitFor(async () => (await api("GET", "/api/local/health")).status === 200 || null, "health", 30_000);
  }, 60_000);
  afterAll(async () => {
    if (child?.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolveExit => child.once("exit", resolveExit)); }
    if (provider) await new Promise<void>(resolveClose => provider.close(() => resolveClose()));
    if (bridge) await new Promise<void>(resolveClose => bridge.close(() => resolveClose()));
    if (root) await rm(root, { recursive: true, force: true });
  }, 60_000);

  it("CEO schedules for a teammate; the scheduler runs that teammate; CEO lists and cancels", async () => {
    const providerResult = await api("POST", "/api/local/providers", { kind: "openai-compatible", label: "Fixture", apiKey: "fixture-only", baseUrl: providerOrigin, model: "fixture-model" });
    expect(providerResult.status).toBe(201);
    expect((await api("POST", "/api/local/runtime/inference", { source: "provider", providerId: providerResult.body.provider.id })).status).toBe(200);
    const ceo = await api("POST", "/api/local/bots", { name: "Ari", title: "CEO" });
    const worker = await api("POST", "/api/local/bots", { name: "Mina", title: "Researcher" });
    expect(ceo.status).toBe(201);
    expect(worker.status).toBe(201);
    ceoId = ceo.body.agent.agentId;
    ceoThread = ceo.body.thread.id;
    workerId = worker.body.agent.agentId;
    await send(ceo.body.thread.id, "SCHEDULE_WORKER");
    const scheduled = await waitFor(async () => (await api("GET", "/api/crons")).body.items.find((row: any) => row.name === "Worker check") ?? null, "scheduled routine");
    expect(scheduled.agent_id).toBe(workerId);
    await waitFor(async () => (await api("GET", `/api/crons/${scheduled.id}/runs`)).body.items.find((row: any) => row.state === "done") ?? null, "worker routine run", 50_000);
    expect(JSON.stringify((await api("GET", `/api/collaboration/threads/${encodeURIComponent(worker.body.thread.id)}/messages`)).body)).toContain("Routine ran for worker");
    await send(ceo.body.thread.id, "SCHEDULE_CANCEL");
    const cancellable = await waitFor(async () => (await api("GET", "/api/crons")).body.items.find((row: any) => row.name === "Cancelled check") ?? null, "second routine");
    cancelId = cancellable.id;
    const callsBeforeList = calls;
    await send(ceo.body.thread.id, "LIST_ROUTINES");
    await waitFor(async () => calls >= callsBeforeList + 2 || null, "list tool turn");
    await send(ceo.body.thread.id, "CANCEL_ROUTINE");
    await waitFor(async () => !(await api("GET", "/api/crons")).body.items.some((row: any) => row.id === cancelId) || null, "cancelled routine");
    expect((await api("GET", `/api/crons/${cancelId}/runs`)).body.items).toEqual([]);
    const callsBeforeDenied = calls;
    await send(worker.body.thread.id, "SCHEDULE_FOR_CEO");
    await waitFor(() => calls >= callsBeforeDenied + 2 || null, "denied worker tool turn");
    expect((await api("GET", "/api/crons")).body.items.some((row: any) => row.name === "Unauthorized check")).toBe(false);
  }, 95_000);

  it("routes a mounted BizOS tool from the real sidecar over the HMAC desktop bridge", async () => {
    expect(ceoThread).toBeTruthy();
    const before = bridgeCalls.length;
    await send(ceoThread, "SEND_INBOX_TOOL");
    const call = await waitFor(() => bridgeCalls.slice(before).find(row => row.operation === "tools/email-inbox") ?? null, "signed inbox bridge call");
    expect(call.body.workspaceId).toMatch(/^os_/);
    expect(typeof call.body.orgId).toBe("string");
    expect(JSON.stringify(call)).not.toMatch(/secret|apiKey|providerKey/);
  }, 30_000);

  it("refuses unlinked or mismatched status before sending a BizOS tool call", async () => {
    const before = bridgeCalls.filter(row => row.operation === "tools/email-inbox").length;
    const originalWorkspaceId = statusWorkspaceId;
    linked = false;
    const firstTurn = calls;
    await settle(await send(ceoThread, "SEND_INBOX_TOOL"), "unlinked tool refusal");
    expect(calls).toBeGreaterThan(firstTurn);
    expect(bridgeCalls.filter(row => row.operation === "tools/email-inbox")).toHaveLength(before);
    linked = true;
    statusWorkspaceId = "os_different_workspace";
    const secondTurn = calls;
    await settle(await send(ceoThread, "SEND_INBOX_TOOL"), "mismatched workspace refusal");
    expect(calls).toBeGreaterThan(secondTurn);
    expect(bridgeCalls.filter(row => row.operation === "tools/email-inbox")).toHaveLength(before);
    statusWorkspaceId = originalWorkspaceId;
  }, 30_000);

  it("dispatches site unpublish over the signed desktop bridge", async () => {
    const before = bridgeCalls.length;
    const run = await settle(await send(ceoThread, "UNPUBLISH_SITE_TOOL"), "unpublish tool turn");
    expect(offeredTools, JSON.stringify({ run, bridge: bridgeCalls.slice(before), logs: logs.slice(-500) })).toContain("bizos_site_unpublish");
    const call = bridgeCalls.slice(before).find(row => row.operation === "tools/site-unpublish");
    expect(call, JSON.stringify({ run, bridge: bridgeCalls.slice(before), logs: logs.slice(-500) })).toBeDefined();
    expect(call?.body).toMatchObject({ workspaceId: statusWorkspaceId, site_id: "site-fixture", operation_id: "operation-fixture" });
  }, 30_000);

  it("mounts server computer tools on the next turn when signed availability changes, even on a free local plan", async () => {
    expect((await api("GET", "/api/local/entitlement")).body).toMatchObject({ tier: "free", features: { cloudComputer: false } });
    computerAvailable = true;
    const before = calls;
    await settle(await send(ceoThread, "CHECK_COMPUTER_TOOL"), "computer-enabled model turn");
    expect(calls).toBeGreaterThan(before);
    expect(offeredTools).toContain("computer_observe");
    expect(bridgeCalls.some(row => row.operation === "computer/status" && row.body.workspaceId === statusWorkspaceId)).toBe(true);
    computerAvailable = false;
    const after = calls;
    await settle(await send(ceoThread, "CHECK_COMPUTER_TOOL"), "computer-disabled model turn");
    expect(calls).toBeGreaterThan(after);
    expect(offeredTools).not.toContain("computer_observe");
  }, 30_000);

  it("lets a new recruit write its own short first message in its direct chat", async () => {
    await send(ceoThread, "RECRUIT_SPECIALIST");
    const thread = await waitFor(async () => (await api("GET", "/api/collaboration/bootstrap")).body.threads.find((row: any) => row.kind === "agent" && row.name === "Lena") ?? null, "recruit direct chat");
    const messages = await waitFor(async () => {
      const result = (await api("GET", `/api/collaboration/threads/${encodeURIComponent(thread.id)}/messages`)).body;
      return JSON.stringify(result).includes("Ari m'a briefée") ? result : null;
    }, "recruit greeting", 30_000);
    expect(messages.messages[0].role).toBe("assistant");
    expect(messages.messages[0].senderName).toBe("Lena");
    expect(JSON.stringify(messages)).toContain("Tu peux me solliciter");
  }, 40_000);
});
