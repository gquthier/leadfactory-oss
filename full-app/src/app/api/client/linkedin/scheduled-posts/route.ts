import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const MAX_PER_DAY = 5;
const SOURCE_TYPES = ["linkedin_post", "surprise_asset", "manual"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

interface CreateBody {
  source_type?: SourceType;
  source_id?: string | null;
  body?: string;
  scheduled_at?: string;
}

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scheduled_posts")
    .select("id, source_type, source_id, body_snapshot, scheduled_at, status, retry_count, linkedin_post_urn, error_message, published_at, created_at")
    .eq("client_id", session.user.id)
    .order("scheduled_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceType = body.source_type ?? "manual";
  if (!SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: "Invalid source_type" }, { status: 400 });
  }

  const postBody = (body.body ?? "").trim();
  if (postBody.length < 1) {
    return NextResponse.json({ error: "Body required" }, { status: 400 });
  }
  if (postBody.length > 3000) {
    return NextResponse.json({ error: "Body too long (max 3000 chars)" }, { status: 400 });
  }

  if (!body.scheduled_at) {
    return NextResponse.json({ error: "scheduled_at required" }, { status: 400 });
  }
  const scheduledAt = new Date(body.scheduled_at);
  if (isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "Invalid scheduled_at" }, { status: 400 });
  }
  // Allow scheduling at most 5 min in the past (so "Publier maintenant" works
  // even with clock drift). Anything older than that is rejected.
  if (scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json({ error: "scheduled_at is in the past" }, { status: 400 });
  }

  const clientId = session.user.id;
  const admin = createAdminClient();

  const { data: conn } = await admin
    .from("linkedin_connections")
    .select("id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!conn) {
    return NextResponse.json(
      { error: "LinkedIn non connecté. Connectez votre compte dans Paramètres > Intégrations." },
      { status: 412 }
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", since)
    .neq("status", "cancelled");
  if ((recentCount ?? 0) >= MAX_PER_DAY) {
    return NextResponse.json(
      { error: `Limite quotidienne atteinte (${MAX_PER_DAY} posts/jour)` },
      { status: 429 }
    );
  }

  const dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: dup } = await admin
    .from("scheduled_posts")
    .select("id")
    .eq("client_id", clientId)
    .eq("body_snapshot", postBody)
    .gte("created_at", dupSince)
    .neq("status", "cancelled")
    .maybeSingle();
  if (dup) {
    return NextResponse.json(
      { error: "Un post identique a déjà été programmé dans les dernières 24h" },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertError } = await admin
    .from("scheduled_posts")
    .insert({
      client_id: clientId,
      source_type: sourceType,
      source_id: body.source_id ?? null,
      body_snapshot: postBody,
      scheduled_at: scheduledAt.toISOString(),
      status: "queued",
      scheduled_by: clientId,
    })
    .select()
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? "Insert failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ post: inserted });
}
