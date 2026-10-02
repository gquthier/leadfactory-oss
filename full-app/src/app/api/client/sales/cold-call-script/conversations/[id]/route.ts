/**
 * GET    /api/client/sales/cold-call-script/conversations/[id]  → fetch
 * PATCH  /api/client/sales/cold-call-script/conversations/[id]  → archived/pinned/title
 * DELETE /api/client/sales/cold-call-script/conversations/[id]  → suppression
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  getConversation,
  updateConversation,
  deleteConversation,
} from "@/lib/cold-call-script-writer/chat-data";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, props: RouteContext) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const conv = await getConversation(session.user.id, params.id);
    if (!conv) {
      return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
    }
    return NextResponse.json({ conversation: conv });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

interface PatchBody {
  archived?: boolean;
  pinned?: boolean;
  title?: string;
}

export async function PATCH(req: Request, props: RouteContext) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body.title === "string" && body.title.trim().length >= 2) {
    patch.title = body.title.trim().slice(0, 120);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    await updateConversation(session.user.id, params.id, patch as Parameters<typeof updateConversation>[2]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: RouteContext) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    await deleteConversation(session.user.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
