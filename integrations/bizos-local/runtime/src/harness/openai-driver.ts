// Native OpenAI-compatible chat-completions driver (Gemini, OpenRouter,
// Groq, Together, a self-hosted vLLM…).
//
// Why native: Codex CLI dropped `wire_api = "chat"` (0.155 refuses the
// config: "`wire_api = \"chat\"` is no longer supported"), so the
// `model_providers` bridge can no longer reach a Chat Completions endpoint.
// This driver is the Ollama driver's twin for a remote API: the same agent
// loop over the host's dynamic tools (team tools: recruit_agent,
// schedule_routine, manage_agent, checkpoint_task, and pack tools), the same
// RuntimeEvents, STOP aborts the request in flight. Text streams as SSE
// `content.delta`; a provider that answers plain JSON is accepted too.
//
// The key travels only in the `authorization` header of the request to the
// address the person configured; it is never put in a prompt or an event.
import type { CodexDynamicTool, CodexTurnHandle, RuntimeEvent } from "./codex-driver.js";
import { isRichToolResult } from "./tool-result.js";
import { createHash, randomUUID } from "node:crypto";
import { ContinuityBridgeError } from "../continuity-bridge.js";

export interface OpenAiTurnInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** What the person called this provider ("Gemini"), for error lines. */
  label?: string;
  system: string;
  text: string;
  threadId: string;
  runId: string;
  /** Quick chats have no team tools. */
  agent?: boolean;
  dynamicTools: CodexDynamicTool[];
  onEvent(event: RuntimeEvent): void;
  fetchImpl?: typeof fetch;
  /** Signed BizOS bridge. When present, no URL, key, provider id or model is
   * sent. The normal host tool loop consumes its non-streaming completion. */
  chatCompletion?: (body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  /** Per-request timeout. */
  timeoutMs?: number;
}

type Message = Record<string, unknown>;
interface ToolCall { id: string; name: string; arguments: string; extra: Record<string, unknown> }

const MAX_ROUNDS = 12;
const MAX_CALLS = 32;
const MAX_ARG_CHARS = 32_000;
const MAX_TOOL_OUTPUT = 10_000;
const MAX_ANSWER_CHARS = 60_000;

function bizosBridgeErrorMessage(code: string): string {
  switch (code) {
    case "insufficient_credits":
    case "insufficient_work_credits":
      return "Crédits BizOS insuffisants. Rechargez vos Work Credits pour continuer.";
    case "rate_limited":
      return "BizOS reçoit trop de demandes. Réessayez dans un instant.";
    case "inference_disabled":
    case "feature_disabled":
      return "L'inférence BizOS est temporairement indisponible.";
    case "budget_exhausted":
      return "Budget d'inférence BizOS atteint pour ce tour. Envoyez un nouveau message pour continuer.";
    case "unlinked":
    case "forbidden":
      return "Connectez ce Mac à votre compte et à votre organisation BizOS, puis réessayez.";
    case "continuation_required":
    case "continuation_mismatch":
      return "Le tour d'outils BizOS a perdu sa continuité. Relancez votre demande dans un nouveau message.";
    default:
      return "L'inférence BizOS a échoué. Réessayez.";
  }
}

/** The runtime run id is opaque but not UUID-shaped. Derive a UUID so a
 * resumed local run keeps the same credit admission identity. */
function clientTurnUuid(runId: string): string {
  const dnsNamespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1").update(dnsNamespace).update(`bizos-inference-v1:${runId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/** Folds one chunk's `delta.tool_calls` into the calls being assembled.
 * Unknown keys (Gemini's `extra_content.google.thought_signature`) are
 * kept and echoed back: Gemini refuses a follow-up without them. */
function mergeToolCalls(into: ToolCall[], deltas: unknown): void {
  if (!Array.isArray(deltas)) return;
  for (let position = 0; position < deltas.length; position++) {
    const delta = deltas[position];
    if (!record(delta)) continue;
    const index = typeof delta.index === "number" && Number.isSafeInteger(delta.index) && delta.index >= 0 && delta.index < MAX_CALLS
      ? delta.index : position;
    const call = into[index] ?? (into[index] = { id: "", name: "", arguments: "", extra: {} });
    if (typeof delta.id === "string" && delta.id) call.id = delta.id;
    const fn = record(delta.function) ? delta.function : {};
    if (typeof fn.name === "string" && fn.name) call.name = call.name && call.name !== fn.name ? call.name + fn.name : fn.name;
    if (typeof fn.arguments === "string") call.arguments += fn.arguments;
    else if (record(fn.arguments)) call.arguments = JSON.stringify(fn.arguments);
    for (const [key, value] of Object.entries(delta)) {
      if (!["index", "id", "type", "function"].includes(key) && !(key in call.extra)) call.extra[key] = value;
    }
    if (call.arguments.length > MAX_ARG_CHARS) throw new Error("The API returned tool arguments over the local size limit.");
  }
}

interface EncryptedReasoning { type: "reasoning.encrypted"; data: string }
interface Round { content: string; calls: ToolCall[]; finish: string | null; usage?: { input: number; output: number; cached?: number }; reasoningDetails?: EncryptedReasoning[] }

function encryptedReasoning(value: unknown): EncryptedReasoning[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0])
    || Object.keys(value[0]).sort().join(",") !== "data,type"
    || value[0].type !== "reasoning.encrypted"
    || typeof value[0].data !== "string"
    || !/^bizos-reasoning:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value[0].data))
    throw new Error("BizOS returned an invalid reasoning token.");
  return [{ type: "reasoning.encrypted", data: value[0].data }];
}

function usageOf(value: unknown): Round["usage"] {
  if (!record(value)) return undefined;
  const input = value.prompt_tokens, output = value.completion_tokens;
  if (typeof input !== "number" || typeof output !== "number" || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return undefined;
  const details = record(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
  const cached = typeof details.cached_tokens === "number" && Number.isSafeInteger(details.cached_tokens) ? details.cached_tokens : undefined;
  return { input, output, ...(cached !== undefined ? { cached } : {}) };
}

function applyChoice(round: Round, choice: unknown, streamed: boolean, onText: (delta: string) => void): void {
  if (!record(choice)) return;
  const part = streamed ? choice.delta : choice.message;
  if (record(part)) {
    if (typeof part.content === "string" && part.content) {
      round.content += part.content;
      if (round.content.length > MAX_ANSWER_CHARS) throw new Error("The API answer exceeds the local size limit.");
      onText(part.content);
    }
    mergeToolCalls(round.calls, part.tool_calls);
  }
  if (typeof choice.finish_reason === "string" && choice.finish_reason) round.finish = choice.finish_reason;
}

async function failureOf(response: Response, label: string): Promise<Error> {
  if (response.status === 401 || response.status === 403) return new Error(`${label} refused the API key (${response.status}). Check it in Settings → Plans & usage.`);
  if (response.status === 429) return new Error(`${label} is rate-limiting or out of quota (429). Try again later.`);
  let detail = "";
  try {
    const body = await response.text();
    const parsed = (() => { try { return JSON.parse(body) as unknown; } catch { return null; } })();
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = record(first) && record(first.error) && typeof first.error.message === "string" ? first.error.message : body;
    detail = message.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch { /* no body */ }
  return new Error(`${label} answered ${response.status}${detail ? `: ${detail}` : ""}`);
}

/** One chat-completions request, streamed when the provider streams. */
async function complete(
  input: OpenAiTurnInput,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<Round> {
  const label = input.label?.trim() || "The API";
  if (input.chatCompletion) {
    const json = await input.chatCompletion(body, signal);
    if (!record(json) || !Array.isArray(json.choices) || !json.choices.length) throw new Error(`${label} returned a malformed chat response.`);
    const round: Round = { content: "", calls: [], finish: null };
    applyChoice(round, json.choices[0], false, onText);
    const choice = json.choices[0];
    if (record(choice) && record(choice.message)) round.reasoningDetails = encryptedReasoning(choice.message.reasoning_details);
    round.usage = usageOf(json.usage);
    return round;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(input.timeoutMs ?? 300_000);
  const response = await fetchImpl(chatCompletionsUrl(input.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream, application/json",
      ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, timeout]),
  });
  if (!response.ok) throw await failureOf(response, label);
  const round: Round = { content: "", calls: [], finish: null };
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !response.body) {
    const json = (await response.json()) as unknown;
    if (!record(json) || !Array.isArray(json.choices) || !json.choices.length) throw new Error(`${label} returned a malformed chat response.`);
    applyChoice(round, json.choices[0], false, onText);
    round.usage = usageOf(json.usage);
    return round;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") { done = true; return; }
    let chunk: unknown;
    try { chunk = JSON.parse(data); } catch { throw new Error(`${label} streamed a malformed chunk.`); }
    if (record(chunk) && record(chunk.error)) {
      throw new Error(`${label} failed mid-answer: ${String(chunk.error.message ?? "unknown error").slice(0, 300)}`);
    }
    if (!record(chunk)) return;
    if (Array.isArray(chunk.choices) && chunk.choices.length) applyChoice(round, chunk.choices[0], true, onText);
    round.usage = usageOf(chunk.usage) ?? round.usage;
  };
  for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (done) break;
    }
    if (done) break;
  }
  if (!done && buffer.trim()) handleLine(buffer);
  return round;
}

export function startOpenAiTurn(input: OpenAiTurnInput): CodexTurnHandle {
  const aborter = new AbortController();
  let cancelled = false;
  let finished = false;
  const label = input.label?.trim() || "The API";
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
      const messages: Message[] = [{ role: "system", content: input.system }, { role: "user", content: input.text }];
      const tools = input.agent
        ? input.dynamicTools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
        : [];
      let calls = 0;
      let attributed = false;
      const clientTurnId = clientTurnUuid(input.runId);
      let previousRequestId: string | undefined;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (cancelled) return;
        const requestId = input.chatCompletion ? randomUUID() : undefined;
        const answer = await complete(input, {
          ...(input.chatCompletion ? { clientTurnId, requestId, ...(previousRequestId ? { previousRequestId } : {}), max_tokens: 4096 } : { model: input.model, stream: true }),
          messages,
          ...(tools.length ? { tools } : {}),
        }, aborter.signal, (delta) => {
          // A non-streaming BizOS response can contain both text and calls.
          // Hold its text until we know it is a final answer: the model must
          // not announce an action before the host tool actually succeeds.
          if (!input.chatCompletion) emit({ type: "content.delta", streamKind: "assistant_text", delta });
        });
        if (cancelled) return;
        if (requestId) previousRequestId = requestId;
        if (answer.finish === "length") throw new Error(`${label} stopped at its output limit; the answer is incomplete.`);
        if (answer.finish === "content_filter") throw new Error(`${label} withheld the answer (content filter).`);
        if (!attributed) { emit({ type: "external.model.verified" }); attributed = true; }
        if (answer.usage) emit({ type: "token-usage", input: answer.usage.input, output: answer.usage.output, ...(answer.usage.cached !== undefined ? { cachedInput: answer.usage.cached } : {}) });
        const requested = answer.calls.filter(Boolean);
        if (input.chatCompletion && requested.some((call) => !call.id || !call.name))
          throw new Error("BizOS returned a malformed tool call.");
        if (!answer.content.trim() && !requested.length) throw new Error(`${label} returned an empty answer.`);
        if (answer.content.trim() && (!input.chatCompletion || !requested.length)) {
          if (input.chatCompletion) emit({ type: "content.delta", streamKind: "assistant_text", delta: answer.content });
          emit({ type: "item.completed", itemType: "assistant_text", text: answer.content, itemId: `api-${round}`, phase: requested.length ? "commentary" : "final_answer" });
        }
        if (!requested.length) { terminal(true, null); return; }
        const echoed = requested.map((call, index) => ({ ...call, id: call.id || `call_${round}_${index}` }));
        messages.push({
          role: "assistant",
          content: answer.content || null,
          ...(input.chatCompletion && answer.reasoningDetails ? { reasoning_details: answer.reasoningDetails } : {}),
          tool_calls: echoed.map((call) => ({ ...(input.chatCompletion ? {} : call.extra), id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })),
        });
        for (let index = 0; index < echoed.length; index++) {
          if (cancelled) return;
          calls++;
          if (calls > MAX_CALLS) throw new Error(`${label} tool-call limit reached.`);
          const call = echoed[index]!;
          const tool = input.agent ? input.dynamicTools.find((candidate) => candidate.name === call.name) : undefined;
          const callId = `${input.runId}:${round}:${index}`;
          let args: unknown;
          try { args = call.arguments.trim() ? JSON.parse(call.arguments) : {}; } catch { args = undefined; }
          let result: string;
          let ok = true;
          if (!tool || !record(args)) {
            // Told back to the model rather than failing the turn: a model
            // that misnames a tool can correct itself on the next round.
            ok = false;
            result = JSON.stringify({ error: !tool ? `unknown tool ${call.name.slice(0, 100)}` : "arguments must be a JSON object" });
            emit({ type: "item.started", itemType: "tool", itemId: callId, title: call.name.slice(0, 100) || "tool" });
          } else {
            emit({ type: "item.started", itemType: "tool", itemId: callId, title: call.name });
            try {
              const value = await tool.call(args, { callId, threadId: input.threadId, turnId: input.runId });
              if (record(value) && (value.isError === true || value.ok === false || value.success === false || value.error)) {
                ok = false;
              }
              result = isRichToolResult(value) ? JSON.stringify(value.text) : JSON.stringify(value ?? null);
              if (result.length > MAX_TOOL_OUTPUT) result = JSON.stringify({
                status: "completed", result_truncated: true,
                message: "The host tool completed, but its result exceeded the local display limit. Do not repeat a write; inspect current state with an available read tool if needed.",
              });
            } catch (error) {
              ok = false;
              result = JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) });
            }
          }
          if (cancelled) return;
          emit({ type: "item.completed", itemType: "tool", itemId: callId, ok });
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }
      throw new Error(`${label} tool-round limit reached.`);
    } catch (error) {
      if (cancelled || finished) return;
      const raw = error instanceof Error ? error.message : String(error);
      const message = input.chatCompletion
        ? error instanceof ContinuityBridgeError
          ? bizosBridgeErrorMessage(error.code)
          : raw === `${label} returned a malformed chat response.` ? raw : "L'inférence BizOS a échoué. Réessayez."
        : input.apiKey ? raw.split(input.apiKey).join("[key]") : raw;
      emit({ type: "runtime.error", message });
      terminal(false, message);
    }
  })();
  return handle;
}
