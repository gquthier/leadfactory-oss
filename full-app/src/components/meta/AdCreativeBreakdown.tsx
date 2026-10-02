"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Image as ImageIcon, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { DatePreset } from "@/lib/meta-api";
import type { LeadAggregate } from "@/types/index";

interface AdRow {
  ad_id: string;
  ad_name: string;
  adset_name: string;
  campaign_name: string;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversion_label?: string;
  thumbnail_url?: string;
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
}

type SortKey = "spend" | "leads" | "cpl" | "ctr" | "impressions" | "cpc" | "cpm";
type SortDir = "asc" | "desc";

interface Props {
  adAccountId: string;
  period: DatePreset;
  leadStats?: Record<string, LeadAggregate>;
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

const SORT_OPTS: Array<{ key: SortKey; label: string }> = [
  { key: "spend",       label: "Dépense"     },
  { key: "leads",       label: "Leads"       },
  { key: "cpl",         label: "CPL"         },
  { key: "ctr",         label: "CTR"         },
  { key: "cpm",         label: "CPM"         },
  { key: "cpc",         label: "CPC"         },
  { key: "impressions", label: "Impressions" },
];

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:   "bg-lf-green text-white",
  PAUSED:   "bg-gray-200 text-gray-600",
  DELETED:  "bg-red-100 text-red-600",
  ARCHIVED: "bg-gray-100 text-gray-500",
};
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif", PAUSED: "En pause", DELETED: "Supprimé", ARCHIVED: "Archivé",
};

function StatusBadge({ status }: { status?: string }) {
  return (
    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 border border-black flex-shrink-0 ${STATUS_STYLES[status ?? ""] ?? "bg-gray-100 text-gray-500"}`}>
      {STATUS_LABELS[status ?? ""] ?? status ?? "—"}
    </span>
  );
}

function AdThumbnail({ url, name }: { url?: string; name: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name.split(/[\s_-]/).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  if (!url || imgError) {
    return (
      <div className="w-16 h-16 border-3 border-black bg-lf-black flex items-center justify-center flex-shrink-0">
        <span className="text-lf-yellow font-black text-sm">{initials}</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt={name}
      className="w-16 h-16 border-3 border-black object-cover flex-shrink-0"
      onError={() => setImgError(true)}
    />
  );
}

export function AdCreativeBreakdown({ adAccountId, period, leadStats }: Props) {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/meta/ad-stats?ad_account_id=${encodeURIComponent(adAccountId)}&period=${period}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAds(data.ads ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [adAccountId, period]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const handleSort = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const sorted = [...ads].sort((a, b) => {
    const va = (a[sortBy] as number) ?? 0;
    const vb = (b[sortBy] as number) ?? 0;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  const displayed = showAll ? sorted : sorted.slice(0, 6);
  const convLabelGlobal = ads[0]?.conversion_label ?? "Leads";

  if (loading) return (
    <div className="flex items-center gap-2 text-lf-gray text-sm font-medium py-4 justify-center">
      <RefreshCw className="w-4 h-4 animate-spin" />
      Chargement des créatives...
    </div>
  );

  if (error) return (
    <div className="p-3 bg-red-50 border-3 border-red-400 text-red-600 text-xs font-bold">{error}</div>
  );

  if (!ads.length) return (
    <div className="p-4 bg-gray-50 border-3 border-black text-xs font-medium text-lf-gray text-center">
      Aucune créative avec des données sur cette période.
    </div>
  );

  return (
    <div>
      {/* Header + sort bar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-3.5 h-3.5 text-lf-gray" />
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
            {ads.length} créative{ads.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray mr-1">Trier :</span>
          {SORT_OPTS.map(opt => {
            const active = sortBy === opt.key;
            const displayLabel = opt.key === "leads"
              ? convLabelGlobal
              : opt.key === "cpl"
              ? (convLabelGlobal === "Leads" ? "CPL" : "CPA")
              : opt.label;
            return (
              <button
                key={opt.key}
                onClick={() => handleSort(opt.key)}
                className={`flex items-center gap-0.5 px-2 py-1 border-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                  active ? "bg-lf-black text-white border-black" : "bg-white border-black hover:bg-gray-50"
                }`}
              >
                {displayLabel}
                {active
                  ? sortDir === "desc"
                    ? <ArrowDown className="w-2.5 h-2.5 ml-0.5" />
                    : <ArrowUp className="w-2.5 h-2.5 ml-0.5" />
                  : <ArrowUpDown className="w-2.5 h-2.5 ml-0.5 opacity-30" />
                }
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {displayed.map((ad, i) => {
          const stats = leadStats?.[ad.ad_id];
          const roasCA = stats && ad.spend > 0 ? (stats.total_revenue / ad.spend).toFixed(1) + "x" : "—";
          const roasCash = stats && ad.spend > 0 ? (stats.total_cash / ad.spend).toFixed(1) + "x" : "—";
          const convLabel = ad.conversion_label ?? "Leads";
          const cpaLabel = convLabel === "Leads" ? "CPL" : "CPA";

          return (
            <div key={ad.ad_id} className="border-3 border-black bg-white overflow-hidden">
              {/* Thumbnail + name */}
              <div className="flex items-start gap-3 p-3 border-b-2 border-dashed border-gray-200">
                <div className="relative flex-shrink-0">
                  <AdThumbnail url={ad.thumbnail_url} name={ad.ad_name} />
                  <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-lf-black text-white text-[9px] font-black flex items-center justify-center border-2 border-white">
                    {i + 1}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <p className="font-black text-xs uppercase tracking-wide leading-tight line-clamp-2 flex-1">{ad.ad_name}</p>
                    <StatusBadge status={ad.status} />
                  </div>
                  <p className="text-[10px] font-medium text-lf-gray truncate">{ad.adset_name}</p>
                  <p className="text-[10px] font-medium text-lf-gray/70 truncate">{ad.campaign_name}</p>
                </div>
              </div>

              {/* 6 metrics in 2 rows of 3 */}
              <div className="grid grid-cols-3 divide-x-2 divide-black border-b-2 border-black">
                {([
                  { key: "spend" as SortKey,  label: "Dépensé",    val: `${fmt(ad.spend, 0)}€`                       },
                  { key: "leads" as SortKey,  label: convLabel,     val: fmt(ad.leads)                                 },
                  { key: "cpl" as SortKey,    label: cpaLabel,      val: ad.cpl > 0 ? `${fmt(ad.cpl, 0)}€` : "—"      },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    onClick={() => handleSort(m.key)}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === m.key ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">{m.label}</p>
                    <p className="text-sm font-black leading-tight">{m.val}</p>
                  </button>
                ))}
              </div>
              <div className={`grid grid-cols-3 divide-x-2 divide-black ${leadStats ? "border-b-2 border-dashed border-gray-200" : ""}`}>
                {([
                  { key: "ctr" as SortKey,         label: "CTR",         val: `${fmt(ad.ctr, 2)}%`                        },
                  { key: "cpm" as SortKey,          label: "CPM",         val: `${fmt(ad.cpm, 0)}€`                        },
                  { key: "impressions" as SortKey,  label: "Impressions", val: fmt(ad.impressions)                          },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    onClick={() => handleSort(m.key)}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === m.key ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">{m.label}</p>
                    <p className="text-sm font-black leading-tight">{m.val}</p>
                  </button>
                ))}
              </div>

              {/* Lead quality + CA + Cash + ROAS row */}
              {leadStats && (
                <div className="grid grid-cols-5 divide-x-2 divide-black bg-lf-green/5">
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">Qualité</p>
                    <p className="text-xs font-black mt-0.5">
                      {stats?.avg_quality != null ? `★ ${stats.avg_quality.toFixed(1)}` : "—"}
                    </p>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">CA</p>
                    <p className="text-xs font-black mt-0.5">
                      {stats && stats.total_revenue > 0 ? `${fmt(stats.total_revenue, 0)}€` : "—"}
                    </p>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">Cash</p>
                    <p className="text-xs font-black mt-0.5">
                      {stats && stats.total_cash > 0 ? `${fmt(stats.total_cash, 0)}€` : "—"}
                    </p>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">ROAS CA</p>
                    <p className={`text-xs font-black mt-0.5 ${roasCA !== "—" && parseFloat(roasCA) >= 3 ? "text-lf-green" : roasCA !== "—" && parseFloat(roasCA) >= 1.5 ? "text-amber-600" : ""}`}>
                      {roasCA}
                    </p>
                  </div>
                  <div className="px-2 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">ROAS Cash</p>
                    <p className={`text-xs font-black mt-0.5 ${roasCash !== "—" && parseFloat(roasCash) >= 3 ? "text-lf-green" : roasCash !== "—" && parseFloat(roasCash) >= 1.5 ? "text-amber-600" : ""}`}>
                      {roasCash}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {ads.length > 6 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-3 w-full py-2 border-3 border-black text-xs font-black uppercase tracking-wider hover:bg-gray-50 transition-colors"
        >
          {showAll ? "Réduire" : `Voir toutes les ${ads.length} créatives`}
        </button>
      )}
    </div>
  );
}
