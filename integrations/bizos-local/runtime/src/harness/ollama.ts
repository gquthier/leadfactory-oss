/** Native Ollama HTTP boundary. Only a loopback daemon and installed local models. */
export interface OllamaModelDetail {
  id: string;
  capabilities: string[];
  locality: "local" | "remote" | "unknown";
  chat: boolean;
  tools: boolean;
  error?: string;
}

export interface InspectedOllamaModel extends OllamaModelDetail { contextLength?: number }

export interface OllamaProbe {
  ok: boolean;
  models: string[];
  modelDetails?: OllamaModelDetail[];
  error?: string;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_MODELS = 200;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeOllamaUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a loopback Ollama address with an explicit port."); }
  if (!(["http:", "https:"].includes(url.protocol)) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password || value.includes("?") || value.includes("#")
    || !["/", "/v1", "/v1/"].includes(url.pathname)) {
    throw new Error("Ollama must use a plain loopback address (127.0.0.1, localhost, or [::1]) with an explicit port; only legacy /v1 is accepted.");
  }
  return url.origin;
}

export async function ollamaJson(baseUrl: string, path: "/api/tags" | "/api/show" | "/api/chat", input?: unknown, options: {
  fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number;
} = {}): Promise<unknown> {
  const origin = normalizeOllamaUrl(baseUrl); // persisted input is untrusted too
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? (path === "/api/chat" ? 300_000 : 15_000));
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error("Ollama request cancelled.");
    const response = await (options.fetchImpl ?? fetch)(`${origin}${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers: { accept: "application/json", ...(input === undefined ? {} : { "content-type": "application/json" }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Ollama ${path} answered HTTP ${response.status}.`);
    if (!response.body) throw new Error("Ollama returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > (options.maxBytes ?? MAX_RESPONSE_BYTES)) {
        await reader.cancel();
        throw new Error("Ollama response exceeds the local size limit.");
      }
      chunks.push(value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("Ollama returned malformed JSON."); }
    return parsed;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}

function remote(row: Record<string, unknown>): boolean {
  return (typeof row.remote_model === "string" && row.remote_model.trim() !== "")
    || (typeof row.remote_host === "string" && row.remote_host.trim() !== "");
}
function remoteName(id: string): boolean { return /(?:[:\-]cloud)(?:$|[.:\-])/i.test(id); }

function tags(body: unknown): Array<{ id: string; remote: boolean }> {
  if (!record(body) || !Array.isArray(body.models) || body.models.length > MAX_MODELS) throw new Error("Ollama returned an invalid model inventory.");
  const found = new Set<string>();
  return body.models.map(row => {
    if (!record(row) || typeof row.name !== "string" || !MODEL_ID.test(row.name) || found.has(row.name)) throw new Error("Ollama returned an invalid or duplicate model name.");
    found.add(row.name);
    return { id: row.name, remote: remote(row) || remoteName(row.name) };
  });
}

async function detail(baseUrl: string, item: { id: string; remote: boolean }, options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number }): Promise<InspectedOllamaModel> {
  if (item.remote) return { id: item.id, capabilities: [], locality: "remote", chat: false, tools: false, error: "Remote Ollama model; local execution is required." };
  try {
    const body = await ollamaJson(baseUrl, "/api/show", { model: item.id }, options);
    if (!record(body)) throw new Error("Model details are unavailable.");
    const capabilities = Array.isArray(body.capabilities) && body.capabilities.every(c => typeof c === "string")
      ? body.capabilities.filter((c): c is string => typeof c === "string").slice(0, 32) : [];
    if (remote(body) || remoteName(item.id)) return { id: item.id, capabilities, locality: "remote", chat: false, tools: false, error: "Remote Ollama model; local execution is required." };
    const local = record(body.details) || record(body.model_info) || typeof body.modelfile === "string";
    const chat = local && capabilities.includes("completion");
    const tools = chat && capabilities.includes("tools");
    const contextLength = record(body.model_info) ? Object.entries(body.model_info)
      .filter(([key, value]) => key.endsWith(".context_length") && typeof value === "number" && Number.isSafeInteger(value) && value >= 2_048)
      .map(([, value]) => value as number)[0] : undefined;
    return { id: item.id, capabilities, locality: local ? "local" : "unknown", chat, tools,
      ...(contextLength ? { contextLength } : {}),
      ...(!local ? { error: "Local model metadata is unavailable." } : !chat ? { error: "Model does not support chat completion." } : {}),
    };
  } catch (error) {
    return { id: item.id, capabilities: [], locality: "unknown", chat: false, tools: false,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}

export async function probeOllama(baseUrl: string, options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<OllamaProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  try {
    const bounded = { ...options, signal: controller.signal };
    const inventory = tags(await ollamaJson(baseUrl, "/api/tags", undefined, bounded));
    const modelDetails: OllamaModelDetail[] = [];
    for (const item of inventory) {
      if (controller.signal.aborted) modelDetails.push({ id: item.id, capabilities: [], locality: "unknown", chat: false, tools: false, error: "Ollama model inspection timed out." });
      else {
        const { contextLength: _contextLength, ...publicDetail } = await detail(baseUrl, item, bounded);
        modelDetails.push(publicDetail);
      }
    }
    return { ok: true, models: modelDetails.filter(row => row.locality === "local" && row.chat).map(row => row.id), modelDetails };
  } catch (error) {
    return { ok: false, models: [], error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}

/** Recheck the exact chosen tag immediately before a native turn. */
export async function inspectOllamaModel(baseUrl: string, id: string, requireTools: boolean, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<InspectedOllamaModel> {
  if (!MODEL_ID.test(id)) throw new Error("Select an installed Ollama model in Settings.");
  const inventory = tags(await ollamaJson(baseUrl, "/api/tags", undefined, options));
  const item = inventory.find(row => row.id === id);
  if (!item) throw new Error(`Selected Ollama model ${id} is not installed.`);
  const result = await detail(baseUrl, item, options);
  if (result.locality === "remote") throw new Error(`Selected Ollama model ${id} is remote; choose an installed local model.`);
  if (!result.chat) throw new Error(`Selected Ollama model ${id} cannot chat locally: ${result.error ?? "unsupported"}`);
  if (requireTools && !result.tools) throw new Error("This model supports chat only; choose a tool-capable model for agents.");
  return result;
}
