// External inference providers — an API key instead of a ChatGPT / Claude
// plan.
//
// Codex CLI can talk to any OpenAI-compatible endpoint through its
// `model_providers` configuration (`base_url`, `env_key`, `wire_api`). That
// is the whole trick here: a provider the user adds in Settings → Plans &
// usage becomes a set of `-c` overrides on the codex turn, with the key
// travelling in the child environment under the variable `env_key` names —
// never in argv. OpenRouter, Groq, Together, a local Ollama: same path.
//
// `providers.json` (0600) holds the keys, next to `apps.json`. Nothing here
// touches the cloud runtime or a BizOS credential: `local-bizos-oss`.
import { newId } from "./ids.js";
import type { Storage } from "./storage.js";

export const PROVIDERS_FILE = "providers.json";
export const MAX_INFERENCE_PROVIDERS = 12;
export const PROVIDER_ID = /^prv_[a-z0-9]{6,40}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const CONFIG_ID = /^[a-z][a-z0-9_]{0,31}$/;

export type InferenceKind = "openrouter" | "ollama" | "openai-compatible";

export interface InferencePreset {
  kind: InferenceKind;
  label: string;
  blurb: string;
  baseUrl: string;
  envKey: string;
  /** Codex `wire_api`: chat completions or the Responses API. */
  wireApi: "chat" | "responses";
  needsKey: boolean;
  model: string;
  docs: string;
}

export const INFERENCE_PRESETS: ReadonlyArray<InferencePreset> = [
  {
    kind: "openrouter",
    label: "OpenRouter",
    blurb: "One key, hundreds of models from every lab.",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    wireApi: "chat",
    needsKey: true,
    model: "openai/gpt-4.1-mini",
    docs: "https://openrouter.ai/docs/quickstart",
  },
  {
    kind: "ollama",
    label: "Ollama on this Mac",
    blurb: "Models that run on this computer, no key, no network.",
    baseUrl: "http://127.0.0.1:11434/v1",
    envKey: "OLLAMA_API_KEY",
    wireApi: "chat",
    needsKey: false,
    model: "llama3.2",
    docs: "https://ollama.com",
  },
  {
    kind: "openai-compatible",
    label: "Other OpenAI-compatible API",
    blurb: "Groq, Together, Fireworks, Mistral, a self-hosted vLLM: any endpoint that speaks the OpenAI API.",
    baseUrl: "",
    envKey: "OPENAI_COMPATIBLE_API_KEY",
    wireApi: "chat",
    needsKey: true,
    model: "",
    docs: "https://developers.openai.com/codex/config-advanced",
  },
];

export interface InferenceProvider {
  id: string;
  kind: InferenceKind;
  label: string;
  baseUrl: string;
  envKey: string;
  wireApi: "chat" | "responses";
  /** The key. Never crosses the bridge; `PublicInferenceProvider.hasKey` does. */
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  lastTest?: { at: string; ok: boolean; models: string[]; error?: string };
}

export type PublicInferenceProvider = Omit<InferenceProvider, "apiKey"> & { hasKey: boolean };

export interface InferenceProviderInput {
  kind: InferenceKind;
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface InferenceProviderPatch {
  label?: string;
  baseUrl?: string;
  /** Empty string clears the key. */
  apiKey?: string;
  model?: string;
}

export class InferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_inference_provider";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toPublicProvider(provider: InferenceProvider): PublicInferenceProvider {
  const { apiKey, ...rest } = provider;
  return { ...rest, hasKey: apiKey.length > 0 };
}

export function presetFor(kind: InferenceKind): InferencePreset {
  return INFERENCE_PRESETS.find((preset) => preset.kind === kind) ?? INFERENCE_PRESETS[2]!;
}

export function validateBaseUrl(raw: string, kind: InferenceKind): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InferenceError("that is not an API address");
  }
  if (url.username || url.password || url.search || url.hash) throw new InferenceError("the API address must be plain: no credentials, no query");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new InferenceError(kind === "ollama" ? "Ollama is reached over http on this Mac only" : "a remote API must use https");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateModel(raw: string): string {
  const model = raw.trim();
  if (!model) return "";
  if (model.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) throw new InferenceError("that model id is not a model id");
  return model;
}

export function validateKey(raw: string): string {
  if (raw.length > 4_096 || /[\r\n\0]/.test(raw)) throw new InferenceError("the key is not plain text");
  return raw.trim();
}

function normalizeProvider(raw: unknown): InferenceProvider | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !PROVIDER_ID.test(raw.id)) return null;
  const kind: InferenceKind = raw.kind === "openrouter" || raw.kind === "ollama" ? raw.kind : "openai-compatible";
  const preset = presetFor(kind);
  const envKey = typeof raw.envKey === "string" && ENV_NAME.test(raw.envKey) ? raw.envKey : preset.envKey;
  return {
    id: raw.id,
    kind,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 60) : preset.label,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : preset.baseUrl,
    envKey,
    wireApi: raw.wireApi === "responses" ? "responses" : "chat",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    model: typeof raw.model === "string" ? raw.model : preset.model,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    ...(isRecord(raw.lastTest) && typeof raw.lastTest.at === "string"
      ? {
          lastTest: {
            at: raw.lastTest.at,
            ok: raw.lastTest.ok === true,
            models: Array.isArray(raw.lastTest.models) ? raw.lastTest.models.filter((m): m is string => typeof m === "string") : [],
            ...(typeof raw.lastTest.error === "string" ? { error: raw.lastTest.error } : {}),
          },
        }
      : {}),
  };
}

export class InferenceStore {
  private providers: InferenceProvider[];

  constructor(
    private readonly storage: Storage,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {
    const raw = this.storage.readJson<unknown>(PROVIDERS_FILE, null);
    const rows = isRecord(raw) && Array.isArray(raw.providers) ? raw.providers : [];
    this.providers = rows.map(normalizeProvider).filter((p): p is InferenceProvider => p !== null);
  }

  private persist(): void {
    this.storage.writeJson(PROVIDERS_FILE, { version: 1, providers: this.providers });
  }

  list(): InferenceProvider[] {
    return this.providers.map((p) => ({ ...p }));
  }

  publicList(): PublicInferenceProvider[] {
    return this.providers.map(toPublicProvider);
  }

  get(id: string): InferenceProvider | undefined {
    const found = this.providers.find((p) => p.id === id);
    return found ? { ...found } : undefined;
  }

  add(input: InferenceProviderInput): InferenceProvider {
    if (this.providers.length >= MAX_INFERENCE_PROVIDERS) throw new InferenceError(`at most ${MAX_INFERENCE_PROVIDERS} providers`);
    const preset = presetFor(input.kind);
    const baseUrl = validateBaseUrl(input.baseUrl?.trim() || preset.baseUrl, input.kind);
    if (!baseUrl) throw new InferenceError("an API address is required");
    const apiKey = validateKey(input.apiKey ?? "");
    if (preset.needsKey && !apiKey) throw new InferenceError(`${preset.label} needs an API key`);
    const now = this.nowIso();
    // The config id codex sees must be unique per provider and a bare key.
    const provider: InferenceProvider = {
      id: newId("prv"),
      kind: input.kind,
      label: (input.label?.trim() || preset.label).slice(0, 60),
      baseUrl,
      envKey: preset.envKey,
      wireApi: preset.wireApi,
      apiKey,
      model: validateModel(input.model ?? "") || preset.model,
      createdAt: now,
      updatedAt: now,
    };
    this.providers.push(provider);
    this.persist();
    return { ...provider };
  }

  update(id: string, patch: InferenceProviderPatch): InferenceProvider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new InferenceError("that provider is not added");
    if (patch.label !== undefined) {
      const label = patch.label.trim().slice(0, 60);
      if (!label) throw new InferenceError("a provider needs a name");
      provider.label = label;
    }
    if (patch.baseUrl !== undefined) provider.baseUrl = validateBaseUrl(patch.baseUrl, provider.kind);
    if (patch.apiKey !== undefined) provider.apiKey = validateKey(patch.apiKey);
    if (patch.model !== undefined) provider.model = validateModel(patch.model) || presetFor(provider.kind).model;
    provider.updatedAt = this.nowIso();
    this.persist();
    return { ...provider };
  }

  recordTest(id: string, result: { ok: boolean; models: string[]; error?: string }): InferenceProvider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new InferenceError("that provider is not added");
    provider.lastTest = {
      at: this.nowIso(),
      ok: result.ok,
      models: result.models.slice(0, 200),
      ...(result.error ? { error: result.error.slice(0, 400) } : {}),
    };
    this.persist();
    return { ...provider };
  }

  remove(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter((p) => p.id !== id);
    if (this.providers.length === before) return false;
    this.persist();
    return true;
  }
}

// ── what a codex turn gets ─────────────────────────────────────────────────

/** The overrides for one codex turn, and the key it needs in its environment. */
export interface CodexModelProvider {
  /** The `model_providers.<id>` key; bare, unique, never user text. */
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  wireApi: "chat" | "responses";
  /** Forwarded to the child environment under `envKey`; empty means none. */
  apiKey: string;
  model: string;
}

export function codexModelProviderFor(provider: InferenceProvider): CodexModelProvider {
  const id = `bizos_${provider.kind.replace(/[^a-z0-9]/g, "_")}_${provider.id.slice(4, 12)}`;
  if (!CONFIG_ID.test(id)) throw new InferenceError("provider id is not a config key");
  return {
    id,
    name: provider.label,
    baseUrl: provider.baseUrl,
    envKey: provider.envKey,
    wireApi: provider.wireApi,
    apiKey: provider.apiKey,
    model: provider.model,
  };
}

// ── testing a provider: list its models ────────────────────────────────────

export interface InferenceProbe {
  ok: boolean;
  models: string[];
  error?: string;
}

export async function probeInferenceProvider(
  provider: Pick<InferenceProvider, "baseUrl" | "apiKey" | "kind">,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<InferenceProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${provider.baseUrl.replace(/\/$/, "")}/models`, {
      headers: {
        accept: "application/json",
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, models: [], error: "the key was refused" };
    if (!response.ok) return { ok: false, models: [], error: `the API answered ${response.status}` };
    const body = (await response.json()) as unknown;
    const rows = isRecord(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
    const models = rows
      .map((row) => (isRecord(row) && typeof row.id === "string" ? row.id : isRecord(row) && typeof row.name === "string" ? row.name : null))
      .filter((id): id is string => id !== null);
    return { ok: true, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      models: [],
      error: provider.kind === "ollama" && /ECONNREFUSED|fetch failed|timeout/i.test(message)
        ? "Ollama is not running on this Mac (start it, then check again)"
        : message,
    };
  }
}
