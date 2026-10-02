"use client";

import Link from "next/link";
import clsx from "clsx";
import { Clock, Link2, FileText, AlertCircle, Loader2 } from "lucide-react";
import { TEMP_LABELS } from "@/lib/sales-call-analyzer/analyzer-schema";

interface HistoryItem {
  id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  duration_minutes: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  source_type: string;
  overall_score: number | null;
  summary: string | null;
  deal_temperature: string | null;
}

function scoreBand(score: number) {
  if (score >= 7) return { cls: "bg-lf-green text-white", label: "Bon" };
  if (score >= 4) return { cls: "bg-lf-yellow text-black", label: "Moyen" };
  return { cls: "bg-lf-pink text-black", label: "À retravailler" };
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="min-w-[44px] h-11 border-3 border-black bg-white flex items-center justify-center text-xs font-black text-lf-gray">
        —
      </div>
    );
  }
  const band = scoreBand(score);
  return (
    <div
      className={clsx(
        "min-w-[44px] h-11 border-3 border-black flex flex-col items-center justify-center shadow-brutal-xs",
        band.cls
      )}
    >
      <span className="text-base font-black leading-none">{score.toFixed(1)}</span>
      <span className="text-[9px] font-black uppercase opacity-80">/10</span>
    </div>
  );
}

function StatusPill({ status, error }: { status: string; error: string | null }) {
  if (status === "running" || status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase px-2 py-1 border-2 border-black bg-lf-yellow">
        <Loader2 className="w-3 h-3 animate-spin" /> En cours
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        title={error ?? undefined}
        className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase px-2 py-1 border-2 border-black bg-lf-pink"
      >
        <AlertCircle className="w-3 h-3" /> Échec
      </span>
    );
  }
  return null;
}

export function CallHistoryList({ items }: { items: HistoryItem[] }) {
  if (!items.length) {
    return (
      <div className="card-brutal p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center shadow-brutal-xs">
          <FileText className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-2">
          Aucun call analysé pour l&apos;instant
        </h2>
        <p className="text-lf-gray font-medium mb-6 max-w-md mx-auto">
          Branche ta clé Fathom puis colle l&apos;URL d&apos;un meeting, ou paste un transcript brut pour démarrer.
        </p>
        <Link href="/client/sales/call-analyzer/new" className="btn-primary inline-flex items-center gap-2">
          Analyser mon premier call
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((it) => {
        const date = it.meeting_date ?? it.created_at;
        const dateLabel = new Date(date).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const isCompleted = it.status === "completed";
        const card = (
          <article
            className={clsx(
              "card-brutal p-4 flex flex-col gap-3 bg-white h-full",
              isCompleted &&
                "hover:bg-lf-yellow hover:shadow-[6px_6px_0_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all cursor-pointer"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <ScoreBadge score={it.overall_score} />
              <div className="flex flex-col items-end gap-1">
                <StatusPill status={it.status} error={it.error_message} />
                {it.deal_temperature && (
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 border-2 border-black bg-white">
                    {TEMP_LABELS[it.deal_temperature as keyof typeof TEMP_LABELS] ?? it.deal_temperature}
                  </span>
                )}
              </div>
            </div>

            <h3 className="text-sm font-black uppercase tracking-tight line-clamp-2 leading-snug">
              {it.meeting_title ?? "Call sans titre"}
            </h3>

            {it.summary ? (
              <p className="text-xs font-medium text-lf-gray line-clamp-4 leading-relaxed">
                {it.summary}
              </p>
            ) : (
              <p className="text-xs font-medium italic text-lf-gray">
                {it.status === "completed"
                  ? "Pas de résumé disponible."
                  : "Analyse en cours…"}
              </p>
            )}

            <div className="mt-auto pt-2 border-t-2 border-black/10 flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-lf-gray">
                <Clock className="w-3 h-3" /> {dateLabel}
              </span>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-lf-gray">
                {it.duration_minutes ? <span>{it.duration_minutes} min</span> : null}
                <span className="inline-flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  {it.source_type === "fathom_url" ? "Fathom" : "Paste"}
                </span>
              </div>
            </div>
          </article>
        );

        return isCompleted ? (
          <Link key={it.id} href={`/client/sales/call-analyzer/${it.id}`}>
            {card}
          </Link>
        ) : (
          <div key={it.id}>{card}</div>
        );
      })}
    </div>
  );
}
