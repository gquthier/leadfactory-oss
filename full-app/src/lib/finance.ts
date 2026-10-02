import { createAdminClient } from "@/lib/supabase-server";
import { initMetaToken } from "@/lib/meta-token";
import { getAccountInsightsForRange } from "@/lib/meta-api";
import type {
  Campaign,
  ClientFinanceProfile,
  FinanceDashboardRow,
  FinanceDashboardSummary,
  FinanceEntry,
  Lead,
  Profile,
  TeamMember,
} from "@/types/index";

type ClientWithCampaigns = Pick<Profile, "id" | "full_name" | "company" | "email" | "is_active"> & {
  campaigns: Array<Pick<Campaign, "id" | "name" | "status" | "ad_account_id">>;
};

type DashboardFilters = {
  month?: string;
  from?: string;
  to?: string;
};

type RangeInfo = {
  month: string;
  monthLabel: string;
  label: string;
  from: string;
  to: string;
  fromIso: string;
  toExclusiveIso: string;
};

type RawFinanceEntry = FinanceEntry & {
  amount: number | string | null;
  client?: Array<{ full_name: string; company: string | null }> | { full_name: string; company: string | null } | null;
  team_member?: Array<TeamMember> | TeamMember | null;
};

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isValidDateInput(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getMonthBounds(month?: string) {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const safeMonth = /^\d{4}-\d{2}$/.test(month ?? "") ? String(month) : fallback;
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));
  return {
    month: safeMonth,
    monthLabel: formatMonthLabel(start),
    from: `${year}-${pad(monthNumber)}-01`,
    to: `${year}-${pad(monthNumber)}-${pad(end.getUTCDate())}`,
  };
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function buildRangeInfo(filters?: DashboardFilters): RangeInfo {
  const monthBounds = getMonthBounds(filters?.month);
  const hasCustomRange =
    isValidDateInput(filters?.from) &&
    isValidDateInput(filters?.to) &&
    String(filters?.from) <= String(filters?.to);

  const from = hasCustomRange ? String(filters?.from) : monthBounds.from;
  const to = hasCustomRange ? String(filters?.to) : monthBounds.to;

  const label =
    !hasCustomRange && from === monthBounds.from && to === monthBounds.to
      ? monthBounds.monthLabel
      : `${formatDateLabel(from)} → ${formatDateLabel(to)}`;

  return {
    month: monthBounds.month,
    monthLabel: monthBounds.monthLabel,
    label,
    from,
    to,
    fromIso: `${from}T00:00:00.000Z`,
    toExclusiveIso: addDays(to, 1),
  };
}

function normalizeNumber(value: number | string | null | undefined) {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProfile(profile: Partial<ClientFinanceProfile> | undefined, clientId: string): ClientFinanceProfile {
  return {
    id: profile?.id ?? `draft-${clientId}`,
    client_id: clientId,
    phase: profile?.phase === "mrr" ? "mrr" : "trial",
    trial_amount: profile?.trial_amount == null ? null : normalizeNumber(profile.trial_amount),
    trial_start_date: profile?.trial_start_date ?? null,
    trial_end_date: profile?.trial_end_date ?? null,
    mrr_amount: profile?.mrr_amount == null ? null : normalizeNumber(profile.mrr_amount),
    next_payment_date: profile?.next_payment_date ?? null,
    last_payment_date: profile?.last_payment_date ?? null,
    notes: profile?.notes ?? null,
    created_at: profile?.created_at ?? new Date(0).toISOString(),
    updated_at: profile?.updated_at ?? new Date(0).toISOString(),
  };
}

function normalizeEntry(entry: RawFinanceEntry): FinanceEntry {
  return {
    ...entry,
    amount: normalizeNumber(entry.amount),
    client: Array.isArray(entry.client) ? entry.client[0] ?? null : entry.client ?? null,
    team_member: Array.isArray(entry.team_member) ? entry.team_member[0] ?? null : entry.team_member ?? null,
    profiles: Array.isArray(entry.client) ? entry.client[0] ?? null : entry.client ?? null,
  };
}

function isDateInRange(date: string | null | undefined, rangeInfo: RangeInfo) {
  if (!date) return false;
  return date >= rangeInfo.from && date <= rangeInfo.to;
}

function getExpectedRevenue(profile: ClientFinanceProfile, rangeInfo: RangeInfo) {
  if (!isDateInRange(profile.next_payment_date, rangeInfo)) return 0;
  return profile.phase === "mrr"
    ? normalizeNumber(profile.mrr_amount)
    : normalizeNumber(profile.trial_amount);
}

function getRecurringRevenue(profile: ClientFinanceProfile) {
  if (profile.phase !== "mrr") return 0;
  return normalizeNumber(profile.mrr_amount);
}

function getPrimaryAdAccount(campaigns: ClientWithCampaigns["campaigns"]) {
  const liveCampaign = campaigns.find((campaign) => campaign.ad_account_id && campaign.status === "live");
  if (liveCampaign?.ad_account_id) return liveCampaign.ad_account_id;
  return campaigns.find((campaign) => campaign.ad_account_id)?.ad_account_id ?? null;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export async function getFinanceDashboard(filters?: DashboardFilters): Promise<{
  month: string;
  monthLabel: string;
  rangeLabel: string;
  from: string;
  to: string;
  rows: FinanceDashboardRow[];
  entries: FinanceEntry[];
  teamMembers: TeamMember[];
  summary: FinanceDashboardSummary;
  metaConnected: boolean;
}> {
  const rangeInfo = buildRangeInfo(filters);
  const admin = createAdminClient();
  await initMetaToken(admin);

  const [
    rawClients,
    rawTeamMembers,
    rawNewClients,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, company, email, is_active, campaigns:campaigns!campaigns_client_id_fkey(id, name, status, ad_account_id)")
      .eq("role", "client")
      .order("company", { ascending: true }),
    admin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "admin")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "client")
      .gte("created_at", rangeInfo.fromIso)
      .lt("created_at", rangeInfo.toExclusiveIso),
  ]);

  const clients = ((rawClients.data ?? []) as unknown as Array<ClientWithCampaigns & { campaigns?: ClientWithCampaigns["campaigns"] | null }>).map((client) => ({
    ...client,
    campaigns: client.campaigns ?? [],
  }));
  const clientIds = clients.map((client) => client.id);
  const teamMembers = (rawTeamMembers.data ?? []) as TeamMember[];

  const [rawProfiles, rawEntries, rawLeads] = await Promise.all([
    clientIds.length === 0
      ? Promise.resolve({ data: [] as ClientFinanceProfile[] })
      : admin
          .from("client_finance_profiles")
          .select("*")
          .in("client_id", clientIds),
    admin
      .from("finance_entries")
      .select(`
        id,
        client_id,
        team_member_id,
        entry_type,
        category,
        label,
        amount,
        entry_date,
        received_by,
        notes,
        created_at,
        updated_at,
        client:profiles!finance_entries_client_id_fkey(full_name, company),
        team_member:profiles!finance_entries_team_member_id_fkey(id, full_name, email)
      `)
      .gte("entry_date", rangeInfo.from)
      .lte("entry_date", rangeInfo.to)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    clientIds.length === 0
      ? Promise.resolve({ data: [] as Lead[] })
      : admin
          .from("leads")
          .select("id, client_id, revenue, cash_collected, created_at")
          .in("client_id", clientIds)
          .gte("created_at", rangeInfo.fromIso)
          .lt("created_at", rangeInfo.toExclusiveIso),
  ]);

  const financeProfiles = ((rawProfiles.data ?? []) as ClientFinanceProfile[]).map((profile) => ({
    ...profile,
    trial_amount: profile.trial_amount == null ? null : normalizeNumber(profile.trial_amount),
    mrr_amount: profile.mrr_amount == null ? null : normalizeNumber(profile.mrr_amount),
  }));
  const financeEntries = ((rawEntries.data ?? []) as RawFinanceEntry[]).map(normalizeEntry);
  const leads = (rawLeads.data ?? []) as Lead[];

  const financeByClient = new Map(financeProfiles.map((profile) => [profile.client_id, profile]));
  const entriesByClient = new Map<string, FinanceEntry[]>();
  const unassignedEntries: FinanceEntry[] = [];

  for (const entry of financeEntries) {
    if (!entry.client_id) {
      unassignedEntries.push(entry);
      continue;
    }
    const existing = entriesByClient.get(entry.client_id) ?? [];
    existing.push(entry);
    entriesByClient.set(entry.client_id, existing);
  }

  const leadByClient = new Map<string, { revenue: number; cash: number }>();
  for (const lead of leads) {
    if (!lead.client_id) continue;
    const bucket = leadByClient.get(lead.client_id) ?? { revenue: 0, cash: 0 };
    bucket.revenue += normalizeNumber(lead.revenue);
    bucket.cash += normalizeNumber(lead.cash_collected);
    leadByClient.set(lead.client_id, bucket);
  }

  const accountByClient = new Map<string, string>();
  const uniqueAccounts = new Set<string>();
  for (const client of clients) {
    const accountId = getPrimaryAdAccount(client.campaigns);
    if (!accountId) continue;
    accountByClient.set(client.id, accountId);
    uniqueAccounts.add(accountId);
  }

  const spendByAccount = new Map<string, number>();
  if (process.env.META_ACCESS_TOKEN && uniqueAccounts.size > 0) {
    const insights = await Promise.all(
      Array.from(uniqueAccounts).map(async (accountId) => {
        const data = await getAccountInsightsForRange(accountId, rangeInfo.from, rangeInfo.to);
        return [accountId, data?.spend ?? 0] as const;
      })
    );

    for (const [accountId, spend] of insights) {
      spendByAccount.set(accountId, spend);
    }
  }

  const rows = clients
    .map((client): FinanceDashboardRow => {
      const financeProfile = normalizeProfile(financeByClient.get(client.id), client.id);
      const clientEntries = entriesByClient.get(client.id) ?? [];
      const revenueEntries = clientEntries.filter((entry) => entry.entry_type === "revenue");
      const expenseEntries = clientEntries.filter((entry) => entry.entry_type === "expense");
      const paymentEntry =
        revenueEntries.find((entry) => entry.category === "client_payment") ??
        revenueEntries[0] ??
        null;
      const manualRevenue = revenueEntries.reduce((sum, entry) => sum + normalizeNumber(entry.amount), 0);
      const manualExpenses = expenseEntries.reduce((sum, entry) => sum + normalizeNumber(entry.amount), 0);
      const crmStats = leadByClient.get(client.id) ?? { revenue: 0, cash: 0 };
      const adSpend = spendByAccount.get(accountByClient.get(client.id) ?? "") ?? 0;
      const expectedRevenue = getExpectedRevenue(financeProfile, rangeInfo);
      const recurringRevenue = getRecurringRevenue(financeProfile);
      const totalExpenses = manualExpenses + adSpend;
      const margin = expectedRevenue - totalExpenses;
      const netProfit = manualRevenue - totalExpenses;
      const roas = adSpend > 0 ? crmStats.revenue / adSpend : null;
      const roi = adSpend > 0 ? (crmStats.revenue - adSpend) / adSpend : null;

      return {
        client_id: client.id,
        client_name: client.company ?? client.full_name,
        company: client.company,
        contact_name: client.full_name,
        email: client.email,
        is_active: client.is_active,
        campaigns: client.campaigns,
        finance_profile: financeProfile,
        next_payment_date: financeProfile.next_payment_date,
        payment_entry_id: paymentEntry?.id ?? null,
        payment_amount: paymentEntry ? roundCurrency(normalizeNumber(paymentEntry.amount)) : null,
        payment_date: paymentEntry?.entry_date ?? null,
        expected_revenue: roundCurrency(expectedRevenue),
        recurring_revenue: roundCurrency(recurringRevenue),
        manual_revenue: roundCurrency(manualRevenue),
        crm_revenue: roundCurrency(crmStats.revenue),
        crm_cash: roundCurrency(crmStats.cash),
        manual_expenses: roundCurrency(manualExpenses),
        ad_spend: roundCurrency(adSpend),
        total_expenses: roundCurrency(totalExpenses),
        margin: roundCurrency(margin),
        net_profit: roundCurrency(netProfit),
        roas,
        roi,
      };
    })
    .sort((left, right) => {
      const leftDate = left.next_payment_date ?? "9999-12-31";
      const rightDate = right.next_payment_date ?? "9999-12-31";
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return left.client_name.localeCompare(right.client_name, "fr");
    });

  const manualRevenueTotal = financeEntries
    .filter((entry) => entry.entry_type === "revenue")
    .reduce((sum, entry) => sum + normalizeNumber(entry.amount), 0);
  const manualExpenseTotal = financeEntries
    .filter((entry) => entry.entry_type === "expense")
    .reduce((sum, entry) => sum + normalizeNumber(entry.amount), 0);
  const adSpendTotal = rows.reduce((sum, row) => sum + row.ad_spend, 0);
  const expectedRevenueTotal = rows.reduce((sum, row) => sum + row.expected_revenue, 0);
  const recurringRevenueTotal = rows.reduce((sum, row) => sum + row.recurring_revenue, 0);
  const crmRevenueTotal = rows.reduce((sum, row) => sum + row.crm_revenue, 0);
  const totalExpenses = manualExpenseTotal + adSpendTotal;

  return {
    month: rangeInfo.month,
    monthLabel: rangeInfo.monthLabel,
    rangeLabel: rangeInfo.label,
    from: rangeInfo.from,
    to: rangeInfo.to,
    rows,
    entries: financeEntries,
    teamMembers,
    summary: {
      month: rangeInfo.month,
      from: rangeInfo.from,
      to: rangeInfo.to,
      label: rangeInfo.label,
      new_clients_count: rawNewClients.count ?? 0,
      expected_revenue: roundCurrency(expectedRevenueTotal),
      recurring_revenue: roundCurrency(recurringRevenueTotal),
      manual_revenue: roundCurrency(manualRevenueTotal),
      crm_revenue: roundCurrency(crmRevenueTotal),
      total_expenses: roundCurrency(totalExpenses),
      ad_spend: roundCurrency(adSpendTotal),
      manual_expenses: roundCurrency(manualExpenseTotal),
      margin: roundCurrency(expectedRevenueTotal - totalExpenses),
      net_profit: roundCurrency(manualRevenueTotal - totalExpenses),
      roas: adSpendTotal > 0 ? crmRevenueTotal / adSpendTotal : null,
      roi: adSpendTotal > 0 ? (crmRevenueTotal - adSpendTotal) / adSpendTotal : null,
      unassigned_expenses: roundCurrency(
        unassignedEntries
          .filter((entry) => entry.entry_type === "expense")
          .reduce((sum, entry) => sum + normalizeNumber(entry.amount), 0)
      ),
    },
    metaConnected: Boolean(process.env.META_ACCESS_TOKEN),
  };
}
