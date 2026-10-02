import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, scopeCampaignsQuery } from "@/lib/admin-scope";
import { getLeadForms, getAllFormLeads, getPageIdForAdAccount, getPageToken } from "@/lib/meta-leads";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);

  // Parse body safely — body may be {} or { campaign_id }
  let campaign_id: string | undefined;
  try {
    const body = await req.json();
    campaign_id = body.campaign_id;
  } catch {
    // No body or invalid JSON — sync all campaigns
  }

  // Fetch campaign(s) to sync — include meta_token_id
  let campaignsToSync: Array<{
    id: string;
    name: string;
    ad_account_id: string;
    client_id: string;
    meta_token_id: string | null;
  }> = [];

  if (campaign_id) {
    const { data: campaign } = await adminSupabase
      .from("campaigns")
      .select("id, name, ad_account_id, client_id, meta_token_id")
      .eq("id", campaign_id)
      .single();

    if (!campaign?.ad_account_id) {
      return NextResponse.json({ error: "Aucun compte Meta lié à cette campagne" }, { status: 400 });
    }
    campaignsToSync = [campaign as typeof campaignsToSync[0]];
  } else {
    const allCampaignsQ = scopeCampaignsQuery(
      adminSupabase
        .from("campaigns")
        .select("id, name, ad_account_id, client_id, meta_token_id")
        .not("ad_account_id", "is", null),
      scope
    );

    const { data: campaigns } = await allCampaignsQ;

    campaignsToSync = (campaigns ?? []).filter(
      (c): c is typeof campaignsToSync[0] => !!c.ad_account_id
    );
  }

  // Pre-fetch all tokens needed (avoid N+1)
  const tokenIds = Array.from(new Set(campaignsToSync.map(c => c.meta_token_id).filter(Boolean))) as string[];
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

  let totalInserted = 0;
  let totalUpdated = 0;
  const errors: Array<{ campaign: string; error: string }> = [];

  for (const campaign of campaignsToSync) {
    try {
      // Résolution du token : token de la campagne → token env par défaut
      const userToken = (campaign.meta_token_id && tokenMap[campaign.meta_token_id])
        ? tokenMap[campaign.meta_token_id]
        : defaultToken;

      if (!userToken) {
        throw new Error("Aucun token Meta configuré. Ajoutez un token dans les Paramètres.");
      }

      // Trouver la Page Facebook associée au compte publicitaire
      const pageId = await getPageIdForAdAccount(campaign.ad_account_id, userToken);
      if (!pageId) {
        throw new Error(`Aucune Page Facebook trouvée pour le compte ${campaign.ad_account_id}. Vérifiez que le compte a des adsets actifs.`);
      }

      // Obtenir le Page Access Token (requis par Meta pour lire les leads)
      const pageToken = await getPageToken(pageId, userToken);

      const forms = await getLeadForms(campaign.ad_account_id, userToken);

      for (const form of forms) {
        const leads = await getAllFormLeads(form.id, pageToken);

        // Ensure default pipeline stage exists for this client
        await adminSupabase.rpc("seed_default_pipeline_stages", { p_client_id: campaign.client_id });
        const { data: defaultStage } = await adminSupabase
          .from("pipeline_stages")
          .select("id")
          .eq("client_id", campaign.client_id)
          .eq("is_default", true)
          .limit(1)
          .single();

        for (const lead of leads) {
          const record = {
            campaign_id: campaign.id,
            client_id: campaign.client_id,
            meta_lead_id: lead.meta_lead_id,
            meta_form_id: lead.meta_form_id,
            meta_form_name: form.name,
            meta_campaign_name: campaign.name,
            meta_ad_id: lead.meta_ad_id,
            full_name: lead.full_name,
            email: lead.email,
            phone: lead.phone,
            company: lead.company,
            field_data: lead.field_data,
            meta_created_at: lead.meta_created_at,
            source: "meta_ads",
            updated_at: new Date().toISOString(),
          };

          const { data: existing } = await adminSupabase
            .from("leads")
            .select("id")
            .eq("meta_lead_id", lead.meta_lead_id)
            .single();

          if (existing) {
            await adminSupabase.from("leads").update(record).eq("id", existing.id);
            totalUpdated++;
          } else {
            await adminSupabase.from("leads").insert({
              ...record,
              status: "new",
              pipeline_stage_id: defaultStage?.id ?? null,
            });
            totalInserted++;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Sync error for campaign ${campaign.id} (${campaign.name}):`, message);
      errors.push({ campaign: campaign.name, error: message });
    }
  }

  return NextResponse.json({
    inserted: totalInserted,
    updated: totalUpdated,
    total: totalInserted + totalUpdated,
    errors: errors.length > 0 ? errors : undefined,
  });
}
