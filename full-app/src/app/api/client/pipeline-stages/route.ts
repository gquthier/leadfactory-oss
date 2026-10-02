import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const clientId = session.user.id;

  // Check if the client already has stages
  const { data: existing, error: checkError } = await adminSupabase
    .from("pipeline_stages")
    .select("id")
    .eq("client_id", clientId)
    .limit(1);

  if (checkError)
    return NextResponse.json({ error: checkError.message }, { status: 500 });

  // Seed default stages if none exist
  if (!existing || existing.length === 0) {
    const { error: rpcError } = await adminSupabase.rpc(
      "seed_default_pipeline_stages",
      { p_client_id: clientId }
    );
    if (rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const { data, error } = await adminSupabase
    .from("pipeline_stages")
    .select("*")
    .eq("client_id", clientId)
    .order("display_order", { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stages: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { name, color, display_order } = await req.json();

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json(
      { error: "Le nom de l'étape est requis" },
      { status: 400 }
    );
  }

  const { data, error } = await adminSupabase
    .from("pipeline_stages")
    .insert({
      client_id: session.user.id,
      name: name.trim(),
      color: color ?? "#3B82F6",
      display_order: display_order ?? 0,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stage: data }, { status: 201 });
}
