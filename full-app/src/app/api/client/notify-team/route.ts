import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();

  // Get client profile for name
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("full_name, company")
    .eq("id", session.user.id)
    .single();

  const { action, message } = await req.json();
  if (!action) return NextResponse.json({ error: "action requis" }, { status: 400 });

  const clientName = profile?.company || profile?.full_name || "Client inconnu";

  const { error } = await adminSupabase
    .from("team_notifications")
    .insert({
      client_id: session.user.id,
      client_name: clientName,
      action,
      message: message || null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
