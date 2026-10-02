import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { loadClientSequenceContext } from "@/lib/sequence-context";
import {
  buildLinkedInSystemPrompt,
  extractPostsFromResponse,
  stripPostBlocks,
} from "@/lib/linkedin-system-prompt";
import {
  getConversation,
  updateConversation,
  createConversation,
  replacePostsForConversation,
  listPosts,
  type LinkedInChatMessage,
} from "@/lib/linkedin-data";
import { openRouterChat, loadOutboundModel } from "@/lib/openrouter";
import { consumeOrReject, refundCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";

interface ChatRequestBody {
  message: string;
  conversation_id?: string | null;
}

export async function POST(req: Request) {
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

  const previewClientId = await getPreviewClientId();
  const clientId =
    profile.role === "admin" && previewClientId ? previewClientId : session.user.id;

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

  let conversation = body.conversation_id
    ? await getConversation(clientId, body.conversation_id)
    : null;

  if (!conversation) {
    const initialTitle = userMessage.slice(0, 60) || "Nouveau brief LinkedIn";
    conversation = await createConversation(clientId, initialTitle);
  }

  const ctx = await loadClientSequenceContext(
    clientId,
    (conversation.context_override as Record<string, unknown> | null) ?? null
  );

  const systemPrompt = buildLinkedInSystemPrompt(ctx);

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "Clé IA non configurée. Demande à ton agence Lead Factory de la configurer." },
      { status: 500 }
    );
  }

  const history: LinkedInChatMessage[] = Array.isArray(conversation.messages)
    ? (conversation.messages as LinkedInChatMessage[])
    : [];

  const selectedModel = await loadOutboundModel();

  // ── Crédits : consommer 1 crédit avant l'appel IA ──────────────
  const isAdminWithoutPreview = profile.role === "admin" && !previewClientId;
  const creditCheck = await consumeOrReject({
    clientId,
    isAdminWithoutPreview,
    feature: "personal_brand_chat",
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
      temperature: 0.85, // un peu plus chaud que cold-email pour la créa
    });

    assistantText = result.text;
  } catch (e: unknown) {
    // Refund le crédit consommé puisque l'IA a échoué
    if (!isAdminWithoutPreview) {
      await refundCredits(clientId, "personal_brand_chat", {
        conversation_id: conversation.id,
        reason: "openrouter_error",
      });
    }
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[LinkedIn Chat] OpenRouter error:", detail);
    return NextResponse.json(
      { error: `Erreur IA : ${detail}` },
      { status: 500 }
    );
  }

  // Extraction posts + persistence
  const extracted = extractPostsFromResponse(assistantText);
  let savedPosts = await listPosts(clientId, conversation.id);

  if (extracted.length > 0) {
    savedPosts = await replacePostsForConversation(
      clientId,
      conversation.id,
      extracted.map((p) => ({
        body: p.body,
        hook: p.hook,
        framework: p.framework,
        format: p.format,
        metrics: { length: p.length },
      }))
    );
  }

  const newMessages: LinkedInChatMessage[] = [
    ...history,
    { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    {
      role: "assistant",
      content: assistantText,
      timestamp: new Date().toISOString(),
    },
  ];

  await updateConversation(clientId, conversation.id, { messages: newMessages });

  return NextResponse.json({
    conversation_id: conversation.id,
    response: stripPostBlocks(assistantText),
    raw_response: assistantText,
    posts: savedPosts,
    extracted_count: extracted.length,
  });
}
