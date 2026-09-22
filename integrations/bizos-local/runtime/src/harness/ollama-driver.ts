import type { CodexDynamicTool, CodexTurnHandle, RuntimeEvent } from "./codex-driver.js";
import { inspectOllamaModel, ollamaJson } from "./ollama.js";

export interface OllamaTurnInput {
  baseUrl: string;
  model: string;
  system: string;
  text: string;
  threadId: string;
  runId: string;
  /** Quick chats have no team tools. Agents require tool-capable models. */
  agent?: boolean;
  dynamicTools: CodexDynamicTool[];
  onEvent(event: RuntimeEvent): void;
  fetchImpl?: typeof fetch;
}

type Message = Record<string, unknown>;
const MAX_ROUNDS = 12;
const MAX_CALLS = 32;
const MAX_ARG_CHARS = 32_000;
const MAX_TOOL_OUTPUT = 10_000;
const MAX_CONTEXT_TOKENS = 65_536;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function startOllamaTurn(input: OllamaTurnInput): CodexTurnHandle {
  const aborter = new AbortController();
  let cancelled = false;
  let finished = false;
  const emit = (event: RuntimeEvent) => { if (!finished && !cancelled) input.onEvent(event); };
  const terminal = (ok: boolean, reason: string | null) => {
    if (finished) return;
    finished = true;
    input.onEvent({ type: "turn.completed", ok, stopReason: reason });
  };
  const handle: CodexTurnHandle = {
    stop() { if (finished) return; cancelled = true; aborter.abort(); terminal(false, "cancelled"); },
    respond() { return "unavailable"; },
    sessionId() { return null; },
    settled() { return finished; },
  };

  void (async () => {
    try {
      emit({ type: "turn.started" });
      emit({ type: "session.started", sessionId: null, model: input.model });
      const inspected = await inspectOllamaModel(input.baseUrl, input.model, input.agent === true, { fetchImpl: input.fetchImpl, signal: aborter.signal });
      if (cancelled) return;
      const numCtx = Math.min(MAX_CONTEXT_TOKENS, inspected.contextLength ?? 32_768);
      // UTF-8 bytes conservatively bound the token count even for non-ASCII
      // text. Reserve 2k tokens for the model's answer and tool arguments.
      const maxRequestBytes = numCtx - 2_048;
      if (Buffer.byteLength(input.text) + Buffer.byteLength(input.system) > maxRequestBytes) throw new Error("Ollama prompt exceeds the selected model's context limit.");
      const messages: Message[] = [{ role: "system", content: input.system }, { role: "user", content: input.text }];
      const tools = input.agent ? input.dynamicTools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) : [];
      let calls = 0;
      let attributed = false;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (cancelled) return;
        const request = {
          model: input.model, messages, stream: false, think: false,
          options: { num_ctx: numCtx, num_predict: 1024 },
          ...(tools.length ? { tools } : {}),
        };
        if (Buffer.byteLength(JSON.stringify(request)) > maxRequestBytes) throw new Error("Ollama context exceeds the selected model's context limit.");
        const body = await ollamaJson(input.baseUrl, "/api/chat", request, { fetchImpl: input.fetchImpl, signal: aborter.signal, timeoutMs: 300_000 });
        if (cancelled) return;
        if (!record(body) || body.done !== true || !record(body.message) || body.message.role !== "assistant"
          || typeof body.message.content !== "string") throw new Error("Ollama returned a malformed or incomplete chat response.");
        if ((typeof body.remote_model === "string" && body.remote_model.trim())
          || (typeof body.remote_host === "string" && body.remote_host.trim())
          || (typeof body.model === "string" && /(?:[:\-]cloud)(?:$|[.:\-])/i.test(body.model))) {
          throw new Error("Ollama routed this response to a remote model; local execution is required.");
        }
        if (typeof body.model !== "string" || body.model !== input.model) throw new Error("Ollama did not identify the exact selected model in its response.");
        if (body.done_reason === "length") throw new Error("Ollama stopped at its generation limit; the answer is incomplete.");
        if (!attributed) { emit({ type: "ollama.model.verified" }); attributed = true; }
        if (typeof body.prompt_eval_count === "number" && Number.isSafeInteger(body.prompt_eval_count) && body.prompt_eval_count >= 0
          && typeof body.eval_count === "number" && Number.isSafeInteger(body.eval_count) && body.eval_count >= 0) {
          emit({ type: "token-usage", input: body.prompt_eval_count, output: body.eval_count });
        }
        const message = body.message;
        const content = message.content as string;
        if (content.length > MAX_TOOL_OUTPUT) throw new Error("Ollama answer exceeds the local size limit.");
        const rawCalls = message.tool_calls;
        if (rawCalls !== undefined && (!Array.isArray(rawCalls) || rawCalls.length > MAX_CALLS)) throw new Error("Ollama returned malformed tool calls.");
        const requested = Array.isArray(rawCalls) ? rawCalls : [];
        if (!content.trim() && !requested.length) throw new Error("Ollama returned an empty answer.");
        if (cancelled) return;
        if (content.trim()) emit({ type: "item.completed", itemType: "assistant_text", text: content, itemId: `ollama-${round}`, phase: requested.length ? "commentary" : "final_answer" });
        if (!requested.length) { terminal(true, null); return; }
        // Native history includes the original assistant tool calls and optional
        // thinking, but thinking never becomes a public RuntimeEvent.
        messages.push({ role: "assistant", content, ...(typeof message.thinking === "string" ? { thinking: message.thinking.slice(0, 40_000) } : {}), tool_calls: requested });
        for (let index = 0; index < requested.length; index++) {
          if (cancelled) return;
          calls++;
          if (calls > MAX_CALLS) throw new Error("Ollama tool-call limit reached.");
          const requestedCall = requested[index];
          if (!record(requestedCall) || !record(requestedCall.function) || typeof requestedCall.function.name !== "string"
            || !record(requestedCall.function.arguments) || JSON.stringify(requestedCall.function.arguments).length > MAX_ARG_CHARS) {
            throw new Error("Ollama returned malformed tool arguments.");
          }
          const name = requestedCall.function.name;
          const tool = input.agent ? input.dynamicTools.find(candidate => candidate.name === name) : undefined;
          if (!tool) throw new Error(`Ollama requested unavailable tool ${name.slice(0, 100)}.`);
          const callId = `${input.runId}:${round}:${index}`;
          emit({ type: "item.started", itemType: "tool", itemId: callId, title: name });
          let result: string;
          let ok = true;
          try {
            const value = await tool.call(requestedCall.function.arguments, { callId, threadId: input.threadId, turnId: input.runId });
            result = JSON.stringify(value ?? null);
            if (result.length > MAX_TOOL_OUTPUT) result = JSON.stringify({
              status: "completed", result_truncated: true,
              message: "The host tool completed, but its result exceeded the local display limit. Do not repeat a write; inspect current state with an available read tool if needed.",
            });
          } catch (error) {
            ok = false;
            result = JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) });
          }
          if (cancelled) return;
          emit({ type: "item.completed", itemType: "tool", itemId: callId, ok });
          messages.push({ role: "tool", tool_name: name, content: result });
        }
      }
      throw new Error("Ollama tool-round limit reached.");
    } catch (error) {
      if (cancelled || finished) return;
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "runtime.error", message });
      terminal(false, message);
    }
  })();
  return handle;
}
