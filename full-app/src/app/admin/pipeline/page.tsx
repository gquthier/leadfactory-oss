import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, scopeCampaignsQuery } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import { PipelineClient } from "./PipelineClient";
import { CampaignStatus } from "@/types/index";
import type { PipelineClientTask } from "@/lib/pipeline-timeline";

export default async function AdminPipeline() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  const query = scopeCampaignsQuery(
    adminSupabase
      .from("campaigns")
      .select("id, name, status, budget_monthly, created_at, updated_at, ad_account_id, ai_creative_prompt, notes, client_id, onboarding_response_id, profiles:profiles!campaigns_client_id_fkey(full_name, company, email, next_catchup)")
      .order("updated_at", { ascending: false }),
    scope
  );

  const { data: campaigns, error } = await query;

  if (error) console.error("[admin/pipeline] DB error:", error.message);

  const clientIds = Array.from(new Set((campaigns ?? []).map((campaign) => campaign.client_id)));
  const onboardingIds = Array.from(
    new Set(
      (campaigns ?? [])
        .map((campaign) => campaign.onboarding_response_id)
        .filter(Boolean)
    )
  ) as string[];

  const [{ data: tasks }, { data: onboardingResponses }] = await Promise.all([
    clientIds.length
      ? adminSupabase
          .from("client_tasks")
          .select("id, client_id, title, description, is_completed, completed_at, created_at, updated_at")
          .in("client_id", clientIds)
      : Promise.resolve({ data: [] as PipelineClientTask[] }),
    onboardingIds.length
      ? adminSupabase
          .from("onboarding_responses")
          .select("id, submitted_at")
          .in("id", onboardingIds)
      : Promise.resolve({ data: [] as { id: string; submitted_at: string }[] }),
  ]);

  const tasksByClientId = new Map<string, PipelineClientTask[]>();
  for (const task of (tasks ?? []) as PipelineClientTask[]) {
    const existing = tasksByClientId.get(task.client_id) ?? [];
    existing.push(task);
    tasksByClientId.set(task.client_id, existing);
  }

  const onboardingById = new Map(
    ((onboardingResponses ?? []) as { id: string; submitted_at: string }[]).map((response) => [
      response.id,
      response.submitted_at,
    ])
  );

  type PipelineCampaign = {
    id: string;
    name: string;
    status: CampaignStatus;
    budget_monthly: number | null;
    created_at: string;
    updated_at: string;
    ad_account_id: string | null;
    ai_creative_prompt: string | null;
    notes: string | null;
    client_id: string;
    onboarding_response_id: string | null;
    onboarding_submitted_at: string | null;
    profiles: {
      full_name: string;
      company: string | null;
      email: string;
      next_catchup: string | null;
    } | null;
    client_tasks: PipelineClientTask[];
  };

  const pipelineCampaigns: PipelineCampaign[] = ((campaigns ?? []) as unknown as Omit<
    PipelineCampaign,
    "onboarding_submitted_at" | "client_tasks"
  >[]).map((campaign) => ({
    ...campaign,
    onboarding_submitted_at: campaign.onboarding_response_id
      ? onboardingById.get(campaign.onboarding_response_id) ?? null
      : null,
    client_tasks: tasksByClientId.get(campaign.client_id) ?? [],
  }));

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <div className="sticker -rotate-1 inline-block mb-3">PIPELINE</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Pipeline clients</h1>
        <p className="text-lf-gray font-medium mt-1">
          {pipelineCampaigns.length} campagne{pipelineCampaigns.length > 1 ? "s" : ""} en cours
        </p>
      </div>

      <PipelineClient campaigns={pipelineCampaigns} isSuperAdmin={scope.isSuperAdmin} />
    </div>
  );
}
