"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Users, DollarSign, Eye, MousePointer,
  TrendingUp, Zap, BarChart2, Target, SlidersHorizontal, Euro,
} from "lucide-react";
import type { MetaInsights, DatePreset } from "@/lib/meta-api";
import type { Lead, LeadAggregate } from "@/types";
import { SpendLeadsChart } from "./SpendLeadsChart";
import { MetricLineChart } from "./MetricLineChart";
import { CampaignBreakdown } from "./CampaignBreakdown";
import { AdCreativeBreakdown } from "./AdCreativeBreakdown";
import { ExportBriefButton } from "./ExportBriefButton";

interface Props {
  adAccountId: string;
  campaignId: string;
}

const PERIODS: Array<{ label: string; value: DatePreset }> = [
  { label: "7j", value: "last_7d" },
  { label: "30j", value: "last_30d" },
  { label: "90j", value: "last_90d" },
  { label: "Tout", value: "maximum" },
];

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ── ROAS hero card ────────────────────────────────────────────────────────────
function RoasHero({ roas, totalRevenue, spend }: { roas: number; totalRevenue: number; spend: number }) {
  const isGreat = roas >= 3;
  const isGood = roas >= 1.5;
  const accentColor = isGreat ? "bg-lf-green" : isGood ? "bg-lf-yellow" : "bg-red-400";
  const textColor = isGreat ? "text-lf-green" : isGood ? "text-lf-yellow" : "text-red-400";
  const label = isGreat ? "Excellent" : isGood ? "Correct" : "À améliorer";

  return (
    <div className="border-3 border-black bg-black text-white p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Euro className="w-4 h-4 opacity-50" />
          <p className="text-xs font-black uppercase tracking-wider opacity-60">ROAS — Retour sur investissement</p>
        </div>
        <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider border border-current ${textColor}`}>
          {label}
        </span>
      </div>
      <div className="flex items-end gap-4">
        <p className={`text-5xl font-black leading-none ${textColor}`}>{fmt(roas, 2)}x</p>
        <p className="text-sm font-medium opacity-60 pb-1">
          Pour 1€ dépensé → <span className="font-black opacity-100">{fmt(roas, 2)}€</span> généré
        </p>
      </div>
      <div className={`h-1.5 w-full ${accentColor} opacity-80`} style={{ width: `${Math.min(roas / 5 * 100, 100)}%` }} />
      <div className="flex items-center gap-4 text-xs font-medium opacity-55">
        <span>CA total : <span className="font-black opacity-100 text-white">{fmt(totalRevenue, 0)} €</span></span>
        <span>·</span>
        <span>Budget dépensé : <span className="font-black opacity-100 text-white">{fmt(spend, 2)} €</span></span>
      </div>
    </div>
  );
}

// ── KPI card small ────────────────────────────────────────────────────────────
function KpiSmall({
  label, value, sub, color = "bg-white", icon: Icon,
}: { label: string; value: string; sub?: string; color?: string; icon: React.ElementType }) {
  return (
    <div className={`border-3 border-black p-4 flex flex-col gap-1 ${color}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wider opacity-60">{label}</p>
        <Icon className="w-4 h-4 opacity-25" />
      </div>
      <p className="text-2xl font-black leading-none">{value}</p>
      {sub && <p className="text-xs font-medium opacity-55">{sub}</p>}
    </div>
  );
}

// ── KPI card large ────────────────────────────────────────────────────────────
function KpiLarge({
  label, value, sub, color = "bg-white", icon: Icon,
}: { label: string; value: string; sub?: string; color?: string; icon: React.ElementType }) {
  return (
    <div className={`border-3 border-black p-5 flex flex-col gap-1 ${color}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-black uppercase tracking-wider opacity-60">{label}</p>
        <Icon className="w-5 h-5 opacity-20" />
      </div>
      <p className="text-3xl font-black leading-none">{value}</p>
      {sub && <p className="text-xs font-medium opacity-55 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Efficiency ratio bar ──────────────────────────────────────────────────────
function RatioBar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray">{label}</p>
        <p className="text-sm font-black">{fmt(value, 2)}{unit}</p>
      </div>
      <div className="h-3 bg-gray-100 border-2 border-black">
        <div className="h-full bg-lf-blue transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ClientMetaStats({ adAccountId, campaignId }: Props) {
  const [period, setPeriod] = useState<DatePreset>("last_30d");
  const [insights, setInsights] = useState<MetaInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  const [leadStatsByCampaign, setLeadStatsByCampaign] = useState<Record<string, LeadAggregate> | undefined>(undefined);
  const [leadStatsByAdId, setLeadStatsByAdId] = useState<Record<string, LeadAggregate> | undefined>(undefined);

  // Fetch revenue once (all leads, all time)
  useEffect(() => {
    fetch("/api/client/leads?limit=1000")
      .then((r) => r.json())
      .then((data) => {
        if (data.leads) {
          const sum = (data.leads as Lead[]).reduce(
            (acc: number, l: Lead) => acc + (l.revenue ?? 0),
            0
          );
          setTotalRevenue(sum);
        }
      })
      .catch(() => {/* silent fail */});
  }, []);

  // Fetch lead aggregates for breakdowns
  useEffect(() => {
    fetch(`/api/admin/leads/aggregated?campaign_id=${campaignId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.byCampaignName) setLeadStatsByCampaign(data.byCampaignName);
        if (data.byAdId) setLeadStatsByAdId(data.byAdId);
      })
      .catch(() => {/* silent fail */});
  }, [campaignId]);

  const fetchStats = useCallback(async (preset: DatePreset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meta/campaign-stats?ad_account_id=${encodeURIComponent(adAccountId)}&period=${preset}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInsights(data.summary);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => { fetchStats(period); }, [period, fetchStats]);

  const roas = totalRevenue > 0 && insights && insights.spend > 0
    ? totalRevenue / insights.spend
    : null;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Period selector */}
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              disabled={loading}
              className={`px-3 py-1.5 border-2 border-black text-xs font-black uppercase transition-all ${
                period === p.value ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => fetchStats(period)}
            disabled={loading}
            className="ml-1 p-1.5 border-2 border-black bg-white hover:bg-gray-50"
            title="Actualiser"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Right side: export + mode toggle */}
        <div className="flex items-center gap-2 flex-wrap">
        <ExportBriefButton adAccountId={adAccountId} period={period} />

        {/* Mode toggle */}
        <div className="flex items-center border-3 border-black overflow-hidden">
          <button
            onClick={() => setMode("simple")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase transition-all ${
              mode === "simple" ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
            }`}
          >
            <Zap className="w-3 h-3" />
            Simple
          </button>
          <button
            onClick={() => setMode("advanced")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase border-l-3 border-black transition-all ${
              mode === "advanced" ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Avancé
          </button>
        </div>
        </div>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 bg-lf-green border border-black rounded-full" />
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray">Meta Ads · Données live</p>
        {insights && (
          <span className="text-xs text-lf-gray font-medium">
            · {insights.date_start} → {insights.date_stop}
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-3 border-red-400 text-red-600 text-xs font-bold">{error}</div>
      )}

      {loading && !insights && (
        <div className="flex items-center gap-2 text-lf-gray text-sm font-medium py-6 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Chargement des données Meta...
        </div>
      )}

      {/* ── SIMPLE MODE ── */}
      {mode === "simple" && insights && (
        <div className="flex flex-col gap-4">

          {/* ROAS hero — shown only if revenue data exists */}
          {roas !== null && (
            <RoasHero roas={roas} totalRevenue={totalRevenue} spend={insights.spend} />
          )}

          {/* 2 big hero KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <KpiLarge
              label={insights.conversion_label === "—" ? "Conversions" : insights.conversion_label}
              value={insights.leads > 0 ? fmt(insights.leads) : "—"}
              sub={
                insights.leads === 0
                  ? "Aucun suivi de conversion détecté"
                  : insights.cpl > 0
                  ? `${insights.conversion_label === "Leads" ? "CPL" : "CPA"} : ${fmt(insights.cpl, 2)} €`
                  : undefined
              }
              color="bg-lf-blue text-white"
              icon={Users}
            />
            <KpiLarge
              label="Budget dépensé"
              value={`${fmt(insights.spend, 2)} €`}
              sub={insights.leads > 0 && insights.conversion_label !== "—" ? `${fmt(insights.leads)} ${insights.conversion_label.toLowerCase()}` : undefined}
              color="bg-lf-yellow"
              icon={DollarSign}
            />
          </div>

          {/* 2 secondary KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <KpiSmall
              label="Impressions"
              value={fmt(insights.impressions)}
              sub={`Portée : ${fmt(insights.reach)}`}
              icon={Eye}
            />
            <KpiSmall
              label="CTR"
              value={`${fmt(insights.ctr, 2)} %`}
              sub={`CPC : ${fmt(insights.cpc, 2)} €`}
              icon={MousePointer}
            />
          </div>

          {insights.leads === 0 && (
            <p className="text-xs font-medium text-lf-gray p-3 bg-gray-50 border-3 border-black">
              Aucun lead enregistré sur cette période. Essayez &ldquo;Tout&rdquo; pour voir l&apos;historique complet.
            </p>
          )}

          {/* Charts */}
          <SpendLeadsChart adAccountId={adAccountId} period={period} conversionLabel={insights.conversion_label} />
          <MetricLineChart adAccountId={adAccountId} period={period} conversionLabel={insights.conversion_label} />
        </div>
      )}

      {/* ── ADVANCED MODE ── */}
      {mode === "advanced" && insights && (
        <div className="flex flex-col gap-6">

          {/* ROAS hero */}
          {roas !== null && (
            <RoasHero roas={roas} totalRevenue={totalRevenue} spend={insights.spend} />
          )}

          {/* Section 1 : KPIs leads + coûts */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <Target className="w-3.5 h-3.5" />
              Leads &amp; coûts
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <KpiSmall label={insights.conversion_label === "—" ? "Conversions" : insights.conversion_label} value={insights.leads > 0 ? fmt(insights.leads) : "—"} color="bg-lf-blue text-white" icon={Users} />
              <KpiSmall label={insights.conversion_label === "Leads" ? "CPL" : "CPA"} value={insights.cpl > 0 ? `${fmt(insights.cpl, 2)} €` : "—"} sub={insights.leads > 0 ? `Coût par ${(insights.conversion_label === "—" ? "conversion" : insights.conversion_label).toLowerCase()}` : "Pas de suivi"} color="bg-lf-yellow" icon={DollarSign} />
              <KpiSmall label="Dépensé" value={`${fmt(insights.spend, 2)} €`} icon={DollarSign} />
            </div>
          </div>

          {/* Section 2 : Revenus (if data available) */}
          {totalRevenue > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
                <Euro className="w-3.5 h-3.5" />
                Revenus générés
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <KpiSmall
                  label="CA total"
                  value={`${fmt(totalRevenue, 0)} €`}
                  sub="Tous les leads"
                  color="bg-black text-white"
                  icon={Euro}
                />
                <KpiSmall
                  label="CA moy. / lead"
                  value={insights.leads > 0 ? `${fmt(totalRevenue / insights.leads, 0)} €` : "—"}
                  sub="Par lead converti"
                  icon={TrendingUp}
                />
                <KpiSmall
                  label="ROAS"
                  value={roas !== null ? `${fmt(roas, 2)}x` : "—"}
                  sub="Retour sur investissement"
                  color={roas !== null && roas >= 3 ? "bg-lf-green text-white" : roas !== null && roas >= 1.5 ? "bg-lf-yellow" : "bg-white"}
                  icon={TrendingUp}
                />
              </div>
            </div>
          )}

          {/* Section 3 : Diffusion */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <Eye className="w-3.5 h-3.5" />
              Diffusion
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiSmall label="Impressions" value={fmt(insights.impressions)} icon={Eye} />
              <KpiSmall label="Portée" value={fmt(insights.reach)} sub="Personnes uniques" icon={Users} />
              <KpiSmall label="Clics" value={fmt(insights.clicks)} icon={MousePointer} />
              <KpiSmall label="CPM" value={`${fmt(insights.cpm, 2)} €`} sub="Pour 1000 imp." icon={TrendingUp} />
            </div>
          </div>

          {/* Section 4 : Performance */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5" />
              Performance &amp; engagement
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <KpiSmall label="CTR" value={`${fmt(insights.ctr, 2)} %`} sub="Taux de clic" icon={MousePointer} />
              <KpiSmall label="CPC" value={`${fmt(insights.cpc, 2)} €`} sub="Coût par clic" icon={DollarSign} />
              <KpiSmall
                label="Taux de conv."
                value={insights.clicks > 0 ? `${fmt((insights.leads / insights.clicks) * 100, 2)} %` : "—"}
                sub={`Clics → ${insights.conversion_label}`}
                icon={Target}
              />
            </div>
          </div>

          {/* Section 5 : Ratios visuels */}
          <div className="card-brutal-sm p-5">
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-4 flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Efficacité relative
            </p>
            <div className="flex flex-col gap-4">
              {roas !== null && (
                <RatioBar label="ROAS (objectif 3x)" value={roas} max={5} unit="x" />
              )}
              <RatioBar label="CTR (% de clics)" value={insights.ctr} max={10} unit=" %" />
              <RatioBar label={`Taux de conversion (clics → ${insights.conversion_label.toLowerCase()})`} value={insights.clicks > 0 ? (insights.leads / insights.clicks) * 100 : 0} max={20} unit=" %" />
              <RatioBar label="CPM (coût visibilité)" value={insights.cpm} max={30} unit=" €" />
            </div>
          </div>

          {/* Section 6 : Par campagne */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5" />
              Par campagne
            </p>
            <CampaignBreakdown adAccountId={adAccountId} period={period} leadStats={leadStatsByCampaign} />
          </div>

          {/* Section 7 : Par créative */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5" />
              Par créative
            </p>
            <AdCreativeBreakdown adAccountId={adAccountId} period={period} leadStats={leadStatsByAdId} />
          </div>

          {/* Section 8 : Évolution graphique */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" />
              Évolution jour par jour
            </p>
            <SpendLeadsChart adAccountId={adAccountId} period={period} conversionLabel={insights.conversion_label} />
          </div>

          {/* Section 9 : Courbes de tendance */}
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" />
              Courbes de tendance
            </p>
            <MetricLineChart adAccountId={adAccountId} period={period} conversionLabel={insights.conversion_label} />
          </div>
        </div>
      )}

      {!loading && !insights && !error && (
        <div className="p-4 bg-gray-50 border-3 border-black text-xs font-medium text-lf-gray">
          Pas de données sur cette période. Le compte publicitaire n&apos;a peut-être pas de campagnes actives récentes.
        </div>
      )}
    </div>
  );
}
