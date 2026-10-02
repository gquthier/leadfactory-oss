import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { toLoomEmbedUrl } from "@/lib/team-resources/loom";

// Vérifie session + super admin. Retourne le client admin Supabase ou une réponse d'erreur.
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

// Nettoie une URL de document (https requis), null si vide/invalide.
function cleanDocumentUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// GET /api/admin/team-resources → liste toutes les ressources + leurs assignations
export async function GET() {
  const { adminSupabase, error } = await requireSuperAdmin();
  if (error) return error;

  const { data: resources, error: dbError } = await adminSupabase
    .from("team_resources")
    .select("*")
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const { data: assignments, error: aError } = await adminSupabase
    .from("team_resource_assignments")
    .select("resource_id, team_member_id");

  if (aError) return NextResponse.json({ error: aError.message }, { status: 500 });

  // Regroupe les membres assignés par ressource.
  const byResource = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = byResource.get(a.resource_id) ?? [];
    list.push(a.team_member_id);
    byResource.set(a.resource_id, list);
  }

  const enriched = (resources ?? []).map((r) => ({
    ...r,
    assignee_ids: byResource.get(r.id) ?? [],
  }));

  return NextResponse.json({ resources: enriched });
}

// POST /api/admin/team-resources  { kind, title, loom_url?, document_url?, body_html?, body_text? }
export async function POST(req: Request) {
  const { adminSupabase, userId, error } = await requireSuperAdmin();
  if (error) return error;

  const { kind, title, loom_url, document_url, body_html, body_text, is_published } =
    await req.json();

  if (!title?.trim()) return NextResponse.json({ error: "Titre requis" }, { status: 400 });
  const safeKind = kind === "sop" ? "sop" : "resource";

  // Place la nouvelle ressource en tête (order_index = min existant - 1).
  const { data: existing } = await adminSupabase
    .from("team_resources")
    .select("order_index")
    .order("order_index", { ascending: true })
    .limit(1);
  const nextOrder = existing && existing.length > 0 ? existing[0].order_index - 1 : 0;

  const { data: resource, error: dbError } = await adminSupabase
    .from("team_resources")
    .insert({
      created_by: userId,
      kind: safeKind,
      title: title.trim(),
      loom_url: toLoomEmbedUrl(loom_url),
      document_url: cleanDocumentUrl(document_url),
      body_html: body_html?.trim() || null,
      body_text: body_text?.trim() || null,
      is_published: is_published === false ? false : true,
      order_index: nextOrder,
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ resource });
}

// PATCH /api/admin/team-resources  { id, ...champs }
export async function PATCH(req: Request) {
  const { adminSupabase, error } = await requireSuperAdmin();
  if (error) return error;

  const { id, kind, title, loom_url, document_url, body_html, body_text, is_published } =
    await req.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (kind !== undefined) updates.kind = kind === "sop" ? "sop" : "resource";
  if (title !== undefined) {
    if (!title.trim()) return NextResponse.json({ error: "Le titre ne peut pas être vide" }, { status: 400 });
    updates.title = title.trim();
  }
  if (loom_url !== undefined) updates.loom_url = toLoomEmbedUrl(loom_url);
  if (document_url !== undefined) updates.document_url = cleanDocumentUrl(document_url);
  if (body_html !== undefined) updates.body_html = body_html?.trim() || null;
  if (body_text !== undefined) updates.body_text = body_text?.trim() || null;
  if (is_published !== undefined) updates.is_published = Boolean(is_published);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Aucune modification" }, { status: 400 });
  }

  const { data: resource, error: dbError } = await adminSupabase
    .from("team_resources")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ resource });
}

// DELETE /api/admin/team-resources?id=xxx
export async function DELETE(req: Request) {
  const { adminSupabase, error } = await requireSuperAdmin();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const { error: dbError } = await adminSupabase.from("team_resources").delete().eq("id", id);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
