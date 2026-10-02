import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scheduled_posts")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.client_id !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ post: data });
}

interface PatchBody {
  scheduled_at?: string;
  action?: "retry";
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("scheduled_posts")
    .select("id, client_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing || existing.client_id !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.action === "retry") {
    if (existing.status !== "failed") {
      return NextResponse.json(
        { error: `Impossible de réessayer un post en statut "${existing.status}"` },
        { status: 400 }
      );
    }
    const { error } = await admin
      .from("scheduled_posts")
      .update({
        status: "queued",
        retry_count: 0,
        next_retry_at: null,
        scheduled_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ requeued: true });
  }

  if (body.scheduled_at) {
    if (existing.status !== "queued" && existing.status !== "failed") {
      return NextResponse.json(
        { error: `Impossible de reprogrammer un post en statut "${existing.status}"` },
        { status: 400 }
      );
    }
    const newAt = new Date(body.scheduled_at);
    if (isNaN(newAt.getTime())) {
      return NextResponse.json({ error: "Invalid scheduled_at" }, { status: 400 });
    }
    if (newAt.getTime() < Date.now() - 5 * 60 * 1000) {
      return NextResponse.json({ error: "scheduled_at est dans le passé" }, { status: 400 });
    }
    const { error } = await admin
      .from("scheduled_posts")
      .update({
        scheduled_at: newAt.toISOString(),
        status: "queued",
        error_message: null,
        next_retry_at: null,
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rescheduled: true });
  }

  return NextResponse.json({ error: "Aucune action reconnue" }, { status: 400 });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("scheduled_posts")
    .select("id, client_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing || existing.client_id !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.status !== "queued" && existing.status !== "failed") {
    return NextResponse.json(
      { error: `Impossible d'annuler un post en statut "${existing.status}"` },
      { status: 400 }
    );
  }

  const { error: updateError } = await admin
    .from("scheduled_posts")
    .update({ status: "cancelled" })
    .eq("id", existing.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  return NextResponse.json({ cancelled: true });
}
