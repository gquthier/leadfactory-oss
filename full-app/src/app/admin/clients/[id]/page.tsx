import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessClient } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import { ClientDetailClient } from "./ClientDetailClient";
import { type CampaignStatus } from "@/types/index";
import { getAdAccounts } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";

type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  budget_monthly: number | null;
  created_at: string;
  ad_account_id: string | null;
  meta_token_id: string | null;
  ai_creative_prompt: string | null;
  notes: string | null;
  onboarding_response_id: string | null;
  weekly_report_enabled: boolean;
};

type ClientProfile = {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  phone: string | null;
  created_at: string;
  role: string;
  is_active: boolean;
  next_catchup: string | null;
  managed_by: string | null;
  results_rating: string | null;
  results_rating_note: string | null;
};

export type ClientTask = {
  id: string;
  client_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export default async function AdminClientDetail(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  await initMetaToken(adminSupabase).catch(() => {});
  const metaAccounts = await getAdAccounts().catch(() => []);

  const [{ data: profile }, { data: campaigns }, { data: tasks }, { data: metaTokens }] = await Promise.all([
    adminSupabase
      .from("profiles")
      .select("id, full_name, company, email, phone, created_at, role, is_active, next_catchup, managed_by, results_rating, results_rating_note")
      .eq("id", params.id)
      .single(),
    adminSupabase
      .from("campaigns")
      .select("id, name, status, budget_monthly, created_at, ad_account_id, meta_token_id, ai_creative_prompt, notes, onboarding_response_id, weekly_report_enabled")
      .eq("client_id", params.id)
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("client_tasks")
      .select("*")
      .eq("client_id", params.id)
      .order("created_at", { ascending: true }),
    adminSupabase
      .from("meta_tokens")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name"),
  ]);

  if (!profile) redirect("/admin/clients");

  // Non-super-admin can view clients they manage OR that are assigned to them via the team
  if (!canAccessClient(scope, profile.managed_by, profile.id)) {
    redirect("/admin/clients");
  }

  return (
    <ClientDetailClient
      client={profile as unknown as ClientProfile}
      campaigns={(campaigns ?? []) as unknown as CampaignRow[]}
      tasks={(tasks ?? []) as unknown as ClientTask[]}
      metaAccounts={metaAccounts.map((a) => ({ id: a.id, account_id: a.account_id, name: a.name }))}
      metaTokens={(metaTokens ?? []) as { id: string; name: string; is_active: boolean }[]}
      isSuperAdmin={scope.isSuperAdmin}
    />
  );
}
