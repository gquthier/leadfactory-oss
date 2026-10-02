import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const stageId = params.id;

  // Verify ownership
  const { data: stage } = await adminSupabase
    .from("pipeline_stages")
    .select("client_id")
    .eq("id", stageId)
    .single();

  if (!stage || stage.client_id !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { name, color, display_order, is_won, is_lost } = await req.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;
  if (display_order !== undefined) updates.display_order = display_order;
  if (is_won !== undefined) updates.is_won = is_won;
  if (is_lost !== undefined) updates.is_lost = is_lost;

  const { data, error } = await adminSupabase
    .from("pipeline_stages")
    .update(updates)
    .eq("id", stageId)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ stage: data });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const stageId = params.id;

  // Verify ownership
  const { data: stage } = await adminSupabase
    .from("pipeline_stages")
    .select("client_id")
    .eq("id", stageId)
    .single();

  if (!stage || stage.client_id !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Check that no leads reference this stage
  const { count, error: countError } = await adminSupabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_stage_id", stageId);

  if (countError)
    return NextResponse.json({ error: countError.message }, { status: 500 });

  if (count && count > 0) {
    return NextResponse.json(
      {
        error: `Impossible de supprimer cette étape : ${count} lead(s) y sont associés. Déplacez-les d'abord.`,
      },
      { status: 409 }
    );
  }

  const { error } = await adminSupabase
    .from("pipeline_stages")
    .delete()
    .eq("id", stageId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
