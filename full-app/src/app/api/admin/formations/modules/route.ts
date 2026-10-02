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
    .from("formation_modules")
    .select("*")
    .eq("formation_id", formationId)
    .order("display_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ modules: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { formation_id, title, description, module_number, video_url, presentation_url, resources, notes, duration_minutes, display_order } = await req.json();
  if (!formation_id || !title?.trim()) return NextResponse.json({ error: "formation_id et title requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("formation_modules")
    .insert({
      formation_id,
      title: title.trim(),
      description: description?.trim() || null,
      module_number: module_number ?? 0,
      video_url: video_url || null,
      presentation_url: presentation_url || null,
      resources: resources ?? [],
      notes: notes?.trim() || null,
      duration_minutes: duration_minutes || null,
      display_order: display_order ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ module: data });
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
    .from("formation_modules")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ module: data });
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

  const { error } = await adminSupabase.from("formation_modules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
