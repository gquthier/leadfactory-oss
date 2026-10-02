import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessCampaign } from "@/lib/admin-scope";

const CREATIVE_BRIEF_PREFIX = "CREATIVE_BRIEF_JSON:";

function encodeCreativeBrief(json: string): string {
  return CREATIVE_BRIEF_PREFIX + json;
}
function decodeCreativeBrief(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith(CREATIVE_BRIEF_PREFIX)) return raw.slice(CREATIVE_BRIEF_PREFIX.length);
  return null;
}

async function verifyAdmin(req?: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Non autorisé", status: 401 } as const;

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return { error: "Accès admin requis", status: 403 } as const;

  const scope = await getAdminScope(session.user.id);
  return { session, adminSupabase, scope } as const;
}

async function verifyOwnership(adminSupabase: ReturnType<typeof createAdminClient>, scope: Awaited<ReturnType<typeof getAdminScope>>, _userId: string, campaignId: string) {
  if (scope.isSuperAdmin) return true;
  const { data: campaign } = await adminSupabase.from("campaigns").select("managed_by").eq("id", campaignId).single();
  return canAccessCampaign(scope, campaign?.managed_by ?? null, campaignId);
}

// GET /api/admin/creative-brief?campaign_id=xxx
export async function GET(req: Request) {
  const auth = await verifyAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id");
  if (!campaignId) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  if (!await verifyOwnership(auth.adminSupabase, auth.scope, auth.session.user.id, campaignId)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { data, error } = await auth.adminSupabase
    .from("campaigns")
    .select("id, ai_static_prompt")
    .eq("id", campaignId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const creativeBrief = decodeCreativeBrief(data?.ai_static_prompt);
  return NextResponse.json({ campaign: { id: data.id, creative_brief: creativeBrief } });
}

// PATCH /api/admin/creative-brief
export async function PATCH(req: Request) {
  const auth = await verifyAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { campaign_id, creative_brief } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });
  if (typeof creative_brief !== "string") return NextResponse.json({ error: "creative_brief requis" }, { status: 400 });

  if (!await verifyOwnership(auth.adminSupabase, auth.scope, auth.session.user.id, campaign_id)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { data, error } = await auth.adminSupabase
    .from("campaigns")
    .update({
      ai_static_prompt: encodeCreativeBrief(creative_brief),
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign_id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
