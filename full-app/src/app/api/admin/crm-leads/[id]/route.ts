import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";

const ALLOWED_STATUSES = new Set([
  "new_discovery",
  "contacted",
  "qualified",
  "proposal_sent",
  "won",
  "lost",
  "no_show",
  "cancelled",
]);

const ALLOWED_PRIORITIES = new Set(["low", "normal", "high"]);

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  const body = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
    }
    patch.status = body.status;
  }

  if (body.priority !== undefined) {
    if (!ALLOWED_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: "Priorité invalide" }, { status: 400 });
    }
    patch.priority = body.priority;
  }

  if (body.notes !== undefined) {
    patch.notes = String(body.notes || "").trim() || null;
  }

  const { error } = await adminSupabase
    .from("crm_leads")
    .update(patch)
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
