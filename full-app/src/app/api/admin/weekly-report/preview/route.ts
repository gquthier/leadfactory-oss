import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { initMetaToken } from "@/lib/meta-token";
import { getAccountInsights } from "@/lib/meta-api";
import { buildWeeklyReportEmail } from "@/lib/weekly-report-email";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Auth: require admin session
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: adminProfile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (adminProfile?.role !== "admin")
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id");
  if (!campaignId)
    return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  // Fetch campaign
  const { data: campaign } = await adminSupabase
    .from("campaigns")
    .select("id, name, client_id, ad_account_id, meta_token_id")
    .eq("id", campaignId)
    .single();

  if (!campaign)
    return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });
  if (!campaign.ad_account_id)
    return NextResponse.json({ error: "Aucun compte Meta lié" }, { status: 400 });

  // Resolve Meta token
  await initMetaToken(adminSupabase);

  if (campaign.meta_token_id) {
    const { data: tokenRecord } = await adminSupabase
      .from("meta_tokens")
      .select("token")
      .eq("id", campaign.meta_token_id)
      .eq("is_active", true)
      .single();
    if (tokenRecord?.token) {
      process.env.META_ACCESS_TOKEN = tokenRecord.token;
    }
  }

  // Fetch client profile
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("email, full_name, company")
    .eq("id", campaign.client_id)
    .single();

  // Fetch insights
  const insights = await getAccountInsights(campaign.ad_account_id, "last_7d");

  // Fetch recent leads
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentLeads } = await adminSupabase
    .from("leads")
    .select("full_name, email, phone, status, created_at")
    .eq("campaign_id", campaign.id)
    .gte("created_at", sevenDaysAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(5);

  // Cash collected for ROAS
  const { data: cashData } = await adminSupabase
    .from("leads")
    .select("cash_collected")
    .eq("campaign_id", campaign.id)
    .not("cash_collected", "is", null);

  const totalCash = (cashData ?? []).reduce(
    (sum, l) => sum + (Number(l.cash_collected) || 0),
    0
  );

  const spend = insights?.spend ?? 0;
  const roasRatio =
    totalCash > 0 && spend > 0
      ? Math.round((totalCash / spend) * 100) / 100
      : null;

  // Period dates
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() - 1);
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 6);

  const formatDateFr = (d: Date) =>
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.invalid";

  const html = buildWeeklyReportEmail({
    clientName: profile?.full_name || profile?.company || "Client",
    campaignName: campaign.name,
    periodStart: formatDateFr(periodStart),
    periodEnd: formatDateFr(periodEnd),
    stats: {
      spend: insights?.spend ?? 0,
      leads: insights?.leads ?? 0,
      cpl: insights?.cpl ?? 0,
      cpm: insights?.cpm ?? 0,
      impressions: insights?.impressions ?? 0,
      clicks: insights?.clicks ?? 0,
      ctr: insights?.ctr ?? 0,
      cpc: insights?.cpc ?? 0,
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
      spend,
      ratio: roasRatio,
    },
    appUrl,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
