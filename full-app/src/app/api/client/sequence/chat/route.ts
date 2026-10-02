import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { loadClientSequenceContext } from "@/lib/sequence-context";
import {
  buildSequenceSystemPrompt,
  extractEmailsFromResponse,
  stripEmailBlock,
} from "@/lib/sequence-prompts";
import { getProvider, type SequenceProvider } from "@/lib/sequence-providers";
import {
  getConversation,
  updateConversation,
  createConversation,
  replaceEmailsForConversation,
  type ChatMessage,
} from "@/lib/sequence-data";
import { openRouterChat, loadOutboundModel } from "@/lib/openrouter";
import { consumeOrReject, refundCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";

interface ChatRequestBody {
  message: string;
  conversation_id?: string | null;
  /** Outil d'envoi sélectionné (détermine la syntaxe des merge tags) */
  provider?: SequenceProvider | null;
  // Pas besoin d'envoyer l'historique : on le relit depuis la DB
  // (source de vérité unique, évite la désync UI/serveur)
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

  const adminSupabase = createAdminClient();

  const { data: profile } = await adminSupabase
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

  // Le client effectif : soit le client connecté, soit le client prévisualisé
  // par un admin en mode "Aperçu". Les RLS bloquent l'admin sur la table
  // sequence_conversations en écriture, donc on utilise adminClient via les
  // helpers de sequence-data.ts.
  const previewClientId = await getPreviewClientId();
  const clientId =
    profile.role === "admin" && previewClientId ? previewClientId : session.user.id;

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
    const initialTitle = userMessage.slice(0, 60) || "Nouvelle séquence";
    conversation = await createConversation(clientId, initialTitle);
  }

  // ── 4. Contexte client ──────────────────────────────────────────
  const ctx = await loadClientSequenceContext(
    clientId,
    (conversation.context_override as Record<string, unknown> | null) ?? null
  );

  const provider = getProvider(body.provider ?? undefined);
  const systemPrompt = buildSequenceSystemPrompt(ctx, provider);

  // ── 5. Clé OpenRouter ───────────────────────────────────────────
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Clé IA non configurée. Demande à ton agence Lead Factory de la configurer.",
      },
      { status: 500 }
    );
  }

  // ── 6. Construire l'historique pour OpenRouter ─────────────────
  const history: ChatMessage[] = Array.isArray(conversation.messages)
    ? (conversation.messages as ChatMessage[])
    : [];

  // ── 7. Appel OpenRouter avec le modèle admin-configuré ─────────
  const selectedModel = await loadOutboundModel();

  // ── Crédits : 3 crédits par chat ───────────────────────────────
  const isAdminWithoutPreview = profile.role === "admin" && !previewClientId;
  const creditCheck = await consumeOrReject({
    clientId,
    isAdminWithoutPreview,
    feature: "outbound_chat",
    metadata: { conversation_id: conversation.id },
  });
  if (!creditCheck.ok) return creditCheck.response;

  let assistantText: string;
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
      temperature: 0.7,
    });

    assistantText = result.text;
  } catch (e: unknown) {
    if (!isAdminWithoutPreview) {
      await refundCredits(clientId, "outbound_chat", {
        conversation_id: conversation.id,
        reason: "openrouter_error",
      });
    }
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[Sequence Chat] OpenRouter error:", detail);
    return NextResponse.json(
      { error: `Erreur IA : ${detail}` },
      { status: 500 }
    );
  }

  // ── 8. Extraction emails + persistence ─────────────────────────
  const extracted = extractEmailsFromResponse(assistantText);

  let savedEmails: Awaited<ReturnType<typeof replaceEmailsForConversation>> = [];
  if (extracted && extracted.length > 0) {
    // Si la réponse ne contient qu'un email, on l'interprète comme un update
    // ciblé. Sinon, on remplace l'ensemble de la séquence.
    if (extracted.length === 1) {
      // Single-email update : append/replace selon le step. Simpler v1 :
      // on remplace toute la séquence par cet email seul ne marcherait pas.
      // → on cherche l'email existant avec un step similaire, sinon append.
      // Pour la v1, on choisit la stratégie simple : remplacer toute la séquence
      // seulement si elle est vide. Sinon, le LLM doit renvoyer la séquence complète.
      // (Documenté dans sequence-prompts.ts — instruction au LLM)
      const { listEmails } = await import("@/lib/sequence-data");
      const existing = await listEmails(clientId, conversation.id);
      if (existing.length === 0) {
        savedEmails = await replaceEmailsForConversation(
          clientId,
          conversation.id,
          extracted.map((e) => ({
            subject: e.subject || null,
            body: e.body,
            wait_days: e.wait_days,
          }))
        );
      }
      // Sinon : on laisse le LLM gérer (le user demandera explicitement
      // "régénère toute la séquence" si besoin).
    } else {
      savedEmails = await replaceEmailsForConversation(
        clientId,
        conversation.id,
        extracted.map((e) => ({
          subject: e.subject || null,
          body: e.body,
          wait_days: e.wait_days,
        }))
      );
    }
  }

  // ── 9. Sauvegarder le tour de chat ──────────────────────────────
  const newMessages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    {
      role: "assistant",
      content: assistantText,
      timestamp: new Date().toISOString(),
    },
  ];

  await updateConversation(clientId, conversation.id, { messages: newMessages });

  // ── 10. Réponse ─────────────────────────────────────────────────
  return NextResponse.json({
    conversation_id: conversation.id,
    response: stripEmailBlock(assistantText),
    raw_response: assistantText,
    emails: savedEmails,
    extracted_count: extracted?.length ?? 0,
  });
}
