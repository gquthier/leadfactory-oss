import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { getConversation, listPosts } from "@/lib/linkedin-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id requis" }, { status: 400 });
  }

  const conversation = await getConversation(clientId, id);
  if (!conversation) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const posts = await listPosts(clientId, id);

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages ?? [],
    posts: posts.map((p) => ({
      id: p.id,
      body: p.body,
      hook: p.hook,
      framework: p.framework,
      format: p.format,
      metrics: p.metrics ?? {},
    })),
  });
}
