import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessCampaign } from "@/lib/admin-scope";
import {
  getCampaignStatusWriteCandidates,
  isCampaignStatusEnumError,
} from "@/lib/campaign-status";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  const { campaign_id, status, notes, weekly_report_enabled } = await req.json();

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

  let error: { message: string } | null = null;
  const statusCandidates = status
    ? getCampaignStatusWriteCandidates(status)
    : [undefined];

  for (const candidate of statusCandidates) {
    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (candidate !== undefined) updatePayload.status = candidate;
    if (notes !== undefined) updatePayload.notes = notes;
    if (weekly_report_enabled !== undefined) updatePayload.weekly_report_enabled = weekly_report_enabled;

    const result = await adminSupabase
      .from("campaigns")
      .update(updatePayload)
      .eq("id", campaign_id);

    error = result.error;

    if (!error) {
      break;
    }

    if (!isCampaignStatusEnumError(error.message)) {
      break;
    }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logActivity({
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    actorRole: "admin",
    action: status ? "campaign_status_changed" : "campaign_updated",
    targetType: "campaign",
    targetId: campaign_id,
    metadata: {
      ...(status && { new_status: status }),
      ...(notes !== undefined && { notes_updated: true }),
    },
  });

  return NextResponse.json({ success: true });
}
