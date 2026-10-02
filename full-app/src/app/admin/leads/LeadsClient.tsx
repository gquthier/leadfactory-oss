"use client";

import { useState, useMemo } from "react";
import {
  Table2,
  LayoutGrid,
  List,
  BarChart3,
  RefreshCw,
  Star,
  ChevronDown,
  MessageSquare,
  X,
  Search,
  AlertTriangle,
  CheckCircle2,
  Euro,
  Download,
} from "lucide-react";
import type { Lead, LeadStatus } from "@/types/index";
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from "@/types/index";

interface Campaign {
  id: string;
  name: string;
  ad_account_id: string | null;
  client_id?: string | null;
}

interface Client {
  id: string;
  full_name: string;
  company: string | null;
}

interface SyncResult {
  inserted: number;
  updated: number;
  errors: { campaign: string; error: string }[];
}

interface Props {
  leads: Lead[];
  campaigns: Campaign[];
  clients: Client[];
}

const STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost"];

type ViewMode = "table" | "kanban" | "compact" | "stats";

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-block text-xs font-black uppercase tracking-wide px-2 py-0.5 border border-black ${LEAD_STATUS_COLORS[status]}`}>
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

function QualityStars({
  score,
  onChange,
}: {
  score: number | null;
  onChange?: (v: number) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange?.(n)}
          className={`transition-colors ${onChange ? "cursor-pointer" : "cursor-default"}`}
          title={`Qualité ${n}`}
          type="button"
        >
          <Star
            className={`w-3.5 h-3.5 ${
              score !== null && n <= score
                ? score >= 4
                  ? "fill-lf-green text-lf-green"
                  : score >= 3
                  ? "fill-lf-yellow text-lf-yellow"
                  : "fill-red-400 text-red-400"
                : "text-gray-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function StatusDropdown({
  current,
  onChange,
}: {
  current: LeadStatus;
  onChange: (s: LeadStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1"
        type="button"
      >
        <StatusBadge status={current} />
        <ChevronDown className="w-3 h-3 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border-3 border-black shadow-brutal min-w-[130px]">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs font-bold uppercase hover:bg-gray-50 ${
                s === current ? "bg-gray-100" : ""
              }`}
              type="button"
            >
              {LEAD_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function MoneyCell({
  leadId, value, onSave, title,
}: { leadId: string; value: number | null; onSave: (id: string, val: number | null) => void; title: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  const commit = () => {
    const parsed = draft.trim() === "" ? null : parseFloat(draft.replace(",", "."));
    onSave(leadId, isNaN(parsed as number) ? null : parsed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          className="w-20 border-2 border-lf-blue px-2 py-0.5 text-xs font-bold focus:outline-none"
          placeholder="0.00"
        />
        <span className="text-xs text-gray-400">€</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 border-2 transition-colors ${
        value != null
          ? "border-lf-green bg-green-50 text-lf-green hover:bg-green-100"
          : "border-dashed border-gray-300 text-gray-400 hover:border-lf-blue hover:text-lf-blue"
      }`}
      title={title}
    >
      {value != null ? (
        <><Euro className="w-3 h-3" />{fmt(value, 0)}</>
      ) : (
        <><Euro className="w-3 h-3 opacity-40" /><span>—</span></>
      )}
    </button>
  );
}

function NoteModal({
  lead,
  onSave,
  onClose,
}: {
  lead: Lead;
  onSave: (notes: string) => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-canvas border-3 border-black shadow-brutal w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b-3 border-black">
          <h3 className="font-black uppercase text-sm">
            Note — {lead.full_name ?? lead.email ?? "Lead"}
          </h3>
          <button onClick={onClose} type="button" className="hover:bg-gray-100 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="textarea-brutal w-full h-32 text-sm"
            placeholder="Ajouter une note..."
          />
        </div>
        <div className="flex gap-2 p-4 border-t-3 border-black">
          <button onClick={() => onSave(notes)} className="btn-primary flex-1 text-sm" type="button">
            Sauvegarder
          </button>
          <button onClick={onClose} className="btn-secondary text-sm" type="button">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sync Result Banner ────────────────────────────────────────────────────────

function SyncBanner({
  result,
  onDismiss,
}: {
  result: SyncResult;
  onDismiss: () => void;
}) {
  const hasErrors = result.errors.length > 0;
  return (
    <div className={`border-3 border-black p-3 flex flex-col gap-2 ${hasErrors ? "bg-lf-yellow" : "bg-lf-green/20"}`}>
      {/* Summary row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasErrors ? (
            <AlertTriangle className="w-4 h-4 flex-none text-orange-600" />
          ) : (
            <CheckCircle2 className="w-4 h-4 flex-none text-lf-green" />
          )}
          <span className="text-sm font-black">
            {result.inserted} nouveau{result.inserted !== 1 ? "x" : ""},{" "}
            {result.updated} mis à jour
            {hasErrors && (
              <span className="text-orange-700 ml-2">
                — {result.errors.length} erreur{result.errors.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
        </div>
        <button
          onClick={onDismiss}
          type="button"
          className="p-1 hover:bg-black/10 rounded flex-none"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Error details */}
      {hasErrors && (
        <div className="flex flex-col gap-1 pl-6">
          {result.errors.map((err, i) => (
            <div key={i} className="text-xs font-medium text-orange-800 border-l-2 border-orange-500 pl-2">
              <span className="font-black">{err.campaign}</span> — {err.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({
  leads,
  onStatusChange,
  onQualityChange,
  onNoteClick,
  onRevenueSave,
  onCashSave,
}: {
  leads: Lead[];
  onStatusChange: (id: string, s: LeadStatus) => void;
  onQualityChange: (id: string, q: number) => void;
  onNoteClick: (lead: Lead) => void;
  onRevenueSave: (id: string, val: number | null) => void;
  onCashSave: (id: string, val: number | null) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-3 border-black bg-lf-black text-white">
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Nom</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Email</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Téléphone</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Campagne</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Statut</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Qualité</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden lg:table-cell">
              <span className="flex items-center gap-1"><Euro className="w-3 h-3 text-lf-yellow" />CA</span>
            </th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden xl:table-cell">
              <span className="flex items-center gap-1"><Euro className="w-3 h-3 text-lf-green" />Cash</span>
            </th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Date</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => (
            <tr
              key={lead.id}
              className={`border-b border-black/10 hover:bg-gray-50 ${
                i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
              }`}
            >
              <td className="px-4 py-3 font-bold">
                {lead.full_name ?? <span className="text-gray-400 font-normal">—</span>}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {lead.email ?? <span className="text-gray-400">—</span>}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {lead.phone ?? <span className="text-gray-400">—</span>}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs font-bold uppercase text-gray-600">
                  {lead.campaigns?.name ?? lead.meta_campaign_name ?? "—"}
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusDropdown
                  current={lead.status}
                  onChange={(s) => onStatusChange(lead.id, s)}
                />
              </td>
              <td className="px-4 py-3">
                <QualityStars
                  score={lead.quality_score}
                  onChange={(q) => onQualityChange(lead.id, q)}
                />
              </td>
              <td className="px-4 py-3 hidden lg:table-cell">
                <MoneyCell leadId={lead.id} value={lead.revenue ?? null} onSave={onRevenueSave} title="CA (valeur contrat)" />
              </td>
              <td className="px-4 py-3 hidden xl:table-cell">
                <MoneyCell leadId={lead.id} value={lead.cash_collected ?? null} onSave={onCashSave} title="Cash reçu (acompte)" />
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {lead.meta_created_at
                  ? new Date(lead.meta_created_at).toLocaleDateString("fr-FR")
                  : new Date(lead.created_at).toLocaleDateString("fr-FR")}
              </td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onNoteClick(lead)}
                  className={`p-1.5 border-2 border-transparent hover:border-black hover:bg-lf-yellow transition-colors ${
                    lead.notes ? "text-lf-blue" : "text-gray-400"
                  }`}
                  title="Notes"
                  type="button"
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {leads.length === 0 && (
        <div className="py-16 text-center text-gray-400 font-bold uppercase tracking-wide">
          Aucun lead trouvé
        </div>
      )}
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────

function KanbanView({
  leads,
  onStatusChange,
}: {
  leads: Lead[];
  onStatusChange: (id: string, s: LeadStatus) => void;
}) {
  const byStatus = useMemo(() => {
    const map: Record<LeadStatus, Lead[]> = {
      new: [], contacted: [], qualified: [], converted: [], lost: [],
    };
    for (const lead of leads) map[lead.status].push(lead);
    return map;
  }, [leads]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUSES.map((status) => (
        <div key={status} className="flex-none w-64">
          <div className={`flex items-center justify-between px-3 py-2 border-3 border-black mb-2 ${LEAD_STATUS_COLORS[status]}`}>
            <span className="font-black uppercase text-xs tracking-wide">
              {LEAD_STATUS_LABELS[status]}
            </span>
            <span className="font-black text-sm">{byStatus[status].length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {byStatus[status].map((lead) => (
              <div key={lead.id} className="bg-white border-3 border-black p-3 shadow-brutal-xs hover:-translate-y-0.5 transition-transform">
                <p className="font-black text-sm">{lead.full_name ?? "—"}</p>
                <p className="text-xs text-gray-600 mt-0.5">{lead.email ?? "—"}</p>
                {lead.company && (
                  <p className="text-xs font-bold uppercase text-gray-500 mt-1">{lead.company}</p>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <QualityStars score={lead.quality_score} />
                  <select
                    value={lead.status}
                    onChange={(e) => onStatusChange(lead.id, e.target.value as LeadStatus)}
                    className="text-xs border border-black px-1.5 py-0.5 bg-white font-bold uppercase cursor-pointer"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                {lead.meta_created_at && (
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(lead.meta_created_at).toLocaleDateString("fr-FR")}
                  </p>
                )}
              </div>
            ))}
            {byStatus[status].length === 0 && (
              <div className="border-3 border-dashed border-black/20 p-4 text-center text-xs text-gray-400 uppercase font-bold">
                Vide
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Compact View ─────────────────────────────────────────────────────────────

function CompactView({
  leads,
  onStatusChange,
  onQualityChange,
}: {
  leads: Lead[];
  onStatusChange: (id: string, s: LeadStatus) => void;
  onQualityChange: (id: string, q: number) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-black/10 border-3 border-black">
      {leads.map((lead) => (
        <div key={lead.id} className="flex items-center gap-4 px-4 py-2 hover:bg-gray-50">
          <div className="flex-1 min-w-0">
            <span className="font-black text-sm mr-2">{lead.full_name ?? "—"}</span>
            <span className="text-xs text-gray-500">{lead.email ?? ""}</span>
            {lead.phone && <span className="text-xs text-gray-400 ml-2">{lead.phone}</span>}
          </div>
          <StatusDropdown current={lead.status} onChange={(s) => onStatusChange(lead.id, s)} />
          <QualityStars score={lead.quality_score} onChange={(q) => onQualityChange(lead.id, q)} />
          <span className="text-xs text-gray-400 w-20 text-right flex-none">
            {lead.meta_created_at
              ? new Date(lead.meta_created_at).toLocaleDateString("fr-FR")
              : new Date(lead.created_at).toLocaleDateString("fr-FR")}
          </span>
        </div>
      ))}
      {leads.length === 0 && (
        <div className="py-12 text-center text-gray-400 font-bold uppercase tracking-wide text-sm">
          Aucun lead
        </div>
      )}
    </div>
  );
}

// ─── Stats View ───────────────────────────────────────────────────────────────

function StatsView({ leads }: { leads: Lead[] }) {
  const total = leads.length;
  const byStatus = useMemo(() => {
    const map: Record<LeadStatus, number> = {
      new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0,
    };
    for (const l of leads) map[l.status]++;
    return map;
  }, [leads]);

  const converted = byStatus.converted;
  const convRate = total > 0 ? ((converted / total) * 100).toFixed(1) : "0";
  const scored = leads.filter((l) => l.quality_score !== null);
  const avgQuality =
    scored.length > 0
      ? (scored.reduce((sum, l) => sum + (l.quality_score ?? 0), 0) / scored.length).toFixed(1)
      : null;

  const kpis = [
    { label: "Total leads", value: total, color: "bg-lf-blue text-white" },
    { label: "Convertis", value: converted, color: "bg-lf-green text-white" },
    { label: "Taux conversion", value: `${convRate}%`, color: "bg-lf-yellow text-black" },
    { label: "Qualité moyenne", value: avgQuality ? `${avgQuality}/5` : "—", color: "bg-purple-500 text-white" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(({ label, value, color }) => (
          <div key={label} className={`border-3 border-black p-4 shadow-brutal ${color}`}>
            <p className="text-xs font-black uppercase tracking-wide opacity-80">{label}</p>
            <p className="text-3xl font-black mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className="border-3 border-black bg-white p-5 shadow-brutal">
        <h3 className="font-black uppercase tracking-wide text-sm mb-4">Répartition par statut</h3>
        <div className="space-y-3">
          {STATUSES.map((status) => {
            const count = byStatus[status];
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={status} className="flex items-center gap-3">
                <div className="w-24 flex-none">
                  <StatusBadge status={status} />
                </div>
                <div className="flex-1 bg-gray-100 border border-black h-6 relative">
                  <div
                    className={`h-full ${LEAD_STATUS_COLORS[status].split(" ")[0]} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-16 text-right">
                  <span className="font-black text-sm">{count}</span>
                  <span className="text-xs text-gray-500 ml-1">({pct.toFixed(0)}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LeadsClient({ leads: initialLeads, campaigns, clients }: Props) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [view, setView] = useState<ViewMode>("table");
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "all">("all");
  const [filterCampaign, setFilterCampaign] = useState<string>("all");
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterCreative, setFilterCreative] = useState<string>("all");
  const [filterQuality, setFilterQuality] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [noteModal, setNoteModal] = useState<Lead | null>(null);

  const uniqueCreatives = useMemo(() => {
    return Array.from(new Set(leads.map((l) => l.meta_form_name).filter(Boolean))) as string[];
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (filterStatus !== "all" && lead.status !== filterStatus) return false;
      if (filterCampaign !== "all" && lead.campaign_id !== filterCampaign) return false;
      if (filterClient !== "all" && lead.client_id !== filterClient) return false;
      if (filterCreative !== "all" && lead.meta_form_name !== filterCreative) return false;
      if (filterQuality > 0 && (lead.quality_score === null || lead.quality_score < filterQuality)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          lead.full_name?.toLowerCase().includes(q) ||
          lead.email?.toLowerCase().includes(q) ||
          lead.phone?.includes(q) ||
          lead.company?.toLowerCase().includes(q) ||
          false
        );
      }
      return true;
    });
  }, [leads, filterStatus, filterCampaign, filterClient, filterCreative, filterQuality, search]);

  const handleExportCSV = () => {
    const BOM = "\uFEFF";
    const headers = ["Nom", "Email", "Téléphone", "Entreprise", "Campagne", "Créative", "Statut", "Qualité", "CA (€)", "Cash (€)", "Date", "Notes"];
    const rows = filteredLeads.map((l) => [
      l.full_name ?? "",
      l.email ?? "",
      l.phone ?? "",
      l.company ?? "",
      l.campaigns?.name ?? l.meta_campaign_name ?? "",
      l.meta_form_name ?? "",
      LEAD_STATUS_LABELS[l.status],
      l.quality_score != null ? String(l.quality_score) : "",
      l.revenue != null ? String(l.revenue) : "",
      l.cash_collected != null ? String(l.cash_collected) : "",
      l.meta_created_at
        ? new Date(l.meta_created_at).toLocaleDateString("fr-FR")
        : new Date(l.created_at).toLocaleDateString("fr-FR"),
      l.notes ?? "",
    ]);
    const csv = BOM + [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const body = filterCampaign !== "all" ? { campaign_id: filterCampaign } : {};
      const res = await fetch("/api/admin/leads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({
          inserted: data.inserted ?? 0,
          updated: data.updated ?? 0,
          errors: data.errors ?? [],
        });
        const leadsRes = await fetch(
          filterCampaign !== "all" ? `/api/admin/leads?campaign_id=${filterCampaign}` : "/api/admin/leads"
        );
        const leadsData = await leadsRes.json();
        if (leadsRes.ok) setLeads(leadsData.leads);
      } else {
        setSyncResult({ inserted: 0, updated: 0, errors: [{ campaign: "Sync", error: data.error ?? "Erreur inconnue" }] });
      }
    } catch {
      setSyncResult({ inserted: 0, updated: 0, errors: [{ campaign: "Sync", error: "Erreur de connexion" }] });
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = async (id: string, status: LeadStatus) => {
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, status } : l));
    await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  };

  const handleRevenueSave = async (id: string, revenue: number | null) => {
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, revenue } : l));
    await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revenue }),
    });
  };

  const handleCashSave = async (id: string, cash_collected: number | null) => {
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, cash_collected } : l));
    await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cash_collected }),
    });
  };

  const handleQualityChange = async (id: string, quality_score: number) => {
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, quality_score } : l));
    await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality_score }),
    });
  };

  const handleNoteSave = async (notes: string) => {
    if (!noteModal) return;
    const id = noteModal.id;
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, notes } : l));
    setNoteModal(null);
    await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
  };

  const VIEWS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "table", icon: <Table2 className="w-4 h-4" />, label: "Table" },
    { mode: "kanban", icon: <LayoutGrid className="w-4 h-4" />, label: "Kanban" },
    { mode: "compact", icon: <List className="w-4 h-4" />, label: "Compact" },
    { mode: "stats", icon: <BarChart3 className="w-4 h-4" />, label: "Stats" },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight">Leads</h1>
          <p className="text-sm text-gray-500 font-bold mt-0.5">
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
            {leads.length !== filteredLeads.length ? ` / ${leads.length} total` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={filteredLeads.length === 0}
            className="btn-secondary flex items-center gap-2 text-sm"
            type="button"
            title="Exporter les leads filtrés en CSV"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary flex items-center gap-2 text-sm"
            type="button"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sync en cours..." : "Synchroniser"}
          </button>
        </div>
      </div>

      {/* ── Sync result banner ── */}
      {syncResult && (
        <SyncBanner result={syncResult} onDismiss={() => setSyncResult(null)} />
      )}

      {/* ── Filters + View switcher (one row) ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-40 flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-brutal w-full pl-9 text-sm py-2"
          />
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LeadStatus | "all")}
          className="input-brutal text-sm py-2 pr-8"
        >
          <option value="all">Tous les statuts</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
          ))}
        </select>

        {/* Client filter */}
        <select
          value={filterClient}
          onChange={(e) => {
            setFilterClient(e.target.value);
            setFilterCampaign("all"); // reset campaign when client changes
          }}
          className="input-brutal text-sm py-2 pr-8"
        >
          <option value="all">Tous les clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company ?? c.full_name}
            </option>
          ))}
        </select>

        {/* Campaign filter — filtered by selected client */}
        <select
          value={filterCampaign}
          onChange={(e) => setFilterCampaign(e.target.value)}
          className="input-brutal text-sm py-2 pr-8"
        >
          <option value="all">Toutes les campagnes</option>
          {campaigns
            .filter((c) => filterClient === "all" || c.client_id === filterClient)
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>

        {/* Creative filter */}
        {uniqueCreatives.length > 0 && (
          <select
            value={filterCreative}
            onChange={(e) => setFilterCreative(e.target.value)}
            className="input-brutal text-sm py-2 pr-8"
          >
            <option value="all">Toutes les créatives</option>
            {uniqueCreatives.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {/* Quality min filter */}
        <select
          value={filterQuality}
          onChange={(e) => setFilterQuality(Number(e.target.value))}
          className="input-brutal text-sm py-2 pr-8"
        >
          <option value={0}>Toutes qualités</option>
          <option value={1}>★ 1+</option>
          <option value={2}>★ 2+</option>
          <option value={3}>★ 3+</option>
          <option value={4}>★ 4+</option>
          <option value={5}>★ 5</option>
        </select>

        {/* View switcher */}
        <div className="flex border-3 border-black ml-auto">
          {VIEWS.map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              title={label}
              type="button"
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase border-r-2 border-black last:border-r-0 transition-colors ${
                view === mode ? "bg-lf-black text-white" : "bg-white hover:bg-gray-100"
              }`}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="border-3 border-black bg-white shadow-brutal overflow-hidden">
        {view === "table" && (
          <TableView
            leads={filteredLeads}
            onStatusChange={handleStatusChange}
            onQualityChange={handleQualityChange}
            onNoteClick={setNoteModal}
            onRevenueSave={handleRevenueSave}
            onCashSave={handleCashSave}
          />
        )}
        {view === "kanban" && (
          <div className="p-4">
            <KanbanView leads={filteredLeads} onStatusChange={handleStatusChange} />
          </div>
        )}
        {view === "compact" && (
          <CompactView
            leads={filteredLeads}
            onStatusChange={handleStatusChange}
            onQualityChange={handleQualityChange}
          />
        )}
        {view === "stats" && (
          <div className="p-5">
            <StatsView leads={filteredLeads} />
          </div>
        )}
      </div>

      {/* ── Note modal ── */}
      {noteModal && (
        <NoteModal
          lead={noteModal}
          onSave={handleNoteSave}
          onClose={() => setNoteModal(null)}
        />
      )}
    </div>
  );
}
