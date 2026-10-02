/**
 * GET /api/admin/leads/debug?ad_account_id=...
 * Diagnostic route — tests Meta token permissions for Lead Ads access.
 * Returns detailed info about available forms and any permission errors.
 */
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

const META_API_BASE = "https://graph.facebook.com/v21.0";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const token = process.env.META_ACCESS_TOKEN ?? "";
  if (!token) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN manquant dans les variables d'environnement" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("ad_account_id");

  const results: Record<string, unknown> = {
    token_present: true,
    token_prefix: token.slice(0, 12) + "...",
  };

  // Test 1: Token validity
  try {
    const meUrl = new URL(`${META_API_BASE}/me`);
    meUrl.searchParams.set("access_token", token);
    meUrl.searchParams.set("fields", "id,name,permissions");
    const meRes = await fetch(meUrl.toString(), { cache: "no-store" });
    const meData = await meRes.json();
    if (meData.error) {
      results.token_valid = false;
      results.token_error = meData.error;
    } else {
      results.token_valid = true;
      results.token_user = meData.name ?? meData.id;
    }
  } catch (e) {
    results.token_valid = false;
    results.token_error = String(e);
  }

  // Test 2: Token permissions (debug_token)
  try {
    const debugUrl = new URL(`${META_API_BASE}/debug_token`);
    debugUrl.searchParams.set("input_token", token);
    debugUrl.searchParams.set("access_token", token);
    const debugRes = await fetch(debugUrl.toString(), { cache: "no-store" });
    const debugData = await debugRes.json();
    if (debugData.data) {
      results.permissions = debugData.data.scopes ?? [];
      results.has_leads_retrieval = (debugData.data.scopes ?? []).includes("leads_retrieval");
      results.has_ads_management = (debugData.data.scopes ?? []).includes("ads_management");
      results.token_expires_at = debugData.data.expires_at
        ? new Date(debugData.data.expires_at * 1000).toISOString()
        : "never";
    }
  } catch (e) {
    results.permissions_check_error = String(e);
  }

  // Test 3: Lead forms access for a specific account (if provided)
  if (adAccountId) {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    try {
      const formsUrl = new URL(`${META_API_BASE}/${accountId}/leadgen_forms`);
      formsUrl.searchParams.set("access_token", token);
      formsUrl.searchParams.set("fields", "id,name,status,created_time,leads_count");
      formsUrl.searchParams.set("limit", "25");
      const formsRes = await fetch(formsUrl.toString(), { cache: "no-store" });
      const formsData = await formsRes.json();

      if (formsData.error) {
        results.lead_forms_error = formsData.error;
        results.lead_forms_count = 0;
        results.lead_forms_tip = getPermissionTip(formsData.error);
      } else {
        results.lead_forms_count = (formsData.data ?? []).length;
        results.lead_forms = (formsData.data ?? []).map((f: Record<string, unknown>) => ({
          id: f.id,
          name: f.name,
          status: f.status,
          leads_count: f.leads_count ?? "non disponible",
          created: f.created_time,
        }));

        // Test reading leads from the first form (if any)
        const firstForm = formsData.data?.[0];
        if (firstForm) {
          try {
            const leadsUrl = new URL(`${META_API_BASE}/${firstForm.id}/leads`);
            leadsUrl.searchParams.set("access_token", token);
            leadsUrl.searchParams.set("fields", "id,created_time,field_data");
            leadsUrl.searchParams.set("limit", "5");
            const leadsRes = await fetch(leadsUrl.toString(), { cache: "no-store" });
            const leadsData = await leadsRes.json();

            if (leadsData.error) {
              results.leads_read_error = leadsData.error;
              results.leads_read_tip = getPermissionTip(leadsData.error);
            } else {
              results.leads_sample_count = (leadsData.data ?? []).length;
              results.leads_sample = (leadsData.data ?? []).slice(0, 3).map((l: Record<string, unknown>) => ({
                id: l.id,
                created_time: l.created_time,
                fields: (l.field_data as Array<{ name: string; values: string[] }> ?? []).map(f => f.name),
              }));
            }
          } catch (e) {
            results.leads_read_error = String(e);
          }
        }
      }
    } catch (e) {
      results.lead_forms_error = String(e);
    }
  } else {
    // Test 3b: List all campaigns with linked Meta accounts
    const { data: campaigns } = await adminSupabase
      .from("campaigns")
      .select("id, name, ad_account_id")
      .not("ad_account_id", "is", null)
      .order("name");

    results.campaigns_with_meta = (campaigns ?? []).map(c => ({
      id: c.id,
      name: c.name,
      ad_account_id: c.ad_account_id,
      test_url: `/api/admin/leads/debug?ad_account_id=${c.ad_account_id}`,
    }));
    results.hint = "Ajoutez ?ad_account_id=act_XXXX pour tester un compte spécifique";
  }

  return NextResponse.json(results, { status: 200 });
}

function getPermissionTip(error: Record<string, unknown>): string {
  const code = error.code as number;
  const subcode = error.error_subcode as number;
  const message = String(error.message ?? "");

  if (code === 190) return "Token expiré ou invalide — régénérez le token Meta.";
  if (code === 200 || code === 10) return "Permission manquante — le token doit avoir 'leads_retrieval' et être admin de la Page Facebook associée.";
  if (code === 100 && subcode === 33) return "Compte publicitaire introuvable ou accès refusé.";
  if (message.toLowerCase().includes("leads_retrieval")) return "Permission 'leads_retrieval' manquante sur le token.";
  if (message.toLowerCase().includes("permission")) return "Problème de permissions Meta — vérifiez les scopes du token.";
  return "Erreur inattendue — consultez le champ error pour plus de détails.";
}
