"use client";

import clsx from "clsx";
import { Quote, Target, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Flame } from "lucide-react";
import {
  PHASE_LABELS,
  OBJECTION_LABELS,
  TEMP_LABELS,
  type SalesCallAnalysis,
} from "@/lib/sales-call-analyzer/analyzer-schema";

function ScoreBig({ score }: { score: number }) {
  const bg =
    score >= 7
      ? "bg-lf-green text-white"
      : score >= 4
      ? "bg-lf-yellow text-black"
      : "bg-lf-pink text-black";
  return (
    <div
      className={clsx(
        "w-28 h-28 border-3 border-black flex flex-col items-center justify-center shadow-brutal flex-shrink-0",
        bg
      )}
    >
      <span className="text-5xl font-black leading-none">{score.toFixed(1)}</span>
      <span className="text-xs font-black uppercase mt-1 opacity-80">sur 10</span>
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-lf-gray">
        <span className="w-4 h-4 border-2 border-lf-gray inline-block" /> {label} <em className="not-italic text-xs">(non détectable)</em>
      </div>
    );
  }
  return (
    <div className={clsx("flex items-center gap-2 text-sm font-bold", ok ? "text-black" : "text-red-600")}>
      {ok ? <CheckCircle2 className="w-4 h-4 text-lf-green" /> : <XCircle className="w-4 h-4 text-red-500" />}
      {label}
    </div>
  );
}

function PhaseCard({ phase }: { phase: SalesCallAnalysis["phases"][number] }) {
  const scoreColor =
    phase.score >= 7 ? "bg-lf-green text-white" : phase.score >= 4 ? "bg-lf-yellow" : "bg-lf-pink";
  return (
    <div className="card-brutal p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-base font-black uppercase tracking-tight">{PHASE_LABELS[phase.phase]}</h3>
        <span className={clsx("px-2 py-1 border-2 border-black text-xs font-black", scoreColor)}>
          {phase.score.toFixed(1)} / 10
        </span>
      </div>

      {phase.framework_violated && (
        <div className="text-xs font-bold text-red-700 mb-2 inline-flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {phase.framework_violated}
        </div>
      )}

      {phase.what_worked.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-black uppercase tracking-wider text-lf-gray mb-1">Ce qui a marché</p>
          <ul className="space-y-1">
            {phase.what_worked.map((w, i) => (
              <li key={i} className="text-sm flex gap-2">
                <CheckCircle2 className="w-4 h-4 text-lf-green flex-shrink-0 mt-0.5" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase.what_to_improve.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-black uppercase tracking-wider text-lf-gray mb-1">À améliorer</p>
          <ul className="space-y-1">
            {phase.what_to_improve.map((w, i) => (
              <li key={i} className="text-sm flex gap-2">
                <Target className="w-4 h-4 text-lf-blue flex-shrink-0 mt-0.5" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase.verbatim_quotes.length > 0 && (
        <div className="border-t-3 border-black pt-3 space-y-2">
          {phase.verbatim_quotes.map((q, i) => (
            <div key={i} className="bg-gray-50 border-2 border-black p-2">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase mb-1">
                <Quote className="w-3 h-3" />
                {q.speaker === "commercial" ? "Commercial" : "Prospect"}
                {q.timestamp && <span className="text-lf-gray">· {q.timestamp}</span>}
              </div>
              <p className="text-sm italic">« {q.quote} »</p>
              {q.context && <p className="text-xs text-lf-gray mt-1">{q.context}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnalysisView({ analysis }: { analysis: SalesCallAnalysis }) {
  return (
    <div className="space-y-6">
      {/* Hero verdict */}
      <div className="card-brutal p-6">
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          <ScoreBig score={analysis.overall_score} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm font-black uppercase px-3 py-1.5 border-3 border-black bg-white">
                {TEMP_LABELS[analysis.deal_temperature]}
              </span>
              <span
                className={clsx(
                  "text-sm font-black uppercase px-3 py-1.5 border-3 border-black",
                  analysis.next_call_likely ? "bg-lf-green text-white" : "bg-lf-pink"
                )}
              >
                {analysis.next_call_likely ? "Next call probable" : "Next call incertain"}
              </span>
              {analysis.prospect_company && (
                <span className="text-sm font-bold px-2 py-1 border-2 border-black bg-gray-50">
                  {analysis.prospect_company}
                </span>
              )}
            </div>
            <p className="text-lg font-medium leading-snug">{analysis.call_summary_one_liner}</p>
          </div>
        </div>
      </div>

      {/* Top 3 recos */}
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-3 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" /> Top 3 leviers pour le prochain call
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {analysis.top_3_recommendations
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map((r) => (
              <div key={r.priority} className="card-brutal p-5 flex flex-col">
                <div className="w-10 h-10 bg-lf-black text-white border-3 border-black flex items-center justify-center font-black text-lg mb-3 shadow-brutal-xs">
                  {r.priority}
                </div>
                <h3 className="font-black uppercase tracking-tight text-base mb-2">{r.title}</h3>
                <p className="text-sm font-medium text-lf-gray mb-3">{r.why}</p>
                <div className="border-t-3 border-black pt-3 mt-auto">
                  <p className="text-[11px] font-black uppercase text-lf-gray mb-1">Au prochain call</p>
                  <p className="text-sm font-medium">{r.how_next_call}</p>
                  <p className="text-[11px] font-bold text-lf-blue uppercase mt-2">
                    Source : {r.framework_source}
                  </p>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Alignement LeadFactory + talk ratio */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-brutal p-5">
          <h2 className="text-base font-black uppercase tracking-tight mb-3">Alignement doctrine LeadFactory</h2>
          <div className="space-y-2 mb-3">
            <CheckRow ok={analysis.leadfactory_alignment.speed_to_lead_respected} label="Speed-to-lead respecté" />
            <CheckRow ok={analysis.leadfactory_alignment.bnt_qualif_done} label="Qualification BNT faite" />
            <CheckRow ok={analysis.leadfactory_alignment.next_step_dated} label="Next step daté en fin de call" />
          </div>
          {analysis.leadfactory_alignment.score_aligned_quotes.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] font-black uppercase text-lf-gray mb-1">Citations alignées</p>
              <ul className="space-y-1">
                {analysis.leadfactory_alignment.score_aligned_quotes.map((q, i) => (
                  <li key={i} className="text-xs italic">« {q} »</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.leadfactory_alignment.score_deviant_quotes.length > 0 && (
            <div>
              <p className="text-[11px] font-black uppercase text-red-600 mb-1">Citations déviantes</p>
              <ul className="space-y-1">
                {analysis.leadfactory_alignment.score_deviant_quotes.map((q, i) => (
                  <li key={i} className="text-xs italic">« {q} »</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="card-brutal p-5">
          <h2 className="text-base font-black uppercase tracking-tight mb-3">Talk ratio commercial</h2>
          {analysis.talk_ratio_commercial_pct !== null ? (
            <>
              <div className="text-5xl font-black mb-2">
                {analysis.talk_ratio_commercial_pct}%
              </div>
              <p
                className={clsx(
                  "text-sm font-black uppercase",
                  analysis.talk_ratio_verdict === "good_under_40" && "text-lf-green",
                  analysis.talk_ratio_verdict === "acceptable_40_55" && "text-lf-yellow-dark",
                  analysis.talk_ratio_verdict === "too_high_over_55" && "text-red-600"
                )}
              >
                {analysis.talk_ratio_verdict === "good_under_40" && "✓ Excellent (< 40%)"}
                {analysis.talk_ratio_verdict === "acceptable_40_55" && "⚠ Acceptable (40-55%)"}
                {analysis.talk_ratio_verdict === "too_high_over_55" && "✗ Trop élevé (> 55%)"}
              </p>
              <p className="text-xs text-lf-gray font-medium mt-2">
                Doctrine LeadFactory : 20-40% maximum côté commercial.
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-lf-gray">
              Talk ratio non calculable (timestamps ou diarization manquants dans le transcript).
            </p>
          )}
        </div>
      </div>

      {/* Red flags */}
      {analysis.critical_red_flags.length > 0 && (
        <div className="card-brutal p-5 bg-lf-pink/20">
          <h2 className="text-base font-black uppercase tracking-tight mb-3 flex items-center gap-2 text-red-700">
            <Flame className="w-5 h-5" /> Red flags critiques
          </h2>
          <ul className="space-y-1">
            {analysis.critical_red_flags.map((f, i) => (
              <li key={i} className="text-sm font-medium flex gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Objections */}
      {analysis.objections.length > 0 && (
        <div>
          <h2 className="text-xl font-black uppercase tracking-tight mb-3">
            Objections détectées ({analysis.objections.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.objections.map((o, i) => (
              <div key={i} className="card-brutal p-5">
                <h3 className="font-black uppercase text-base mb-2">
                  {OBJECTION_LABELS[o.type] ?? o.type}
                </h3>
                <p className="text-sm italic mb-3 text-lf-gray">« {o.raised_verbatim} »</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <span
                    className={clsx(
                      "text-[11px] font-black uppercase px-2 py-1 border-2 border-black",
                      o.was_isolated ? "bg-lf-green text-white" : "bg-lf-pink"
                    )}
                  >
                    Isolée {o.was_isolated ? "✓" : "✗"}
                  </span>
                  <span
                    className={clsx(
                      "text-[11px] font-black uppercase px-2 py-1 border-2 border-black",
                      o.was_treated ? "bg-lf-green text-white" : "bg-lf-pink"
                    )}
                  >
                    Traitée {o.was_treated ? "✓" : "✗"}
                  </span>
                  <span
                    className={clsx(
                      "text-[11px] font-black uppercase px-2 py-1 border-2 border-black",
                      o.was_validated ? "bg-lf-green text-white" : "bg-lf-pink"
                    )}
                  >
                    Validée {o.was_validated ? "✓" : "✗"}
                  </span>
                </div>
                <p className="text-sm font-medium border-t-3 border-black pt-3">{o.reco}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phases */}
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-3">Analyse par phase</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {analysis.phases.map((p) => (
            <PhaseCard key={p.phase} phase={p} />
          ))}
        </div>
      </div>
    </div>
  );
}
