import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

/**
 * POST /api/admin/reassign-client
 * Body: { client_id: string, new_admin_id: string }
 * Super-admin only — reassigns a client (and their campaigns) to a different admin.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  if (!scope.isSuperAdmin) {
    return NextResponse.json({ error: "Super-admin requis" }, { status: 403 });
  }

  const { client_id, new_admin_id } = await req.json();
  if (!client_id || !new_admin_id) {
    return NextResponse.json({ error: "client_id et new_admin_id requis" }, { status: 400 });
  }

  // Verify new_admin_id exists and is an admin
  const { data: newAdmin } = await adminSupabase
    .from("profiles")
    .select("id, role")
    .eq("id", new_admin_id)
    .single();
  if (!newAdmin || newAdmin.role !== "admin") {
    return NextResponse.json({ error: "Admin cible introuvable" }, { status: 404 });
  }

  // Reassign profile managed_by
  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({ managed_by: new_admin_id, updated_at: new Date().toISOString() })
    .eq("id", client_id);
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  // Reassign all campaigns for this client
  const { error: campaignError } = await adminSupabase
    .from("campaigns")
    .update({ managed_by: new_admin_id, updated_at: new Date().toISOString() })
    .eq("client_id", client_id);
  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
