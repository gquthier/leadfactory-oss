"use client";

import { useState } from "react";
import {
  TrendingUp, Users, MousePointer, Eye, DollarSign, Zap,
  RefreshCw, ExternalLink, ChevronDown, ChevronUp, Download,
  BarChart2, Image as ImageIcon,
} from "lucide-react";
import type { MetaAdAccount, MetaInsights, DatePreset, ConversionBreakdown } from "@/lib/meta-api";
import { SpendLeadsChart } from "@/components/meta/SpendLeadsChart";
import { MetricLineChart } from "@/components/meta/MetricLineChart";
import { CampaignBreakdown } from "@/components/meta/CampaignBreakdown";
import { AdCreativeBreakdown } from "@/components/meta/AdCreativeBreakdown";
import { ExportBriefButton } from "@/components/meta/ExportBriefButton";

type AccountWithInsights = MetaAdAccount & { insights: MetaInsights | null };
type LinkedCampaign = { id: string; name: string; ad_account_id: string; profiles: { company?: string; full_name: string } };
type DetailTab = "summary" | "campaigns" | "creatives";

interface Props {
  initialAccounts: AccountWithInsights[];
  allAccounts: MetaAdAccount[];
  linkedCampaigns: LinkedCampaign[];
}

const PERIODS: Array<{ label: string; value: DatePreset }> = [
  { label: "7 jours",  value: "last_7d"    },
  { label: "30 jours", value: "last_30d"   },
  { label: "90 jours", value: "last_90d"   },
  { label: "Ce mois",  value: "this_month" },
  { label: "Tout",     value: "maximum"    },
];

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtEur(n: number) {
  return `${fmt(n, 2)} €`;
}

/** Compact conversion display for the collapsed account row header */
function ConversionCell({ ins }: { ins: MetaInsights }) {
  const { all_conversions, leads, conversion_label, cpl } = ins;
  const cpaLabel = conversion_label === "Leads" ? "CPL" : conversion_label === "—" ? "CPA" : "CPA";

  // No meaningful conversion tracking (pure awareness/traffic account)
  if (leads === 0 && all_conversions.length === 0) {
    return (
      <div className="text-right">
        <p className="text-xs text-lf-gray font-medium">Conv.</p>
        <p className="font-black text-sm text-lf-gray">—</p>
      </div>
    );
  }

  // Single conversion type
  if (all_conversions.length <= 1) {
    return (
      <div className="text-right">
        <p className="text-xs text-lf-gray font-medium">{conversion_label}</p>
        <p className="font-black text-sm text-lf-blue">{fmt(leads)}</p>
        {cpl > 0 && <p className="text-[10px] text-lf-gray font-medium">{cpaLabel} {fmtEur(cpl)}</p>}
      </div>
    );
  }

  // Multiple conversion types — compact "X A · Y B" display
  return (
    <div className="text-right">
      <p className="text-xs text-lf-gray font-medium">Mixte</p>
      <div className="flex items-center gap-2 justify-end">
        {all_conversions.map((c: ConversionBreakdown) => (
          <span key={c.label} className="text-sm font-black text-lf-blue leading-tight">
            {fmt(c.count)} <span className="text-xs font-medium text-lf-gray">{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StatPill({ label, value, color = "bg-white" }: { label: string; value: string; color?: string }) {
  return (
    <div className={`border-3 border-black p-3 ${color}`}>
      <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">{label}</p>
      <p className="text-xl font-black leading-none">{value}</p>
    </div>
  );
}

function AccountRow({ acc, client, period }: { acc: AccountWithInsights; client?: string; period: DatePreset }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<DetailTab>("summary");
  const ins = acc.insights;

  const TABS: Array<{ key: DetailTab; label: string; icon: React.ElementType }> = [
    { key: "summary",   label: "Résumé",       icon: BarChart2   },
    { key: "campaigns", label: "Campagnes",     icon: TrendingUp  },
    { key: "creatives", label: "Créatives",     icon: ImageIcon   },
  ];

  return (
    <div className="border-3 border-black bg-white overflow-hidden">
      {/* Header row — always visible */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
            <span className="font-black text-white text-xs">{acc.name.charAt(0)}</span>
          </div>
          <div className="min-w-0">
            <p className="font-black text-sm uppercase truncate">{acc.name}</p>
            {client && <p className="text-xs text-lf-blue font-bold">{client}</p>}
            <p className="text-xs text-lf-gray">{acc.account_id} · {acc.currency}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 ml-4 flex-shrink-0">
          {ins ? (
            <div className="hidden sm:flex items-center gap-6 text-right">
              <div>
                <p className="text-xs text-lf-gray font-medium">Dépensé</p>
                <p className="font-black text-sm">{fmtEur(ins.spend)}</p>
              </div>
              {/* Conversion column — adapts to single / mixed / none */}
              <ConversionCell ins={ins} />
              <div>
                <p className="text-xs text-lf-gray font-medium">Impressions</p>
                <p className="font-black text-sm">{fmt(ins.impressions)}</p>
              </div>
            </div>
          ) : (
            <span className="text-xs text-lf-gray font-medium italic">Pas de données sur la période</span>
          )}
          <button className="p-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded — with tabs */}
      {expanded && ins && (
        <div className="border-t-3 border-black">
          {/* Tab selector */}
          <div className="flex border-b-3 border-black">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-black uppercase tracking-wider border-r-3 border-black transition-colors last:border-r-0 ${
                  tab === t.key ? "bg-lf-black text-white" : "bg-gray-50 hover:bg-gray-100"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: Résumé */}
          {tab === "summary" && (
            <div className="bg-gray-50 p-5 flex flex-col gap-4">
              {/* Conversion breakdown — dynamic based on detected types */}
              {ins.all_conversions.length > 1 && (
                <div className="border-3 border-lf-blue bg-lf-blue/5 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-lf-blue mb-2">
                    Conversions détectées ({ins.all_conversions.length} types)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ins.all_conversions.map((c: ConversionBreakdown) => (
                      <div key={c.label} className="border-2 border-lf-blue bg-white px-3 py-1.5 flex items-center gap-2">
                        <span className="text-sm font-black text-lf-blue">{fmt(c.count)}</span>
                        <span className="text-xs font-black uppercase tracking-wider">{c.label}</span>
                        {c.cpa > 0 && <span className="text-xs font-medium text-lf-gray">{fmtEur(c.cpa)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                <StatPill label="Dépensé"     value={fmtEur(ins.spend)}   color="bg-lf-yellow" />
                {ins.all_conversions.length === 0 ? (
                  <StatPill label="Conv." value="—" color="bg-lf-blue text-white" />
                ) : (
                  <StatPill label={ins.conversion_label} value={fmt(ins.leads)} color="bg-lf-blue text-white" />
                )}
                <StatPill label={ins.conversion_label === "Leads" ? "CPL" : "CPA"} value={ins.cpl > 0 ? fmtEur(ins.cpl) : "—"} />
                <StatPill label="CPM"         value={fmtEur(ins.cpm)}                           />
                <StatPill label="Impressions" value={fmt(ins.impressions)}                       />
                <StatPill label="Portée"      value={fmt(ins.reach)}                            />
                <StatPill label="CTR"         value={`${fmt(ins.ctr, 2)}%`}                     />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatPill label="Clics"       value={fmt(ins.clicks)}                           />
                <StatPill label="CPC"         value={fmtEur(ins.cpc)}                           />
                <StatPill label="Taux conv."  value={ins.clicks > 0 ? `${fmt((ins.leads / ins.clicks) * 100, 2)}%` : "—"} />
              </div>
              <p className="text-xs text-lf-gray font-medium">
                Période : {ins.date_start} → {ins.date_stop}
              </p>
              <SpendLeadsChart adAccountId={acc.id} period={period} conversionLabel={ins.conversion_label} />
              <MetricLineChart adAccountId={acc.id} period={period} conversionLabel={ins.conversion_label} />
              <ExportBriefButton adAccountId={acc.id} period={period} accountName={acc.name} />
            </div>
          )}

          {/* Tab: Campagnes */}
          {tab === "campaigns" && (
            <div className="bg-gray-50 p-5">
              <CampaignBreakdown adAccountId={acc.id} period={period} />
            </div>
          )}

          {/* Tab: Créatives */}
          {tab === "creatives" && (
            <div className="bg-gray-50 p-5">
              <AdCreativeBreakdown adAccountId={acc.id} period={period} />
            </div>
          )}
        </div>
      )}

      {expanded && !ins && (
        <div className="border-t-3 border-black bg-gray-50 px-5 py-4 text-sm text-lf-gray font-medium">
          Aucune donnée disponible sur cette période. Le compte n&apos;a peut-être pas de campagnes actives.
        </div>
      )}
    </div>
  );
}

export function MetaHubClient({ initialAccounts, allAccounts, linkedCampaigns }: Props) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [period, setPeriod] = useState<DatePreset>("last_30d");
  const [loading, setLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  // Totaux globaux
  const totals = accounts.reduce(
    (acc, a) => ({
      spend:       acc.spend       + (a.insights?.spend       ?? 0),
      leads:       acc.leads       + (a.insights?.leads       ?? 0),
      impressions: acc.impressions + (a.insights?.impressions ?? 0),
      reach:       acc.reach       + (a.insights?.reach       ?? 0),
      clicks:      acc.clicks      + (a.insights?.clicks      ?? 0),
    }),
    { spend: 0, leads: 0, impressions: 0, reach: 0, clicks: 0 }
  );
  const avgCPL = totals.leads > 0 ? totals.spend / totals.leads : 0;
  const avgCPM = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;

  const handlePeriodChange = async (newPeriod: DatePreset) => {
    setPeriod(newPeriod);
    setLoading(true);
    try {
      const res = await fetch(`/api/meta/accounts?period=${newPeriod}`);
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(`/api/admin/export-leads?period=${period}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      a.download = match?.[1] ?? `leads-export-${period}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setCsvLoading(false);
    }
  };

  // Map compte Meta -> client LF
  const clientByAccount = linkedCampaigns.reduce<Record<string, string>>((map, c) => {
    if (c.ad_account_id) {
      const accountId = c.ad_account_id.startsWith("act_") ? c.ad_account_id : `act_${c.ad_account_id}`;
      map[accountId] = c.profiles?.company || c.profiles?.full_name;
    }
    return map;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {/* Period selector + Export CSV */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-black uppercase tracking-wider text-lf-gray mr-2">Période :</span>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePeriodChange(p.value)}
            disabled={loading}
            className={`px-4 py-2 border-3 border-black text-xs font-black uppercase tracking-wider transition-all ${
              period === p.value ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
            }`}
          >
            {p.label}
          </button>
        ))}
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-lf-gray ml-2" />}

        <div className="ml-auto">
          <button
            onClick={handleExportCSV}
            disabled={csvLoading}
            className="flex items-center gap-2 px-4 py-2 border-3 border-black bg-lf-green text-white text-xs font-black uppercase tracking-wider hover:bg-green-600 transition-all disabled:opacity-60"
          >
            {csvLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Exporter CSV
          </button>
        </div>
      </div>

      {/* KPIs globaux */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="card-brutal-sm p-4 bg-lf-yellow">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider opacity-70 mb-1">Budget dépensé</p>
              <p className="text-3xl font-black leading-none">{fmtEur(totals.spend)}</p>
            </div>
            <DollarSign className="w-6 h-6 opacity-30" />
          </div>
        </div>
        <div className="card-brutal-sm p-4 bg-lf-blue text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider opacity-70 mb-1">Conversions totales</p>
              <p className="text-3xl font-black leading-none">{totals.leads > 0 ? fmt(totals.leads) : "—"}</p>
            </div>
            <Users className="w-6 h-6 opacity-30" />
          </div>
        </div>
        <div className="card-brutal-sm p-4 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">CPA moyen</p>
              <p className="text-3xl font-black leading-none">{avgCPL > 0 ? fmtEur(avgCPL) : "—"}</p>
            </div>
            <Zap className="w-6 h-6 opacity-20" />
          </div>
        </div>
        <div className="card-brutal-sm p-4 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">CPM moyen</p>
              <p className="text-3xl font-black leading-none">{avgCPM > 0 ? fmtEur(avgCPM) : "—"}</p>
            </div>
            <TrendingUp className="w-6 h-6 opacity-20" />
          </div>
        </div>
        <div className="card-brutal-sm p-4 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Impressions</p>
              <p className="text-3xl font-black leading-none">{fmt(totals.impressions)}</p>
            </div>
            <Eye className="w-6 h-6 opacity-20" />
          </div>
        </div>
        <div className="card-brutal-sm p-4 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Clics</p>
              <p className="text-3xl font-black leading-none">{fmt(totals.clicks)}</p>
            </div>
            <MousePointer className="w-6 h-6 opacity-20" />
          </div>
        </div>
      </div>

      {/* Liste des comptes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-black uppercase text-sm tracking-wider">
            Comptes publicitaires ({accounts.length})
          </p>
          <a
            href="https://business.facebook.com/adsmanager"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-bold text-lf-blue hover:underline"
          >
            Ouvrir Ads Manager <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {accounts.length === 0 ? (
          <div className="card-brutal p-6 bg-lf-yellow">
            <p className="font-black text-lg uppercase mb-2">Aucun compte publicitaire trouvé</p>
            <p className="text-sm font-medium mb-4">
              Le token Meta configuré ne donne accès à aucun compte publicitaire.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 btn-primary text-sm"
              >
                Graph API Explorer <ExternalLink className="w-3 h-3" />
              </a>
              <a href="/admin/settings" className="btn-secondary text-sm">Paramètres →</a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {accounts.map((acc) => (
              <AccountRow
                key={acc.id}
                acc={acc}
                client={clientByAccount[acc.id]}
                period={period}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
