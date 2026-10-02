import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import type { LeadAggregate } from "@/types/index";

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

  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign_id");

  if (!campaignId) {
    return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });
  }

  // Client: vérifier que la campagne lui appartient
  if (profile?.role !== "admin") {
    const { data: campaign } = await adminSupabase
      .from("campaigns")
      .select("client_id")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.client_id !== session.user.id) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  const { data: leads, error } = await adminSupabase
    .from("leads")
    .select("meta_campaign_name, meta_ad_id, quality_score, revenue, cash_collected")
    .eq("campaign_id", campaignId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrégation par meta_campaign_name
  const byCampaignName: Record<string, LeadAggregate> = {};
  // Agrégation par meta_ad_id
  const byAdId: Record<string, LeadAggregate> = {};

  for (const lead of leads ?? []) {
    // By campaign name
    const cname = lead.meta_campaign_name ?? "__unknown__";
    if (!byCampaignName[cname]) {
      byCampaignName[cname] = { count: 0, avg_quality: null, total_revenue: 0, total_cash: 0 };
    }
    byCampaignName[cname].count++;
    byCampaignName[cname].total_revenue += lead.revenue ?? 0;
    byCampaignName[cname].total_cash += lead.cash_collected ?? 0;

    // By ad id
    if (lead.meta_ad_id) {
      if (!byAdId[lead.meta_ad_id]) {
        byAdId[lead.meta_ad_id] = { count: 0, avg_quality: null, total_revenue: 0, total_cash: 0 };
      }
      byAdId[lead.meta_ad_id].count++;
      byAdId[lead.meta_ad_id].total_revenue += lead.revenue ?? 0;
      byAdId[lead.meta_ad_id].total_cash += lead.cash_collected ?? 0;
    }
  }

  // Compute avg_quality per campaign name
  const qualByCampaign: Record<string, { sum: number; count: number }> = {};
  const qualByAdId: Record<string, { sum: number; count: number }> = {};

  for (const lead of leads ?? []) {
    if (lead.quality_score != null) {
      const cname = lead.meta_campaign_name ?? "__unknown__";
      if (!qualByCampaign[cname]) qualByCampaign[cname] = { sum: 0, count: 0 };
      qualByCampaign[cname].sum += lead.quality_score;
      qualByCampaign[cname].count++;

      if (lead.meta_ad_id) {
        if (!qualByAdId[lead.meta_ad_id]) qualByAdId[lead.meta_ad_id] = { sum: 0, count: 0 };
        qualByAdId[lead.meta_ad_id].sum += lead.quality_score;
        qualByAdId[lead.meta_ad_id].count++;
      }
    }
  }

  for (const key of Object.keys(byCampaignName)) {
    const q = qualByCampaign[key];
    if (q && q.count > 0) byCampaignName[key].avg_quality = q.sum / q.count;
  }
  for (const key of Object.keys(byAdId)) {
    const q = qualByAdId[key];
    if (q && q.count > 0) byAdId[key].avg_quality = q.sum / q.count;
  }

  return NextResponse.json({ byCampaignName, byAdId });
}
