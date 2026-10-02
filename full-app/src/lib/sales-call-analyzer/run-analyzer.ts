/**
 * Glue : transcript → OpenRouter (Sonnet 4.6 par défaut) → parse JSON → valider Zod.
 * 1 retry de réparation si le JSON est malformé.
 */

import { openRouterChat, loadOutboundModel } from "@/lib/openrouter";
import { SYSTEM_PROMPT, buildUserPrompt } from "./analyzer-prompt";
import {
  salesCallAnalysisSchema,
  type SalesCallAnalysis,
} from "./analyzer-schema";

export interface RunAnalyzerInput {
  transcript: string;
  meta?: {
    prospectCompany?: string;
    meetingTitle?: string;
    meetingDate?: string;
  };
  modelOverride?: string;
}

export interface RunAnalyzerOutput {
  analysis: SalesCallAnalysis;
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

function tryParseAnalysis(raw: string): SalesCallAnalysis | { error: string } {
  const cleaned = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { error: `JSON parse error: ${(e as Error).message}` };
  }
  const validation = salesCallAnalysisSchema.safeParse(parsed);
  if (!validation.success) {
    return { error: `Zod validation: ${validation.error.message.slice(0, 400)}` };
  }
  return validation.data;
}

export async function runAnalyzer(
  input: RunAnalyzerInput
): Promise<RunAnalyzerOutput> {
  const model = input.modelOverride ?? (await loadOutboundModel());

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserPrompt(input.transcript, input.meta) },
  ];

  // Tour 1
  const r1 = await openRouterChat({
    model,
    messages,
    temperature: 0.3,
    maxTokens: 8000,
  });

  const first = tryParseAnalysis(r1.text);
  if (!("error" in first)) {
    return {
      analysis: first,
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
    temperature: 0.1,
    maxTokens: 8000,
  });

  const second = tryParseAnalysis(r2.text);
  if ("error" in second) {
    throw new Error(`Analyzer failed after retry: ${second.error}`);
  }

  return {
    analysis: second,
    modelUsed: r2.modelUsed,
    promptTokens: (r1.usage?.prompt_tokens ?? 0) + (r2.usage?.prompt_tokens ?? 0),
    completionTokens:
      (r1.usage?.completion_tokens ?? 0) + (r2.usage?.completion_tokens ?? 0),
  };
}
