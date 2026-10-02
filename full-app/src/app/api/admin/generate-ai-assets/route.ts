import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { generateAllAIPrompts } from "@/lib/ai-prompts";
import type { BriefContext } from "@/lib/ai-prompts";

function isValidInternalSecret(headerValue: string | null): boolean {
  const expected = process.env.INTERNAL_TRIGGER_SECRET;
  if (!expected || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const adminSupabase = createAdminClient();

  // Internal calls (fire-and-forget from process-onboarding / onboarding submit)
  // must present a shared secret. Fail-closed when the secret is missing.
  const isInternal = isValidInternalSecret(req.headers.get("x-internal-secret"));

  if (!isInternal) {
    // Normal admin-session auth path
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
    }
  }

  const { campaignId } = await req.json();
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId requis" }, { status: 400 });
  }

  // Fetch campaign + linked onboarding response + profile
  const { data: campaign, error: campaignError } = await adminSupabase
    .from("campaigns")
    .select("id, name, budget_monthly, platform, objective, onboarding_response_id, client_id")
    .eq("id", campaignId)
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });
  }

  const { data: onboarding } = campaign.onboarding_response_id
    ? await adminSupabase
        .from("onboarding_responses")
        .select("responses")
        .eq("id", campaign.onboarding_response_id)
        .single()
    : { data: null };

  const { data: profileData } = campaign.client_id
    ? await adminSupabase
        .from("profiles")
        .select("full_name, company")
        .eq("id", campaign.client_id)
        .single()
    : { data: null };

  const responses = (onboarding?.responses ?? {}) as Record<string, unknown>;

  function val(v: unknown): string {
    if (!v) return "—";
    if (Array.isArray(v)) return (v as unknown[]).join(", ") || "—";
    return String(v).trim() || "—";
  }

  const briefContext: BriefContext = {
    entreprise: val(responses.a_entreprise) !== "—"
      ? val(responses.a_entreprise)
      : (profileData?.company ?? campaign.name ?? "Client"),
    resumeOffre: val(responses.a_resume_offre),
    typeOffre: val(responses.a_type),
    prix: val(responses.a_prix),
    promesse: val(responses.c_promesse),
    problemes: val(responses.a_problemes),
    differenciants: val(responses.a_differenciants),
    objectif: val(responses.b_objectif) !== "—"
      ? val(responses.b_objectif)
      : (campaign.objective ?? "leads"),
    cible: val(responses.d_cible1_description),
    budget: campaign.budget_monthly ? `${campaign.budget_monthly} €/mois` : val(responses.g_budget),
    conversion: val(responses.b_conversion),
  };

  const result = await generateAllAIPrompts(briefContext);

  // Save to DB — always persist what was generated, even partial
  await adminSupabase
    .from("campaigns")
    .update({
      ...(result.adCopy !== null && { ai_ad_copy_prompt: result.adCopy }),
      ...(result.videoAd !== null && { ai_video_ad_prompt: result.videoAd }),
      ...(result.vsl !== null && { ai_vsl_prompt: result.vsl }),
      ...(result.static !== null && { ai_static_prompt: result.static }),
      ai_generated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  const hasErrors = Object.keys(result.errors).length > 0;

  return NextResponse.json({
    success: !hasErrors,
    prompts: {
      adCopy: result.adCopy,
      videoAd: result.videoAd,
      vsl: result.vsl,
      static: result.static,
    },
    ...(hasErrors && { errors: result.errors }),
  });
}
