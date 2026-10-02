import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const KIND_VALUES = ["new_lead", "follow_up_reminder", "weekly_summary", "system"] as const;

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
  const onlyUnread = searchParams.get("unread") === "1";

  const admin = createAdminClient();
  let q = admin
    .from("client_notifications")
    .select("id, kind, lead_id, title, body, link_path, is_read, read_at, metadata, created_at")
    .eq("client_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (onlyUnread) q = q.eq("is_read", false);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: unreadCount } = await admin
    .from("client_notifications")
    .select("id", { count: "exact", head: true })
    .eq("client_id", session.user.id)
    .eq("is_read", false);

  return NextResponse.json({ notifications: data ?? [], unreadCount: unreadCount ?? 0 });
}

interface PatchBody {
  ids?: string[];
  markAll?: boolean;
  kinds?: string[];
}

export async function PATCH(req: Request) {
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
  const nowIso = new Date().toISOString();

  if (body.markAll) {
    let q = admin
      .from("client_notifications")
      .update({ is_read: true, read_at: nowIso })
      .eq("client_id", session.user.id)
      .eq("is_read", false);
    if (body.kinds && body.kinds.length > 0) {
      const validKinds = body.kinds.filter((k): k is (typeof KIND_VALUES)[number] =>
        (KIND_VALUES as readonly string[]).includes(k)
      );
      if (validKinds.length === 0) {
        return NextResponse.json({ error: "Invalid kinds" }, { status: 400 });
      }
      q = q.in("kind", validKinds);
    }
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ marked: true });
  }

  if (body.ids && body.ids.length > 0) {
    const { error } = await admin
      .from("client_notifications")
      .update({ is_read: true, read_at: nowIso })
      .eq("client_id", session.user.id)
      .in("id", body.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ marked: true });
  }

  return NextResponse.json({ error: "ids[] or markAll required" }, { status: 400 });
}
