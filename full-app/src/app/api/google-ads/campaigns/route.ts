import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  getGoogleAdsAccessToken,
  searchCampaigns,
  type GoogleAdsDateRange,
  type GoogleAdsMetricsSummary,
} from "@/lib/google-ads-api";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customer_id");
  const dateRange = (searchParams.get("date_range") ?? "LAST_30_DAYS") as GoogleAdsDateRange;

  if (!customerId) {
    return NextResponse.json({ error: "Paramètre customer_id requis" }, { status: 400 });
  }

  try {
    const token = await getGoogleAdsAccessToken();
    const campaigns = await searchCampaigns(customerId, dateRange, token);

    const summary: GoogleAdsMetricsSummary = campaigns.reduce(
      (acc, c) => ({
        totalCost: acc.totalCost + c.costMicros / 1_000_000,
        totalConversions: acc.totalConversions + c.conversions,
        totalImpressions: acc.totalImpressions + c.impressions,
        totalClicks: acc.totalClicks + c.clicks,
        avgCPC: 0,
        avgCPL: 0,
      }),
      { totalCost: 0, totalConversions: 0, totalImpressions: 0, totalClicks: 0, avgCPC: 0, avgCPL: 0 },
    );

    summary.avgCPC = summary.totalClicks > 0
      ? summary.totalCost / summary.totalClicks
      : 0;

    summary.avgCPL = summary.totalConversions > 0
      ? summary.totalCost / summary.totalConversions
      : 0;

    return NextResponse.json({ summary, campaigns });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
