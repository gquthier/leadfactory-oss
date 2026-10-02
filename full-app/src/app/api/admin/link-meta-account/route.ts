import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessCampaign } from "@/lib/admin-scope";

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);

  const {
    campaign_id,
    ad_account_id,
    meta_campaign_id,
    facebook_page_id,
    facebook_page_name,
    instagram_account_id,
    instagram_account_name,
  } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  // Verify access (managed_by OR team-assigned) unless super admin
  if (!scope.isSuperAdmin) {
    const { data: campaign } = await adminSupabase
      .from("campaigns")
      .select("managed_by")
      .eq("id", campaign_id)
      .single();
    if (!canAccessCampaign(scope, campaign?.managed_by ?? null, campaign_id)) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  const { error } = await adminSupabase
    .from("campaigns")
    .update({
      ad_account_id: ad_account_id || null,
      pixel_id: meta_campaign_id || null,
      facebook_page_id: facebook_page_id || null,
      facebook_page_name: facebook_page_name || null,
      instagram_account_id: instagram_account_id || null,
      instagram_account_name: instagram_account_name || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
