import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { client_id?: string; force?: boolean };
  try {
    body = (await req.json()) as { client_id?: string; force?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const clientId = body.client_id;
  if (!clientId) return NextResponse.json({ error: "Missing client_id" }, { status: 400 });

  // Ensure a client_surprises row exists, reset to pending
  const { data: existing } = await admin
    .from("client_surprises")
    .select("id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing) {
    if (body.force) {
      await admin.from("surprise_assets").delete().eq("surprise_id", existing.id);
    }
    await admin
      .from("client_surprises")
      .update({ status: "pending", progress_pct: 0, error_message: null, started_at: null, finished_at: null, viewed_at: null, notified_at: null })
      .eq("id", existing.id);
  } else {
    await admin.from("client_surprises").insert({ client_id: clientId, status: "pending" });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid";
  const res = await fetch(`${appUrl}/api/surprises/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    body: JSON.stringify({ client_id: clientId }),
  });
  const data = await res.json();
  return NextResponse.json({ triggered: true, result: data });
}
