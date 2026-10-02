/**
 * Wrapper OpenRouter pour les appels LLM côté Outbound IA.
 *
 * OpenRouter expose une API compatible OpenAI (`/v1/chat/completions`)
 * et route vers le provider du modèle choisi (Anthropic, Google, OpenAI, etc.).
 *
 * Prix : tous les chiffres sont en USD pour 1M tokens (input/output).
 * Source : openrouter.ai/models — vérifier régulièrement.
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface OpenRouterModel {
  /** Slug OpenRouter exact, ex: "anthropic/claude-sonnet-4.5" */
  id: string;
  /** Nom human-readable affiché en UI */
  label: string;
  /** Provider derrière le modèle */
  provider: "anthropic" | "google" | "openai" | "meta" | "deepseek" | "mistral" | "xai";
  /** Prix input en USD / 1M tokens */
  pricePerMTokensInput: number;
  /** Prix output en USD / 1M tokens */
  pricePerMTokensOutput: number;
  /** Description courte pour aider l'admin à choisir */
  description: string;
  /** Si true, recommandé par défaut */
  recommended?: boolean;
}

/**
 * Catalogue des modèles disponibles pour Outbound IA.
 * Trié par qualité descendante (top frontière → modèles plus rapides/moins chers).
 *
 * Pour ajouter un modèle : copier le slug depuis openrouter.ai/models et
 * lire le prix exact. Mettre `recommended: true` sur le modèle par défaut.
 */
export const OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    pricePerMTokensInput: 5,
    pricePerMTokensOutput: 25,
    description: "Top frontière Anthropic. Le plus créatif et nuancé pour du copywriting outbound — prix divisé par 3 vs Opus 4.1.",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    pricePerMTokensInput: 3,
    pricePerMTokensOutput: 15,
    description: "Sweet spot qualité / coût pour le copywriting. Dernière révision Sonnet. Recommandé par défaut.",
    recommended: true,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    pricePerMTokensInput: 1,
    pricePerMTokensOutput: 5,
    description: "Rapide et économique. OK pour itérations courtes, moins nuancé sur les angles.",
  },
  {
    id: "openai/gpt-5",
    label: "GPT-5",
    provider: "openai",
    pricePerMTokensInput: 5,
    pricePerMTokensOutput: 15,
    description: "Top frontière OpenAI. Très bon en structure et précision technique.",
  },
  {
    id: "openai/gpt-5-mini",
    label: "GPT-5 Mini",
    provider: "openai",
    pricePerMTokensInput: 0.25,
    pricePerMTokensOutput: 2,
    description: "Petit modèle OpenAI ultra-rapide. Économique mais moins inspiré.",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    pricePerMTokensInput: 1.25,
    pricePerMTokensOutput: 10,
    description: "Très bon en multilingue (FR/EN). Latence basse, bon rapport qualité/prix.",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    pricePerMTokensInput: 0.3,
    pricePerMTokensOutput: 2.5,
    description: "Le plus économique. Bon pour brouillonner rapidement.",
  },
  {
    id: "deepseek/deepseek-r1",
    label: "DeepSeek R1",
    provider: "deepseek",
    pricePerMTokensInput: 0.55,
    pricePerMTokensOutput: 2.19,
    description: "Reasoning fort, prix bas. Bonne alternative open-source.",
  },
  {
    id: "x-ai/grok-4",
    label: "Grok 4",
    provider: "xai",
    pricePerMTokensInput: 5,
    pricePerMTokensOutput: 15,
    description: "Plus créatif et moins censuré. Bon pour des angles non-conventionnels.",
  },
];

export const DEFAULT_OUTBOUND_MODEL = "anthropic/claude-sonnet-4.6";

export function getModelById(id: string | undefined | null): OpenRouterModel {
  const found = OPENROUTER_MODELS.find((m) => m.id === id);
  return found ?? OPENROUTER_MODELS.find((m) => m.id === DEFAULT_OUTBOUND_MODEL)!;
}

/**
 * Lit le modèle courant depuis app_settings.
 * Fallback : DEFAULT_OUTBOUND_MODEL.
 */
export async function loadOutboundModel(): Promise<string> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "outbound_ai_model")
      .maybeSingle();

    const v = data?.value;
    if (typeof v === "string" && v.startsWith("")) return v;
    if (typeof v === "string") return v;
    return DEFAULT_OUTBOUND_MODEL;
  } catch {
    return DEFAULT_OUTBOUND_MODEL;
  }
}

// ─── Chat completion ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
  /** Slug du modèle réellement utilisé (peut différer si OpenRouter fallback) */
  modelUsed: string;
  /** Usage tokens si renvoyé par OpenRouter */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Appelle OpenRouter en mode chat completion.
 * Lance une Error si la clé n'est pas configurée ou si l'API répond en erreur.
 */
export async function openRouterChat(opts: ChatOptions): Promise<ChatResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY non configurée");
  }

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Headers recommandés par OpenRouter pour le tracking
      "HTTP-Referer": "https://example.invalid",
      "X-Title": "LeadFactory Outbound IA",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("Réponse OpenRouter sans contenu");
  }

  return {
    text,
    modelUsed: data.model ?? opts.model,
    usage: data.usage,
  };
}
