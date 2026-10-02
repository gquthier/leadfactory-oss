"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Download, X, RefreshCw } from "lucide-react";
import {
  CANONICAL_CAMPAIGN_STATUSES,
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  type CanonicalCampaignStatus,
  type Campaign,
} from "@/types/index";

type CampaignWithProfile = Campaign & {
  profiles: { full_name: string; company: string; email: string };
  meta_campaign_id?: string | null;
};
type ClientProfile = { id: string; full_name: string; company: string | null; email: string };

type SortKey = "date" | "budget";
type SortDir = "asc" | "desc";

const ALL_STATUSES: Array<CanonicalCampaignStatus | "all"> = [
  "all",
  ...CANONICAL_CAMPAIGN_STATUSES,
];

// Meta ad accounts list fetched client-side
interface MetaAccount { id: string; name: string }

interface ImportModalProps {
  clients: ClientProfile[];
  onClose: () => void;
  onSuccess: () => void;
}

function ImportMetaModal({ clients, onClose, onSuccess }: ImportModalProps) {
  const [clientId, setClientId] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMetaAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/meta/accounts");
      const data = await res.json();
      setMetaAccounts(
        (data.accounts ?? []).map((a: Record<string, unknown>) => ({
          id: String(a.id),
          name: String(a.name),
        }))
      );
    } catch {
      setError("Impossible de charger les comptes Meta");
    } finally {
      setLoadingAccounts(false);
    }
  };

  // Load accounts on mount
  useState(() => { loadMetaAccounts(); });

  const handleImport = async () => {
    if (!clientId || !adAccountId) {
      setError("Sélectionne un client et un compte Meta");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import-meta-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, ad_account_id: adAccountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur import");
      } else {
        setResult(`${data.inserted} campagnes importées, ${data.updated} mises à jour`);
        setTimeout(() => { onSuccess(); onClose(); }, 2000);
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-canvas border-3 border-black shadow-brutal w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b-3 border-black">
          <h2 className="font-black uppercase tracking-tight text-lg">Importer depuis Meta</h2>
          <button onClick={onClose} type="button"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-lf-gray font-medium">
            Sélectionne le client et le compte publicitaire Meta à importer.
            Les campagnes actives/pausées seront créées dans l'app avec leurs vrais noms et budgets.
          </p>

          {/* Sélect client */}
          <div>
            <label className="label-brutal">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="input-brutal text-sm"
            >
              <option value="">— Choisir un client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.full_name} ({c.email})
                </option>
              ))}
            </select>
          </div>

          {/* Sélect compte Meta */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label-brutal mb-0">Compte publicitaire Meta</label>
              <button
                onClick={loadMetaAccounts}
                className="text-xs font-bold text-lf-blue hover:underline flex items-center gap-1"
                type="button"
              >
                <RefreshCw className={`w-3 h-3 ${loadingAccounts ? "animate-spin" : ""}`} />
                Actualiser
              </button>
            </div>
            {loadingAccounts ? (
              <div className="input-brutal text-sm text-gray-400">Chargement...</div>
            ) : (
              <select
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                className="input-brutal text-sm"
              >
                <option value="">— Choisir un compte —</option>
                {metaAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-500 px-3 py-2 text-sm font-bold text-red-600">
              {error}
            </div>
          )}
          {result && (
            <div className="bg-lf-green border-2 border-black px-3 py-2 text-sm font-bold text-white">
              ✓ {result}
            </div>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t-3 border-black">
          <button
            onClick={handleImport}
            disabled={importing || !clientId || !adAccountId}
            className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
            type="button"
          >
            {importing ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Import en cours...</>
            ) : (
              <><Download className="w-4 h-4" /> Importer les campagnes</>
            )}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm" type="button">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  campaigns: CampaignWithProfile[];
  clients: ClientProfile[];
}

export function CampaignsClient({ campaigns: initialCampaigns, clients }: Props) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CanonicalCampaignStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showImport, setShowImport] = useState(false);

  const filtered = useMemo(() => {
    let list = [...campaigns];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => {
        const client = (c.profiles?.company || c.profiles?.full_name || "").toLowerCase();
        return client.includes(q) || c.name.toLowerCase().includes(q) || (c.profiles?.email || "").toLowerCase().includes(q);
      });
    }
    if (statusFilter !== "all") {
      list = list.filter((c) => getCanonicalCampaignStatus(c) === statusFilter);
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sortKey === "budget") cmp = (a.budget_monthly ?? 0) - (b.budget_monthly ?? 0);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [campaigns, search, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return <span className="opacity-30 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  const handleImportSuccess = () => {
    // Reload page to get fresh data
    window.location.reload();
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="sticker -rotate-1 inline-block mb-3">MEDIA BUYING</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Campagnes</h1>
          <p className="text-lf-gray font-medium mt-1">
            {filtered.length} campagne{filtered.length !== 1 ? "s" : ""}
            {filtered.length !== campaigns.length && <span className="ml-1 text-xs">(sur {campaigns.length})</span>}
          </p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="btn-blue flex items-center gap-2 text-sm px-5 py-3"
          type="button"
        >
          <Download className="w-4 h-4" />
          Importer depuis Meta
        </button>
      </div>

      {/* Barre de recherche */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="RECHERCHER PAR CLIENT OU CAMPAGNE..."
          className="input-brutal w-full max-w-md text-sm font-bold uppercase placeholder:font-medium placeholder:normal-case"
        />
      </div>

      {/* Filtres statut */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 border-3 border-black text-xs font-black uppercase tracking-wider transition-all ${
              statusFilter === s ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
            }`}
          >
            {s === "all" ? "Tous" : getCampaignStatusLabel(s)}
          </button>
        ))}
      </div>

      {/* Tri */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Trier par :</span>
        {(["date", "budget"] as SortKey[]).map((key) => (
          <button
            key={key}
            onClick={() => toggleSort(key)}
            className={`px-3 py-1.5 border-3 border-black text-xs font-black uppercase tracking-wider transition-all ${
              sortKey === key ? "bg-lf-yellow text-black" : "bg-white hover:bg-gray-50"
            }`}
          >
            {key === "date" ? "Date" : "Budget"} {sortArrow(key)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card-brutal overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-lf-black text-white">
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">Client</th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">Campagne</th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">Statut</th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">Budget</th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider">Date</th>
              <th className="w-[112px] px-4 py-3 text-right text-xs font-black uppercase tracking-wider">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y-3 divide-black">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-bold text-sm">{c.profiles?.company || c.profiles?.full_name}</p>
                  <p className="text-xs text-lf-gray">{c.profiles?.email}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-black text-sm uppercase">{c.name}</p>
                  {c.meta_campaign_id && (
                    <p className="text-xs text-lf-blue font-mono mt-0.5">
                      Meta #{c.meta_campaign_id}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-black px-2 py-1 border-2 border-black ${getCampaignStatusColor(c)}`}>
                    {getCampaignStatusLabel(c)}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm font-bold">
                  {c.budget_monthly ? `${c.budget_monthly}€/mois` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-lf-gray">
                  {new Date(c.created_at).toLocaleDateString("fr-FR")}
                </td>
                <td className="w-[112px] px-4 py-3 text-right align-middle">
                  <Link
                    href={`/admin/campaigns/${c.id}`}
                    className="inline-flex items-center justify-center gap-1 whitespace-nowrap border-3 border-black bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wider leading-none transition-colors hover:bg-lf-yellow"
                  >
                    Gérer <span aria-hidden="true">→</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="p-12 text-center">
            <p className="text-lf-gray font-medium mb-3">
              {campaigns.length === 0 ? "Aucune campagne. Importe-les depuis Meta ↗" : "Aucun résultat."}
            </p>
            {campaigns.length === 0 && (
              <button onClick={() => setShowImport(true)} className="btn-blue text-sm px-5 py-3" type="button">
                <Download className="w-4 h-4 inline mr-2" />
                Importer depuis Meta
              </button>
            )}
          </div>
        )}
      </div>

      {showImport && (
        <ImportMetaModal
          clients={clients}
          onClose={() => setShowImport(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
}
