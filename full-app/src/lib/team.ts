import { createAdminClient } from "@/lib/supabase-server";
import type {
  CampaignStatus,
  TeamCampaign,
  TeamCampaignAssignment,
  TeamClient,
  TeamDashboardMember,
  TeamDashboardSummary,
  TeamMember,
  TeamMemberClientRate,
  TeamRole,
  TeamStatus,
} from "@/types/index";

type RawTeamMember = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_super_admin: boolean | null;
  team_role?: TeamRole | null;
  team_status?: TeamStatus | null;
  created_at: string;
};

type RawTeamClient = {
  id: string;
  full_name: string;
  company: string | null;
};

type RawTeamCampaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  client_id: string;
  created_at: string;
};

type RawCampaignAssignment = TeamCampaignAssignment;

type RawClientRate = {
  id: string;
  team_member_id: string;
  client_id: string;
  monthly_rate: number | string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

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

function normalizeNumber(value: number | string | null | undefined) {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getClientDisplayName(client: TeamClient | undefined) {
  if (!client) return "Client inconnu";
  return client.company || client.full_name || "Client inconnu";
}

function normalizeTeamRole(member: Pick<RawTeamMember, "team_role" | "is_super_admin">): TeamRole {
  if (member.is_super_admin) return "super_admin";
  if (member.team_role) return member.team_role;
  return "admin";
}

function normalizeTeamStatus(member: Pick<RawTeamMember, "team_status" | "is_active">): TeamStatus {
  if (member.team_status) return member.team_status;
  return member.is_active ? "active" : "disabled";
}

function isActiveCampaignStatus(status: CampaignStatus | string) {
  return !["paused", "completed", "completed_project"].includes(String(status));
}

export async function getTeamDashboard(): Promise<{
  members: TeamDashboardMember[];
  campaigns: TeamCampaign[];
  clients: TeamClient[];
  summary: TeamDashboardSummary;
}> {
  const admin = createAdminClient();

  const [rawClients, rawCampaigns] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, company")
      .eq("role", "client")
      .order("company", { ascending: true }),
    admin
      .from("campaigns")
      .select("id, name, status, client_id, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const initialMembers = await admin
    .from("profiles")
    .select("id, email, full_name, is_active, is_super_admin, team_role, team_status, created_at")
    .eq("role", "admin")
    .order("full_name", { ascending: true });

  const rawMembers = isMissingSchemaError(initialMembers.error)
    ? await admin
      .from("profiles")
      .select("id, email, full_name, is_active, is_super_admin, created_at")
      .eq("role", "admin")
      .order("full_name", { ascending: true })
    : initialMembers;

  const initialAssignments = await admin
    .from("campaign_team_members")
    .select("campaign_id, team_member_id, created_at")
    .order("created_at", { ascending: false });

  const assignmentsData = isMissingSchemaError(initialAssignments.error)
    ? []
    : ((initialAssignments.data ?? []) as RawCampaignAssignment[]);

  const initialRates = await admin
    .from("team_member_client_rates")
    .select("id, team_member_id, client_id, monthly_rate, notes, created_at, updated_at")
    .order("created_at", { ascending: false });

  const ratesData = isMissingSchemaError(initialRates.error)
    ? []
    : ((initialRates.data ?? []) as RawClientRate[]);

  const clients = ((rawClients.data ?? []) as RawTeamClient[]).map((client) => ({
    id: client.id,
    full_name: client.full_name,
    company: client.company,
  }));

  const clientsById = new Map(clients.map((client) => [client.id, client]));

  const campaigns = ((rawCampaigns.data ?? []) as RawTeamCampaign[]).map((campaign) => {
    const client = clientsById.get(campaign.client_id);

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      client_id: campaign.client_id,
      created_at: campaign.created_at,
      client_name: getClientDisplayName(client),
      client_company: client?.company ?? null,
    } satisfies TeamCampaign;
  });

  const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const assignmentsByMember = new Map<string, TeamCampaign[]>();
  for (const assignment of assignmentsData) {
    const campaign = campaignsById.get(assignment.campaign_id);
    if (!campaign) continue;

    const existing = assignmentsByMember.get(assignment.team_member_id) ?? [];
    existing.push(campaign);
    assignmentsByMember.set(assignment.team_member_id, existing);
  }

  const ratesByMember = new Map<string, TeamMemberClientRate[]>();
  for (const rate of ratesData) {
    const client = clientsById.get(rate.client_id);
    const normalizedRate: TeamMemberClientRate = {
      id: rate.id,
      team_member_id: rate.team_member_id,
      client_id: rate.client_id,
      monthly_rate: normalizeNumber(rate.monthly_rate),
      notes: rate.notes,
      created_at: rate.created_at,
      updated_at: rate.updated_at,
      client_name: getClientDisplayName(client),
      client_company: client?.company ?? null,
    };

    const existing = ratesByMember.get(rate.team_member_id) ?? [];
    existing.push(normalizedRate);
    ratesByMember.set(rate.team_member_id, existing);
  }

  // Fetch initial_password from auth user_metadata for each admin member
  const rawMembersList = (rawMembers.data ?? []) as RawTeamMember[];
  const passwordByMemberId = new Map<string, string | null>();
  await Promise.all(
    rawMembersList.map(async (member) => {
      try {
        const { data } = await admin.auth.admin.getUserById(member.id);
        const pwd = data?.user?.user_metadata?.initial_password ?? null;
        passwordByMemberId.set(member.id, typeof pwd === "string" ? pwd : null);
      } catch {
        passwordByMemberId.set(member.id, null);
      }
    })
  );

  const members = rawMembersList
    .map((member) => {
      const assignedCampaigns = assignmentsByMember.get(member.id) ?? [];
      const activeAssignedCampaigns = assignedCampaigns.filter((campaign) =>
        isActiveCampaignStatus(campaign.status)
      );
      const activeClientIds = Array.from(
        new Set(activeAssignedCampaigns.map((campaign) => campaign.client_id))
      );
      const clientRates = ratesByMember.get(member.id) ?? [];
      const rateByClientId = new Map(clientRates.map((rate) => [rate.client_id, rate.monthly_rate]));

      return {
        id: member.id,
        email: member.email,
        full_name: member.full_name,
        is_active: member.is_active,
        is_super_admin: member.is_super_admin ?? false,
        team_role: normalizeTeamRole(member),
        team_status: normalizeTeamStatus(member),
        created_at: member.created_at,
        assigned_campaigns: assignedCampaigns,
        client_rates: clientRates,
        active_projects_count: activeAssignedCampaigns.length,
        active_clients_count: activeClientIds.length,
        pay_due_total: activeClientIds.reduce((sum, clientId) => sum + (rateByClientId.get(clientId) ?? 0), 0),
        initial_password: passwordByMemberId.get(member.id) ?? null,
      } satisfies TeamDashboardMember;
    })
    .sort((left, right) => {
      if (left.is_super_admin && !right.is_super_admin) return -1;
      if (!left.is_super_admin && right.is_super_admin) return 1;
      return left.full_name.localeCompare(right.full_name, "fr");
    });

  const summary = members.reduce<TeamDashboardSummary>(
    (acc, member) => {
      if (member.team_status !== "disabled") {
        acc.active_members_count += 1;
      }
      acc.active_projects_count += member.active_projects_count;
      acc.active_clients_count += member.active_clients_count;
      acc.pay_due_total += member.pay_due_total;
      return acc;
    },
    {
      active_members_count: 0,
      active_projects_count: 0,
      active_clients_count: 0,
      pay_due_total: 0,
    }
  );

  return { members, campaigns, clients, summary };
}
