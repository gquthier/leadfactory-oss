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

  // Verify lead ownership
  const { data: lead } = await adminSupabase
    .from("leads")
    .select("client_id")
    .eq("id", leadId)
    .single();

  if (!lead || lead.client_id !== session.user.id)
    return NextResponse.json(
      { error: "Lead introuvable ou accès refusé" },
      { status: 404 }
    );

  const { data, error } = await adminSupabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ activities: data ?? [] });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
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

  // Verify lead ownership
  const { data: lead } = await adminSupabase
    .from("leads")
    .select("client_id")
    .eq("id", leadId)
    .single();

  if (!lead || lead.client_id !== clientId)
    return NextResponse.json(
      { error: "Lead introuvable ou accès refusé" },
      { status: 404 }
    );

  const { activity_type, title, description } = await req.json();

  const validTypes = [
    "note",
    "call",
    "email",
    "meeting",
    "stage_change",
    "status_change",
    "task",
    "whatsapp",
    "sms",
    "other",
  ];

  if (!activity_type || !validTypes.includes(activity_type)) {
    return NextResponse.json(
      {
        error: `Type d'activité invalide. Valeurs acceptées : ${validTypes.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (!title || typeof title !== "string" || title.trim() === "") {
    return NextResponse.json(
      { error: "Le titre de l'activité est requis" },
      { status: 400 }
    );
  }

  const { data, error } = await adminSupabase
    .from("lead_activities")
    .insert({
      lead_id: leadId,
      client_id: clientId,
      activity_type,
      title: title.trim(),
      description: description ?? null,
      created_by: clientId,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ activity: data }, { status: 201 });
}
