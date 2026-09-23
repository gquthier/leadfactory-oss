// The native OpenAI-compatible chat-completions driver (Gemini, OpenRouter…)
// against a fake server: SSE streaming, tool calls assembled from pieces,
// provider extras echoed back, plain JSON answers, STOP and API errors.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/harness/codex-driver.js";
import { startOpenAiTurn, type OpenAiTurnInput } from "../src/harness/openai-driver.js";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

interface Seen { url: string; authorization: string | undefined; body: any }

async function serve(answer: (body: any, res: ServerResponse, index: number) => void): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    seen.push({ url: req.url ?? "", authorization: req.headers.authorization, body });
    answer(body, res, seen.length - 1);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server!.address() as any).port}/v1beta/openai`, seen };
}

function sse(res: ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end("data: [DONE]\n\n");
}

async function run(input: Partial<OpenAiTurnInput> & Pick<OpenAiTurnInput, "baseUrl">): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  startOpenAiTurn({ apiKey: "sk-test", model: "gemini-flash", label: "Gemini", system: "system", text: "hi", threadId: "bot:x", runId: "run:x",
    dynamicTools: [], ...input, onEvent: (event) => events.push(event) });
  await waitFor(() => events.some((event) => event.type === "turn.completed"));
  return events;
}

async function waitFor(probe: () => boolean): Promise<void> {
  for (let n = 0; n < 400 && !probe(); n++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(probe()).toBe(true);
}

it("streams text as deltas, then publishes the whole answer with usage", async () => {
  const { base, seen } = await serve((_body, res) => sse(res, [
    { choices: [{ index: 0, delta: { role: "assistant", content: "O" } }] },
    { choices: [{ index: 0, delta: { content: "K" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 1 } },
  ]));
  const events = await run({ baseUrl: base });
  expect(seen[0]).toMatchObject({ url: "/v1beta/openai/chat/completions", authorization: "Bearer sk-test" });
  expect(seen[0]!.body).toMatchObject({ model: "gemini-flash", stream: true, messages: [{ role: "system", content: "system" }, { role: "user", content: "hi" }] });
  expect(seen[0]!.body.tools).toBeUndefined();
  expect(events.filter((event) => event.type === "content.delta").map((event) => (event as { delta: string }).delta)).toEqual(["O", "K"]);
  expect(events).toContainEqual({ type: "item.completed", itemType: "assistant_text", text: "OK", itemId: "api-0", phase: "final_answer" });
  expect(events).toContainEqual({ type: "token-usage", input: 7, output: 1 });
  expect(events).toContainEqual({ type: "external.model.verified" });
  expect(events.at(-1)).toEqual({ type: "turn.completed", ok: true, stopReason: null });
});

it("assembles a streamed tool call, runs the host tool once and echoes provider extras back", async () => {
  const calls: unknown[] = [];
  const { base, seen } = await serve((_body, res, index) => index === 0
    ? sse(res, [
      { choices: [{ index: 0, delta: { content: "Checking.", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_state", arguments: "{\"sco" }, extra_content: { google: { thought_signature: "sig" } } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "pe\":\"self\"}" } }] }, finish_reason: "tool_calls" }] },
    ])
    : sse(res, [{ choices: [{ index: 0, delta: { content: "Value 42" }, finish_reason: "stop" }] }]));
  const events = await run({ baseUrl: base, agent: true, dynamicTools: [{
    name: "read_state", description: "Read", inputSchema: { type: "object" },
    call: async (args, context) => { calls.push({ args, context }); return { value: 42 }; },
  }] });
  expect(calls).toEqual([{ args: { scope: "self" }, context: { callId: "run:x:0:0", threadId: "bot:x", turnId: "run:x" } }]);
  expect(seen[0]!.body.tools).toEqual([{ type: "function", function: { name: "read_state", description: "Read", parameters: { type: "object" } } }]);
  expect(seen[1]!.body.messages.slice(-2)).toEqual([
    { role: "assistant", content: "Checking.", tool_calls: [{ extra_content: { google: { thought_signature: "sig" } }, id: "call_1", type: "function", function: { name: "read_state", arguments: "{\"scope\":\"self\"}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "{\"value\":42}" },
  ]);
  expect(events).toContainEqual({ type: "item.completed", itemType: "assistant_text", text: "Checking.", itemId: "api-0", phase: "commentary" });
  expect(events).toContainEqual({ type: "item.completed", itemType: "tool", itemId: "run:x:0:0", ok: true });
  expect(events.at(-1)).toEqual({ type: "turn.completed", ok: true, stopReason: null });
});

it("accepts a plain JSON answer and tells the model about a tool it does not have", async () => {
  const { base, seen } = await serve((_body, res, index) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(index === 0
      ? { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "rm_rf", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }
      : { choices: [{ message: { role: "assistant", content: "Sorry" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
  });
  const events = await run({ baseUrl: base, agent: true });
  expect(seen[1]!.body.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: "{\"error\":\"unknown tool rm_rf\"}" });
  expect(events).toContainEqual({ type: "item.completed", itemType: "tool", itemId: "run:x:0:0", ok: false });
  expect(events.at(-1)).toEqual({ type: "turn.completed", ok: true, stopReason: null });
});

it("reports a refused key without leaking it, and STOP aborts an answer in flight", async () => {
  const refused = await serve((_body, res) => { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "bad key sk-test" } })); });
  const events = await run({ baseUrl: refused.base });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
  expect(JSON.stringify(events)).toContain("Gemini refused the API key (401)");
  expect(JSON.stringify(events)).not.toContain("sk-test");
  await new Promise<void>((resolve) => server!.close(() => resolve()));

  let started!: () => void;
  const inFlight = new Promise<void>((resolve) => { started = resolve; });
  const slow = await serve((_body, res) => {
    started();
    setTimeout(() => { if (!res.destroyed) sse(res, [{ choices: [{ delta: { content: "Late" }, finish_reason: "stop" }] }]); }, 100);
  });
  const stopped: RuntimeEvent[] = [];
  const handle = startOpenAiTurn({ baseUrl: slow.base, apiKey: "k", model: "m", system: "s", text: "t", threadId: "chat:x", runId: "r", dynamicTools: [], onEvent: (event) => stopped.push(event) });
  await inFlight;
  handle.stop();
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(stopped.filter((event) => event.type === "turn.completed")).toEqual([{ type: "turn.completed", ok: false, stopReason: "cancelled" }]);
  expect(stopped.some((event) => event.type === "item.completed")).toBe(false);
});

it("refuses a truncated answer", async () => {
  const { base } = await serve((_body, res) => sse(res, [{ choices: [{ delta: { content: "Half" }, finish_reason: "length" }] }]));
  const events = await run({ baseUrl: base });
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: expect.stringContaining("output limit") });
  expect(events.some((event) => event.type === "item.completed")).toBe(false);
});
