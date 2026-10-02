"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, FileText, Quote, Search, Copy, Check } from "lucide-react";
import {
  buildVerbatimsCsv,
  type AggregatedVerbatim,
} from "@/lib/sales-call-analyzer/aggregate";
import { PHASE_LABELS } from "@/lib/sales-call-analyzer/analyzer-schema";

interface Props {
  items: AggregatedVerbatim[];
}

type SpeakerFilter = "all" | "commercial" | "prospect";

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center justify-center w-7 h-7 bg-white border-3 border-black hover:bg-lf-yellow transition-all flex-shrink-0"
      title="Copier la citation"
      aria-label="Copier la citation"
    >
      {copied ? (
        <Check className="w-3 h-3 text-lf-green" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  );
}

export function VerbatimTable({ items }: Props) {
  const [speaker, setSpeaker] = useState<SpeakerFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const phasesPresent = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => s.add(i.phase));
    return Array.from(s);
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((i) => {
      if (speaker !== "all" && i.speaker !== speaker) return false;
      if (phaseFilter !== "all" && i.phase !== phaseFilter) return false;
      if (needle) {
        const hay = `${i.quote} ${i.context} ${i.meeting_title ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, speaker, phaseFilter, search]);

  if (items.length === 0) {
    return (
      <div className="card-brutal p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center shadow-brutal-xs">
          <Quote className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-black uppercase tracking-tight mb-2">
          Aucun verbatim pour l&apos;instant
        </h2>
        <p className="text-lf-gray font-medium mb-6 max-w-md mx-auto">
          Analyse quelques calls pour voir apparaître les citations exactes (commercial + prospect) extraites de chaque appel.
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
      {/* Toolbar : filtres + export */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Speaker filter */}
          <div className="flex items-center border-3 border-black overflow-hidden">
            {(["all", "commercial", "prospect"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSpeaker(s)}
                className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors ${
                  speaker === s ? "bg-lf-black text-white" : "bg-white hover:bg-gray-100"
                }`}
              >
                {s === "all" ? "Tous" : s === "commercial" ? "Commercial" : "Prospect"}
              </button>
            ))}
          </div>

          {/* Phase filter */}
          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            className="border-3 border-black px-3 py-1.5 text-xs font-black uppercase tracking-wider bg-white"
          >
            <option value="all">Toutes phases</option>
            {phasesPresent.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p as keyof typeof PHASE_LABELS] ?? p}
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lf-gray pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="border-3 border-black pl-8 pr-3 py-1.5 text-xs font-medium bg-white w-56"
            />
          </div>
        </div>

        <button
          onClick={() => {
            const csv = buildVerbatimsCsv(filtered);
            const today = new Date().toISOString().slice(0, 10);
            downloadCsv(`leadfactory-verbatim-${today}.csv`, csv);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all"
        >
          <Download className="w-3.5 h-3.5" /> Exporter CSV ({filtered.length})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card-brutal p-8 text-center">
          <p className="text-sm font-bold text-lf-gray">
            Aucun verbatim ne correspond à ces filtres.
          </p>
        </div>
      ) : (
        <div className="card-brutal p-0 overflow-hidden bg-white">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-lf-black text-white">
              <tr>
                <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[110px]">
                  Speaker
                </th>
                <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white">
                  Citation
                </th>
                <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[160px]">
                  Phase
                </th>
                <th className="text-left px-4 py-3 font-black uppercase tracking-wider text-[10px] border-r-2 border-white w-[180px]">
                  Call
                </th>
                <th className="text-center px-4 py-3 font-black uppercase tracking-wider text-[10px] w-[60px]">
                  Copier
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <tr key={`${v.call_id}-${i}`} className="border-t-3 border-black align-top">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 border-2 border-black ${
                        v.speaker === "commercial"
                          ? "bg-lf-blue text-white"
                          : "bg-lf-pink text-black"
                      }`}
                    >
                      {v.speaker === "commercial" ? "Commercial" : "Prospect"}
                    </span>
                    {v.timestamp && (
                      <div className="text-[10px] font-bold text-lf-gray mt-1">
                        {v.timestamp}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm italic font-medium mb-1">« {v.quote} »</p>
                    {v.context && (
                      <p className="text-xs text-lf-gray font-medium">{v.context}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 border-2 border-black bg-white">
                      {v.phase_label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/client/sales/call-analyzer/${v.call_id}`}
                      className="text-xs font-black uppercase tracking-wider text-lf-blue hover:underline block truncate"
                      title={v.meeting_title ?? "Call sans titre"}
                    >
                      {v.meeting_title ?? "Call sans titre"}
                    </Link>
                    {v.meeting_date && (
                      <div className="text-[10px] font-bold text-lf-gray mt-1">
                        {new Date(v.meeting_date).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <CopyButton text={v.quote} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
