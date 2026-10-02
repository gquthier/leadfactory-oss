import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAccountInsights, getCampaignInsights, getDailyInsights } from "@/lib/meta-api";
import type { DatePreset } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("ad_account_id");
  const datePreset = (searchParams.get("period") ?? "last_30d") as DatePreset;
  const withDaily = searchParams.get("daily") === "1";
  const withCampaigns = searchParams.get("campaigns") === "1";

  if (!adAccountId) return NextResponse.json({ error: "ad_account_id requis" }, { status: 400 });

  // Check permissions: admin voit tout, client voit seulement ses propres campagnes
  const adminSupabase = createAdminClient();
  await initMetaToken(adminSupabase);

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN manquant" }, { status: 500 });
  }
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();

  if (profile?.role !== "admin") {
    // Vérifier que ce compte appartient bien à une campagne du client
    const { data: campaign } = await adminSupabase
      .from("campaigns")
      .select("id")
      .eq("client_id", session.user.id)
      .eq("ad_account_id", adAccountId)
      .single();

    if (!campaign) return NextResponse.json({ error: "Accès non autorisé à ce compte" }, { status: 403 });
  }

  const [summary, campaigns, daily] = await Promise.all([
    getAccountInsights(adAccountId, datePreset),
    withCampaigns ? getCampaignInsights(adAccountId, datePreset) : Promise.resolve([]),
    withDaily ? getDailyInsights(adAccountId, datePreset) : Promise.resolve([]),
  ]);

  return NextResponse.json({ summary, campaigns, daily });
}
