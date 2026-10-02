import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { listAllScripts, listConversations } from "@/lib/reels-data";

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

  const [scripts, conversations] = await Promise.all([
    listAllScripts(clientId),
    listConversations(clientId),
  ]);

  const conversationTitleById = new Map(conversations.map((c) => [c.id, c.title]));

  return NextResponse.json({
    scripts: scripts.map((s) => ({
      id: s.id,
      conversation_id: s.conversation_id,
      conversation_title: conversationTitleById.get(s.conversation_id) ?? "Brief supprimé",
      body: s.body,
      hook: s.hook,
      framework: s.framework,
      format: s.format,
      platform: s.platform,
      duration_seconds: s.duration_seconds,
      metrics: s.metrics ?? {},
      created_at: s.created_at,
    })),
  });
}
