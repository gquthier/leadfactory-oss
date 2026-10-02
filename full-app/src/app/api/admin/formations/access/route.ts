import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const formationId = searchParams.get("formation_id");
  if (!formationId) return NextResponse.json({ error: "formation_id requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("client_formation_access")
    .select("*, profiles:client_id(id, full_name, company, email)")
    .eq("formation_id", formationId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ access: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { client_id, formation_id } = await req.json();
  if (!client_id || !formation_id) return NextResponse.json({ error: "client_id et formation_id requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("client_formation_access")
    .insert({ client_id, formation_id, granted_by: session.user.id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ access: data });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { client_id, formation_id } = await req.json();
  if (!client_id || !formation_id) return NextResponse.json({ error: "client_id et formation_id requis" }, { status: 400 });

  const { error } = await adminSupabase
    .from("client_formation_access")
    .delete()
    .eq("client_id", client_id)
    .eq("formation_id", formation_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
