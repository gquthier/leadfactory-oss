"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  User,
  Phone,
  Mail,
  Euro,
  Calendar,
  Tag,
  GripVertical,
  Star,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineStage {
  id: string;
  name: string;
  color: string;
  display_order: number;
  is_default: boolean;
  is_won: boolean;
  is_lost: boolean;
}

interface CRMLead {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  pipeline_stage_id: string | null;
  quality_score: number | null;
  revenue: number | null;
  cash_collected: number | null;
  notes: string | null;
  tags: string[];
  last_contacted_at: string | null;
  next_follow_up: string | null;
  created_at: string;
  campaigns?: { name: string } | null;
}

interface Props {
  leads: CRMLead[];
  stages: PipelineStage[];
  onLeadClick: (lead: CRMLead) => void;
  onStageDrop: (leadId: string, newStageId: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  manual: "Manuel",
  website: "Site web",
  referral: "Recommandation",
  phone: "Téléphone",
  email: "Email",
  linkedin: "LinkedIn",
  salon: "Salon/Événement",
  other: "Autre",
};

const SOURCE_COLORS: Record<string, string> = {
  meta_ads: "bg-blue-100 text-blue-700",
  google_ads: "bg-red-100 text-red-700",
  manual: "bg-gray-100 text-gray-700",
  website: "bg-purple-100 text-purple-700",
  referral: "bg-green-100 text-green-700",
  phone: "bg-yellow-100 text-yellow-700",
  email: "bg-pink-100 text-pink-700",
  linkedin: "bg-sky-100 text-sky-700",
  salon: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-500",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return null;
  }
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

// ── Quality Stars (read-only) ─────────────────────────────────────────────────

function QualityStars({ score }: { score: number | null }) {
  if (score === null) return null;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${
            n <= score
              ? score >= 4
                ? "fill-lf-green text-lf-green"
                : score >= 3
                ? "fill-lf-yellow text-lf-yellow"
                : "fill-red-400 text-red-400"
              : "text-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

// ── Source Badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const label = SOURCE_LABELS[source] ?? source;
  const color = SOURCE_COLORS[source] ?? SOURCE_COLORS.other;
  return (
    <span
      className={`inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 leading-none ${color}`}
    >
      {label}
    </span>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

interface LeadCardProps {
  lead: CRMLead;
  onClick: (lead: CRMLead) => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
}

function LeadCard({ lead, onClick, onDragStart }: LeadCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const displayName = lead.full_name ?? lead.email ?? lead.phone ?? "Lead sans nom";
  const followUpDate = formatDate(lead.next_follow_up);
  const followUpOverdue = isOverdue(lead.next_follow_up);

  return (
    <div
      draggable
      onDragStart={(e) => {
        setIsDragging(true);
        onDragStart(e, lead.id);
      }}
      onDragEnd={() => setIsDragging(false)}
      onClick={() => onClick(lead)}
      className={`
        group relative bg-white border-2 border-black cursor-pointer
        transition-all duration-150 select-none
        hover:shadow-brutal-sm hover:-translate-y-0.5
        ${isDragging ? "opacity-50 rotate-1 shadow-none" : "shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"}
      `}
    >
      {/* Drag handle accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gray-200 group-hover:bg-lf-blue transition-colors" />

      <div className="pl-3 pr-3 pt-3 pb-2.5 space-y-2">
        {/* Header: name + grip */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight text-lf-black truncate">
              {displayName}
            </p>
            {lead.company && (
              <p className="text-[11px] text-gray-500 font-medium truncate mt-0.5">
                {lead.company}
              </p>
            )}
          </div>
          <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-none mt-0.5 transition-colors cursor-grab active:cursor-grabbing" />
        </div>

        {/* Contact info row */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {lead.email && (
            <span className="flex items-center gap-1 text-[10px] text-gray-500 font-medium truncate max-w-full">
              <Mail className="w-2.5 h-2.5 flex-none" />
              <span className="truncate">{lead.email}</span>
            </span>
          )}
          {lead.phone && (
            <span className="flex items-center gap-1 text-[10px] text-gray-500 font-medium">
              <Phone className="w-2.5 h-2.5 flex-none" />
              {lead.phone}
            </span>
          )}
        </div>

        {/* Source + Quality row */}
        <div className="flex items-center justify-between gap-2">
          <SourceBadge source={lead.source} />
          <QualityStars score={lead.quality_score} />
        </div>

        {/* Revenue + Follow-up row */}
        {(lead.revenue != null || followUpDate) && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            {lead.revenue != null ? (
              <span className="flex items-center gap-0.5 text-xs font-black text-lf-green">
                <Euro className="w-3 h-3" />
                {fmt(lead.revenue, 0)}
              </span>
            ) : (
              <span />
            )}
            {followUpDate && (
              <span
                className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 border ${
                  followUpOverdue
                    ? "bg-red-50 border-red-300 text-red-600"
                    : "bg-lf-yellow/30 border-lf-yellow text-yellow-800"
                }`}
              >
                <Calendar className="w-2.5 h-2.5 flex-none" />
                {followUpDate}
              </span>
            )}
          </div>
        )}

        {/* Campaign badge */}
        {lead.campaigns?.name && (
          <p className="text-[10px] text-gray-400 font-medium truncate border-t border-gray-100 pt-1.5">
            {lead.campaigns.name}
          </p>
        )}

        {/* Tags */}
        {lead.tags && lead.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            <Tag className="w-2.5 h-2.5 text-gray-300 flex-none mt-0.5" />
            {lead.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-lf-pink/40 border border-lf-pink text-gray-700 leading-none"
              >
                {tag}
              </span>
            ))}
            {lead.tags.length > 4 && (
              <span className="text-[9px] font-bold text-gray-400">
                +{lead.tags.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty Drop Zone ───────────────────────────────────────────────────────────

function EmptyDropZone({ isDragOver }: { isDragOver: boolean }) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center gap-2 py-8 px-4
        border-2 border-dashed transition-all duration-150
        ${
          isDragOver
            ? "border-lf-blue bg-blue-50 scale-[1.02]"
            : "border-gray-300 bg-gray-50/50"
        }
      `}
    >
      <User
        className={`w-6 h-6 transition-colors ${isDragOver ? "text-lf-blue" : "text-gray-300"}`}
      />
      <p
        className={`text-xs font-bold uppercase tracking-wide transition-colors ${
          isDragOver ? "text-lf-blue" : "text-gray-400"
        }`}
      >
        Glissez un lead ici
      </p>
    </div>
  );
}

// ── Column Header ─────────────────────────────────────────────────────────────

interface ColumnHeaderProps {
  stage: PipelineStage;
  count: number;
  totalRevenue: number;
}

function ColumnHeader({ stage, count, totalRevenue }: ColumnHeaderProps) {
  return (
    <div className="flex-none border-b-3 border-black bg-lf-black text-white px-3 py-3">
      <div className="flex items-center gap-2">
        {/* Color dot using inline style for dynamic stage colors */}
        <span
          className="w-3 h-3 flex-none border-2 border-white/30"
          style={{ backgroundColor: stage.color || "#6B7280" }}
        />
        <h3 className="font-black uppercase text-xs tracking-widest leading-none flex-1 truncate">
          {stage.name}
        </h3>
        <span className="flex-none bg-white text-lf-black text-[10px] font-black px-1.5 py-0.5 min-w-[20px] text-center">
          {count}
        </span>
      </div>
      {totalRevenue > 0 && (
        <div className="flex items-center gap-1 mt-2">
          <Euro className="w-3 h-3 text-lf-green" />
          <span className="text-xs font-bold text-lf-green">{fmt(totalRevenue, 0)}</span>
          <span className="text-[10px] text-white/40 font-medium">pipeline</span>
        </div>
      )}
    </div>
  );
}

// ── Column Footer ─────────────────────────────────────────────────────────────

interface ColumnFooterProps {
  count: number;
  totalRevenue: number;
  isWon: boolean;
  isLost: boolean;
}

function ColumnFooter({ count, totalRevenue, isWon, isLost }: ColumnFooterProps) {
  return (
    <div
      className={`flex-none border-t-2 border-black/10 px-3 py-2 flex items-center justify-between ${
        isWon ? "bg-green-50" : isLost ? "bg-gray-100" : "bg-white"
      }`}
    >
      <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">
        {count} lead{count !== 1 ? "s" : ""}
      </span>
      {totalRevenue > 0 && (
        <span className="text-[10px] font-black text-lf-green flex items-center gap-0.5">
          <Euro className="w-2.5 h-2.5" />
          {fmt(totalRevenue, 0)}
        </span>
      )}
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  stage: PipelineStage;
  leads: CRMLead[];
  onLeadClick: (lead: CRMLead) => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  onDrop: (stageId: string) => void;
}

function KanbanColumn({
  stage,
  leads,
  onLeadClick,
  onDragStart,
  onDrop,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const totalRevenue = useMemo(
    () => leads.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
    [leads]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);
      onDrop(stage.id);
    },
    [stage.id, onDrop]
  );

  // Determine column background
  const columnBg = stage.is_won
    ? "bg-green-50/60"
    : stage.is_lost
    ? "bg-gray-100/60"
    : "bg-canvas";

  const dragOverStyles = isDragOver
    ? "ring-4 ring-lf-blue ring-inset border-lf-blue"
    : "border-black";

  return (
    <div
      className={`
        flex flex-col flex-none border-3 shadow-brutal transition-all duration-150
        ${columnBg} ${dragOverStyles}
      `}
      style={{ minWidth: "280px", maxWidth: "320px", width: "300px" }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <ColumnHeader stage={stage} count={leads.length} totalRevenue={totalRevenue} />

      {/* Cards scroll area */}
      <div
        className={`
          flex-1 overflow-y-auto p-2 space-y-2 transition-colors duration-150 min-h-[120px]
          ${isDragOver ? "bg-blue-50/40" : ""}
        `}
        style={{ maxHeight: "calc(100vh - 320px)", minHeight: "120px" }}
      >
        {leads.length === 0 ? (
          <EmptyDropZone isDragOver={isDragOver} />
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onClick={onLeadClick}
              onDragStart={onDragStart}
            />
          ))
        )}

        {/* Extra drop target at bottom when cards exist */}
        {leads.length > 0 && isDragOver && (
          <div className="h-14 border-2 border-dashed border-lf-blue bg-blue-50 flex items-center justify-center">
            <span className="text-xs font-bold text-lf-blue uppercase tracking-wide">
              Déposer ici
            </span>
          </div>
        )}
      </div>

      {/* Column footer */}
      <ColumnFooter
        count={leads.length}
        totalRevenue={totalRevenue}
        isWon={stage.is_won}
        isLost={stage.is_lost}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CRMPipelineKanban({ leads, stages, onLeadClick, onStageDrop }: Props) {
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);

  // Sort stages by display_order
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.display_order - b.display_order),
    [stages]
  );

  // Find the default stage (fallback bucket for unassigned leads)
  const defaultStage = useMemo(
    () =>
      sortedStages.find((s) => s.is_default) ?? sortedStages[0] ?? null,
    [sortedStages]
  );

  // Group leads by stage
  const leadsByStage = useMemo(() => {
    const map: Record<string, CRMLead[]> = {};
    for (const stage of sortedStages) {
      map[stage.id] = [];
    }
    for (const lead of leads) {
      const stageId =
        lead.pipeline_stage_id && map[lead.pipeline_stage_id] !== undefined
          ? lead.pipeline_stage_id
          : defaultStage?.id ?? null;
      if (stageId && map[stageId]) {
        map[stageId].push(lead);
      }
    }
    return map;
  }, [leads, sortedStages, defaultStage]);

  // Total pipeline stats
  const totalRevenue = useMemo(
    () => leads.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
    [leads]
  );

  const wonStage = sortedStages.find((s) => s.is_won);
  const wonLeads = wonStage ? leadsByStage[wonStage.id] ?? [] : [];
  const wonRevenue = wonLeads.reduce((sum, l) => sum + (l.revenue ?? 0), 0);

  const handleDragStart = useCallback(
    (e: React.DragEvent, leadId: string) => {
      setDraggingLeadId(leadId);
      e.dataTransfer.setData("text/plain", leadId);
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleDrop = useCallback(
    (stageId: string) => {
      if (draggingLeadId) {
        onStageDrop(draggingLeadId, stageId);
        setDraggingLeadId(null);
      }
    },
    [draggingLeadId, onStageDrop]
  );

  if (sortedStages.length === 0) {
    return (
      <div className="border-3 border-black bg-white shadow-brutal p-16 text-center">
        <p className="font-black uppercase text-gray-400 tracking-wide text-sm">
          Aucune étape de pipeline configurée
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Contactez votre administrateur pour configurer le pipeline CRM.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Board-level stats bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 border-3 border-black bg-lf-black text-white px-4 py-2 shadow-brutal-sm">
          <User className="w-4 h-4 text-lf-yellow" />
          <span className="font-black text-sm uppercase tracking-wide">
            {leads.length} lead{leads.length !== 1 ? "s" : ""}
          </span>
        </div>

        {totalRevenue > 0 && (
          <div className="flex items-center gap-2 border-3 border-black bg-white px-4 py-2 shadow-brutal-sm">
            <Euro className="w-4 h-4 text-lf-green" />
            <span className="font-black text-sm text-lf-green">
              {fmt(totalRevenue, 0)} €
            </span>
            <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wide">
              pipeline total
            </span>
          </div>
        )}

        {wonRevenue > 0 && (
          <div className="flex items-center gap-2 border-3 border-lf-green bg-green-50 px-4 py-2 shadow-brutal-sm">
            <Euro className="w-4 h-4 text-lf-green" />
            <span className="font-black text-sm text-lf-green">
              {fmt(wonRevenue, 0)} €
            </span>
            <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">
              gagnés
            </span>
          </div>
        )}

        <div className="ml-auto text-[10px] font-bold uppercase text-gray-400 tracking-wide flex items-center gap-1.5 border-2 border-dashed border-gray-200 px-3 py-2">
          <GripVertical className="w-3 h-3" />
          Glissez les cartes pour changer d&apos;étape
        </div>
      </div>

      {/* Kanban Board */}
      <div
        className="
          overflow-x-auto pb-4
          md:overflow-x-auto
        "
      >
        {/* Mobile: vertical stack; Desktop: horizontal row */}
        <div
          className="
            flex flex-col gap-4
            md:flex-row md:gap-4 md:items-start
          "
          style={{ minWidth: "max-content" }}
        >
          {sortedStages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              leads={leadsByStage[stage.id] ?? []}
              onLeadClick={onLeadClick}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
