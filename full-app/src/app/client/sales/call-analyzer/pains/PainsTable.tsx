"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, Flame, AlertTriangle } from "lucide-react";
import {
  buildPainsCsv,
  type AggregatedPainCategory,
} from "@/lib/sales-call-analyzer/aggregate";

interface Props {
  pains: AggregatedPainCategory[];
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function IntensityBar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = value >= 4 ? "bg-lf-pink" : value >= 2.5 ? "bg-lf-yellow" : "bg-lf-green";
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-16 h-3 border-2 border-black bg-white relative overflow-hidden">
        <div className={`absolute top-0 left-0 h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-black tabular-nums">{value.toFixed(1)}</span>
    </div>
  );
}

export function PainsTable({ pains }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (pains.length === 0) {
    return (
      <div className="card-brutal p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center shadow-brutal-xs">
          <Flame className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-2">
          Aucun pain point détecté pour l&apos;instant
        </h2>
        <p className="text-lf-gray font-medium mb-6 max-w-md mx-auto">
          Les pains points apparaissent automatiquement à partir des analyses récentes. Les
          analyses antérieures à cette feature n&apos;en contiennent pas.
        </p>
        <Link
          href="/client/sales/call-analyzer/new"
          className="btn-primary inline-flex items-center gap-2"
        >
          Analyser un nouveau call
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            const csv = buildPainsCsv(pains);
            const today = new Date().toISOString().slice(0, 10);
            downloadCsv(`leadfactory-pains-${today}.csv`, csv);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Exporter CSV
        </button>
      </div>

      <div className="card-brutal p-0 overflow-hidden bg-white">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-lf-black text-white">
            <tr>
              <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Catégorie de pain
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[100px]">
                Récurrence
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[80px]">
                Calls
              </th>
              <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[140px]">
                Intensité ⌀
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[80px]">
                Max
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] w-[80px]">
                Détail
              </th>
            </tr>
          </thead>
          <tbody>
            {pains.map((p) => {
              const isOpen = openKey === p.category;
              return (
                <>
                  <tr key={p.category} className="border-t-3 border-black align-top">
                    <td className="px-4 py-3 font-black">
                      <div className="flex items-center gap-2">
                        {p.max_intensity >= 4 && (
                          <Flame className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                        )}
                        <span>{p.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[36px] h-7 px-2 bg-lf-yellow border-2 border-black font-black">
                        {p.occurrence_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-bold">{p.call_count}</td>
                    <td className="px-4 py-3">
                      <IntensityBar value={p.avg_intensity} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block text-xs font-black px-2 py-1 border-2 border-black ${
                          p.max_intensity >= 4
                            ? "bg-lf-pink"
                            : p.max_intensity >= 3
                            ? "bg-lf-yellow"
                            : "bg-white"
                        }`}
                      >
                        {p.max_intensity}/5
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setOpenKey(isOpen ? null : p.category)}
                        className="inline-flex items-center justify-center w-8 h-8 bg-white border-3 border-black hover:bg-lf-yellow transition-all"
                        aria-label={isOpen ? "Refermer" : "Voir le détail"}
                      >
                        {isOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t-3 border-black bg-lf-yellow/20">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="flex flex-col gap-4">
                          {p.pattern_summary && (
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                                Pattern de current state (synthèse cross-calls)
                              </p>
                              <p className="text-sm font-medium whitespace-pre-wrap">
                                {p.pattern_summary}
                              </p>
                            </div>
                          )}

                          {p.cost_summary && (
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-red-700 mb-1 inline-flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Coûts d&apos;inaction cités
                              </p>
                              <p className="text-sm font-medium whitespace-pre-wrap">
                                {p.cost_summary}
                              </p>
                            </div>
                          )}

                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-2">
                              {p.occurrences.length} occurrence
                              {p.occurrences.length > 1 ? "s" : ""}
                            </p>
                            <div className="flex flex-col gap-2">
                              {p.occurrences.map((occ, idx) => (
                                <div
                                  key={`${occ.call_id}-${idx}`}
                                  className="bg-white border-3 border-black p-3"
                                >
                                  <div className="flex items-center gap-2 flex-wrap mb-2">
                                    <Link
                                      href={`/client/sales/call-analyzer/${occ.call_id}`}
                                      className="text-xs font-black uppercase tracking-wider text-lf-blue hover:underline truncate"
                                    >
                                      {occ.meeting_title ?? "Call sans titre"}
                                    </Link>
                                    {occ.meeting_date && (
                                      <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
                                        {new Date(occ.meeting_date).toLocaleDateString(
                                          "fr-FR",
                                          { day: "numeric", month: "short", year: "numeric" }
                                        )}
                                      </span>
                                    )}
                                    <span
                                      className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 border-2 border-black ${
                                        occ.intensity >= 4
                                          ? "bg-lf-pink"
                                          : occ.intensity >= 3
                                          ? "bg-lf-yellow"
                                          : "bg-white"
                                      }`}
                                    >
                                      Intensité {occ.intensity}/5
                                    </span>
                                  </div>
                                  <p className="text-sm italic mb-2">
                                    « {occ.raised_verbatim} »
                                  </p>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                    <div>
                                      <p className="font-black uppercase tracking-wider text-lf-gray mb-0.5">
                                        Current state
                                      </p>
                                      <p className="font-medium">{occ.current_state}</p>
                                    </div>
                                    {occ.desired_state && (
                                      <div>
                                        <p className="font-black uppercase tracking-wider text-lf-gray mb-0.5">
                                          Desired state
                                        </p>
                                        <p className="font-medium">{occ.desired_state}</p>
                                      </div>
                                    )}
                                    {occ.cost_of_inaction && (
                                      <div>
                                        <p className="font-black uppercase tracking-wider text-red-700 mb-0.5">
                                          Cost of inaction
                                        </p>
                                        <p className="font-medium">{occ.cost_of_inaction}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
