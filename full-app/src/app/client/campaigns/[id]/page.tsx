import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect, notFound } from "next/navigation";
import { getPreviewClientId } from "@/lib/client-preview";
import {
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
} from "@/types/index";
import { ClientCampaignTabs } from "./ClientCampaignTabs";

const PIPELINE = [
  { status: "brief_received",      label: "Brief reçu",                    desc: "Votre questionnaire a bien été reçu par nos équipes." },
  { status: "campaign_proposal",   label: "Propositions de campagne",      desc: "Nous cadrons les axes, les offres et les campagnes à lancer." },
  { status: "ad_creative",         label: "Créative publicitaire",         desc: "Production des créatives publicitaires en cours." },
  { status: "meta_account_setup",  label: "Mise en place du compte Meta",  desc: "Connexion et configuration du compte publicitaire Meta." },
  { status: "live_optimizing",     label: "En ligne et optimisation",      desc: "Vos campagnes tournent et sont optimisées en continu." },
] as const;

export default async function ClientCampaignDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", params.id)
    .eq("client_id", effectiveId)
    .single();

  if (!campaign) notFound();

  // Récupérer le brief si lié
  const { data: onboarding } = campaign.onboarding_response_id
    ? await admin
        .from("onboarding_responses")
        .select("responses")
        .eq("id", campaign.onboarding_response_id)
        .single()
    : { data: null };

  const statusIdx = PIPELINE.findIndex((p) => p.status === getCanonicalCampaignStatus(campaign));

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Votre campagne</p>
        <h1 className="text-3xl font-black uppercase tracking-tight">{campaign.name}</h1>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className={`text-xs font-black px-3 py-1 border-3 border-black ${getCampaignStatusColor(campaign)}`}>
            {getCampaignStatusLabel(campaign)}
          </span>
          {campaign.budget_monthly && (
            <span className="text-sm font-bold text-lf-gray">Budget : {campaign.budget_monthly}€/mois</span>
          )}
        </div>
      </div>

      <ClientCampaignTabs campaign={campaign} onboarding={onboarding} pipeline={PIPELINE} statusIdx={statusIdx} />
    </div>
  );
}
