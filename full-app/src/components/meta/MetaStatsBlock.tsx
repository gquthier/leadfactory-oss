"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, TrendingUp, Users, MousePointer, Eye, Zap, DollarSign, Link2, Check, ChevronDown } from "lucide-react";
import type { MetaInsights, MetaAdAccount, DatePreset } from "@/lib/meta-api";

interface Props {
  adAccountId?: string | null;
  campaignId?: string;              // LF campaign UUID
  isAdmin?: boolean;
  availableAccounts?: MetaAdAccount[]; // pour lier un compte (admin only)
  onLinkAccount?: (adAccountId: string) => Promise<void>;
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

function KpiCard({
  label,
  value,
  sub,
  color = "bg-white",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon: React.ElementType;
}) {
  return (
    <div className={`border-3 border-black p-4 ${color}`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-black uppercase tracking-wider opacity-60">{label}</p>
        <Icon className="w-4 h-4 opacity-30" />
      </div>
      <p className="text-2xl font-black leading-none">{value}</p>
      {sub && <p className="text-xs font-medium mt-1 opacity-60">{sub}</p>}
    </div>
  );
}

export function MetaStatsBlock({ adAccountId, campaignId, isAdmin = false, availableAccounts = [], onLinkAccount }: Props) {
  const [period, setPeriod] = useState<DatePreset>("last_30d");
  const [insights, setInsights] = useState<MetaInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lier un compte
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  const fetchStats = useCallback(async (preset: DatePreset) => {
    if (!adAccountId) return;
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

  useEffect(() => {
    if (adAccountId) fetchStats(period);
  }, [adAccountId, period, fetchStats]);

  const handleLink = async () => {
    if (!selectedAccount || !onLinkAccount) return;
    setLinking(true);
    await onLinkAccount(selectedAccount);
    setLinking(false);
    setLinked(true);
    setShowLinkForm(false);
    setTimeout(() => setLinked(false), 3000);
  };

  // Pas de compte lié
  if (!adAccountId) {
    if (!isAdmin) {
      return (
        <div className="card-brutal-sm p-6 text-center bg-gray-50">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-lf-blue opacity-40" />
          <p className="font-black text-sm uppercase">Stats en cours de configuration</p>
          <p className="text-xs text-lf-gray font-medium mt-1">Les données Meta seront disponibles dès que votre campagne est en ligne.</p>
        </div>
      );
    }

    return (
      <div className="card-brutal-sm p-5 bg-lf-yellow">
        <div className="flex items-center justify-between mb-3">
          <p className="font-black text-sm uppercase">Compte Meta non lié</p>
          {linked && <span className="flex items-center gap-1 text-lf-green text-xs font-bold"><Check className="w-3 h-3" /> Lié !</span>}
        </div>
        <p className="text-xs font-medium mb-4">Liez un compte publicitaire Meta pour afficher les stats de cette campagne.</p>

        {!showLinkForm ? (
          <button onClick={() => setShowLinkForm(true)} className="btn-primary text-xs px-4 py-2 flex items-center gap-2">
            <Link2 className="w-3 h-3" /> Lier un compte Meta
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full input-brutal appearance-none pr-8 text-sm"
              >
                <option value="">— Sélectionner un compte —</option>
                {availableAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.account_id}) · {acc.currency}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleLink} disabled={!selectedAccount || linking} className={`flex items-center gap-2 text-xs px-4 py-2 ${!selectedAccount || linking ? "btn-disabled" : "btn-primary"}`}>
                {linking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Confirmer
              </button>
              <button onClick={() => setShowLinkForm(false)} className="btn-secondary text-xs px-4 py-2">Annuler</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header + période */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-lf-green border border-black rounded-full" />
          <p className="font-black text-xs uppercase tracking-wider">Meta Ads · Données live</p>
        </div>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              disabled={loading}
              className={`px-3 py-1 border-2 border-black text-xs font-black uppercase transition-all ${
                period === p.value ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button onClick={() => fetchStats(period)} disabled={loading} className="ml-1 p-1.5 border-2 border-black bg-white hover:bg-gray-50">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-3 border-red-400 text-red-600 text-xs font-bold">{error}</div>
      )}

      {loading && !insights && (
        <div className="flex items-center gap-2 text-lf-gray text-sm font-medium py-4">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Chargement des données Meta...
        </div>
      )}

      {insights && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Leads générés"
              value={fmt(insights.leads)}
              sub={insights.cpl > 0 ? `CPL : ${insights.cpl.toFixed(2)} €` : undefined}
              color="bg-lf-blue text-white"
              icon={Users}
            />
            <KpiCard
              label="Budget dépensé"
              value={`${insights.spend.toFixed(2)} €`}
              color="bg-lf-yellow"
              icon={DollarSign}
            />
            <KpiCard
              label="Impressions"
              value={fmt(insights.impressions)}
              sub={`Portée : ${fmt(insights.reach)}`}
              icon={Eye}
            />
            <KpiCard
              label="CTR"
              value={`${insights.ctr.toFixed(2)}%`}
              sub={`CPC : ${insights.cpc.toFixed(2)} €`}
              icon={MousePointer}
            />
          </div>

          {insights.leads === 0 && (
            <div className="p-3 bg-gray-50 border-3 border-black text-xs font-medium text-lf-gray">
              Aucun lead enregistré sur la période sélectionnée. Essayez "Tout" pour voir l'historique complet.
            </div>
          )}

          <p className="text-xs text-lf-gray font-medium">
            Période analysée : {insights.date_start} → {insights.date_stop}
            {loading && " · Actualisation..."}
          </p>
        </>
      )}

      {!loading && !insights && !error && (
        <div className="p-4 bg-gray-50 border-3 border-black text-xs font-medium text-lf-gray">
          Pas de données sur cette période. Le compte publicitaire n'a peut-être pas de campagnes actives récentes.
        </div>
      )}
    </div>
  );
}
