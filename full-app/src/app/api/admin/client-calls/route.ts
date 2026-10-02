import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// Vérifie session + rôle admin. Retourne le client admin Supabase ou une réponse d'erreur.
async function requireAdmin() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Accès admin requis" }, { status: 403 }) };

  return { adminSupabase };
}

// GET /api/admin/client-calls?client_id=xxx
export async function GET(req: Request) {
  const { adminSupabase, error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "client_id requis" }, { status: 400 });

  const { data, error: dbError } = await adminSupabase
    .from("client_calls")
    .select("*")
    .eq("client_id", clientId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ calls: data });
}

// POST /api/admin/client-calls  { client_id, title, transcript?, link? }
export async function POST(req: Request) {
  const { adminSupabase, error } = await requireAdmin();
  if (error) return error;

  const { client_id, title, transcript, link } = await req.json();
  if (!client_id || !title?.trim()) {
    return NextResponse.json({ error: "client_id et titre requis" }, { status: 400 });
  }

  // Place le nouvel appel en tête (order_index = min existant - 1)
  const { data: existing } = await adminSupabase
    .from("client_calls")
    .select("order_index")
    .eq("client_id", client_id)
    .order("order_index", { ascending: true })
    .limit(1);
  const nextOrder = existing && existing.length > 0 ? existing[0].order_index - 1 : 0;

  const { data: call, error: dbError } = await adminSupabase
    .from("client_calls")
    .insert({
      client_id,
      title: title.trim(),
      transcript: transcript?.trim() || null,
      link: link?.trim() || null,
      order_index: nextOrder,
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ call });
}

// PATCH /api/admin/client-calls  { id, title?, transcript?, link? }
export async function PATCH(req: Request) {
  const { adminSupabase, error } = await requireAdmin();
  if (error) return error;

  const { id, title, transcript, link } = await req.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const updates: Record<string, string | null> = {};
  if (title !== undefined) {
    if (!title.trim()) return NextResponse.json({ error: "Le titre ne peut pas être vide" }, { status: 400 });
    updates.title = title.trim();
  }
  if (transcript !== undefined) updates.transcript = transcript?.trim() || null;
  if (link !== undefined) updates.link = link?.trim() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Aucune modification" }, { status: 400 });
  }

  const { data: call, error: dbError } = await adminSupabase
    .from("client_calls")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ call });
}

// DELETE /api/admin/client-calls?id=xxx
export async function DELETE(req: Request) {
  const { adminSupabase, error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const { error: dbError } = await adminSupabase
    .from("client_calls")
    .delete()
    .eq("id", id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
