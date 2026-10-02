import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { initMetaToken } from "@/lib/meta-token";
import { getAccountInsights } from "@/lib/meta-api";
import { sendEmail } from "@/lib/email";
import { buildWeeklyReportEmail } from "@/lib/weekly-report-email";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Verify Vercel Cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminSupabase = createAdminClient();

  // Init default Meta token from admin profile
  await initMetaToken(adminSupabase);

  // Fetch campaigns with weekly report enabled + live status
  const { data: campaigns } = await adminSupabase
    .from("campaigns")
    .select("id, name, client_id, ad_account_id, meta_token_id")
    .eq("weekly_report_enabled", true)
    .in("status", ["live_optimizing", "live", "optimizing"])
    .not("ad_account_id", "is", null);

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: [] });
  }

  // Pre-fetch meta tokens (same pattern as leads/sync)
  const tokenIds = Array.from(
    new Set(campaigns.map((c) => c.meta_token_id).filter(Boolean))
  ) as string[];
  const tokenMap: Record<string, string> = {};

  if (tokenIds.length > 0) {
    const { data: tokenRecords } = await adminSupabase
      .from("meta_tokens")
      .select("id, token")
      .in("id", tokenIds)
      .eq("is_active", true);

    for (const t of tokenRecords ?? []) {
      tokenMap[t.id] = t.token;
    }
  }

  const defaultToken = process.env.META_ACCESS_TOKEN ?? "";

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ campaign: string; error: string }> = [];

  // Period dates
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() - 1); // yesterday
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 6); // 7 days back

  const formatDateFr = (d: Date) =>
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.invalid";

  for (const campaign of campaigns) {
    try {
      // Fetch client profile
      const { data: profile } = await adminSupabase
        .from("profiles")
        .select("email, full_name, company")
        .eq("id", campaign.client_id)
        .single();

      if (!profile?.email) {
        skipped++;
        continue;
      }

      // Resolve Meta token
      const userToken =
        campaign.meta_token_id && tokenMap[campaign.meta_token_id]
          ? tokenMap[campaign.meta_token_id]
          : defaultToken;

      if (userToken) {
        process.env.META_ACCESS_TOKEN = userToken;
      }

      // Fetch Meta insights
      const insights = await getAccountInsights(campaign.ad_account_id!, "last_7d");

      if (!insights) {
        skipped++;
        continue;
      }

      // Fetch recent leads (last 7 days, limit 5)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: recentLeads } = await adminSupabase
        .from("leads")
        .select("full_name, email, phone, status, created_at")
        .eq("campaign_id", campaign.id)
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);

      // Fetch total cash collected for ROAS
      const { data: cashData } = await adminSupabase
        .from("leads")
        .select("cash_collected")
        .eq("campaign_id", campaign.id)
        .not("cash_collected", "is", null);

      const totalCash = (cashData ?? []).reduce(
        (sum, l) => sum + (Number(l.cash_collected) || 0),
        0
      );

      const roasRatio =
        totalCash > 0 && insights.spend > 0
          ? Math.round((totalCash / insights.spend) * 100) / 100
          : null;

      const html = buildWeeklyReportEmail({
        clientName: profile.full_name || profile.company || "Client",
        campaignName: campaign.name,
        periodStart: formatDateFr(periodStart),
        periodEnd: formatDateFr(periodEnd),
        stats: {
          spend: insights.spend,
          leads: insights.leads,
          cpl: insights.cpl,
          cpm: insights.cpm,
          impressions: insights.impressions,
          clicks: insights.clicks,
          ctr: insights.ctr,
          cpc: insights.cpc,
        },
        recentLeads: (recentLeads ?? []).map((l) => ({
          name: l.full_name || "—",
          email: l.email || "",
          phone: l.phone || "",
          status: l.status || "nouveau",
          date: new Date(l.created_at).toLocaleDateString("fr-FR"),
        })),
        roas: {
          cashCollected: totalCash,
          spend: insights.spend,
          ratio: roasRatio,
        },
        appUrl,
      });

      await sendEmail({
        to: profile.email,
        subject: `📊 Rapport hebdo — ${campaign.name}`,
        html,
      });

      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[weekly-report] Error for campaign ${campaign.id}:`, message);
      errors.push({ campaign: campaign.name, error: message });
    }
  }

  return NextResponse.json({ sent, skipped, errors: errors.length > 0 ? errors : undefined });
}
