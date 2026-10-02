import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sales_call_analyses")
    .select(
      "id, source_type, meeting_title, meeting_date, duration_minutes, status, error_message, created_at, analysis_json"
    )
    .eq("client_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Strip the heavy analysis_json down to summary fields for list view
  const items = (data ?? []).map((row) => {
    const a = row.analysis_json as
      | {
          overall_score?: number;
          call_summary_one_liner?: string;
          deal_temperature?: string;
        }
      | null;
    return {
      id: row.id,
      source_type: row.source_type,
      meeting_title: row.meeting_title,
      meeting_date: row.meeting_date,
      duration_minutes: row.duration_minutes,
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at,
      overall_score: a?.overall_score ?? null,
      summary: a?.call_summary_one_liner ?? null,
      deal_temperature: a?.deal_temperature ?? null,
    };
  });

  return NextResponse.json({ items });
}
