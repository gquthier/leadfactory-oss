import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const leadId = params.id;

  const { data: lead, error } = await adminSupabase
    .from("leads")
    .select(
      "*, campaigns(name, ad_account_id), pipeline_stages(id, name, color, is_won, is_lost)"
    )
    .eq("id", leadId)
    .eq("client_id", session.user.id)
    .single();

  if (error || !lead)
    return NextResponse.json(
      { error: "Lead introuvable ou accès refusé" },
      { status: 404 }
    );

  const { data: activities, error: activitiesError } = await adminSupabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (activitiesError)
    return NextResponse.json(
      { error: activitiesError.message },
      { status: 500 }
    );

  return NextResponse.json({ lead, activities: activities ?? [] });
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const clientId = session.user.id;
  const leadId = params.id;

  // Verify ownership and fetch current values for change detection
  const { data: existing, error: fetchError } = await adminSupabase
    .from("leads")
    .select("client_id, pipeline_stage_id, status")
    .eq("id", leadId)
    .single();

  if (fetchError || !existing)
    return NextResponse.json({ error: "Lead introuvable" }, { status: 404 });

  if (existing.client_id !== clientId)
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await req.json();

  const {
    status,
    quality_score,
    notes,
    revenue,
    cash_collected,
    pipeline_stage_id,
    assigned_to,
    last_contacted_at,
    next_follow_up,
    tags,
    preferred_contact,
    city,
    source,
  } = body;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (status !== undefined) updates.status = status;
  if (quality_score !== undefined) updates.quality_score = quality_score;
  if (notes !== undefined) updates.notes = notes;
  if (revenue !== undefined) updates.revenue = revenue;
  if (cash_collected !== undefined) updates.cash_collected = cash_collected;
  if (pipeline_stage_id !== undefined)
    updates.pipeline_stage_id = pipeline_stage_id;
  if (assigned_to !== undefined) updates.assigned_to = assigned_to;
  if (last_contacted_at !== undefined)
    updates.last_contacted_at = last_contacted_at;
  if (next_follow_up !== undefined) updates.next_follow_up = next_follow_up;
  if (tags !== undefined) updates.tags = tags;
  if (preferred_contact !== undefined)
    updates.preferred_contact = preferred_contact;
  if (city !== undefined) updates.city = city;
  if (source !== undefined) updates.source = source;

  const { data: lead, error: updateError } = await adminSupabase
    .from("leads")
    .update(updates)
    .eq("id", leadId)
    .select()
    .single();

  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Track pipeline stage change
  if (
    pipeline_stage_id !== undefined &&
    pipeline_stage_id !== existing.pipeline_stage_id
  ) {
    // Fetch stage names for context
    const [prevStageResult, newStageResult] = await Promise.all([
      existing.pipeline_stage_id
        ? adminSupabase
            .from("pipeline_stages")
            .select("name")
            .eq("id", existing.pipeline_stage_id)
            .single()
        : Promise.resolve({ data: null }),
      pipeline_stage_id
        ? adminSupabase
            .from("pipeline_stages")
            .select("name")
            .eq("id", pipeline_stage_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const prevName = prevStageResult.data?.name ?? "Aucune";
    const newName = newStageResult.data?.name ?? "Aucune";

    await adminSupabase.from("lead_activities").insert({
      lead_id: leadId,
      client_id: clientId,
      activity_type: "stage_change",
      title: `Étape changée : ${prevName} → ${newName}`,
      metadata: {
        from_stage_id: existing.pipeline_stage_id,
        to_stage_id: pipeline_stage_id,
        from_stage_name: prevName,
        to_stage_name: newName,
      },
      created_by: clientId,
    });
  }

  // Track status change
  if (status !== undefined && status !== existing.status) {
    await adminSupabase.from("lead_activities").insert({
      lead_id: leadId,
      client_id: clientId,
      activity_type: "status_change",
      title: `Statut changé : ${existing.status ?? "inconnu"} → ${status}`,
      metadata: {
        from_status: existing.status,
        to_status: status,
      },
      created_by: clientId,
    });
  }

  return NextResponse.json({ lead });
}
