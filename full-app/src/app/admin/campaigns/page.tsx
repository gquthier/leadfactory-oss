import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope, scopeCampaignsQuery, scopeProfilesQuery } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import type { Campaign } from "@/types/index";
import { CampaignsClient } from "./CampaignsClient";

type CampaignWithProfile = Campaign & { profiles: { full_name: string; company: string; email: string } };

export default async function AdminCampaigns() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  const campaignsQ = scopeCampaignsQuery(
    adminSupabase
      .from("campaigns")
      .select("*, profiles:profiles!campaigns_client_id_fkey(full_name, company, email)")
      .order("created_at", { ascending: false }),
    scope
  );

  const clientsQ = scopeProfilesQuery(
    adminSupabase
      .from("profiles")
      .select("id, full_name, company, email")
      .eq("role", "client")
      .eq("is_active", true)
      .order("company"),
    scope
  );

  const [{ data: campaigns }, { data: clients }] = await Promise.all([
    campaignsQ,
    clientsQ,
  ]);

  return (
    <CampaignsClient
      campaigns={(campaigns as unknown as CampaignWithProfile[]) ?? []}
      clients={clients ?? []}
    />
  );
}
