import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, canAccessClient } from "@/lib/admin-scope";
import { logActivity } from "@/lib/activity-log";
import { CLIENT_RESULTS_RATINGS, type ClientResultsRating } from "@/types";

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  const { client_id, full_name, company, phone, is_active, next_catchup, results_rating, results_rating_note } = await req.json();
  if (!client_id) return NextResponse.json({ error: "client_id requis" }, { status: 400 });

  // Validate results_rating value (null/"" = clear the rating)
  if (results_rating !== undefined && results_rating !== null && results_rating !== "") {
    if (!CLIENT_RESULTS_RATINGS.includes(results_rating as ClientResultsRating)) {
      return NextResponse.json({ error: "results_rating invalide" }, { status: 400 });
    }
  }

  // Verify access (managed_by OR team-assigned) unless super admin
  if (!scope.isSuperAdmin) {
    const { data: clientProfile } = await adminSupabase
      .from("profiles")
      .select("managed_by")
      .eq("id", client_id)
      .single();
    if (!canAccessClient(scope, clientProfile?.managed_by ?? null, client_id)) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) updates.full_name = full_name;
  if (company !== undefined) updates.company = company;
  if (phone !== undefined) updates.phone = phone;
  if (is_active !== undefined) updates.is_active = is_active;
  if (next_catchup !== undefined) updates.next_catchup = next_catchup || null;
  if (results_rating !== undefined) {
    updates.results_rating = results_rating || null;
    updates.results_rating_updated_at = new Date().toISOString();
    updates.results_rating_updated_by = session.user.id;
  }
  if (results_rating_note !== undefined) updates.results_rating_note = results_rating_note || null;

  const { error } = await adminSupabase
    .from("profiles")
    .update(updates)
    .eq("id", client_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Determine the action type
  const action = is_active === false ? "client_deactivated"
    : is_active === true ? "client_reactivated"
    : results_rating !== undefined ? "client_results_rated"
    : "client_updated";

  logActivity({
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    actorRole: "admin",
    action,
    targetType: "client",
    targetId: client_id,
    targetLabel: full_name ?? company ?? client_id,
    metadata: {
      changed_fields: Object.keys(updates).filter((k) => k !== "updated_at"),
      ...(is_active !== undefined && { is_active }),
      ...(results_rating !== undefined && { results_rating: results_rating || null }),
    },
  });

  return NextResponse.json({ success: true });
}
