/**
 * Meta Marketing API v21.0 — Lead Factory
 * Endpoints: /insights, /campaigns, /adaccounts
 */

const META_API_BASE = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
function getToken() {
 if(process.env.LEADFACTORY_DATA_MODE!=='supabase'||process.env.LEADFACTORY_ENABLE_EXTERNAL!=='1')throw new Error('Meta distant désactivé dans le starter local.');
 return process.env.META_ACCESS_TOKEN ?? '';
}

/** One detected conversion type with its count and cost per conversion */
export interface ConversionBreakdown {
  label: string;   // e.g. "Leads", "Achats", "Visites page"
  count: number;
  cpa: number;     // cost per action (€), 0 if unavailable
}

export interface MetaInsights {
  spend: number;              // Dépensé (€)
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;                // %
  cpc: number;                // €/clic
  cpm: number;                // €/1000 impressions
  leads: number;              // Primary conversion count (auto-detected)
  cpl: number;                // Cost per primary conversion (€)
  conversion_label: string;   // e.g. "Leads", "Achats", "Visites page", or "—"
  /** All tier-1 (real business outcome) conversions with non-zero count.
   *  Empty = no conversion tracking, only traffic/engagement campaigns. */
  all_conversions: ConversionBreakdown[];
  date_start: string;
  date_stop: string;
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  objective: string;
  daily_budget?: number;   // centimes → €/100
  lifetime_budget?: number;
  start_time?: string;
  stop_time?: string;
  insights?: MetaInsights;
}

export interface MetaAdAccount {
  id: string;              // "act_XXXXXXX"
  name: string;
  account_id: string;
  account_status: number;  // 1=ACTIVE 2=DISABLED 3=UNSETTLED
  currency: string;
  timezone_name: string;
  amount_spent: number;    // centimes total depuis création
}

export interface MetaPage {
  id: string;
  name: string;
  category: string;
  instagram_business_account?: {
    id: string;
    name: string;
    username: string;
  };
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month"
  | "maximum";

type MetaTimeRange = {
  since: string;
  until: string;
};

// ─── Helpers ──────────────────────────────────────────────────────

type ActionRow = { action_type: string; value: string };

/**
 * Tier-1: real business outcomes (lead form submissions, purchases, pixel events, etc.)
 * All non-zero tier-1 types are collected in `all_conversions`.
 *
 * Tier-2: traffic proxies used ONLY when tier-1 is empty (no conversion tracking set up).
 * They tell us "the campaign at least sent people to the site" but are NOT listed in
 * `all_conversions` so they don't inflate the conversion count for mixed accounts.
 *
 * Intentionally EXCLUDED: post_engagement, video_view, link_click — these are raw
 * engagement/reach metrics already visible in other columns (clicks, impressions, etc.)
 * and should never be mistaken for conversions.
 */
const TIER1_PRIORITY: Array<{ types: string[]; prefix?: boolean; label: string }> = [
  { types: ["lead", "leadgen_grouped"],                                      label: "Leads"        },
  { types: ["omni_purchase", "offsite_conversion.fb_pixel_purchase"],        label: "Achats"       },
  { types: ["offsite_conversion.fb_pixel_lead"],                             label: "Leads pixel"  },
  { types: ["offsite_conversion.fb_pixel_complete_registration"],            label: "Inscriptions" },
  { types: ["offsite_conversion.fb_pixel_add_to_cart"],                      label: "Ajouts panier"},
  { types: ["offsite_conversion.fb_pixel_view_content"],                     label: "Visites page" },
  { types: ["offsite_conversion.fb_pixel_search"],                           label: "Recherches"   },
  { types: ["offsite_conversion.custom"],       prefix: true,                label: "Conv. perso." },
  { types: ["offsite_conversion.fb_pixel_custom"],                           label: "Conv. perso." },
  { types: ["app_install", "mobile_app_install"],                            label: "Installs"     },
  { types: ["onsite_conversion.messaging_conversation_started_7d"],          label: "Messages"     },
];

/** Last-resort traffic proxy when zero tier-1 conversions exist (e.g. pure awareness/traffic campaigns) */
const TIER2_PRIORITY: Array<{ types: string[]; prefix?: boolean; label: string }> = [
  { types: ["landing_page_view", "omni_landing_page_view"],                  label: "Visites site" },
];

function findMatch(
  priority: typeof TIER1_PRIORITY[0],
  actions: ActionRow[],
  costPerAction: ActionRow[] | undefined,
): ConversionBreakdown | null {
  for (const type of priority.types) {
    const action = priority.prefix
      ? actions.find((a) => a.action_type.startsWith(type))
      : actions.find((a) => a.action_type === type);
    if (action) {
      const count = parseInt(action.value, 10);
      if (count > 0) {
        const cpaEntry = priority.prefix
          ? costPerAction?.find((a) => a.action_type.startsWith(type))
          : costPerAction?.find((a) => a.action_type === type);
        return { label: priority.label, count, cpa: cpaEntry ? parseFloat(cpaEntry.value) : 0 };
      }
    }
  }
  return null;
}

/**
 * Detect conversions from Meta actions[].
 * Returns:
 *   primary       — the most important conversion (tier-1 first, tier-2 as last resort)
 *   all_conversions — ALL distinct tier-1 conversions (empty for pure traffic accounts)
 */
function detectConversions(
  actions: ActionRow[] | undefined,
  costPerAction: ActionRow[] | undefined,
): { primary: ConversionBreakdown; all_conversions: ConversionBreakdown[] } {
  const none = { primary: { label: "—", count: 0, cpa: 0 }, all_conversions: [] };
  if (!actions?.length) return none;

  // Collect ALL tier-1 matches (for mixed account display)
  const tier1Matches: ConversionBreakdown[] = [];
  for (const priority of TIER1_PRIORITY) {
    const match = findMatch(priority, actions, costPerAction);
    if (match && !tier1Matches.some((m) => m.label === match.label)) {
      tier1Matches.push(match);
    }
  }

  // If tier-1 found something, use first match as primary
  if (tier1Matches.length > 0) {
    return { primary: tier1Matches[0], all_conversions: tier1Matches };
  }

  // Tier-2 fallback: traffic proxy metrics (not included in all_conversions)
  for (const priority of TIER2_PRIORITY) {
    const match = findMatch(priority, actions, costPerAction);
    if (match) return { primary: match, all_conversions: [] };
  }

  return none;
}

function parseInsightsRow(row: Record<string, unknown>): MetaInsights {
  const { primary, all_conversions } = detectConversions(
    row.actions as ActionRow[],
    row.cost_per_action_type as ActionRow[],
  );
  return {
    spend:            parseFloat(String(row.spend       ?? 0)),
    impressions:      parseInt(String(row.impressions   ?? 0), 10),
    clicks:           parseInt(String(row.clicks        ?? 0), 10),
    reach:            parseInt(String(row.reach         ?? 0), 10),
    ctr:              parseFloat(String(row.ctr         ?? 0)),
    cpc:              parseFloat(String(row.cpc         ?? 0)),
    cpm:              parseFloat(String(row.cpm         ?? 0)),
    leads:            primary.count,
    cpl:              primary.cpa,
    conversion_label: primary.label,
    all_conversions,
    date_start:       String(row.date_start ?? ""),
    date_stop:        String(row.date_stop  ?? ""),
  };
}

async function metaFetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", getToken());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { next: { revalidate: 300 } }); // cache 5min
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API error: ${JSON.stringify(err)}`);
  }
  return res.json();
}

function normalizeAccountId(adAccountId: string) {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

function dateParams(datePreset: DatePreset, timeRange?: MetaTimeRange): Record<string, string> {
  if (timeRange) {
    return { time_range: JSON.stringify(timeRange) };
  }

  return { date_preset: datePreset };
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Retourne tous les comptes publicitaires accessibles avec le token
 */
export async function getAdAccounts(): Promise<MetaAdAccount[]> {
  const data = await metaFetch("/me/adaccounts", {
    fields: "id,name,account_id,account_status,currency,timezone_name,amount_spent",
    limit: "100",
  }) as { data: Array<Record<string, unknown>> };

  return (data.data ?? []).map((acc) => ({
    id: String(acc.id),
    name: String(acc.name),
    account_id: String(acc.account_id),
    account_status: parseInt(String(acc.account_status), 10),
    currency: String(acc.currency),
    timezone_name: String(acc.timezone_name),
    amount_spent: parseInt(String(acc.amount_spent), 10) / 100,
  }));
}

/**
 * Insights agrégés pour UN compte publicitaire
 */
export async function getAccountInsights(
  adAccountId: string,
  datePreset: DatePreset = "last_30d"
): Promise<MetaInsights | null> {
  try {
    const accountId = normalizeAccountId(adAccountId);
    const data = await metaFetch(`/${accountId}/insights`, {
      fields: "spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
      ...dateParams(datePreset),
      level: "account",
    }) as { data: Array<Record<string, unknown>> };

    if (!data.data?.length) return null;
    return parseInsightsRow(data.data[0]);
  } catch {
    return null;
  }
}

export async function getAccountInsightsForRange(
  adAccountId: string,
  since: string,
  until: string
): Promise<MetaInsights | null> {
  try {
    const accountId = normalizeAccountId(adAccountId);
    const data = await metaFetch(`/${accountId}/insights`, {
      fields: "spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
      ...dateParams("maximum", { since, until }),
      level: "account",
    }) as { data: Array<Record<string, unknown>> };

    if (!data.data?.length) return null;
    return parseInsightsRow(data.data[0]);
  } catch {
    return null;
  }
}

/**
 * Insights par campagne pour un compte
 */
export async function getCampaignInsights(
  adAccountId: string,
  datePreset: DatePreset = "last_30d"
): Promise<Array<MetaInsights & { campaign_id: string; campaign_name: string }>> {
  try {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const data = await metaFetch(`/${accountId}/insights`, {
      fields: "campaign_name,campaign_id,spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type",
      date_preset: datePreset,
      level: "campaign",
      limit: "50",
    }) as { data: Array<Record<string, unknown>> };

    return (data.data ?? []).map((row) => ({
      ...parseInsightsRow(row),
      campaign_id: String(row.campaign_id),
      campaign_name: String(row.campaign_name),
    }));
  } catch {
    return [];
  }
}

/**
 * Insights jour par jour (pour graphique évolution)
 */
export async function getDailyInsights(
  adAccountId: string,
  datePreset: DatePreset = "last_30d"
): Promise<Array<MetaInsights & { date: string }>> {
  try {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const data = await metaFetch(`/${accountId}/insights`, {
      fields: "spend,impressions,clicks,reach,actions,cost_per_action_type",
      date_preset: datePreset,
      time_increment: "1",
      level: "account",
      limit: "90",
    }) as { data: Array<Record<string, unknown>> };

    return (data.data ?? []).map((row) => ({
      ...parseInsightsRow(row),
      date: String(row.date_start),
    }));
  } catch {
    return [];
  }
}

/**
 * Insights pour TOUS les comptes (vue admin globale)
 */
export async function getAllAccountsInsights(
  datePreset: DatePreset = "last_30d"
): Promise<Array<MetaAdAccount & { insights: MetaInsights | null }>> {
  const accounts = await getAdAccounts();

  const withInsights = await Promise.all(
    accounts
      .filter((a) => a.account_status === 1)
      .map(async (acc) => ({
        ...acc,
        insights: await getAccountInsights(acc.id, datePreset),
      }))
  );

  return withInsights.sort((a, b) => (b.insights?.spend ?? 0) - (a.insights?.spend ?? 0));
}

/**
 * Pages Facebook accessibles avec le token (pour attribution client)
 */
export async function getFacebookPages(): Promise<MetaPage[]> {
  try {
    const data = await metaFetch("/me/accounts", {
      fields: "id,name,category,instagram_business_account{id,name,username}",
      limit: "100",
    }) as { data: Array<Record<string, unknown>> };

    return (data.data ?? []).map((page) => ({
      id: String(page.id),
      name: String(page.name),
      category: String(page.category ?? ""),
      instagram_business_account: page.instagram_business_account
        ? (page.instagram_business_account as { id: string; name: string; username: string })
        : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Crée une audience personnalisée dans un compte publicitaire
 */
export async function createCustomAudience(
  adAccountId: string,
  params: {
    name: string;
    description?: string;
    subtype?: "CUSTOM" | "WEBSITE" | "ENGAGEMENT";
  }
): Promise<{ id: string; name: string }> {
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  const body = new URLSearchParams({
    name: params.name,
    subtype: params.subtype ?? "CUSTOM",
    ...(params.description ? { description: params.description } : {}),
    customer_file_source: "USER_PROVIDED_ONLY",
    access_token: getToken(),
  });

  const res = await fetch(`${META_API_BASE}/${accountId}/customaudiences`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || (data as { error?: unknown }).error) {
    const err = (data as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? "Erreur création audience Meta");
  }
  return { id: String(data.id), name: params.name };
}

/**
 * Campagnes d'un compte publicitaire (liste avec budgets et statuts)
 */
export async function getAdAccountCampaigns(
  adAccountId: string
): Promise<MetaCampaign[]> {
  try {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const data = await metaFetch(`/${accountId}/campaigns`, {
      fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time",
      limit: "200",
    }) as { data: Array<Record<string, unknown>> };

    return (data.data ?? []).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      status: String(c.status ?? "PAUSED") as MetaCampaign["status"],
      objective: String(c.objective ?? ""),
      daily_budget: c.daily_budget ? parseInt(String(c.daily_budget), 10) / 100 : undefined,
      lifetime_budget: c.lifetime_budget ? parseInt(String(c.lifetime_budget), 10) / 100 : undefined,
      start_time: c.start_time ? String(c.start_time) : undefined,
      stop_time: c.stop_time ? String(c.stop_time) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Insight pour une campagne Meta spécifique (par campaign_id)
 */
export async function getCampaignStats(
  adAccountId: string,
  campaignId: string,
  datePreset: DatePreset = "last_30d"
): Promise<MetaInsights | null> {
  try {
    const data = await metaFetch(`/${campaignId}/insights`, {
      fields: "spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type",
      date_preset: datePreset,
    }) as { data: Array<Record<string, unknown>> };

    if (!data.data?.length) {
      // Fallback: chercher via le compte
      const campaignInsights = await getCampaignInsights(adAccountId, "maximum");
      const found = campaignInsights.find((c) => c.campaign_id === campaignId);
      return found ?? null;
    }
    return parseInsightsRow(data.data[0]);
  } catch {
    return null;
  }
}

/**
 * Insights par ad (niveau créative) pour un compte publicitaire
 */
export interface MetaAdInsight extends MetaInsights {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  thumbnail_url?: string;
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
}

export async function getAdInsights(
  adAccountId: string,
  datePreset: DatePreset = "last_30d"
): Promise<MetaAdInsight[]> {
  try {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    // Insights au niveau ad
    const insightsData = await metaFetch(`/${accountId}/insights`, {
      fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,reach,ctr,cpc,cpm,actions,cost_per_action_type",
      date_preset: datePreset,
      level: "ad",
      limit: "100",
    }) as { data: Array<Record<string, unknown>> };

    // Données des ads (status + thumbnail)
    const adsData = await metaFetch(`/${accountId}/ads`, {
      fields: "id,status,creative{thumbnail_url}",
      limit: "200",
    }) as { data: Array<Record<string, unknown>> };

    const thumbnailMap: Record<string, string> = {};
    const statusMap: Record<string, MetaAdInsight["status"]> = {};
    for (const ad of (adsData.data ?? [])) {
      const id = String(ad.id);
      const creative = ad.creative as { thumbnail_url?: string } | undefined;
      if (creative?.thumbnail_url) thumbnailMap[id] = creative.thumbnail_url;
      statusMap[id] = String(ad.status ?? "PAUSED") as MetaAdInsight["status"];
    }

    return (insightsData.data ?? []).map((row) => ({
      ...parseInsightsRow(row),
      ad_id: String(row.ad_id ?? ""),
      ad_name: String(row.ad_name ?? ""),
      adset_id: String(row.adset_id ?? ""),
      adset_name: String(row.adset_name ?? ""),
      campaign_id: String(row.campaign_id ?? ""),
      campaign_name: String(row.campaign_name ?? ""),
      thumbnail_url: thumbnailMap[String(row.ad_id)] ?? undefined,
      status: statusMap[String(row.ad_id)] ?? "PAUSED",
    }));
  } catch {
    return [];
  }
}
