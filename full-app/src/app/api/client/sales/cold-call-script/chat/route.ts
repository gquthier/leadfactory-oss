/**
 * POST /api/client/sales/cold-call-script/chat
 *
 * Mode chat itératif : l'agent IA experte cold call B2B pull le contexte client
 * depuis onboarding_responses (loadClientSequenceContext), répond en conversation,
 * et insère/modifie le script dans des balises <SCRIPT_JSON>...</SCRIPT_JSON>.
 *
 * Pattern calqué sur /api/client/sequence/chat.
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { loadClientSequenceContext } from "@/lib/sequence-context";
import {
  buildChatSystemPrompt,
  extractScriptFromResponse,
  stripScriptBlock,
} from "@/lib/cold-call-script-writer/chat-prompt";
import { coldCallScriptSchema } from "@/lib/cold-call-script-writer/script-schema";
import {
  getConversation,
  createConversation,
  updateConversation,
  type ChatMessage,
} from "@/lib/cold-call-script-writer/chat-data";
import { openRouterChat, loadOutboundModel } from "@/lib/openrouter";
import { consumeOrReject, refundCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChatRequestBody {
  message: string;
  conversation_id?: string | null;
}

export async function POST(req: Request) {
  // ── 1. Auth ─────────────────────────────────────────────────────
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", session.user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profil introuvable" }, { status: 403 });
  }
  if (profile.is_active === false) {
    return NextResponse.json({ error: "Compte désactivé" }, { status: 403 });
  }

  const clientId = session.user.id;

  // ── 2. Parsing ──────────────────────────────────────────────────
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const userMessage = body.message?.trim();
  if (!userMessage) {
    return NextResponse.json({ error: "Message requis" }, { status: 400 });
  }

  // ── 3. Récupérer / créer la conversation ───────────────────────
  let conversation = body.conversation_id
    ? await getConversation(clientId, body.conversation_id)
    : null;

  if (!conversation) {
    const initialTitle = userMessage.slice(0, 60) || "Nouvelle conversation";
    conversation = await createConversation(clientId, initialTitle);
  }

  // ── 4. Contexte client (onboarding) ─────────────────────────────
  const ctx = await loadClientSequenceContext(clientId, null);
  const systemPrompt = buildChatSystemPrompt(ctx);

  // ── 5. Clé OpenRouter ───────────────────────────────────────────
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "Clé IA non configurée. Demande à ton agence Lead Factory de la configurer." },
      { status: 500 }
    );
  }

  const history: ChatMessage[] = Array.isArray(conversation.messages)
    ? (conversation.messages as ChatMessage[])
    : [];

  // ── 6. Crédits : 4 crédits par tour (admin = gratuit) ──────────
  const isAdminWithoutPreview = profile.role === "admin";
  const creditCheck = await consumeOrReject({
    clientId,
    isAdminWithoutPreview,
    feature: "cold_call_script",
    metadata: { conversation_id: conversation.id, turn: history.length / 2 + 1 },
  });
  if (!creditCheck.ok) return creditCheck.response;

  // ── 7. Appel OpenRouter ─────────────────────────────────────────
  const selectedModel = await loadOutboundModel();

  let assistantText: string;
  let promptTokens = 0;
  let completionTokens = 0;
  let modelUsed = selectedModel;

  try {
    const result = await openRouterChat({
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: userMessage },
      ],
      temperature: 0.6,
      maxTokens: 8000,
    });
    assistantText = result.text;
    promptTokens = result.usage?.prompt_tokens ?? 0;
    completionTokens = result.usage?.completion_tokens ?? 0;
    modelUsed = result.modelUsed;
  } catch (e: unknown) {
    if (!isAdminWithoutPreview) {
      await refundCredits(clientId, "cold_call_script", {
        conversation_id: conversation.id,
        reason: "openrouter_error",
      });
    }
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Erreur IA : ${detail}` }, { status: 500 });
  }

  // ── 8. Extraction script si présent ─────────────────────────────
  const extracted = extractScriptFromResponse(assistantText);
  let nextScript: unknown | null = conversation.current_script;
  let scriptValid = false;
  let scriptValidationError: string | null = null;

  if (extracted) {
    if (extracted.parsed !== null) {
      const validation = coldCallScriptSchema.safeParse(extracted.parsed);
      if (validation.success) {
        nextScript = validation.data;
        scriptValid = true;
      } else {
        scriptValid = false;
        scriptValidationError = validation.error.message.slice(0, 600);
        // On garde l'ancien script ; on remontera l'erreur au user dans la réponse
      }
    } else {
      scriptValidationError = extracted.parseError;
    }
  }

  // ── 9. Sauvegarder le tour ──────────────────────────────────────
  const newMessages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    {
      role: "assistant",
      content: assistantText,
      timestamp: new Date().toISOString(),
    },
  ];

  // Auto-titre si encore "Nouvelle conversation" et qu'on a un script
  let nextTitle = conversation.title;
  if (
    (conversation.title === "Nouvelle conversation" || conversation.title.length < 4) &&
    scriptValid &&
    nextScript &&
    typeof nextScript === "object" &&
    "meta" in nextScript
  ) {
    const headline = (nextScript as { meta: { headline?: string } }).meta?.headline;
    if (headline) nextTitle = headline.slice(0, 120);
  }

  await updateConversation(clientId, conversation.id, {
    messages: newMessages,
    current_script: nextScript,
    total_prompt_tokens: conversation.total_prompt_tokens + promptTokens,
    total_completion_tokens: conversation.total_completion_tokens + completionTokens,
    last_model_used: modelUsed,
    title: nextTitle,
  });

  // ── 10. Réponse ─────────────────────────────────────────────────
  return NextResponse.json({
    conversation_id: conversation.id,
    response: stripScriptBlock(assistantText),
    raw_response: assistantText,
    script: nextScript,
    script_updated: scriptValid,
    script_validation_error: scriptValidationError,
    title: nextTitle,
  });
}
