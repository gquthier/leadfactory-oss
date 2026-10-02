import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// Vérifie session + super admin.
async function requireSuperAdmin() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role, is_super_admin")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin" || !profile?.is_super_admin) {
    return { error: NextResponse.json({ error: "Accès super admin requis" }, { status: 403 }) };
  }

  return { adminSupabase, userId: session.user.id };
}

// POST /api/admin/team-resources/assign  { resource_id, member_ids: string[] }
// Remplace l'ensemble des attributions de la ressource par la liste fournie (diff add/remove).
export async function POST(req: Request) {
  const { adminSupabase, userId, error } = await requireSuperAdmin();
  if (error) return error;

  const { resource_id, member_ids } = await req.json();
  if (!resource_id) return NextResponse.json({ error: "resource_id requis" }, { status: 400 });
  const wanted: string[] = Array.isArray(member_ids) ? member_ids.filter(Boolean) : [];

  // Attributions actuelles.
  const { data: current, error: curErr } = await adminSupabase
    .from("team_resource_assignments")
    .select("team_member_id")
    .eq("resource_id", resource_id);
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });

  const currentIds = new Set((current ?? []).map((a) => a.team_member_id));
  const wantedSet = new Set(wanted);

  const toAdd = wanted.filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !wantedSet.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map((team_member_id) => ({
      resource_id,
      team_member_id,
      assigned_by: userId,
    }));
    const { error: addErr } = await adminSupabase.from("team_resource_assignments").insert(rows);
    if (addErr) return NextResponse.json({ error: addErr.message }, { status: 500 });
  }

  if (toRemove.length > 0) {
    const { error: rmErr } = await adminSupabase
      .from("team_resource_assignments")
      .delete()
      .eq("resource_id", resource_id)
      .in("team_member_id", toRemove);
    if (rmErr) return NextResponse.json({ error: rmErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, added: toAdd.length, removed: toRemove.length });
}
