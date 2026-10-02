"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  buildRecommendationsCsv,
  type AggregatedRecommendation,
} from "@/lib/sales-call-analyzer/aggregate";

interface Props {
  recommendations: AggregatedRecommendation[];
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

const PRIORITY_LABELS: Record<number, { label: string; cls: string }> = {
  1: { label: "P1", cls: "bg-lf-pink text-black" },
  2: { label: "P2", cls: "bg-lf-yellow text-black" },
  3: { label: "P3", cls: "bg-white text-black" },
};

export function RecommendationsTable({ recommendations }: Props) {
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null);
  const [frameworkFilter, setFrameworkFilter] = useState<string>("");

  const frameworks = useMemo(() => {
    const set = new Set<string>();
    for (const r of recommendations) {
      if (r.framework_source) set.add(r.framework_source);
    }
    return Array.from(set).sort();
  }, [recommendations]);

  const filtered = recommendations.filter((r) => {
    if (priorityFilter !== null && r.priority !== priorityFilter) return false;
    if (frameworkFilter && r.framework_source !== frameworkFilter) return false;
    return true;
  });

  if (recommendations.length === 0) {
    return (
      <div className="card-brutal p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center shadow-brutal-xs">
          <FileText className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-2">
          Aucune recommandation pour l&apos;instant
        </h2>
        <p className="text-lf-gray font-medium mb-6 max-w-md mx-auto">
          Analyse quelques calls pour voir les recommandations apparaître ici.
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
            Filtrer :
          </span>
          {[1, 2, 3].map((p) => (
            <button
              key={p}
              onClick={() =>
                setPriorityFilter(priorityFilter === p ? null : p)
              }
              className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 border-2 border-black transition-all ${
                priorityFilter === p
                  ? "bg-lf-black text-white"
                  : "bg-white text-black hover:bg-lf-yellow"
              }`}
            >
              P{p}
            </button>
          ))}
          {frameworks.length > 0 && (
            <select
              value={frameworkFilter}
              onChange={(e) => setFrameworkFilter(e.target.value)}
              className="text-[10px] font-black uppercase tracking-wider px-2 py-1 border-2 border-black bg-white"
            >
              <option value="">Tous les frameworks</option>
              {frameworks.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          {(priorityFilter !== null || frameworkFilter) && (
            <button
              onClick={() => {
                setPriorityFilter(null);
                setFrameworkFilter("");
              }}
              className="text-[10px] font-black uppercase tracking-wider text-lf-gray hover:text-black"
            >
              × Reset
            </button>
          )}
        </div>

        <button
          onClick={() => {
            const csv = buildRecommendationsCsv(filtered);
            const today = new Date().toISOString().slice(0, 10);
            downloadCsv(`leadfactory-recommendations-${today}.csv`, csv);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Exporter CSV ({filtered.length})
        </button>
      </div>

      <div className="card-brutal p-0 overflow-hidden bg-white">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-lf-black text-white">
            <tr>
              <th className="text-center px-3 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-16">
                Priorité
              </th>
              <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Recommandation
              </th>
              <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white hidden lg:table-cell">
                Comment l&apos;appliquer
              </th>
              <th className="text-left px-3 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                Framework
              </th>
              <th className="text-left px-3 py-3 font-black uppercase tracking-wider text-[10px]">
                Call
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const pri =
                PRIORITY_LABELS[r.priority] ?? {
                  label: `P${r.priority}`,
                  cls: "bg-white",
                };
              return (
                <tr
                  key={`${r.call_id}-${idx}`}
                  className="border-t-3 border-black align-top"
                >
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-9 h-7 border-2 border-black font-black text-xs ${pri.cls}`}
                    >
                      {pri.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-black mb-1">{r.title}</p>
                    {r.why && (
                      <p className="text-xs font-medium text-lf-gray line-clamp-3">
                        {r.why}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <p className="text-xs font-medium whitespace-pre-wrap line-clamp-4">
                      {r.how_next_call}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] font-black uppercase tracking-wider bg-white border-2 border-black px-2 py-1 inline-block">
                      {r.framework_source || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/client/sales/call-analyzer/${r.call_id}`}
                      className="text-xs font-black uppercase tracking-wider text-lf-blue hover:underline truncate block max-w-[140px]"
                    >
                      {r.meeting_title ?? "Call sans titre"}
                    </Link>
                    {r.meeting_date && (
                      <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
                        {new Date(r.meeting_date).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
