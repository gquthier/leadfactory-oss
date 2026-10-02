import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { data: formations, error } = await adminSupabase
    .from("formations")
    .select("*, formation_modules(id), client_formation_access(id)")
    .order("display_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (formations ?? []).map((f: Record<string, unknown>) => ({
    ...f,
    modules_count: Array.isArray(f.formation_modules) ? f.formation_modules.length : 0,
    clients_count: Array.isArray(f.client_formation_access) ? f.client_formation_access.length : 0,
    formation_modules: undefined,
    client_formation_access: undefined,
  }));

  return NextResponse.json({ formations: result });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { title, description, slug, cover_image_url } = await req.json();
  if (!title?.trim() || !slug?.trim()) return NextResponse.json({ error: "title et slug requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("formations")
    .insert({ title: title.trim(), description: description?.trim() || null, slug: slug.trim(), cover_image_url: cover_image_url || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ formation: data });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("formations")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ formation: data });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const { error } = await adminSupabase.from("formations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
