import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

/** PATCH /api/admin/meta-tokens/assign — assigne un token à une campagne */
export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { campaign_id, token_id } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  const { error } = await admin
    .from("campaigns")
    .update({ meta_token_id: token_id ?? null, updated_at: new Date().toISOString() })
    .eq("id", campaign_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
