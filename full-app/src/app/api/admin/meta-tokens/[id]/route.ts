import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

async function assertAdmin() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return null;

  return admin;
}

/** PATCH /api/admin/meta-tokens/[id] — renommer ou activer/désactiver */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) update.name = String(body.name).trim();
  if (body.is_active !== undefined) update.is_active = Boolean(body.is_active);
  if (body.token !== undefined) update.token = String(body.token).trim();

  const { data, error } = await admin
    .from("meta_tokens")
    .update(update)
    .eq("id", params.id)
    .select("id, name, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data });
}

/** DELETE /api/admin/meta-tokens/[id] — supprimer un token */
export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Détacher les campagnes liées avant suppression
  await admin.from("campaigns").update({ meta_token_id: null }).eq("meta_token_id", params.id);

  const { error } = await admin.from("meta_tokens").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
