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
  const clientId = searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("client_tasks")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { client_id, title, description } = await req.json();
  if (!client_id || !title?.trim()) return NextResponse.json({ error: "client_id et title requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("client_tasks")
    .insert({
      client_id,
      created_by: session.user.id,
      title: title.trim(),
      description: description?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
