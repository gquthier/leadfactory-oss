import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => escapeCSV(r[c])).join(","));
  return [header, ...lines].join("\n");
}

/**
 * GET /api/admin/export-client?client_id=xxx
 * Returns a ZIP-like multi-sheet CSV (one section per entity).
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get("client_id");
  if (!client_id) return NextResponse.json({ error: "client_id requis" }, { status: 400 });

  // Ownership check
  const { data: clientProfile } = await adminSupabase
    .from("profiles")
    .select("id, full_name, company, email, phone, created_at, managed_by")
    .eq("id", client_id)
    .single();

  if (!clientProfile) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  if (!scope.isSuperAdmin && clientProfile.managed_by !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const [{ data: campaigns }, { data: leads }, { data: tasks }] = await Promise.all([
    adminSupabase
      .from("campaigns")
      .select("id, name, status, budget_monthly, platform, objective, ad_account_id, created_at, updated_at, notes")
      .eq("client_id", client_id),
    adminSupabase
      .from("leads")
      .select("meta_lead_id, full_name, email, phone, company, meta_form_name, meta_campaign_name, meta_created_at, status, revenue")
      .eq("client_id", client_id)
      .order("meta_created_at", { ascending: false }),
    adminSupabase
      .from("client_tasks")
      .select("title, description, is_completed, completed_at, created_at")
      .eq("client_id", client_id),
  ]);

  const name = clientProfile.company || clientProfile.full_name || client_id;
  const date = new Date().toISOString().slice(0, 10);

  // Build multi-section CSV
  const sections: string[] = [];

  sections.push("=== PROFIL CLIENT ===");
  sections.push(toCSV([clientProfile], ["id", "full_name", "company", "email", "phone", "created_at"]));

  sections.push("\n=== CAMPAGNES ===");
  if (campaigns?.length) {
    sections.push(toCSV(campaigns as Record<string, unknown>[], ["id", "name", "status", "budget_monthly", "platform", "objective", "ad_account_id", "created_at", "updated_at", "notes"]));
  } else {
    sections.push("Aucune campagne");
  }

  sections.push("\n=== LEADS ===");
  if (leads?.length) {
    sections.push(toCSV(leads as Record<string, unknown>[], ["meta_lead_id", "full_name", "email", "phone", "company", "meta_form_name", "meta_campaign_name", "meta_created_at", "status", "revenue"]));
  } else {
    sections.push("Aucun lead");
  }

  sections.push("\n=== TÂCHES ===");
  if (tasks?.length) {
    sections.push(toCSV(tasks as Record<string, unknown>[], ["title", "description", "is_completed", "completed_at", "created_at"]));
  } else {
    sections.push("Aucune tâche");
  }

  const csv = sections.join("\n");
  const filename = `leadfactory-client-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${date}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
