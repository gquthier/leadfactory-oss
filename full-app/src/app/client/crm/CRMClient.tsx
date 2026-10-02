"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Kanban, Table2, BarChart3, Plus, Upload, Search, ChevronDown,
  Euro, TrendingUp, Star, Download, MessageSquare, X, Filter, Settings,
} from "lucide-react";
import type { Lead, LeadStatus, PipelineStage, LeadActivity, LeadSource } from "@/types/index";
import {
  LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS,
} from "@/types/index";
import { CRMPipelineKanban } from "../leads/CRMPipelineKanban";
import { LeadDetailPanel } from "../leads/LeadDetailPanel";
import { AddLeadModal } from "../leads/AddLeadModal";
import { ImportLeadsModal } from "../leads/ImportLeadsModal";
import { CRMStatsView } from "./CRMStatsView";
import { CRMSettingsModal } from "./CRMSettingsModal";

type ViewMode = "pipeline" | "table" | "stats";

const STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost"];

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

function SourceBadge({ source }: { source: LeadSource | string | null }) {
  const s = (source ?? "other") as LeadSource;
  const color = LEAD_SOURCE_COLORS[s] ?? LEAD_SOURCE_COLORS.other;
  const label = LEAD_SOURCE_LABELS[s] ?? source ?? "Autre";
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-sm ${color}`}>
      {label}
    </span>
  );
}

function QualityStars({ score, onChange }: { score: number | null; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange?.(n)}
          className={onChange ? "cursor-pointer" : "cursor-default"}>
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

// ── Stats View ──────────────────────────────────────────────────────────────
function StatsView({ leads, stages }: { leads: Lead[]; stages: PipelineStage[] }) {
  const total = leads.length;
  const totalRevenue = leads.reduce((sum, l) => sum + (l.revenue ?? 0), 0);
  const totalCash = leads.reduce((sum, l) => sum + (l.cash_collected ?? 0), 0);
  const converted = leads.filter((l) => l.status === "converted").length;
  const convRate = total > 0 ? ((converted / total) * 100).toFixed(1) : "0";

  const bySource = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const l of leads) {
      const s = l.source ?? "other";
      if (!map[s]) map[s] = { count: 0, revenue: 0 };
      map[s].count++;
      map[s].revenue += l.revenue ?? 0;
    }
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  }, [leads]);

  const byStage = useMemo(() => {
    return stages.map((stage) => {
      const stageLeads = leads.filter((l) => l.pipeline_stage_id === stage.id);
      return {
        ...stage,
        count: stageLeads.length,
        revenue: stageLeads.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
      };
    });
  }, [leads, stages]);

  return (
    <div className="space-y-6">
      {/* Revenue hero */}
      {totalRevenue > 0 && (
        <div className="border-3 border-black p-6 bg-lf-black text-white shadow-brutal">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-lf-yellow" />
            <p className="text-xs font-black uppercase tracking-widest text-white/60">CA total généré</p>
          </div>
          <p className="text-5xl font-black leading-none mb-2">{fmt(totalRevenue, 2)} &euro;</p>
          <div className="flex gap-4 text-sm text-white/60 font-medium">
            <span>{converted} lead{converted > 1 ? "s" : ""} converti{converted > 1 ? "s" : ""}</span>
            {totalCash > 0 && <span>&middot; {fmt(totalCash, 0)} &euro; cash re&ccedil;u</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total leads", value: total, color: "bg-lf-blue text-white" },
          { label: "Convertis", value: converted, color: "bg-lf-green text-white" },
          { label: "Taux conversion", value: `${convRate}%`, color: "bg-lf-yellow text-black" },
          { label: "Valeur pipeline", value: `${fmt(totalRevenue, 0)} \u20AC`, color: "bg-purple-500 text-white" },
        ].map(({ label, value, color }) => (
          <div key={label} className={`border-3 border-black p-4 shadow-brutal ${color}`}>
            <p className="text-xs font-black uppercase tracking-wide opacity-80">{label}</p>
            <p className="text-3xl font-black mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* By Pipeline Stage */}
      <div className="border-3 border-black bg-white p-5 shadow-brutal">
        <h3 className="font-black uppercase tracking-wide text-sm mb-4">Par &eacute;tape du pipeline</h3>
        <div className="space-y-3">
          {byStage.map((stage) => {
            const pct = total > 0 ? (stage.count / total) * 100 : 0;
            return (
              <div key={stage.id} className="flex items-center gap-3">
                <div className="w-28 flex-none flex items-center gap-2">
                  <div className="w-3 h-3 border border-black flex-shrink-0" style={{ backgroundColor: stage.color }} />
                  <span className="text-xs font-bold truncate">{stage.name}</span>
                </div>
                <div className="flex-1 bg-gray-100 border border-black h-6 relative">
                  <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: stage.color }} />
                </div>
                <div className="w-24 text-right">
                  <span className="font-black text-sm">{stage.count}</span>
                  <span className="text-xs text-gray-500 ml-1">({pct.toFixed(0)}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* By Source */}
      <div className="border-3 border-black bg-white p-5 shadow-brutal">
        <h3 className="font-black uppercase tracking-wide text-sm mb-4">Par source</h3>
        <div className="space-y-2">
          {bySource.map(([source, data]) => (
            <div key={source} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <SourceBadge source={source} />
              <div className="text-right">
                <span className="font-black text-sm">{data.count} lead{data.count > 1 ? "s" : ""}</span>
                {data.revenue > 0 && <span className="text-xs text-lf-green ml-2">{fmt(data.revenue, 0)} &euro;</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Table View ──────────────────────────────────────────────────────────────
function TableView({ leads, stages, onStatusChange, onLeadClick, onQualityChange }: {
  leads: Lead[];
  stages: PipelineStage[];
  onStatusChange: (id: string, s: LeadStatus) => void;
  onLeadClick: (lead: Lead) => void;
  onQualityChange: (id: string, q: number) => void;
}) {
  const stageMap = useMemo(() => {
    const m: Record<string, PipelineStage> = {};
    for (const s of stages) m[s.id] = s;
    return m;
  }, [stages]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-3 border-black bg-lf-black text-white">
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Nom</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden sm:table-cell">Contact</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Source</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">&Eacute;tape</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide">Statut</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden md:table-cell">Qualit&eacute;</th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden lg:table-cell">
              <span className="flex items-center gap-1"><Euro className="w-3 h-3 text-lf-yellow" />CA</span>
            </th>
            <th className="text-left px-4 py-3 font-black uppercase text-xs tracking-wide hidden xl:table-cell">Date</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => {
            const stage = lead.pipeline_stage_id ? stageMap[lead.pipeline_stage_id] : null;
            return (
              <tr key={lead.id}
                onClick={() => onLeadClick(lead)}
                className={`border-b border-black/10 hover:bg-lf-yellow/10 cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                <td className="px-4 py-3">
                  <div className="font-bold">{lead.full_name ?? <span className="text-gray-400">&mdash;</span>}</div>
                  {lead.company && <div className="text-xs text-gray-500">{lead.company}</div>}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="text-xs text-gray-600">{lead.email ?? ""}</div>
                  <div className="text-xs text-gray-500">{lead.phone ?? ""}</div>
                </td>
                <td className="px-4 py-3"><SourceBadge source={lead.source} /></td>
                <td className="px-4 py-3">
                  {stage ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                      <span className="w-2.5 h-2.5 border border-black" style={{ backgroundColor: stage.color }} />
                      {stage.name}
                    </span>
                  ) : <span className="text-gray-400 text-xs">&mdash;</span>}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <StatusDropdown current={lead.status} onChange={(s) => onStatusChange(lead.id, s)} />
                </td>
                <td className="px-4 py-3 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                  <QualityStars score={lead.quality_score} onChange={(q) => onQualityChange(lead.id, q)} />
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {lead.revenue != null ? (
                    <span className="text-xs font-bold text-lf-green">{fmt(lead.revenue, 0)} &euro;</span>
                  ) : <span className="text-gray-300 text-xs">&mdash;</span>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 hidden xl:table-cell">
                  {(lead.meta_created_at ? new Date(lead.meta_created_at) : new Date(lead.created_at)).toLocaleDateString("fr-FR")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {leads.length === 0 && (
        <div className="py-16 text-center text-gray-400 font-bold uppercase tracking-wide">Aucun lead trouv&eacute;</div>
      )}
    </div>
  );
}

// ── Main CRM Component ──────────────────────────────────────────────────────
interface Props {
  leads: Lead[];
  stages: PipelineStage[];
  campaigns: { id: string; name: string }[];
}

export function CRMClient({ leads: initialLeads, stages: initialStages, campaigns }: Props) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [stages, setStages] = useState<PipelineStage[]>(initialStages);
  const [view, setView] = useState<ViewMode>("pipeline");
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterStage, setFilterStage] = useState<string>("all");

  // Modals
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedActivities, setSelectedActivities] = useState<LeadActivity[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Filtered leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (filterSource !== "all" && lead.source !== filterSource) return false;
      if (filterStage !== "all" && lead.pipeline_stage_id !== filterStage) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          lead.full_name?.toLowerCase().includes(q) ||
          lead.email?.toLowerCase().includes(q) ||
          lead.phone?.includes(q) ||
          lead.company?.toLowerCase().includes(q) ||
          lead.tags?.some((t) => t.toLowerCase().includes(q)) ||
          false
        );
      }
      return true;
    });
  }, [leads, filterSource, filterStage, search]);

  const totalRevenue = useMemo(() => leads.reduce((sum, l) => sum + (l.revenue ?? 0), 0), [leads]);

  // ── API Helpers ─────────────────────────────────────────────────────────
  const updateLead = useCallback(async (id: string, updates: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, ...updates } : l));
    await fetch(`/api/client/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }, []);

  const handleStageDrop = useCallback(async (leadId: string, newStageId: string) => {
    await updateLead(leadId, { pipeline_stage_id: newStageId });
  }, [updateLead]);

  const handleLeadClick = useCallback(async (lead: Lead) => {
    setSelectedLead(lead);
    try {
      const res = await fetch(`/api/client/leads/${lead.id}/activities`);
      if (res.ok) {
        const data = await res.json();
        setSelectedActivities(data.activities ?? []);
      }
    } catch {
      setSelectedActivities([]);
    }
  }, []);

  const handleAddActivity = useCallback(async (leadId: string, activity: { activity_type: string; title: string; description?: string }) => {
    const res = await fetch(`/api/client/leads/${leadId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activity),
    });
    if (res.ok) {
      const data = await res.json();
      setSelectedActivities((prev) => [data.activity, ...prev]);
    }
  }, []);

  const handleAddLead = useCallback(async (leadData: Record<string, unknown>) => {
    const res = await fetch("/api/client/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leadData),
    });
    const data = await res.json();
    if (!res.ok || !data.lead) {
      return { success: false, error: data.error ?? "Erreur lors de la création du lead" };
    }
    setLeads((prev) => [data.lead, ...prev]);
    return { success: true, lead: data.lead, warning: data.warning ?? null };
  }, []);

  const handleImport = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/client/leads/import", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.imported > 0) {
      // Refresh leads
      const leadsRes = await fetch("/api/client/leads");
      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        setLeads(leadsData.leads ?? []);
      }
    }
    return data;
  }, []);

  const handleExportCSV = useCallback(() => {
    const BOM = "\uFEFF";
    const headers = ["Nom", "Email", "T\u00E9l\u00E9phone", "Entreprise", "Source", "\u00C9tape", "Statut", "Qualit\u00E9", "CA (\u20AC)", "Tags", "Date"];
    const stageMap: Record<string, string> = {};
    for (const s of stages) stageMap[s.id] = s.name;
    const rows = filteredLeads.map((l) => [
      l.full_name ?? "",
      l.email ?? "",
      l.phone ?? "",
      l.company ?? "",
      LEAD_SOURCE_LABELS[(l.source ?? "other") as LeadSource] ?? l.source ?? "",
      l.pipeline_stage_id ? (stageMap[l.pipeline_stage_id] ?? "") : "",
      LEAD_STATUS_LABELS[l.status],
      l.quality_score != null ? String(l.quality_score) : "",
      l.revenue != null ? String(l.revenue) : "",
      (l.tags ?? []).join(", "),
      (l.meta_created_at ? new Date(l.meta_created_at) : new Date(l.created_at)).toLocaleDateString("fr-FR"),
    ]);
    const csv = BOM + [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crm-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredLeads, stages]);

  const VIEWS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "pipeline", icon: <Kanban className="w-4 h-4" />, label: "Pipeline" },
    { mode: "table", icon: <Table2 className="w-4 h-4" />, label: "Table" },
    { mode: "stats", icon: <BarChart3 className="w-4 h-4" />, label: "Stats" },
  ];

  const uniqueSources = useMemo(() => {
    return Array.from(new Set(leads.map((l) => l.source).filter(Boolean))) as string[];
  }, [leads]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black uppercase tracking-tight">CRM Pipeline</h1>
            <span className="bg-lf-pink text-black text-[10px] font-black px-2 py-1 border-2 border-black shadow-brutal-xs -rotate-2">
              NOUVEAU
            </span>
          </div>
          <p className="text-sm text-gray-500 font-bold mt-0.5">
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
            {totalRevenue > 0 && <span className="ml-2 text-lf-green">&middot; {fmt(totalRevenue, 0)} &euro; CA</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2 text-sm" type="button">
            <Plus className="w-4 h-4" /> Ajouter un lead
          </button>
          <button onClick={() => setShowImportModal(true)} className="btn-secondary flex items-center gap-2 text-sm" type="button">
            <Upload className="w-4 h-4" /> Importer CSV
          </button>
          <button onClick={() => setShowSettingsModal(true)} className="btn-secondary flex items-center gap-2 text-sm" type="button" title="Paramètres CRM">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters + View Switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Rechercher..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="input-brutal w-full pl-9 text-sm py-2" />
        </div>

        {uniqueSources.length > 1 && (
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
            className="input-brutal text-xs py-2 pr-7 max-w-[160px]">
            <option value="all">Toutes les sources</option>
            {uniqueSources.map((s) => (
              <option key={s} value={s}>{LEAD_SOURCE_LABELS[s as LeadSource] ?? s}</option>
            ))}
          </select>
        )}

        {stages.length > 1 && (
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}
            className="input-brutal text-xs py-2 pr-7 max-w-[160px]">
            <option value="all">Toutes les &eacute;tapes</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={handleExportCSV} disabled={filteredLeads.length === 0}
            title="Exporter en CSV"
            className="flex items-center justify-center w-9 h-9 border-3 border-black bg-white hover:bg-lf-yellow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            type="button">
            <Download className="w-4 h-4" />
          </button>

          <div className="flex border-3 border-black">
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
      </div>

      {/* Content */}
      {view === "pipeline" && (
        <CRMPipelineKanban
          leads={filteredLeads as any}
          stages={stages}
          onLeadClick={(lead: any) => handleLeadClick(lead as Lead)}
          onStageDrop={handleStageDrop}
        />
      )}

      {view === "table" && (
        <div className="border-3 border-black bg-white shadow-brutal overflow-hidden">
          <TableView
            leads={filteredLeads}
            stages={stages}
            onStatusChange={(id, status) => updateLead(id, { status })}
            onLeadClick={handleLeadClick}
            onQualityChange={(id, quality_score) => updateLead(id, { quality_score })}
          />
        </div>
      )}

      {view === "stats" && (
        <CRMStatsView leads={filteredLeads} stages={stages} />
      )}

      {/* Lead Detail Panel */}
      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead as any}
          stages={stages}
          activities={selectedActivities as any}
          onClose={() => { setSelectedLead(null); setSelectedActivities([]); }}
          onUpdate={(id: string, updates: any) => {
            updateLead(id, updates);
            setSelectedLead((prev) => prev ? { ...prev, ...updates } : null);
          }}
          onAddActivity={handleAddActivity}
        />
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <AddLeadModal
          stages={stages}
          campaigns={campaigns}
          onSave={handleAddLead as any}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportLeadsModal
          onImport={handleImport}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <CRMSettingsModal
          stages={stages}
          onClose={() => setShowSettingsModal(false)}
          onStagesUpdate={(updatedStages) => {
            setStages(updatedStages);
          }}
        />
      )}
    </div>
  );
}
