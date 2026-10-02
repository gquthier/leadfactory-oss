import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { listConversations, createConversation } from "@/lib/sequence-data";

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

// GET /api/client/sequence/conversations
// Liste toutes les conversations du client (avec leur nb d'emails)
export async function GET() {
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const conversations = await listConversations(clientId);

  // Compter les emails par conversation en une seule requête
  const admin = createAdminClient();
  const { data: emailCounts } = await admin
    .from("sequence_emails")
    .select("conversation_id")
    .eq("client_id", clientId);

  const countByConv = new Map<string, number>();
  for (const e of emailCounts ?? []) {
    const key = (e as { conversation_id: string }).conversation_id;
    countByConv.set(key, (countByConv.get(key) ?? 0) + 1);
  }

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      ...c,
      email_count: countByConv.get(c.id) ?? 0,
    })),
  });
}

// POST /api/client/sequence/conversations
// Crée une nouvelle conversation vide
export async function POST(req: Request) {
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { title?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }

  const conversation = await createConversation(clientId, body.title);
  return NextResponse.json({ conversation });
}
