import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  aggregateObjections,
  type CallAnalysisInput,
} from "@/lib/sales-call-analyzer/aggregate";
import { salesCallAnalysisSchema } from "@/lib/sales-call-analyzer/analyzer-schema";
import { ObjectionsTable } from "./ObjectionsTable";

export const dynamic = "force-dynamic";

export default async function ObjectionsPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin
    .from("sales_call_analyses")
    .select("id, meeting_title, meeting_date, created_at, analysis_json, status")
    .eq("client_id", session.user.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(200);

  const calls: CallAnalysisInput[] = [];
  for (const row of data ?? []) {
    const parsed = salesCallAnalysisSchema.safeParse(row.analysis_json);
    if (!parsed.success) continue;
    calls.push({
      call_id: row.id,
      meeting_title: row.meeting_title,
      meeting_date: row.meeting_date,
      created_at: row.created_at,
      analysis: parsed.data,
    });
  }

  const objections = aggregateObjections(calls);
  const totalCalls = calls.length;

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      <Link
        href="/client/sales/call-analyzer"
        className="inline-flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Retour aux calls
      </Link>

      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">SALES IA</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">
          Objections détectées
        </h1>
        <p className="text-lf-gray font-medium mt-2 max-w-2xl">
          Toutes les objections détectées sur l&apos;ensemble de tes calls, groupées par
          type, avec leur récurrence et une synthèse de la réponse idéale extraite des
          analyses.
        </p>
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray mt-3">
          {totalCalls} call{totalCalls > 1 ? "s" : ""} analysé{totalCalls > 1 ? "s" : ""} ·{" "}
          {objections.length} type{objections.length > 1 ? "s" : ""} d&apos;objection
        </p>
      </div>

      <ObjectionsTable objections={objections} />
    </div>
  );
}
