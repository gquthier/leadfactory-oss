import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_surprises")
    .select("status, viewed_at, finished_at")
    .eq("client_id", session.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ status: null, unseen: false });

  return NextResponse.json({
    status: data.status,
    unseen: data.status === "ready" && !data.viewed_at,
    finishedAt: data.finished_at,
  });
}
