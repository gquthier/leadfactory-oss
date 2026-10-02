import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

async function assertAdmin() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return null;

  return { admin, session };
}

/** GET /api/admin/meta-tokens — liste les tokens de l'admin connecté */
export async function GET() {
  const result = await assertAdmin();
  if (!result) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { admin, session } = result;
  const { data, error } = await admin
    .from("meta_tokens")
    .select("id, name, is_active, created_at")
    .eq("admin_id", session.user.id)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data });
}

/** POST /api/admin/meta-tokens — créer un token lié à l'admin connecté */
export async function POST(req: Request) {
  const result = await assertAdmin();
  if (!result) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { admin, session } = result;
  const { name, token } = await req.json();
  if (!name?.trim() || !token?.trim()) {
    return NextResponse.json({ error: "Nom et token requis" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("meta_tokens")
    .insert({ name: name.trim(), token: token.trim(), is_active: true, admin_id: session.user.id })
    .select("id, name, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data }, { status: 201 });
}
