"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Columns3,
  Euro,
  ExternalLink,
  Filter,
  GripVertical,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Table2,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AdminCrmStatus =
  | "new_discovery"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "won"
  | "lost"
  | "no_show"
  | "cancelled";

export type AdminCrmPriority = "low" | "normal" | "high";

export interface AdminCrmLead {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  status: AdminCrmStatus;
  priority: AdminCrmPriority;
  source: string;
  event_type_id: number | null;
  event_type_title: string | null;
  cal_booking_id: number | null;
  cal_booking_uid: string | null;
  cal_trigger_event: string | null;
  call_start_time: string | null;
  call_end_time: string | null;
  meeting_url: string | null;
  notes: string | null;
  last_webhook_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminCrmMetrics {
  lead_count: number;
  booked_call_count: number;
  shown_call_count: number;
  no_show_count: number;
  cancelled_count: number;
  won_count: number;
  spend: number;
  meta_reported_leads: number;
  cost_per_lead: number | null;
  cost_per_call: number | null;
  show_rate: number | null;
  sales_conversion_rate: number | null;
}

type ViewMode = "data" | "kanban";
type DatePreset = "all" | "today" | "next_7" | "next_30" | "custom";

const STATUS_OPTIONS: { value: AdminCrmStatus; label: string; className: string }[] = [
  { value: "new_discovery", label: "Nouveau", className: "bg-blue-100 text-blue-900" },
  { value: "contacted", label: "Contacté", className: "bg-lf-yellow text-black" },
  { value: "qualified", label: "Qualifié", className: "bg-purple-100 text-purple-900" },
  { value: "proposal_sent", label: "Proposition", className: "bg-orange-100 text-orange-900" },
  { value: "won", label: "Gagné", className: "bg-green-100 text-green-900" },
  { value: "lost", label: "Perdu", className: "bg-gray-200 text-gray-900" },
  { value: "no_show", label: "No-show", className: "bg-red-100 text-red-900" },
  { value: "cancelled", label: "Annulé", className: "bg-gray-100 text-gray-700" },
];

const PRIORITY_OPTIONS: { value: AdminCrmPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "today", label: "Aujourd'hui" },
  { value: "next_7", label: "7 jours" },
  { value: "next_30", label: "30 jours" },
  { value: "custom", label: "Période" },
];

function fmt(n: number | null | undefined, dec = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function leadDateValue(lead: AdminCrmLead) {
  return lead.call_start_time ?? lead.created_at;
}

function dateRangeForPreset(preset: DatePreset, fromDate: string, toDate: string) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (preset === "today") {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start: startOfToday, end };
  }

  if (preset === "next_7" || preset === "next_30") {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + (preset === "next_7" ? 7 : 30));
    end.setHours(23, 59, 59, 999);
    return { start: startOfToday, end };
  }

  if (preset === "custom") {
    const start = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const end = toDate ? new Date(`${toDate}T23:59:59`) : null;
    return { start, end };
  }

  return { start: null, end: null };
}

function statusLabel(status: AdminCrmStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

function statusClass(status: AdminCrmStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.className ?? "bg-gray-100 text-gray-900";
}

function priorityLabel(priority: AdminCrmPriority) {
  return PRIORITY_OPTIONS.find((p) => p.value === priority)?.label ?? priority;
}

function priorityClass(priority: AdminCrmPriority) {
  if (priority === "high") return "bg-red-100 text-red-900";
  if (priority === "low") return "bg-gray-100 text-gray-700";
  return "bg-blue-100 text-blue-900";
}

export function AdminCRMClient({
  initialLeads,
  initialMetrics,
  schemaWarning,
}: {
  initialLeads: AdminCrmLead[];
  initialMetrics: AdminCrmMetrics | null;
  schemaWarning: string | null;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [metrics] = useState(initialMetrics);
  const [viewMode, setViewMode] = useState<ViewMode>("data");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminCrmStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<AdminCrmPriority | "all">("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<AdminCrmLead | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const range = dateRangeForPreset(datePreset, fromDate, toDate);
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (priorityFilter !== "all" && lead.priority !== priorityFilter) return false;
      const leadTime = new Date(leadDateValue(lead)).getTime();
      if (range.start && leadTime < range.start.getTime()) return false;
      if (range.end && leadTime > range.end.getTime()) return false;
      if (!q) return true;
      return [
        lead.full_name,
        lead.email,
        lead.phone,
        lead.company,
        lead.event_type_title,
        lead.notes,
        lead.source,
      ].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [leads, search, statusFilter, priorityFilter, datePreset, fromDate, toDate]);

  const counts = useMemo(() => {
    const base = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, 0])) as Record<AdminCrmStatus, number>;
    for (const lead of leads) base[lead.status] += 1;
    return base;
  }, [leads]);

  const filteredData = useMemo(() => {
    const now = Date.now();
    const bookedCalls = filtered.filter((lead) => Boolean(lead.call_start_time)).length;
    const upcomingCalls = filtered.filter((lead) => lead.call_start_time && new Date(lead.call_start_time).getTime() >= now).length;
    const highPriority = filtered.filter((lead) => lead.priority === "high").length;
    const nextCall = filtered
      .filter((lead) => lead.call_start_time)
      .sort((a, b) => new Date(a.call_start_time ?? 0).getTime() - new Date(b.call_start_time ?? 0).getTime())
      .find((lead) => new Date(lead.call_start_time ?? 0).getTime() >= now);
    return { bookedCalls, upcomingCalls, highPriority, nextCall };
  }, [filtered]);

  const kanbanGroups = useMemo(() => {
    const groups = STATUS_OPTIONS.reduce((acc, status) => {
      acc[status.value] = [];
      return acc;
    }, {} as Record<AdminCrmStatus, AdminCrmLead[]>);
    for (const lead of filtered) groups[lead.status].push(lead);
    for (const status of STATUS_OPTIONS) {
      groups[status.value].sort((a, b) => new Date(leadDateValue(a)).getTime() - new Date(leadDateValue(b)).getTime());
    }
    return groups;
  }, [filtered]);

  const updateLead = async (id: string, patch: Partial<Pick<AdminCrmLead, "status" | "priority" | "notes">>) => {
    const previous = leads.find((lead) => lead.id === id);
    setLeads((rows) => rows.map((lead) => (lead.id === id ? { ...lead, ...patch } : lead)));
    if (selected?.id === id) setSelected((lead) => (lead ? { ...lead, ...patch } : lead));
    setSavingId(id);

    const res = await fetch(`/api/admin/crm-leads/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSavingId(null);

    if (!res.ok && previous) {
      setLeads((rows) => rows.map((lead) => (lead.id === id ? previous : lead)));
      if (selected?.id === id) setSelected(previous);
      alert("Impossible de mettre à jour ce lead.");
    }
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setDatePreset("all");
    setFromDate("");
    setToDate("");
  };

  const moveDraggedLead = (status: AdminCrmStatus) => {
    if (!draggedLeadId) return;
    const lead = leads.find((row) => row.id === draggedLeadId);
    setDraggedLeadId(null);
    if (!lead || lead.status === status) return;
    updateLead(lead.id, { status });
  };

  const saveSelectedNotes = () => {
    if (!selected) return;
    updateLead(selected.id, { notes: selected.notes ?? "" });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lf-blue">Admin uniquement</p>
          <h1 className="text-3xl lg:text-4xl font-black uppercase tracking-tight mt-1">
            CRM Lead Factory
          </h1>
          <p className="text-sm text-lf-gray mt-2 max-w-2xl">
            Pipeline interne des rendez-vous Découverte Lead Factory. Séparé du CRM client et des leads Meta clients.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-secondary inline-flex items-center justify-center gap-2 text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Rafraîchir
        </button>
      </div>

      {schemaWarning && (
        <div className="bg-lf-yellow border-3 border-black shadow-brutal p-4">
          <p className="font-black uppercase text-sm">Migration Supabase requise</p>
          <p className="text-sm mt-1">
            La route admin CRM est déployée, mais les tables `crm_leads` / `crm_ad_spend_daily`
            ne sont pas encore disponibles en production. Appliquer la migration
            `025_admin_leadfactory_crm.sql` dans Supabase.
          </p>
          <p className="text-xs font-mono mt-2 break-words">{schemaWarning}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <Metric title="Leads" value={fmt(metrics?.lead_count ?? leads.length)} subtitle={`${fmt(metrics?.meta_reported_leads ?? 0)} leads Meta`} icon={Users} color="bg-blue-100" />
        <Metric title="Coût / lead" value={money(metrics?.cost_per_lead)} subtitle={`${money(metrics?.spend)} dépensés`} icon={Euro} color="bg-lf-yellow" />
        <Metric title="Show rate" value={metrics?.show_rate == null ? "—" : `${fmt(metrics.show_rate, 1)}%`} subtitle={`${fmt(metrics?.shown_call_count ?? 0)} shows`} icon={CalendarClock} color="bg-purple-100" />
        <Metric title="Coût / call" value={money(metrics?.cost_per_call)} subtitle={`${fmt(metrics?.booked_call_count ?? 0)} calls bookés`} icon={Target} color="bg-orange-100" />
        <Metric title="Conversion sales" value={metrics?.sales_conversion_rate == null ? "—" : `${fmt(metrics.sales_conversion_rate, 1)}%`} subtitle={`${fmt(metrics?.won_count ?? 0)} gagnés`} icon={TrendingUp} color="bg-green-100" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DataPoint label="Affichés" value={fmt(filtered.length)} detail={`${fmt(leads.length)} total CRM`} />
        <DataPoint label="Calls bookés" value={fmt(filteredData.bookedCalls)} detail={`${fmt(filteredData.upcomingCalls)} à venir`} />
        <DataPoint label="Priorité haute" value={fmt(filteredData.highPriority)} detail="À traiter en premier" />
        <DataPoint label="Prochain call" value={dateLabel(filteredData.nextCall?.call_start_time ?? null)} detail={filteredData.nextCall?.full_name || "Aucun call filtré"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status.value}
            type="button"
            onClick={() => setStatusFilter(status.value)}
            className={`text-left border-3 border-black p-3 shadow-brutal-xs transition-all ${
              statusFilter === status.value ? "bg-lf-black text-white" : "bg-white hover:-translate-y-0.5"
            }`}
          >
            <div className="text-2xl font-black">{counts[status.value]}</div>
            <div className="text-xs font-black uppercase mt-1">{status.label}</div>
          </button>
        ))}
      </div>

      <div className="bg-white border-3 border-black shadow-brutal p-4 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="inline-flex border-3 border-black w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setViewMode("data")}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-black uppercase ${
                viewMode === "data" ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              <Table2 className="w-4 h-4" />
              Data
            </button>
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-black uppercase border-l-3 border-black ${
                viewMode === "kanban" ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              <Columns3 className="w-4 h-4" />
              Kanban
            </button>
          </div>

          <button
            type="button"
            onClick={resetFilters}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-xs"
          >
            <Filter className="w-4 h-4" />
            Réinitialiser filtres
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px_180px] xl:grid-cols-[1fr_180px_160px_220px_130px_130px] gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-brutal w-full pl-10"
              placeholder="Chercher nom, email, entreprise, note..."
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AdminCrmStatus | "all")}
            className="input-brutal"
          >
            <option value="all">Tous les statuts</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as AdminCrmPriority | "all")}
            className="input-brutal"
          >
            <option value="all">Toutes priorités</option>
            {PRIORITY_OPTIONS.map((priority) => (
              <option key={priority.value} value={priority.value}>{priority.label}</option>
            ))}
          </select>
          <select
            value={datePreset}
            onChange={(e) => {
              const next = e.target.value as DatePreset;
              setDatePreset(next);
              if (next !== "custom") {
                setFromDate("");
                setToDate("");
              }
            }}
            className="input-brutal"
          >
            {DATE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setDatePreset("custom");
              setFromDate(e.target.value);
            }}
            className="input-brutal"
            aria-label="Date de début"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setDatePreset("custom");
              setToDate(e.target.value);
            }}
            className="input-brutal"
            aria-label="Date de fin"
          />
        </div>
      </div>

      {viewMode === "data" ? (
        <div className="bg-white border-3 border-black shadow-brutal overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-lf-black text-white">
              <tr>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Lead</th>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Statut</th>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Priorité</th>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Call</th>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Source</th>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Dernier webhook</th>
                <th className="text-left px-4 py-3 font-black uppercase text-xs">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id} className="border-t-2 border-black/10 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-black">{lead.full_name || "Sans nom"}</div>
                    <div className="text-xs text-lf-gray">{lead.email || "Sans email"}{lead.company ? ` · ${lead.company}` : ""}</div>
                    {lead.phone && <div className="text-xs text-lf-gray">{lead.phone}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={lead.status}
                      disabled={savingId === lead.id}
                      onChange={(e) => updateLead(lead.id, { status: e.target.value as AdminCrmStatus })}
                      className={`border-2 border-black px-2 py-1 text-xs font-black uppercase ${statusClass(lead.status)}`}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status.value} value={status.value}>{status.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={lead.priority}
                      disabled={savingId === lead.id}
                      onChange={(e) => updateLead(lead.id, { priority: e.target.value as AdminCrmPriority })}
                      className="border-2 border-black px-2 py-1 text-xs font-black uppercase bg-white"
                    >
                      {PRIORITY_OPTIONS.map((priority) => (
                        <option key={priority.value} value={priority.value}>{priority.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 font-bold">{dateLabel(lead.call_start_time)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-1 bg-blue-100 text-blue-900 border-2 border-black text-xs font-black uppercase">
                      {lead.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-lf-gray">{dateLabel(lead.last_webhook_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(lead)}
                        className="btn-secondary text-xs"
                      >
                        Ouvrir
                      </button>
                      <ShortcutButton
                        label="Fermé"
                        disabled={savingId === lead.id || lead.status === "lost"}
                        onClick={() => updateLead(lead.id, { status: "lost" })}
                      />
                      <ShortcutButton
                        label="No-show"
                        disabled={savingId === lead.id || lead.status === "no_show"}
                        onClick={() => updateLead(lead.id, { status: "no_show" })}
                        tone="danger"
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-lf-gray font-bold">
                    Aucun lead Lead Factory pour ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid grid-flow-col auto-cols-[minmax(280px,320px)] gap-4 min-w-max">
            {STATUS_OPTIONS.map((status) => (
              <div
                key={status.value}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => moveDraggedLead(status.value)}
                className={`bg-white border-3 border-black shadow-brutal min-h-[520px] ${
                  draggedLeadId ? "outline outline-2 outline-offset-2 outline-lf-blue/30" : ""
                }`}
              >
                <div className="p-3 border-b-3 border-black bg-lf-black text-white flex items-center justify-between gap-2">
                  <div>
                    <p className="font-black uppercase text-xs">{status.label}</p>
                    <p className="text-[11px] text-white/60">{kanbanGroups[status.value].length} lead{kanbanGroups[status.value].length > 1 ? "s" : ""}</p>
                  </div>
                  <span className={`px-2 py-1 border-2 border-black text-xs font-black ${status.className}`}>
                    {counts[status.value]}
                  </span>
                </div>

                <div className="p-3 space-y-3">
                  {kanbanGroups[status.value].map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDraggedLeadId(lead.id)}
                      onDragEnd={() => setDraggedLeadId(null)}
                      className={`border-2 border-black bg-canvas p-3 cursor-grab active:cursor-grabbing transition-all ${
                        draggedLeadId === lead.id ? "opacity-50" : "hover:-translate-y-0.5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-black text-sm leading-tight truncate">{lead.full_name || "Sans nom"}</p>
                          <p className="text-xs text-lf-gray truncate">{lead.company || lead.email || "Sans entreprise"}</p>
                        </div>
                        <GripVertical className="w-4 h-4 text-lf-gray shrink-0" />
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3">
                        <span className={`px-2 py-0.5 border-2 border-black text-[10px] font-black uppercase ${priorityClass(lead.priority)}`}>
                          {priorityLabel(lead.priority)}
                        </span>
                        <span className="px-2 py-0.5 border-2 border-black bg-white text-[10px] font-black uppercase">
                          {lead.source}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-lf-gray">
                        <p className="flex items-center gap-1.5">
                          <CalendarDays className="w-3.5 h-3.5" />
                          <span className="font-bold text-black">{dateLabel(lead.call_start_time)}</span>
                        </p>
                        {lead.email && (
                          <p className="flex items-center gap-1.5 truncate">
                            <Mail className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{lead.email}</span>
                          </p>
                        )}
                        {lead.phone && (
                          <p className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5" />
                            <span>{lead.phone}</span>
                          </p>
                        )}
                      </div>

                      {lead.notes && (
                        <p className="mt-3 text-xs border-l-4 border-lf-yellow pl-2 line-clamp-2 text-lf-gray">
                          {lead.notes}
                        </p>
                      )}

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(lead)}
                          className="btn-secondary text-xs flex-1"
                        >
                          Ouvrir
                        </button>
                        <ShortcutButton
                          label="Fermé"
                          disabled={savingId === lead.id || lead.status === "lost"}
                          onClick={() => updateLead(lead.id, { status: "lost" })}
                        />
                        <ShortcutButton
                          label="No-show"
                          disabled={savingId === lead.id || lead.status === "no_show"}
                          onClick={() => updateLead(lead.id, { status: "no_show" })}
                          tone="danger"
                        />
                        {lead.meeting_url && (
                          <a
                            href={lead.meeting_url}
                            target="_blank"
                            rel="noreferrer"
                            className="border-2 border-black bg-white p-2 hover:bg-lf-yellow"
                            title="Ouvrir le lien meeting"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}

                  {kanbanGroups[status.value].length === 0 && (
                    <div className="border-2 border-dashed border-black/30 p-6 text-center text-xs font-bold uppercase text-lf-gray">
                      Dépose un lead ici
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
          <div className="w-full max-w-xl bg-canvas border-l-3 border-black h-full overflow-y-auto shadow-brutal">
            <div className="p-5 border-b-3 border-black bg-white flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-lf-blue">Lead Factory CRM</p>
                <h2 className="text-2xl font-black uppercase">{selected.full_name || "Sans nom"}</h2>
                <p className="text-sm text-lf-gray">{selected.email}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="btn-secondary text-xs">
                Fermer
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <Info label="Téléphone" value={selected.phone || "—"} />
                <Info label="Entreprise" value={selected.company || "—"} />
                <Info label="Booking Cal" value={selected.cal_booking_uid || selected.cal_booking_id?.toString() || "—"} />
                <Info label="Event" value={selected.event_type_title || selected.event_type_id?.toString() || "—"} />
                <Info label="Call" value={dateLabel(selected.call_start_time)} />
                <Info label="Statut" value={statusLabel(selected.status)} />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-wider">Notes admin</label>
                <textarea
                  value={selected.notes ?? ""}
                  onChange={(e) => setSelected({ ...selected, notes: e.target.value })}
                  className="textarea-brutal w-full h-36 mt-2"
                  placeholder="Notes de qualification, contexte, next step..."
                />
              </div>
              <button type="button" onClick={saveSelectedNotes} className="btn-primary w-full">
                <CheckCircle2 className="w-4 h-4" />
                Sauvegarder les notes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;
}) {
  return (
    <div className="bg-white border-3 border-black shadow-brutal p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black uppercase text-lf-gray">{title}</p>
        <div className={`w-9 h-9 border-2 border-black flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-3xl font-black mt-2">{value}</div>
      <div className="text-xs text-lf-gray font-bold mt-1">{subtitle}</div>
    </div>
  );
}

function DataPoint({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-white border-2 border-black p-3">
      <p className="text-[10px] font-black uppercase text-lf-gray">{label}</p>
      <p className="text-xl font-black mt-1 leading-tight">{value}</p>
      <p className="text-xs text-lf-gray font-bold mt-1 truncate">{detail}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border-2 border-black p-3">
      <p className="text-[10px] font-black uppercase text-lf-gray">{label}</p>
      <p className="text-sm font-bold mt-1 break-words">{value}</p>
    </div>
  );
}

function ShortcutButton({
  label,
  disabled,
  onClick,
  tone = "neutral",
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`border-2 border-black px-2 py-1 text-xs font-black uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        tone === "danger"
          ? "bg-red-100 text-red-900 hover:bg-red-200"
          : "bg-gray-100 text-gray-900 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
