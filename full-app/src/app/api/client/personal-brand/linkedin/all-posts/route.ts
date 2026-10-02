import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { listAllPosts, listConversations } from "@/lib/linkedin-data";

export const dynamic = "force-dynamic";

export async function GET() {
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
  if (!profile || profile.is_active === false) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 403 });
  }

  const previewClientId = await getPreviewClientId();
  const clientId =
    profile.role === "admin" && previewClientId ? previewClientId : session.user.id;

  const [posts, conversations] = await Promise.all([
    listAllPosts(clientId),
    listConversations(clientId),
  ]);

  const conversationTitleById = new Map(conversations.map((c) => [c.id, c.title]));

  return NextResponse.json({
    posts: posts.map((p) => ({
      id: p.id,
      conversation_id: p.conversation_id,
      conversation_title: conversationTitleById.get(p.conversation_id) ?? "Brief supprimé",
      body: p.body,
      hook: p.hook,
      framework: p.framework,
      format: p.format,
      metrics: p.metrics ?? {},
      created_at: p.created_at,
    })),
  });
}
