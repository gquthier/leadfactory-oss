import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { updatePost, deletePost } from "@/lib/linkedin-data";

export const dynamic = "force-dynamic";

async function resolveClientId(): Promise<{
  ok: false;
  response: NextResponse;
} | { ok: true; clientId: string }> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Non autorisé" }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", session.user.id)
    .single();
  if (!profile || profile.is_active === false) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Compte introuvable" }, { status: 403 }),
    };
  }

  const previewId = await getPreviewClientId();
  const clientId =
    profile.role === "admin" && previewId ? previewId : session.user.id;
  return { ok: true, clientId };
}

interface PatchBody {
  body?: string;
  hook?: string | null;
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveClientId();
  if (!auth.ok) return auth.response;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.body === "string") {
    const trimmed = body.body.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ error: "Le post ne peut pas être vide" }, { status: 400 });
    }
    if (trimmed.length > 3000) {
      return NextResponse.json({ error: "Post trop long (max 3000 caractères)" }, { status: 400 });
    }
    patch.body = trimmed;
    // Resynchronise la longueur dans metrics pour cohérence avec l'UI
    patch.metrics = { length: trimmed.length };
  }
  if (body.hook !== undefined) {
    patch.hook = body.hook ? body.hook.trim() : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    await updatePost(auth.clientId, params.id, patch as Partial<{ body: string; hook: string | null; metrics: Record<string, unknown> }>);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveClientId();
  if (!auth.ok) return auth.response;

  try {
    await deletePost(auth.clientId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
