/**
 * Runner : brief d'offre → OpenRouter (Sonnet 4.6 par défaut) → parse JSON → valider Zod.
 * 1 retry de réparation si le JSON est malformé.
 *
 * Calqué sur ~/leadfactory-app/apps/web/src/lib/sales-call-analyzer/run-analyzer.ts
 */

import { openRouterChat, loadOutboundModel } from "@/lib/openrouter";
import { SYSTEM_PROMPT, buildUserPrompt } from "./script-prompt";
import {
  coldCallScriptSchema,
  type ColdCallScript,
  type OfferBrief,
} from "./script-schema";

export interface RunWriterInput {
  brief: OfferBrief;
  modelOverride?: string;
}

export interface RunWriterOutput {
  script: ColdCallScript;
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
}

function stripCodeFence(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*\n/i, "")
    .replace(/\n```\s*$/i, "")
    .trim();
}

function tryParseScript(raw: string): ColdCallScript | { error: string } {
  const cleaned = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { error: `JSON parse error: ${(e as Error).message}` };
  }
  const validation = coldCallScriptSchema.safeParse(parsed);
  if (!validation.success) {
    return { error: `Zod validation: ${validation.error.message.slice(0, 600)}` };
  }
  return validation.data;
}

export async function runWriter(input: RunWriterInput): Promise<RunWriterOutput> {
  const model = input.modelOverride ?? (await loadOutboundModel());

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserPrompt(input.brief) },
  ];

  // Tour 1
  const r1 = await openRouterChat({
    model,
    messages,
    temperature: 0.6,
    maxTokens: 8000,
  });

  const first = tryParseScript(r1.text);
  if (!("error" in first)) {
    return {
      script: first,
      modelUsed: r1.modelUsed,
      promptTokens: r1.usage?.prompt_tokens,
      completionTokens: r1.usage?.completion_tokens,
    };
  }

  // Tour 2 : retry de réparation
  const repairMessages = [
    ...messages,
    { role: "assistant" as const, content: r1.text },
    {
      role: "user" as const,
      content: `Ton output n'était pas un JSON valide conforme au schéma. Erreur : ${first.error}

Re-produis UNIQUEMENT le JSON valide conforme au schéma fourni dans le system prompt. Pas de markdown, pas de prose, juste l'objet JSON brut.`,
    },
  ];

  const r2 = await openRouterChat({
    model,
    messages: repairMessages,
    temperature: 0.2,
    maxTokens: 8000,
  });

  const second = tryParseScript(r2.text);
  if ("error" in second) {
    throw new Error(`Cold Call Writer failed after retry: ${second.error}`);
  }

  return {
    script: second,
    modelUsed: r2.modelUsed,
    promptTokens: (r1.usage?.prompt_tokens ?? 0) + (r2.usage?.prompt_tokens ?? 0),
    completionTokens:
      (r1.usage?.completion_tokens ?? 0) + (r2.usage?.completion_tokens ?? 0),
  };
}
