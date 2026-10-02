import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessCampaign } from "@/lib/admin-scope";
import { notFound, redirect } from "next/navigation";
import { CampaignDetailClient } from "./CampaignDetailClient";
import { getAdAccounts } from "@/lib/meta-api";

export default async function AdminCampaignDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  const campaignQuery = adminSupabase
    .from("campaigns")
    .select("*, profiles:profiles!campaigns_client_id_fkey(id, full_name, company, email, phone), ai_ad_copy_prompt, ai_video_ad_prompt, ai_vsl_prompt, ai_static_prompt, ai_generated_at")
    .eq("id", params.id);

  const { data: campaign, error } = await campaignQuery.maybeSingle();

  if (error) {
    console.error("[admin/campaigns/[id]] DB error:", error.message);
  }

  if (!campaign) notFound();

  // Non-super-admin can view campaigns they manage OR that are assigned to them via the team
  if (!canAccessCampaign(scope, campaign.managed_by ?? null, campaign.id)) {
    notFound();
  }

  const [onboardingResult, adAccounts] = await Promise.all([
    campaign.onboarding_response_id
      ? adminSupabase.from("onboarding_responses").select("responses").eq("id", campaign.onboarding_response_id).single()
      : Promise.resolve({ data: null }),
    process.env.META_ACCESS_TOKEN ? getAdAccounts().catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <CampaignDetailClient
      campaign={campaign}
      onboarding={onboardingResult.data}
      adAccounts={adAccounts}
      isSuperAdmin={scope.isSuperAdmin}
    />
  );
}
