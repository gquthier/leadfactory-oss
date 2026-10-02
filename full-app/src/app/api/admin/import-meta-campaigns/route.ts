import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdAccountCampaigns } from "@/lib/meta-api";
import {
  getCampaignStatusWriteCandidates,
  isCampaignStatusEnumError,
} from "@/lib/campaign-status";

// Map Meta campaign status → app campaign status
function mapStatus(metaStatus: string): string {
  switch (metaStatus) {
    case "ACTIVE":
    case "PAUSED":
    case "ARCHIVED":
    case "DELETED":
      return "live_optimizing";
    default:
      return "live_optimizing";
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { ad_account_id, client_id } = await req.json();
  if (!ad_account_id || !client_id) {
    return NextResponse.json({ error: "ad_account_id et client_id requis" }, { status: 400 });
  }

  // Vérifier que le client existe
  const { data: clientProfile } = await adminSupabase
    .from("profiles")
    .select("id, company")
    .eq("id", client_id)
    .single();

  if (!clientProfile) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  // Récupérer les campagnes depuis Meta
  const metaCampaigns = await getAdAccountCampaigns(ad_account_id);

  if (!metaCampaigns.length) {
    return NextResponse.json({ error: "Aucune campagne trouvée sur ce compte Meta" }, { status: 404 });
  }

  let inserted = 0;
  let updated = 0;

  for (const mc of metaCampaigns) {
    // Chercher si cette campagne Meta est déjà dans Supabase
    const { data: existing } = await adminSupabase
      .from("campaigns")
      .select("id")
      .eq("meta_campaign_id", mc.id)
      .single();

    const record = {
      client_id,
      name: mc.name,
      platform: "meta",
      ad_account_id: ad_account_id.startsWith("act_") ? ad_account_id : `act_${ad_account_id}`,
      objective: mc.objective,
      meta_campaign_id: mc.id,
      meta_status: mc.status,
      meta_daily_budget: mc.daily_budget ?? null,
      meta_lifetime_budget: mc.lifetime_budget ?? null,
      meta_start_time: mc.start_time ?? null,
      meta_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let synced = false;
    for (const status of getCampaignStatusWriteCandidates(mapStatus(mc.status))) {
      const result = existing
        ? await adminSupabase.from("campaigns").update({ ...record, status }).eq("id", existing.id)
        : await adminSupabase.from("campaigns").insert({ ...record, status });

      if (!result.error) {
        synced = true;
        if (existing) updated++;
        else inserted++;
        break;
      }

      if (!isCampaignStatusEnumError(result.error.message)) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
    }

    if (!synced) {
      return NextResponse.json({ error: "Impossible de synchroniser le statut de campagne" }, { status: 500 });
    }
  }

  return NextResponse.json({ inserted, updated, total: inserted + updated });
}
