import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startOllamaTurn } from "../src/harness/ollama-driver.js";
import type { RuntimeEvent } from "../src/harness/codex-driver.js";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });
it("calls an authorized host tool and returns its actual result to native chat", async () => {
  const requests: any[] = [];
  let calls = 0;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [{ name: "test:1" }] })); return; }
    if (req.url === "/api/show") { res.end(JSON.stringify({ capabilities: ["completion", "tools"], details: { family: "test" } })); return; }
    requests.push(body);
    res.end(JSON.stringify(requests.length === 1
      ? { model: "test:1", done: true, message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_state", arguments: { scope: "self" } } }] }, prompt_eval_count: 3, eval_count: 2 }
      : { model: "test:1", done: true, message: { role: "assistant", content: "Observed result" }, prompt_eval_count: 5, eval_count: 4 }));
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const events: RuntimeEvent[] = [];
  startOllamaTurn({ baseUrl: url, model: "test:1", system: "system", text: "read", threadId: "bot:x", runId: "run:x", agent: true, dynamicTools: [{ name: "read_state", description: "Read", inputSchema: { type: "object" }, call: async (args, context) => { calls++; expect(args).toEqual({ scope: "self" }); expect(context).toMatchObject({ threadId: "bot:x", turnId: "run:x" }); return { value: 42 }; } }], onEvent: event => events.push(event) });
  await new Promise<void>((resolve, reject) => { const timer = setInterval(() => { if (events.some(e => e.type === "turn.completed")) { clearInterval(timer); resolve(); } }, 5); setTimeout(() => { clearInterval(timer); reject(new Error("timeout")); }, 3000); });
  expect(calls).toBe(1);
  expect(requests[1].messages.at(-1)).toMatchObject({ role: "tool", tool_name: "read_state", content: '{"value":42}' });
  expect(requests.every(request => request.model === "test:1")).toBe(true);
  expect(events).toContainEqual({ type: "token-usage", input: 3, output: 2 });
  expect(events).toContainEqual({ type: "token-usage", input: 5, output: 4 });
  expect(events).toContainEqual({ type: "turn.completed", ok: true, stopReason: null });
});

it("STOP aborts an in-flight chat and ignores a late answer", async () => {
  let chatStarted!: () => void;
  const started = new Promise<void>(resolve => { chatStarted = resolve; });
  server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "test:1" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion"], details: { family: "test" } }));
    chatStarted();
    setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ model: "test:1", done: true, message: { role: "assistant", content: "Late" } })); }, 100);
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const events: RuntimeEvent[] = [];
  const handle = startOllamaTurn({ baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: "test:1", system: "system", text: "text", threadId: "chat:x", runId: "run:x", dynamicTools: [], onEvent: event => events.push(event) });
  await started;
  handle.stop();
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(events.filter(event => event.type === "turn.completed")).toEqual([{ type: "turn.completed", ok: false, stopReason: "cancelled" }]);
  expect(events.some(event => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(false);
});

it("rejects a remotely routed or truncated chat before publishing text or executing tools", async () => {
  let reply: unknown = null;
  let calls = 0;
  server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "test:1" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "tools"], details: { family: "test" } }));
    res.end(JSON.stringify(reply));
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const unsafe of [
    { model: "test:1", done: true, remote_host: "cloud.example", message: { role: "assistant", content: "Secret", tool_calls: [{ function: { name: "write", arguments: {} } }] } },
    { model: "test:1", done: true, done_reason: "length", message: { role: "assistant", content: "Half an answer" } },
  ]) {
    reply = unsafe;
    const events: RuntimeEvent[] = [];
    startOllamaTurn({ baseUrl, model: "test:1", system: "system", text: "text", threadId: "bot:x", runId: "run:x", agent: true,
      dynamicTools: [{ name: "write", description: "Write", inputSchema: { type: "object" }, call: async () => { calls++; return {}; } }], onEvent: event => events.push(event) });
    await new Promise<void>((resolve, reject) => { const timer = setInterval(() => { if (events.some(e => e.type === "turn.completed")) { clearInterval(timer); resolve(); } }, 5); setTimeout(() => { clearInterval(timer); reject(new Error("timeout")); }, 3000); });
    expect(events.some(event => event.type === "item.completed" || event.type === "token-usage" || event.type === "ollama.model.verified")).toBe(false);
    expect(events.find(event => event.type === "turn.completed")).toMatchObject({ ok: false });
  }
  expect(calls).toBe(0);
});

it("retains a full production-sized tool schema and result within the selected model context", async () => {
  const requests: any[] = [];
  let writes = 0;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "test:1" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "tools"], details: { family: "test" }, model_info: { "test.context_length": 40960 } }));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.end(JSON.stringify(requests.length === 1
      ? { model: "test:1", done: true, message: { role: "assistant", content: "", tool_calls: [{ function: { name: "write_record", arguments: {} } }] } }
      : { model: "test:1", done: true, message: { role: "assistant", content: "Done" } }));
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const events: RuntimeEvent[] = [];
  startOllamaTurn({ baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: "test:1",
    system: "P".repeat(5000), text: "H".repeat(4000), threadId: "bot:x", runId: "run:x", agent: true,
    dynamicTools: [{ name: "write_record", description: "S".repeat(15405), inputSchema: { type: "object" }, call: async () => { writes++; return { data: "R".repeat(12000) }; } }],
    onEvent: event => events.push(event) });
  await new Promise<void>((resolve, reject) => { const timer = setInterval(() => { if (events.some(e => e.type === "turn.completed")) { clearInterval(timer); resolve(); } }, 5); setTimeout(() => { clearInterval(timer); reject(new Error("timeout")); }, 3000); });
  expect(requests).toHaveLength(2);
  expect(requests[0].tools[0].function.description).toHaveLength(15405);
  expect(writes).toBe(1);
  expect(requests[1].messages.at(-1).content).toContain('"result_truncated":true');
  expect(events).toContainEqual({ type: "item.completed", itemType: "tool", itemId: "run:x:0:0", ok: true });
  expect(events.find(event => event.type === "turn.completed")).toMatchObject({ ok: true });
});
