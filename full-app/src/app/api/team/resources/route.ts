import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// GET /api/team/resources
// Vue team member : les ressources PUBLIÉES qui lui sont attribuées (lecture seule).
// Accessible à tout admin (super admin inclus) ; chacun ne voit que ce qui lui est attribué.
export async function GET() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès équipe requis" }, { status: 403 });
  }

  // Ressources attribuées à ce membre.
  const { data: assignments, error: aErr } = await adminSupabase
    .from("team_resource_assignments")
    .select("resource_id")
    .eq("team_member_id", session.user.id);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const ids = (assignments ?? []).map((a) => a.resource_id);
  if (ids.length === 0) return NextResponse.json({ resources: [] });

  const { data: resources, error: rErr } = await adminSupabase
    .from("team_resources")
    .select("*")
    .in("id", ids)
    .eq("is_published", true)
    .order("kind", { ascending: true }) // 'resource' < 'sop' alpha → on retrie côté client
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: false });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  return NextResponse.json({ resources: resources ?? [] });
}
