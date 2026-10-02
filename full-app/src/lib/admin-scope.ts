import { createAdminClient } from "@/lib/supabase-server";

export interface AdminScope {
  isSuperAdmin: boolean;
  adminId: string;
  /**
   * Client ids the (non-super) admin can access because a campaign of theirs
   * was assigned to this member via `campaign_team_members`. Empty for super admins
   * (they see everything) and for members with no team assignments.
   */
  assignedClientIds: string[];
  /**
   * Campaign ids assigned to this member via `campaign_team_members`.
   */
  assignedCampaignIds: string[];
}

function isMissingSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    error.message?.includes("does not exist") === true ||
    error.message?.includes("schema cache") === true
  );
}

/**
 * Returns the admin scope for the given userId.
 *
 * Super admins see all data. Regular admins see:
 *   - clients/campaigns they own directly (`managed_by = adminId`), AND
 *   - clients/campaigns assigned to them via `campaign_team_members`.
 *
 * The assigned-via-team ids are computed once here so every page/route can scope
 * its queries consistently with `scopeProfilesQuery` / `scopeCampaignsQuery`.
 */
export async function getAdminScope(userId: string): Promise<AdminScope> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .single();

  const isSuperAdmin = data?.is_super_admin ?? false;

  if (isSuperAdmin) {
    return { isSuperAdmin: true, adminId: userId, assignedClientIds: [], assignedCampaignIds: [] };
  }

  // Resolve the campaigns assigned to this member, then the clients behind them.
  const { data: assignments, error: assignmentsError } = await admin
    .from("campaign_team_members")
    .select("campaign_id")
    .eq("team_member_id", userId);

  const assignedCampaignIds = isMissingSchemaError(assignmentsError)
    ? []
    : Array.from(new Set(((assignments ?? []) as { campaign_id: string }[]).map((row) => row.campaign_id)));

  let assignedClientIds: string[] = [];
  if (assignedCampaignIds.length > 0) {
    const { data: campaigns } = await admin
      .from("campaigns")
      .select("client_id")
      .in("id", assignedCampaignIds);
    assignedClientIds = Array.from(
      new Set(((campaigns ?? []) as { client_id: string | null }[]).map((row) => row.client_id).filter((id): id is string => Boolean(id)))
    );
  }

  return { isSuperAdmin: false, adminId: userId, assignedClientIds, assignedCampaignIds };
}

/**
 * PostgREST `.or()` filter list (without the leading column) is fiddly to build by
 * hand. These helpers apply the correct visibility filter for a scope, covering both
 * directly-managed rows and team-assigned rows. Super admins get no filter (see all).
 */

// Minimal structural shape we rely on. Typed loosely (no recursive Q constraint) so
// TS doesn't try to fully instantiate Supabase's deeply-nested query builder generics
// (which triggers TS2589 "excessively deep").
type FilterableQuery = {
  eq: (column: string, value: unknown) => unknown;
  or: (filters: string) => unknown;
};

/**
 * Scope a query over the `profiles` table (client rows) by the row `id`.
 * Returns the same query type that was passed in.
 */
export function scopeProfilesQuery<Q>(query: Q, scope: AdminScope): Q {
  if (scope.isSuperAdmin) return query;
  const q = query as unknown as FilterableQuery;
  if (scope.assignedClientIds.length === 0) {
    return q.eq("managed_by", scope.adminId) as Q;
  }
  return q.or(
    `managed_by.eq.${scope.adminId},id.in.(${scope.assignedClientIds.join(",")})`
  ) as Q;
}

/**
 * Scope a query over the `campaigns` table by the campaign `id`.
 * Returns the same query type that was passed in.
 */
export function scopeCampaignsQuery<Q>(query: Q, scope: AdminScope): Q {
  if (scope.isSuperAdmin) return query;
  const q = query as unknown as FilterableQuery;
  if (scope.assignedCampaignIds.length === 0) {
    return q.eq("managed_by", scope.adminId) as Q;
  }
  return q.or(
    `managed_by.eq.${scope.adminId},id.in.(${scope.assignedCampaignIds.join(",")})`
  ) as Q;
}

/**
 * Whether the scope can access a specific client id (for detail-page / ownership guards).
 */
export function canAccessClient(scope: AdminScope, clientManagedBy: string | null, clientId: string): boolean {
  if (scope.isSuperAdmin) return true;
  if (clientManagedBy === scope.adminId) return true;
  return scope.assignedClientIds.includes(clientId);
}

/**
 * Whether the scope can access a specific campaign id (for detail-page / ownership guards).
 */
export function canAccessCampaign(scope: AdminScope, campaignManagedBy: string | null, campaignId: string): boolean {
  if (scope.isSuperAdmin) return true;
  if (campaignManagedBy === scope.adminId) return true;
  return scope.assignedCampaignIds.includes(campaignId);
}
