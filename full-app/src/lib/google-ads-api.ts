/**
 * Google Ads API v19 — Lead Factory
 * Endpoints: /customers:listAccessibleCustomers, /googleAds:search
 */

const GOOGLE_ADS_BASE = "https://googleads.googleapis.com/v19";

function getDeveloperToken(): string {
  return process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
}

export interface GoogleAdsCustomer {
  id: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

export interface GoogleAdsCampaign {
  id: string;
  name: string;
  status: string;
  costMicros: number;
  conversions: number;
  impressions: number;
  clicks: number;
}

export interface GoogleAdsCampaignWithDate extends GoogleAdsCampaign {
  date: string;
}

export interface GoogleAdsMetricsSummary {
  totalCost: number;
  totalConversions: number;
  totalImpressions: number;
  totalClicks: number;
  avgCPC: number;
  avgCPL: number;
}

export async function getGoogleAdsAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google Ads OAuth credentials in environment variables");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google OAuth error: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

export async function listAccessibleCustomers(token: string): Promise<GoogleAdsCustomer[]> {
  const res = await fetch(`${GOOGLE_ADS_BASE}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": getDeveloperToken(),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google Ads customers error: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as { resourceNames?: string[] };
  const resourceNames = data.resourceNames ?? [];

  // Resolve customer IDs from resource names like "customers/1234567890"
  return resourceNames.map((name) => {
    const id = name.split("/").pop() ?? name;
    return {
      id,
      descriptiveName: id,
      currencyCode: "",
      timeZone: "",
    };
  });
}

export type GoogleAdsDateRange =
  | "LAST_7_DAYS"
  | "LAST_14_DAYS"
  | "LAST_30_DAYS"
  | "LAST_90_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "TODAY"
  | "YESTERDAY";

export async function searchCampaigns(
  customerId: string,
  dateRange: GoogleAdsDateRange = "LAST_30_DAYS",
  token: string,
): Promise<GoogleAdsCampaign[]> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.conversions,
      metrics.impressions,
      metrics.clicks,
      segments.date
    FROM campaign
    WHERE segments.date DURING ${dateRange}
  `.trim();

  const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": getDeveloperToken(),
      "Content-Type": "application/json",
      ...(process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID
        ? { "login-customer-id": process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID }
        : {}),
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google Ads search error: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as {
    results?: Array<{
      campaign: { id: string; name: string; status: string };
      metrics: {
        costMicros?: number;
        conversions?: number;
        impressions?: number;
        clicks?: number;
      };
    }>;
  };

  // Aggregate metrics per campaign (multiple date rows → sum)
  const map = new Map<string, GoogleAdsCampaign>();
  for (const row of data.results ?? []) {
    const id = row.campaign.id;
    const existing = map.get(id);
    const costMicros = Number(row.metrics.costMicros ?? 0);
    const conversions = Number(row.metrics.conversions ?? 0);
    const impressions = Number(row.metrics.impressions ?? 0);
    const clicks = Number(row.metrics.clicks ?? 0);

    if (existing) {
      existing.costMicros += costMicros;
      existing.conversions += conversions;
      existing.impressions += impressions;
      existing.clicks += clicks;
    } else {
      map.set(id, {
        id,
        name: row.campaign.name,
        status: row.campaign.status,
        costMicros,
        conversions,
        impressions,
        clicks,
      });
    }
  }

  return Array.from(map.values());
}
