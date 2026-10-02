import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { maybeSendNewLeadEmail } from "@/lib/new-lead-email";

async function resolveClientId(sessionUserId: string): Promise<string> {
  const admin = createAdminClient();
  const previewId = await getPreviewClientId();
  if (!previewId) return sessionUserId;
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", sessionUserId)
    .single();
  return profile?.role === "admin" ? previewId : sessionUserId;
}

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const effectiveClientId = await resolveClientId(session.user.id);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") ?? "100", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  let query = adminSupabase
    .from("leads")
    .select("*, campaigns(name, ad_account_id)", { count: "exact" })
    .eq("client_id", effectiveClientId)
    .order("meta_created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ leads: data ?? [], total: count ?? 0 });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const clientId = await resolveClientId(session.user.id);

  const {
    full_name,
    email,
    phone,
    company,
    source,
    notes,
    campaign_id,
    pipeline_stage_id,
    tags,
    preferred_contact,
    city,
  } = await req.json();

  if (!full_name || typeof full_name !== "string" || full_name.trim() === "") {
    return NextResponse.json({ error: "Le nom complet est requis" }, { status: 400 });
  }

  // Duplicate check by email or phone
  let duplicateWarning: string | null = null;
  if (email || phone) {
    let dupQuery = adminSupabase
      .from("leads")
      .select("id, full_name, email, phone")
      .eq("client_id", clientId);

    if (email && phone) {
      dupQuery = dupQuery.or(`email.eq.${email},phone.eq.${phone}`);
    } else if (email) {
      dupQuery = dupQuery.eq("email", email);
    } else if (phone) {
      dupQuery = dupQuery.eq("phone", phone);
    }

    const { data: duplicates } = await dupQuery.limit(1);
    if (duplicates && duplicates.length > 0) {
      duplicateWarning = `Un lead similaire existe déjà : ${duplicates[0].full_name}`;
    }
  }

  // Default stage : le stage marqué is_default, sinon le premier par display_order
  let resolvedStageId: string | null = pipeline_stage_id ?? null;
  if (!resolvedStageId) {
    const { data: defaultStage } = await adminSupabase
      .from("pipeline_stages")
      .select("id")
      .eq("client_id", clientId)
      .order("is_default", { ascending: false })
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    resolvedStageId = defaultStage?.id ?? null;
  }

  const { data: lead, error: insertError } = await adminSupabase
    .from("leads")
    .insert({
      client_id: clientId,
      full_name: full_name.trim(),
      email: email ?? null,
      phone: phone ?? null,
      company: company ?? null,
      source: source ?? "manual",
      notes: notes ?? null,
      campaign_id: campaign_id ?? null,
      status: "new",
      pipeline_stage_id: resolvedStageId,
      tags: tags ?? [],
      preferred_contact: preferred_contact ?? null,
      city: city ?? null,
    })
    .select()
    .single();

  if (insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 });

  // Create initial activity
  await adminSupabase.from("lead_activities").insert({
    lead_id: lead.id,
    client_id: clientId,
    activity_type: "note",
    title: "Lead créé manuellement",
    created_by: session.user.id,
  });

  // Fire-and-forget — notify the client by email if enabled. Manual add via
  // AddLeadModal is excluded from email only when the lead was self-added
  // by the same user (anti-spam); preview-mode admins always trigger.
  if (clientId !== session.user.id) {
    void maybeSendNewLeadEmail({
      clientId,
      leadId: lead.id,
      fullName: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      source: lead.source,
      notes: lead.notes,
    });
  }

  return NextResponse.json(
    { lead, warning: duplicateWarning },
    { status: 201 }
  );
}
