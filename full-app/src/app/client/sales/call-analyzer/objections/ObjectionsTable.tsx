"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, FileText } from "lucide-react";
import {
  buildObjectionsCsv,
  type AggregatedObjection,
} from "@/lib/sales-call-analyzer/aggregate";

interface Props {
  objections: AggregatedObjection[];
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

export function ObjectionsTable({ objections }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (objections.length === 0) {
    return (
      <div className="card-brutal p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center shadow-brutal-xs">
          <FileText className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-2">
          Aucune objection détectée pour l&apos;instant
        </h2>
        <p className="text-lf-gray font-medium mb-6 max-w-md mx-auto">
          Analyse quelques calls pour voir les objections récurrentes apparaître ici.
        </p>
        <Link
          href="/client/sales/call-analyzer"
          className="btn-primary inline-flex items-center gap-2"
        >
          Retour aux calls
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            const csv = buildObjectionsCsv(objections);
            const today = new Date().toISOString().slice(0, 10);
            downloadCsv(`leadfactory-objections-${today}.csv`, csv);
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
                Objection
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Récurrence
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Calls
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Traitées
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Validées
              </th>
              <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px]">
                Détail
              </th>
            </tr>
          </thead>
          <tbody>
            {objections.map((o) => {
              const isOpen = openId === o.type;
              return (
                <>
                  <tr key={o.type} className="border-t-3 border-black">
                    <td className="px-4 py-3 font-black align-top">{o.label}</td>
                    <td className="px-4 py-3 text-center align-top">
                      <span className="inline-flex items-center justify-center min-w-[36px] h-7 px-2 bg-lf-yellow border-2 border-black font-black">
                        {o.recurrence}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center align-top font-bold">
                      {o.call_count}
                    </td>
                    <td className="px-4 py-3 text-center align-top">
                      {o.treated_count} / {o.recurrence}
                    </td>
                    <td className="px-4 py-3 text-center align-top">
                      {o.validated_count} / {o.recurrence}
                    </td>
                    <td className="px-4 py-3 text-center align-top">
                      <button
                        onClick={() => setOpenId(isOpen ? null : o.type)}
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
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                              Réponse idéale (synthèse des recos de chaque
                              occurrence)
                            </p>
                            <p className="text-sm font-medium whitespace-pre-wrap">
                              {o.ideal_response || (
                                <span className="italic text-lf-gray">
                                  Aucune reco produite par l&apos;analyse.
                                </span>
                              )}
                            </p>
                          </div>

                          <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-2">
                              {o.occurrences.length} occurrence
                              {o.occurrences.length > 1 ? "s" : ""}
                            </p>
                            <div className="flex flex-col gap-2">
                              {o.occurrences.map((occ, idx) => (
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
                                        occ.was_treated
                                          ? "bg-lf-green text-white"
                                          : "bg-lf-pink text-black"
                                      }`}
                                    >
                                      {occ.was_treated ? "Traitée" : "Non traitée"}
                                    </span>
                                    {occ.was_isolated && (
                                      <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 border-2 border-black bg-white">
                                        Isolée
                                      </span>
                                    )}
                                    {occ.was_validated && (
                                      <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 border-2 border-black bg-white">
                                        Validée
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs font-medium italic mb-1">
                                    « {occ.raised_verbatim} »
                                  </p>
                                  {occ.reco && (
                                    <p className="text-xs font-medium text-lf-gray">
                                      <strong className="text-black">Reco :</strong>{" "}
                                      {occ.reco}
                                    </p>
                                  )}
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
