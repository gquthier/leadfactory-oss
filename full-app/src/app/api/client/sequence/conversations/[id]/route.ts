import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import {
  getConversation,
  updateConversation,
  deleteConversation,
  listEmails,
} from "@/lib/sequence-data";
import { stripEmailBlock } from "@/lib/sequence-prompts";

export const dynamic = "force-dynamic";

async function getEffectiveClientId() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const previewClientId = await getPreviewClientId();
  return profile?.role === "admin" && previewClientId
    ? previewClientId
    : session.user.id;
}

// GET /api/client/sequence/conversations/[id]
// Retourne la conversation complète + ses emails
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const conversation = await getConversation(clientId, params.id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
  }

  const emails = await listEmails(clientId, params.id);

  // Nettoie le JSON brut des messages assistant historiques avant de les
  // renvoyer au client (les anciennes conversations contiennent du JSON brut).
  const cleanedMessages = Array.isArray(conversation.messages)
    ? conversation.messages.map((m) =>
        m.role === "assistant"
          ? { ...m, content: stripEmailBlock(m.content) }
          : m
      )
    : [];

  return NextResponse.json({
    conversation: { ...conversation, messages: cleanedMessages },
    emails,
  });
}

// PATCH /api/client/sequence/conversations/[id]
// Mise à jour titre / context_override
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = (await req.json()) as {
    title?: string;
    context_override?: Record<string, unknown> | null;
  };

  await updateConversation(clientId, params.id, {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.context_override !== undefined && { context_override: body.context_override }),
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/client/sequence/conversations/[id]
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  await deleteConversation(clientId, params.id);
  return NextResponse.json({ success: true });
}
