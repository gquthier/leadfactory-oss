import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { triggerLeadFactoryAutomation } from "@/lib/leadfactory-automation";
import { createNotionMetaCampaignProposal } from "@/lib/notion-meta-proposal";
import { buildClientWelcomeEmail } from "@/lib/client-welcome-email";
import {
  getCampaignStatusWriteCandidates,
  isCampaignStatusEnumError,
} from "@/lib/campaign-status";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    responses?: Record<string, unknown>;
    flow?: string;
  } | null;

  if (!body?.responses) {
    return NextResponse.json({ error: "Données manquantes" }, { status: 400 });
  }

  const responses = asRecord(body.responses);
  const flow = String(body.flow || "leadfactory");

  const adminSupabase = createAdminClient();

  if (flow === "signup") {
    const safeResponses = {
      ...responses,
      i_password: "",
      i_password_confirm: "",
      submitted_via: "signup-flow",
    };

    const { data: onboarding, error: insertError } = await adminSupabase
      .from("onboarding_responses")
      .insert({
        questionnaire_type: "signup",
        responses: safeResponses,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ success: true, onboardingId: onboarding.id });
  }

  const entreprise = String(responses.a_entreprise || "Client").trim();
  const budget = responses.g_budget ? parseFloat(String(responses.g_budget)) : null;
  const objectif = Array.isArray(responses.b_objectif)
    ? String(responses.b_objectif[0] || "")
    : String(responses.b_objectif || "leads");

  // Identifiants choisis par le client (StepI)
  const clientEmail = String(responses.i_email || "").trim();
  const clientPassword = String(responses.i_password || "").trim();

  const email = clientEmail;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Un email client valide est requis" }, { status: 400 });
  const tempPassword = clientPassword || `${randomUUID()}-${randomUUID()}`;

  const safeResponses = { ...responses, i_password: "***", i_password_confirm: "***" };
  const { data: onboarding, error: insertError } = await adminSupabase
    .from("onboarding_responses")
    .insert({
      questionnaire_type: "leadfactory",
      responses: safeResponses,
      submitted_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  // 3. Créer le compte auth
  const { data: newUser, error: userError } = await adminSupabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: entreprise },
  });

  if (userError) {
    // Compte peut-être déjà existant (slug dupliqué), on note et on continue sans bloquer l'UX
    await adminSupabase.from("onboarding_responses").update({
      notes: `[AUTO] Erreur création compte: ${userError.message}`,
    }).eq("id", onboarding.id);
    return NextResponse.json({ success: true, auto_client: false });
  }

  const userId = newUser.user.id;

  // 4. Mettre à jour le profil
  await adminSupabase.from("profiles").update({
    company: entreprise,
    full_name: entreprise,
    updated_at: new Date().toISOString(),
  }).eq("id", userId);

  // 5. Créer la campagne placeholder
  let campaign: { id: string } | null = null;
  for (const status of getCampaignStatusWriteCandidates("brief_received")) {
    const { data, error } = await adminSupabase
      .from("campaigns")
      .insert({
        client_id: userId,
        onboarding_response_id: onboarding.id,
        name: `Campagne Meta — ${entreprise}`,
        status,
        budget_monthly: budget,
        platform: "meta",
        objective: objectif,
      })
      .select()
      .single();

    if (!error) {
      campaign = data;
      break;
    }

    if (!isCampaignStatusEnumError(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (!campaign) {
    return NextResponse.json({ error: "Impossible de créer la campagne" }, { status: 500 });
  }

  // 6. Lier le brief au compte sans stocker de mot de passe.
  await adminSupabase.from("onboarding_responses").update({
    client_id: userId,
    campaign_id: campaign?.id ?? null,
    notes: "[AUTO] Compte créé ; les identifiants restent gérés par Auth.",
  }).eq("id", onboarding.id);

  // 7. Générer les assets IA en arrière-plan — signed with INTERNAL_TRIGGER_SECRET
  if (campaign?.id) {
    const internalSecret = process.env.INTERNAL_TRIGGER_SECRET;
    if (internalSecret) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      fetch(`${appUrl}/api/admin/generate-ai-assets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ campaignId: campaign.id }),
      }).catch(() => {});
    } else {
      console.warn("[onboarding/submit] INTERNAL_TRIGGER_SECRET missing — skipping AI generation");
    }
  }

  // 8. Envoyer l'email de bienvenue (non bloquant)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  sendEmail({
    to: email,
    subject: "Bienvenue chez Lead Factory",
    html: buildClientWelcomeEmail({
      clientName: entreprise,
      email,
      password: tempPassword,
      appUrl,
    }),
  }).catch(() => {});

  // 9. Notifier l'admin
  fetch(`${appUrl}/api/notify-new-brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entreprise, submitted_at: new Date().toISOString() }),
  }).catch(() => {});

  // 10. Générer la proposition de campagne Meta (si config API présente)
  let notionProposalUrl: string | null = null;
  try {
    const notion = await createNotionMetaCampaignProposal({
      company: entreprise,
      onboardingId: onboarding.id,
      campaignId: campaign?.id ?? null,
      responses: safeResponses,
    });
    notionProposalUrl = notion?.url ?? null;
  } catch (err) {
    console.error("[notion-meta-proposal] generation failed", err);
  }

  // 11. Déclencher l'orchestration LeadFactory (Railway/OpenClaw/Slack)
  triggerLeadFactoryAutomation({
    onboardingId: onboarding.id,
    campaignId: campaign?.id ?? null,
    clientId: userId,
    company: entreprise,
    email,
    responses: safeResponses,
    notionProposalUrl,
  }).catch((err) => {
    console.error("[leadfactory-automation] webhook failed", err);
  });

  return NextResponse.json({
    success: true,
    auto_client: true,
    client_id: userId,
    onboarding_id: onboarding.id,
  });
}
