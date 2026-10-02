import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Link2 } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  salesCallAnalysisSchema,
  type SalesCallAnalysis,
} from "@/lib/sales-call-analyzer/analyzer-schema";
import { AnalysisView } from "./AnalysisView";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ callId: string }>;
}

export default async function CallResultPage(props: Props) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("sales_call_analyses")
    .select("*")
    .eq("id", params.callId)
    .eq("client_id", session.user.id)
    .maybeSingle();

  if (!row) notFound();

  const dateLabel = row.meeting_date
    ? new Date(row.meeting_date).toLocaleString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date(row.created_at).toLocaleString("fr-FR");

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <Link
        href="/client/sales/call-analyzer"
        className="inline-flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Sales Call Analyzer
      </Link>

      <div className="mb-6">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">RÉSULTAT</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">
          {row.meeting_title ?? "Call analysé"}
        </h1>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-sm font-bold text-lf-gray uppercase tracking-wide">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> {dateLabel}
          </span>
          {row.duration_minutes ? <span>· {row.duration_minutes} min</span> : null}
          <span className="inline-flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" />
            {row.source_type === "fathom_url" ? "Fathom" : "Paste manuel"}
          </span>
          {row.model_used && <span>· {row.model_used}</span>}
        </div>
      </div>

      {row.status === "failed" && (
        <div className="card-brutal p-6 bg-lf-pink/30">
          <h2 className="text-lg font-black uppercase mb-2">Analyse échouée</h2>
          <p className="text-sm font-medium">{row.error_message ?? "Erreur inconnue"}</p>
          <Link href="/client/sales/call-analyzer/new" className="btn-primary inline-block mt-4">
            Réessayer
          </Link>
        </div>
      )}

      {(row.status === "running" || row.status === "pending") && (
        <div className="card-brutal p-10 text-center">
          <p className="font-black uppercase">Analyse en cours…</p>
          <p className="text-sm text-lf-gray font-medium mt-2">
            Cette page se rafraîchira automatiquement. Recharge si rien ne se passe au bout de 2 min.
          </p>
        </div>
      )}

      {row.status === "completed" && row.analysis_json && (
        <AnalysisView analysis={salesCallAnalysisSchema.parse(row.analysis_json) as SalesCallAnalysis} />
      )}
    </div>
  );
}
