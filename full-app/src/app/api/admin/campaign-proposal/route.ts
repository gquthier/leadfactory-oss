import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessCampaign } from "@/lib/admin-scope";

const PROPOSAL_PREFIX = "PROPOSAL_JSON:";

// Helpers to store proposal data in ai_vsl_prompt field (workaround until proposal_markdown column is added)
function encodeProposal(json: string): string {
  return PROPOSAL_PREFIX + json;
}
function decodeProposal(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith(PROPOSAL_PREFIX)) return raw.slice(PROPOSAL_PREFIX.length);
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

// GET /api/admin/campaign-proposal?campaign_id=xxx
export async function GET(req: Request) {
  const auth = await verifyAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id");
  if (!campaignId) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  if (!await verifyOwnership(auth.adminSupabase, auth.scope, auth.session.user.id, campaignId)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Try proposal_markdown first, fallback to ai_vsl_prompt
  const { data, error } = await auth.adminSupabase
    .from("campaigns")
    .select("id, ai_vsl_prompt")
    .eq("id", campaignId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const proposal = decodeProposal(data?.ai_vsl_prompt);
  return NextResponse.json({ campaign: { id: data.id, proposal_markdown: proposal } });
}

// PATCH /api/admin/campaign-proposal
export async function PATCH(req: Request) {
  const auth = await verifyAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { campaign_id, proposal_markdown } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });
  if (typeof proposal_markdown !== "string") return NextResponse.json({ error: "proposal_markdown requis" }, { status: 400 });

  if (!await verifyOwnership(auth.adminSupabase, auth.scope, auth.session.user.id, campaign_id)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Store in ai_vsl_prompt with prefix marker
  const { data, error } = await auth.adminSupabase
    .from("campaigns")
    .update({
      ai_vsl_prompt: encodeProposal(proposal_markdown),
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign_id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
