"use client";

import { useState, useMemo } from "react";
import { Table2, BarChart3, Star, ChevronDown, MessageSquare, X, Search, Euro, TrendingUp, Download } from "lucide-react";
import type { Lead, LeadStatus } from "@/types/index";
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, LEAD_STATUS_COLORS as STATUS_COLORS } from "@/types/index";

const STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost"];

interface Props {
  leads: Lead[];
}

type ViewMode = "table" | "stats";

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-block text-xs font-black uppercase tracking-wide px-2 py-0.5 border border-black ${LEAD_STATUS_COLORS[status]}`}>
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

function QualityStars({ score, onChange }: { score: number | null; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className={onChange ? "cursor-pointer" : "cursor-default"}
          title={onChange ? `Qualité ${n}` : undefined}
        >
          <Star className={`w-3.5 h-3.5 ${
            score !== null && n <= score
              ? score >= 4 ? "fill-lf-green text-lf-green"
              : score >= 3 ? "fill-lf-yellow text-lf-yellow"
              : "fill-red-400 text-red-400"
              : "text-gray-300"
          }`} />
        </button>
      ))}
    </div>
  );
}

function StatusDropdown({ current, onChange }: { current: LeadStatus; onChange: (s: LeadStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1" type="button">
        <StatusBadge status={current} />
        <ChevronDown className="w-3 h-3 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border-3 border-black shadow-brutal min-w-[130px]">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs font-bold uppercase hover:bg-gray-50 ${s === current ? "bg-gray-100" : ""}`} type="button">
              {LEAD_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Editable money cell — inline edit ─────────────────────────────────────────
function MoneyCell({
  leadId, value, onSave, title, accentColor = "lf-green",
}: { leadId: string; value: number | null; onSave: (id: string, val: number | null) => void; title: string; accentColor?: string }) {
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
          className="w-24 border-2 border-lf-blue px-2 py-1 text-xs font-bold focus:outline-none"
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
      className={`flex items-center gap-1 group text-xs font-bold px-2 py-1 border-2 transition-colors ${
        value != null
          ? `border-${accentColor} bg-green-50 text-${accentColor} hover:bg-green-100`
          : "border-dashed border-gray-300 text-gray-400 hover:border-lf-blue hover:text-lf-blue"
      }`}
      title={title}
    >
      {value != null ? (
        <><Euro className="w-3 h-3" />{fmt(value, 2)}</>
      ) : (
        <><Euro className="w-3 h-3 opacity-40" /><span>Saisir</span></>
      )}
    </button>
  );
}

// Keep RevenueCell as alias for backward compat
function RevenueCell({ leadId, value, onSave }: { leadId: string; value: number | null; onSave: (id: string, revenue: number | null) => void }) {
  return <MoneyCell leadId={leadId} value={value} onSave={onSave} title="Cliquer pour modifier le CA" />;
}

// ── Note modal ────────────────────────────────────────────────────────────────
function NoteModal({ lead, onSave, onClose }: { lead: Lead; onSave: (notes: string) => void; onClose: () => void }) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-canvas border-3 border-black shadow-brutal w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b-3 border-black">
          <h3 className="font-black uppercase text-sm">Note — {lead.full_name ?? lead.email ?? "Lead"}</h3>
          <button onClick={onClose} type="button"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            className="textarea-brutal w-full h-32 text-sm" placeholder="Ajouter une note..." />
        </div>
        <div className="flex gap-2 p-4 border-t-3 border-black">
          <button onClick={() => onSave(notes)} className="btn-primary flex-1 text-sm" type="button">Sauvegarder</button>
          <button onClick={onClose} className="btn-secondary text-sm" type="button">Annuler</button>
        </div>
      </div>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────
function TableView({ leads, onStatusChange, onNoteClick, onRevenueSave, onCashSave, onQualityChange }: {
  leads: Lead[];
  onStatusChange: (id: string, s: LeadStatus) => void;
  onNoteClick: (lead: Lead) => void;
  onRevenueSave: (id: string, revenue: number | null) => void;
  onCashSave: (id: string, cash: number | null) => void;
  onQualityChange: (id: string, q: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-3 border-black bg-lf-black text-white">
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Nom</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Statut</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Email</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden sm:table-cell">Téléphone</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden md:table-cell">Qualité</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">
              <span className="flex items-center gap-1"><Euro className="w-3 h-3 text-lf-yellow" />CA généré</span>
            </th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden xl:table-cell">
              <span className="flex items-center gap-1"><Euro className="w-3 h-3 text-lf-green" />Cash reçu</span>
            </th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden lg:table-cell">Date</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => (
            <tr key={lead.id} className={`border-b border-black/10 hover:bg-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
              <td className="px-4 py-3 font-bold">{lead.full_name ?? <span className="text-gray-400 font-normal">—</span>}</td>
              <td className="px-4 py-3">
                <StatusDropdown current={lead.status} onChange={(s) => onStatusChange(lead.id, s)} />
              </td>
              <td className="px-4 py-3 text-gray-600 text-xs">{lead.email ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-3 text-gray-600 text-xs hidden sm:table-cell">{lead.phone ?? <span className="text-gray-400">—</span>}</td>
              <td className="px-4 py-3 hidden md:table-cell"><QualityStars score={lead.quality_score} onChange={(q) => onQualityChange(lead.id, q)} /></td>
              <td className="px-4 py-3">
                <RevenueCell leadId={lead.id} value={lead.revenue ?? null} onSave={onRevenueSave} />
              </td>
              <td className="px-4 py-3 hidden xl:table-cell">
                <MoneyCell leadId={lead.id} value={lead.cash_collected ?? null} onSave={onCashSave} title="Cliquer pour modifier le cash reçu" accentColor="lf-blue" />
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell">
                {lead.meta_created_at
                  ? new Date(lead.meta_created_at).toLocaleDateString("fr-FR")
                  : new Date(lead.created_at).toLocaleDateString("fr-FR")}
              </td>
              <td className="px-4 py-3">
                <button onClick={() => onNoteClick(lead)}
                  className={`p-1.5 border-2 border-transparent hover:border-black hover:bg-lf-yellow transition-colors ${lead.notes ? "text-lf-blue" : "text-gray-400"}`}
                  title="Notes" type="button">
                  <MessageSquare className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {leads.length === 0 && (
        <div className="py-16 text-center text-gray-400 font-bold uppercase tracking-wide">Aucun lead trouvé</div>
      )}
    </div>
  );
}

// ── Stats view ────────────────────────────────────────────────────────────────
function StatsView({ leads }: { leads: Lead[] }) {
  const total = leads.length;
  const byStatus = useMemo(() => {
    const map: Record<LeadStatus, number> = { new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 };
    for (const l of leads) map[l.status]++;
    return map;
  }, [leads]);

  const converted = byStatus.converted;
  const convRate = total > 0 ? ((converted / total) * 100).toFixed(1) : "0";
  const scored = leads.filter((l) => l.quality_score !== null);
  const avgQuality = scored.length > 0
    ? (scored.reduce((sum, l) => sum + (l.quality_score ?? 0), 0) / scored.length).toFixed(1)
    : null;

  const totalRevenue = leads.reduce((sum, l) => sum + (l.revenue ?? 0), 0);
  const revenueLeads = leads.filter((l) => l.revenue != null && l.revenue > 0).length;
  const avgRevenue = revenueLeads > 0 ? totalRevenue / revenueLeads : 0;

  return (
    <div className="space-y-6">
      {/* Revenue hero card */}
      {totalRevenue > 0 && (
        <div className="border-3 border-black p-6 bg-lf-black text-white shadow-brutal">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-lf-yellow" />
            <p className="text-xs font-black uppercase tracking-widest text-white/60">CA total généré</p>
          </div>
          <p className="text-5xl font-black leading-none mb-2">{fmt(totalRevenue, 2)} €</p>
          <div className="flex gap-4 text-sm text-white/60 font-medium">
            <span>{revenueLeads} lead{revenueLeads > 1 ? "s" : ""} avec CA renseigné</span>
            {avgRevenue > 0 && <span>· Moy. {fmt(avgRevenue, 0)} €/lead</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Mes leads", value: total, color: "bg-lf-blue text-white" },
          { label: "Convertis", value: converted, color: "bg-lf-green text-white" },
          { label: "Taux conversion", value: `${convRate}%`, color: "bg-lf-yellow text-black" },
          { label: "Qualité moyenne", value: avgQuality ? `${avgQuality}/5` : "—", color: "bg-purple-500 text-white" },
        ].map(({ label, value, color }) => (
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
                <div className="w-24 flex-none"><StatusBadge status={status} /></div>
                <div className="flex-1 bg-gray-100 border border-black h-6 relative">
                  <div className={`h-full ${STATUS_COLORS[status].split(" ")[0]} transition-all`} style={{ width: `${pct}%` }} />
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

// ── Main component ────────────────────────────────────────────────────────────
export function ClientLeadsClient({ leads: initialLeads }: Props) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [view, setView] = useState<ViewMode>("table");
  const [filterStatus, setFilterStatus] = useState<LeadStatus | "all">("all");
  const [filterCampaign, setFilterCampaign] = useState<string>("all");
  const [filterCreative, setFilterCreative] = useState<string>("all");
  const [filterQuality, setFilterQuality] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [noteModal, setNoteModal] = useState<Lead | null>(null);

  const uniqueCampaigns = useMemo(() => {
    return Array.from(
      new Set(leads.map((l) => l.campaigns?.name ?? l.meta_campaign_name).filter(Boolean))
    ) as string[];
  }, [leads]);

  const uniqueCreatives = useMemo(() => {
    return Array.from(new Set(leads.map((l) => l.meta_form_name).filter(Boolean))) as string[];
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (filterStatus !== "all" && lead.status !== filterStatus) return false;
      if (filterCampaign !== "all") {
        const campName = lead.campaigns?.name ?? lead.meta_campaign_name;
        if (campName !== filterCampaign) return false;
      }
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
  }, [leads, filterStatus, filterCampaign, filterCreative, filterQuality, search]);

  const totalRevenue = useMemo(
    () => leads.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
    [leads]
  );

  const totalCash = useMemo(
    () => leads.reduce((sum, l) => sum + (l.cash_collected ?? 0), 0),
    [leads]
  );

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    const previousLead = leads.find((lead) => lead.id === id);
    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, ...updates } : lead)));

    const response = await fetch(`/api/client/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok && previousLead) {
      setLeads((prev) => prev.map((lead) => (lead.id === id ? previousLead : lead)));
    }
  };

  const handleStatusChange = async (id: string, status: LeadStatus) => {
    await updateLead(id, { status });
  };

  const handleRevenueSave = async (id: string, revenue: number | null) => {
    await updateLead(id, { revenue });
  };

  const handleQualityChange = async (id: string, quality_score: number) => {
    await updateLead(id, { quality_score });
  };

  const handleCashSave = async (id: string, cash_collected: number | null) => {
    await updateLead(id, { cash_collected });
  };

  const handleExportCSV = () => {
    const BOM = "\uFEFF";
    const headers = ["Nom", "Email", "Téléphone", "Entreprise", "Campagne", "Créative", "Statut", "Qualité", "CA (€)", "Cash (€)", "Date"];
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
    ]);
    const csv = BOM + [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mes-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNoteSave = async (notes: string) => {
    if (!noteModal) return;
    const id = noteModal.id;
    setNoteModal(null);
    await updateLead(id, { notes });
  };

  const VIEWS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "table", icon: <Table2 className="w-4 h-4" />, label: "Table" },
    { mode: "stats", icon: <BarChart3 className="w-4 h-4" />, label: "Stats" },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight">Mes Leads</h1>
          <p className="text-sm text-gray-500 font-bold mt-0.5">
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
            {totalRevenue > 0 && (
              <span className="ml-2 text-lf-green">· {fmt(totalRevenue, 0)} € CA</span>
            )}
            {totalCash > 0 && (
              <span className="ml-2 text-lf-blue">· {fmt(totalCash, 0)} € cash</span>
            )}
          </p>
        </div>
        {/* Revenue hint */}
        <div className="flex flex-wrap gap-2">
          <div className="text-xs font-medium text-lf-gray flex items-center gap-1.5 border-2 border-dashed border-gray-300 px-3 py-2">
            <Euro className="w-3.5 h-3.5" />
            Cliquez sur une cellule CA pour saisir le revenu généré par ce lead
          </div>
          <div className="text-xs font-medium text-lf-gray flex items-center gap-1.5 border-2 border-dashed border-gray-300 px-3 py-2">
            <ChevronDown className="w-3.5 h-3.5" />
            Cliquez sur le statut dans la table pour le modifier
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-40 flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Rechercher..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="input-brutal w-full pl-9 text-sm py-2" />
        </div>

        {/* Status filter */}
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as LeadStatus | "all")}
          className="input-brutal text-sm py-2 pr-8">
          <option value="all">Tous les statuts</option>
          {STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </select>

        {/* Campaign filter */}
        {uniqueCampaigns.length > 1 && (
          <select value={filterCampaign} onChange={(e) => setFilterCampaign(e.target.value)}
            className="input-brutal text-sm py-2 pr-8">
            <option value="all">Toutes les campagnes</option>
            {uniqueCampaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Creative filter */}
        {uniqueCreatives.length > 0 && (
          <select value={filterCreative} onChange={(e) => setFilterCreative(e.target.value)}
            className="input-brutal text-sm py-2 pr-8">
            <option value="all">Toutes les créatives</option>
            {uniqueCreatives.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Quality filter */}
        <select value={filterQuality} onChange={(e) => setFilterQuality(Number(e.target.value))}
          className="input-brutal text-sm py-2 pr-8">
          <option value={0}>Toutes qualités</option>
          <option value={1}>★ 1+</option>
          <option value={2}>★ 2+</option>
          <option value={3}>★ 3+</option>
          <option value={4}>★ 4+</option>
          <option value={5}>★ 5</option>
        </select>

        {/* Export */}
        <button
          onClick={handleExportCSV}
          disabled={filteredLeads.length === 0}
          className="btn-secondary flex items-center gap-2 text-sm"
          type="button"
          title="Exporter mes leads en CSV"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>

        {/* View switcher */}
        <div className="flex border-3 border-black ml-auto">
          {VIEWS.map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => setView(mode)} title={label} type="button"
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase border-r-2 border-black last:border-r-0 transition-colors ${
                view === mode ? "bg-lf-black text-white" : "bg-white hover:bg-gray-100"
              }`}>
              {icon}<span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-3 border-black bg-white shadow-brutal overflow-hidden">
        {view === "table" && (
          <TableView leads={filteredLeads} onStatusChange={handleStatusChange}
            onNoteClick={setNoteModal} onRevenueSave={handleRevenueSave} onCashSave={handleCashSave}
            onQualityChange={handleQualityChange} />
        )}
        {view === "stats" && (
          <div className="p-5"><StatsView leads={filteredLeads} /></div>
        )}
      </div>

      {noteModal && (
        <NoteModal lead={noteModal} onSave={handleNoteSave} onClose={() => setNoteModal(null)} />
      )}
    </div>
  );
}
