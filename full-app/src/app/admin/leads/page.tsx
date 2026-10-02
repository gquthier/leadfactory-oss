import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope, scopeCampaignsQuery, scopeProfilesQuery } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import type { Lead } from "@/types/index";
import { LeadsClient } from "./LeadsClient";

export default async function AdminLeadsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  let leadsQ = adminSupabase
    .from("leads")
    .select("*, campaigns!inner(name, ad_account_id, managed_by), profiles(full_name, company)")
    .order("meta_created_at", { ascending: false })
    .limit(500);
  if (!scope.isSuperAdmin) {
    // Leads are scoped through their campaign: managed by me OR assigned to me.
    leadsQ =
      scope.assignedCampaignIds.length > 0
        ? leadsQ.or(
            `managed_by.eq.${scope.adminId},id.in.(${scope.assignedCampaignIds.join(",")})`,
            { referencedTable: "campaigns" }
          )
        : leadsQ.eq("campaigns.managed_by", scope.adminId);
  }

  const campaignsQ = scopeCampaignsQuery(
    adminSupabase
      .from("campaigns")
      .select("id, name, ad_account_id, client_id")
      .not("ad_account_id", "is", null)
      .order("name"),
    scope
  );

  const clientsQ = scopeProfilesQuery(
    adminSupabase
      .from("profiles")
      .select("id, full_name, company")
      .eq("role", "client")
      .eq("is_active", true)
      .order("full_name"),
    scope
  );

  const [{ data: leads }, { data: campaigns }, { data: clients }] = await Promise.all([
    leadsQ,
    campaignsQ,
    clientsQ,
  ]);

  return (
    <LeadsClient
      leads={(leads as unknown as Lead[]) ?? []}
      campaigns={campaigns ?? []}
      clients={clients ?? []}
    />
  );
}
