import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  aggregatePains,
  type CallAnalysisInput,
} from "@/lib/sales-call-analyzer/aggregate";
import { salesCallAnalysisSchema } from "@/lib/sales-call-analyzer/analyzer-schema";
import { PainsTable } from "./PainsTable";

export const dynamic = "force-dynamic";

export default async function PainsPage() {
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

  const pains = aggregatePains(calls);
  const totalCalls = calls.length;
  const totalOccurrences = pains.reduce((s, p) => s + p.occurrence_count, 0);

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
          Pain Points Catalog
        </h1>
        <p className="text-lf-gray font-medium mt-2 max-w-2xl">
          Toutes les douleurs exprimées par tes prospects, groupées par catégorie, classées
          par fréquence et intensité. C&apos;est ta matière première pour le copy outbound, les
          landings et le positionnement de l&apos;offre.
        </p>
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray mt-3">
          {totalCalls} call{totalCalls > 1 ? "s" : ""} · {totalOccurrences} pain{totalOccurrences > 1 ? "s" : ""} détecté{totalOccurrences > 1 ? "s" : ""} · {pains.length} catégorie{pains.length > 1 ? "s" : ""}
        </p>
      </div>

      <PainsTable pains={pains} />
    </div>
  );
}
