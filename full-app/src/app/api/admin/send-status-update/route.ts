import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import {
  buildCampaignStatusUpdateEmail,
  type CampaignStatusUpdateDeliverable,
} from "@/lib/campaign-status-update-email";
import { getCampaignStatusLabel } from "@/types/index";

// Accept both camelCase (frontend) and snake_case field names
interface SendStatusUpdateBody {
  campaign_id?: string;
  campaignId?: string;
  client_id?: string;
  clientId?: string;
  new_status?: string;
  newStatus?: string;
  custom_message?: string;
  customMessage?: string;
  deliverables?: CampaignStatusUpdateDeliverable[];
}

export async function POST(req: Request) {
  // 1. Authenticate — require a valid session
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // 2. Verify admin role
  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  // 3. Parse and validate request body
  let body: SendStatusUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const campaign_id = body.campaign_id || body.campaignId || "";
  const client_id = body.client_id || body.clientId || "";
  const new_status = body.new_status || body.newStatus || "";
  const custom_message = body.custom_message || body.customMessage;
  const { deliverables } = body;

  if (!campaign_id?.trim()) {
    return NextResponse.json({ error: "campaign_id est requis" }, { status: 400 });
  }
  if (!client_id?.trim()) {
    return NextResponse.json({ error: "client_id est requis" }, { status: 400 });
  }
  if (!new_status?.trim()) {
    return NextResponse.json({ error: "new_status est requis" }, { status: 400 });
  }

  // 4. Fetch client profile (email + full_name + company)
  const { data: clientProfile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("email, full_name, company")
    .eq("id", client_id)
    .single();

  if (profileError || !clientProfile) {
    console.error("[send-status-update] profile fetch error:", profileError);
    return NextResponse.json(
      { error: "Profil client introuvable" },
      { status: 404 }
    );
  }

  if (!clientProfile.email) {
    return NextResponse.json(
      { error: "Adresse email du client manquante" },
      { status: 422 }
    );
  }

  // 5. Fetch campaign name
  const { data: campaign, error: campaignError } = await adminSupabase
    .from("campaigns")
    .select("name")
    .eq("id", campaign_id)
    .single();

  if (campaignError || !campaign) {
    console.error("[send-status-update] campaign fetch error:", campaignError);
    return NextResponse.json(
      { error: "Campagne introuvable" },
      { status: 404 }
    );
  }

  // 6. Build the email HTML
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.invalid";
  const statusLabel = getCampaignStatusLabel(new_status);

  const html = buildCampaignStatusUpdateEmail({
    clientName: clientProfile.full_name || clientProfile.company || "Client",
    campaignName: campaign.name,
    newStatus: new_status,
    statusLabel,
    customMessage: custom_message,
    deliverables,
    appUrl,
  });

  // 7. Send the email
  await sendEmail({
    to: clientProfile.email,
    subject: `Mise à jour de ta campagne — ${statusLabel}`,
    html,
  });

  return NextResponse.json({ success: true });
}
