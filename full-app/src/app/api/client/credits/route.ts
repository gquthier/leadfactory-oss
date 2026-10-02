import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  CREDIT_COSTS,
  CREDIT_WARNING_THRESHOLD,
  ensureCreditsRow,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const balance = await ensureCreditsRow(session.user.id);

  const { searchParams } = new URL(req.url);
  const withHistory = searchParams.get("history") === "1";

  let history: Array<{
    id: string;
    feature: string;
    amount: number;
    metadata: Record<string, unknown>;
    created_at: string;
  }> = [];

  if (withHistory) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("credit_usage")
      .select("id, feature, amount, metadata, created_at")
      .eq("client_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    history = (data ?? []) as typeof history;
  }

  return NextResponse.json({
    balance: balance.balance,
    total_granted: balance.total_granted,
    total_consumed: balance.total_consumed,
    last_consumed_at: balance.last_consumed_at,
    costs: CREDIT_COSTS,
    warning_threshold: CREDIT_WARNING_THRESHOLD,
    low: balance.balance < CREDIT_WARNING_THRESHOLD,
    empty: balance.balance <= 0,
    history,
  });
}
