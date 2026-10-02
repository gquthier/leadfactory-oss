import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";
import { logActivity } from "@/lib/activity-log";

/**
 * DELETE /api/admin/delete-client
 * Body: { client_id: string }
 * Deletes a client and all related data (campaigns, leads, tasks, onboarding responses).
 */
export async function DELETE(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  const { client_id } = await req.json();
  if (!client_id) return NextResponse.json({ error: "client_id requis" }, { status: 400 });

  // Ownership check
  const { data: clientProfile } = await adminSupabase
    .from("profiles")
    .select("id, managed_by")
    .eq("id", client_id)
    .single();

  if (!clientProfile) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  // Fetch client name for audit log before deletion
  const { data: clientData } = await adminSupabase
    .from("profiles")
    .select("full_name, company, email")
    .eq("id", client_id)
    .single();
  if (!scope.isSuperAdmin && clientProfile.managed_by !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // 1. Get all campaign IDs for this client
  const { data: campaigns } = await adminSupabase
    .from("campaigns")
    .select("id")
    .eq("client_id", client_id);
  const campaignIds = (campaigns ?? []).map((c) => c.id);

  // 2. Delete leads
  if (campaignIds.length > 0) {
    await adminSupabase.from("leads").delete().in("campaign_id", campaignIds);
  }

  // 3. Delete client_tasks
  await adminSupabase.from("client_tasks").delete().eq("client_id", client_id);

  // 4. Unlink onboarding_responses (set client_id + campaign_id to null)
  await adminSupabase
    .from("onboarding_responses")
    .update({ client_id: null, campaign_id: null })
    .eq("client_id", client_id);

  // 5. Delete campaigns
  if (campaignIds.length > 0) {
    await adminSupabase.from("campaigns").delete().in("id", campaignIds);
  }

  // 6. Delete profile
  await adminSupabase.from("profiles").delete().eq("id", client_id);

  // 7. Delete auth user (service role required)
  const { error: authError } = await adminSupabase.auth.admin.deleteUser(client_id);
  if (authError) {
    console.error("[delete-client] Auth delete error:", authError.message);
    // Non-blocking — profile + data are already deleted
  }

  // Log client deletion
  logActivity({
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    actorRole: "admin",
    action: "client_deleted",
    targetType: "client",
    targetId: client_id,
    targetLabel: clientData?.full_name ?? "Unknown",
    metadata: {
      company: clientData?.company,
      email: clientData?.email,
      campaigns_deleted: campaignIds.length,
    },
  });

  return NextResponse.json({ success: true });
}
