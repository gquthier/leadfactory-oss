"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Zap, Users } from "lucide-react";

interface MetaAccount {
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
}

interface MetaData {
  accounts?: MetaAccount[];
}

interface QuickStatsProps {
  clientsThisMonth: number;
  clientsLastMonth: number;
  totalClientsAll: number;
}

export function QuickStats({
  clientsThisMonth,
  clientsLastMonth,
  totalClientsAll,
}: QuickStatsProps) {
  const [metaData, setMetaData] = useState<MetaData | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const res = await fetch("/api/meta/accounts?period=this_month");
        if (res.ok) {
          const json = await res.json() as MetaData;
          setMetaData(json);
        }
      } catch {
        // META token not configured or network error — silently ignore
      } finally {
        setMetaLoading(false);
      }
    };
    fetchMeta();
  }, []);

  const delta = clientsThisMonth - clientsLastMonth;
  const deltaLabel =
    delta > 0
      ? `+${delta} nouveau${delta > 1 ? "x" : ""} client${delta > 1 ? "s" : ""} ce mois`
      : delta < 0
      ? `${delta} client${Math.abs(delta) > 1 ? "s" : ""} de moins ce mois`
      : "Stable vs mois dernier";

  const totalMetaLeads = metaData?.accounts?.reduce((acc, a) => {
    return acc + (Number(a.clicks) || 0);
  }, 0);

  const totalMetaSpend = metaData?.accounts?.reduce((acc, a) => {
    return acc + (Number(a.spend) || 0);
  }, 0);

  return (
    <div className="flex flex-wrap gap-3 mb-8">
      {/* Progression clients */}
      <div className="flex items-center gap-3 card-brutal-sm px-4 py-3 bg-lf-green text-white flex-1 min-w-[200px]">
        <TrendingUp className="w-5 h-5 flex-shrink-0 opacity-80" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider opacity-70">
            Clients
          </p>
          <p className="text-sm font-black leading-tight">{deltaLabel}</p>
        </div>
      </div>

      {/* Total clients */}
      <div className="flex items-center gap-3 card-brutal-sm px-4 py-3 bg-white flex-1 min-w-[160px]">
        <Users className="w-5 h-5 flex-shrink-0 opacity-40" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
            Total clients
          </p>
          <p className="text-2xl font-black leading-none">{totalClientsAll}</p>
        </div>
      </div>

      {/* Meta leads */}
      {!metaLoading && metaData && (
        <div className="flex items-center gap-3 card-brutal-sm px-4 py-3 bg-lf-blue text-white flex-1 min-w-[200px]">
          <Zap className="w-5 h-5 flex-shrink-0 opacity-80" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider opacity-70">
              Meta Ads ce mois
            </p>
            <p className="text-sm font-black leading-tight">
              {totalMetaLeads?.toLocaleString("fr-FR")} clics ·{" "}
              {totalMetaSpend?.toLocaleString("fr-FR", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
              € dépensés
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
