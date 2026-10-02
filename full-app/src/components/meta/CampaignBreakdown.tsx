"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, TrendingUp, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { DatePreset } from "@/lib/meta-api";
import type { LeadAggregate } from "@/types/index";

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversion_label: string;
}

type SortKey = "spend" | "leads" | "cpl" | "ctr" | "impressions" | "clicks" | "cpc" | "avg_quality" | "total_revenue" | "total_cash" | "roas_ca" | "roas_cash";
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
  { key: "spend",         label: "Dépense"     },
  { key: "leads",         label: "Leads"       },
  { key: "cpl",           label: "CPL"         },
  { key: "ctr",           label: "CTR"         },
  { key: "impressions",   label: "Impressions" },
  { key: "clicks",        label: "Clics"       },
  { key: "cpc",           label: "CPC"         },
  { key: "avg_quality",   label: "Qualité"     },
  { key: "total_revenue", label: "CA"          },
  { key: "total_cash",    label: "Cash"        },
  { key: "roas_ca",       label: "ROAS CA"     },
  { key: "roas_cash",     label: "ROAS Cash"   },
];

export function CampaignBreakdown({ adAccountId, period, leadStats }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/meta/campaign-stats?ad_account_id=${encodeURIComponent(adAccountId)}&period=${period}&campaigns=1`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCampaigns(data.campaigns ?? []);
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

  // Compute derived values (roas_ca, roas_cash) for sorting
  const withDerived = campaigns.map(c => {
    const stats = leadStats?.[c.campaign_name];
    const roasCA = stats && c.spend > 0 ? stats.total_revenue / c.spend : 0;
    const roasCash = stats && c.spend > 0 ? stats.total_cash / c.spend : 0;
    return {
      ...c,
      avg_quality: stats?.avg_quality ?? 0,
      total_revenue: stats?.total_revenue ?? 0,
      total_cash: stats?.total_cash ?? 0,
      roas_ca: roasCA,
      roas_cash: roasCash,
    };
  });

  const sorted = [...withDerived].sort((a, b) => {
    const va = (a[sortBy] as number) ?? 0;
    const vb = (b[sortBy] as number) ?? 0;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  const maxVal = Math.max(...sorted.map(c => (c[sortBy] as number) ?? 0), 1);
  const convLabelGlobal = withDerived[0]?.conversion_label ?? "Leads";

  if (loading) return (
    <div className="flex items-center gap-2 text-lf-gray text-sm font-medium py-4 justify-center">
      <RefreshCw className="w-4 h-4 animate-spin" />
      Chargement des campagnes...
    </div>
  );

  if (error) return (
    <div className="p-3 bg-red-50 border-3 border-red-400 text-red-600 text-xs font-bold">{error}</div>
  );

  if (!campaigns.length) return (
    <div className="p-4 bg-gray-50 border-3 border-black text-xs font-medium text-lf-gray text-center">
      Aucune campagne avec des données sur cette période.
    </div>
  );

  return (
    <div>
      {/* Header + sort bar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-lf-gray" />
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
            {campaigns.length} campagne{campaigns.length > 1 ? "s" : ""}
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

      <div className="flex flex-col gap-2">
        {sorted.map((c, i) => {
          const stats = leadStats?.[c.campaign_name];
          const roasCA = stats && c.spend > 0 ? (stats.total_revenue / c.spend).toFixed(1) + "x" : "—";
          const roasCash = stats && c.spend > 0 ? (stats.total_cash / c.spend).toFixed(1) + "x" : "—";
          const pct = maxVal > 0 ? (((c[sortBy] as number) ?? 0) / maxVal) * 100 : 0;
          const convLabel = c.conversion_label ?? "Leads";
          const cpaLabel = convLabel === "Leads" ? "CPL" : "CPA";

          return (
            <div key={c.campaign_id} className="border-3 border-black bg-white overflow-hidden">
              {/* Campaign name + spend */}
              <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-dashed border-gray-200">
                <span className="w-6 h-6 bg-lf-black text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <p className="font-black text-sm uppercase tracking-wide flex-1 truncate">{c.campaign_name}</p>
                <span className="font-black text-sm flex-shrink-0">{fmt(c.spend, 2)} €</span>
              </div>

              {/* Bar showing sorted metric */}
              <div className="h-1.5 bg-gray-100">
                <div className="h-full bg-lf-blue transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>

              {/* Meta metrics row */}
              <div className="grid grid-cols-4 sm:grid-cols-7 divide-x-2 divide-black border-b-2 border-dashed border-gray-200">
                {([
                  { key: "leads" as SortKey,       label: convLabel,     val: fmt(c.leads) },
                  { key: "cpl" as SortKey,          label: cpaLabel,      val: c.cpl > 0 ? `${fmt(c.cpl, 2)}€` : "—" },
                  { key: "ctr" as SortKey,          label: "CTR",         val: `${fmt(c.ctr, 2)}%` },
                  { key: "clicks" as SortKey,       label: "Clics",       val: fmt(c.clicks) },
                  { key: "impressions" as SortKey,  label: "Impressions", val: fmt(c.impressions) },
                  { key: "cpc" as SortKey,          label: "CPC",         val: c.cpc > 0 ? `${fmt(c.cpc, 2)}€` : "—" },
                  { key: "spend" as SortKey,        label: "Dépense",     val: `${fmt(c.spend, 2)}€` },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    onClick={() => handleSort(m.key)}
                    className={`px-2 py-2 text-center transition-colors ${
                      sortBy === m.key ? "bg-lf-yellow/40" : "hover:bg-gray-50"
                    }`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray leading-tight">{m.label}</p>
                    <p className="text-xs font-black mt-0.5">{m.val}</p>
                  </button>
                ))}
              </div>

              {/* Lead quality + CA + Cash + ROAS row */}
              {leadStats && (
                <div className="grid grid-cols-2 sm:grid-cols-5 divide-x-2 divide-black bg-lf-green/5">
                  {/* Qualité */}
                  <button
                    onClick={() => handleSort("avg_quality")}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === "avg_quality" ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray leading-tight">Moy. Qualité</p>
                    <p className="text-xs font-black mt-0.5">
                      {stats?.avg_quality != null ? `★ ${stats.avg_quality.toFixed(1)} / 5` : "—"}
                    </p>
                  </button>

                  {/* CA */}
                  <button
                    onClick={() => handleSort("total_revenue")}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === "total_revenue" ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray leading-tight">CA</p>
                    <p className="text-xs font-black mt-0.5">
                      {stats && stats.total_revenue > 0 ? `${fmt(stats.total_revenue, 0)}€` : "—"}
                    </p>
                  </button>

                  {/* Cash */}
                  <button
                    onClick={() => handleSort("total_cash")}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === "total_cash" ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray leading-tight">Cash</p>
                    <p className="text-xs font-black mt-0.5">
                      {stats && stats.total_cash > 0 ? `${fmt(stats.total_cash, 0)}€` : "—"}
                    </p>
                  </button>

                  {/* ROAS CA */}
                  <button
                    onClick={() => handleSort("roas_ca")}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === "roas_ca" ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray leading-tight">ROAS CA</p>
                    <p className={`text-xs font-black mt-0.5 ${roasCA !== "—" && parseFloat(roasCA) >= 3 ? "text-lf-green" : roasCA !== "—" && parseFloat(roasCA) >= 1.5 ? "text-lf-yellow" : ""}`}>
                      {roasCA}
                    </p>
                  </button>

                  {/* ROAS Cash */}
                  <button
                    onClick={() => handleSort("roas_cash")}
                    className={`px-2 py-2 text-center transition-colors ${sortBy === "roas_cash" ? "bg-lf-yellow/40" : "hover:bg-gray-50"}`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray leading-tight">ROAS Cash</p>
                    <p className={`text-xs font-black mt-0.5 ${roasCash !== "—" && parseFloat(roasCash) >= 3 ? "text-lf-green" : roasCash !== "—" && parseFloat(roasCash) >= 1.5 ? "text-lf-yellow" : ""}`}>
                      {roasCash}
                    </p>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
