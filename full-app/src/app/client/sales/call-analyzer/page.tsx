import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Headphones,
  Plus,
  ArrowLeft,
  ShieldAlert,
  Lightbulb,
  Quote,
  Flame,
} from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { CallHistoryList } from "./CallHistoryList";

export const dynamic = "force-dynamic";

export default async function CallAnalyzerHomePage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: history } = await admin
    .from("sales_call_analyses")
    .select(
      "id, meeting_title, meeting_date, duration_minutes, status, error_message, created_at, source_type, analysis_json"
    )
    .eq("client_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const items = (history ?? []).map((row) => {
    const a = row.analysis_json as
      | {
          overall_score?: number;
          call_summary_one_liner?: string;
          deal_temperature?: string;
        }
      | null;
    return {
      id: row.id,
      meeting_title: row.meeting_title,
      meeting_date: row.meeting_date,
      duration_minutes: row.duration_minutes,
      status: row.status,
      error_message: row.error_message,
      created_at: row.created_at,
      source_type: row.source_type,
      overall_score: a?.overall_score ?? null,
      summary: a?.call_summary_one_liner ?? null,
      deal_temperature: a?.deal_temperature ?? null,
    };
  });

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      <Link
        href="/client/sales"
        className="inline-flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Sales
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="sticker-yellow -rotate-1 inline-block mb-3">SALES CALL ANALYZER</div>
          <h1 className="text-3xl font-black uppercase tracking-tight flex items-center gap-3">
            <Headphones className="w-7 h-7" /> Sales Call Analyzer
          </h1>
          <p className="text-lf-gray font-medium mt-2 max-w-2xl">
            Analyse un appel de vente — score sur 10, 3 leviers actionnables, objections détectées et alignement à la doctrine LeadFactory.
          </p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Link
            href="/client/sales/call-analyzer/objections"
            className="btn-secondary inline-flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4" /> Objections
          </Link>
          <Link
            href="/client/sales/call-analyzer/recommendations"
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Lightbulb className="w-4 h-4" /> Recommandations
          </Link>
          <Link
            href="/client/sales/call-analyzer/pains"
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Flame className="w-4 h-4" /> Pain points
          </Link>
          <Link
            href="/client/sales/call-analyzer/verbatim"
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Quote className="w-4 h-4" /> Verbatim
          </Link>
          <Link
            href="/client/sales/call-analyzer/new"
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Analyser un call
          </Link>
        </div>
      </div>

      <CallHistoryList items={items} />
    </div>
  );
}
