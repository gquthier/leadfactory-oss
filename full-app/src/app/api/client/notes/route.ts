import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/client/notes — toutes les notes du client (ou ?unread=true pour count)
export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const campaignId = searchParams.get("campaign_id");

  let query = supabase
    .from("client_notes")
    .select("*")
    .eq("client_id", session.user.id)
    .order("created_at", { ascending: false });

  if (unreadOnly) query = query.eq("is_read", false);
  if (campaignId) query = query.eq("campaign_id", campaignId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notes: data ?? [] });
}

// PATCH /api/client/notes — marque des notes comme lues
export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { ids } = await req.json() as { ids?: string[] };

  let query = supabase
    .from("client_notes")
    .update({ is_read: true })
    .eq("client_id", session.user.id)
    .eq("is_read", false);

  if (ids?.length) {
    query = query.in("id", ids);
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
