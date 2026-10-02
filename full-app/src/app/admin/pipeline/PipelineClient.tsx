"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StatusUpdateModal } from "@/components/admin/StatusUpdateModal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Film,
  Link2,
  TrendingUp,
} from "lucide-react";
import {
  CANONICAL_CAMPAIGN_STATUSES,
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  type CanonicalCampaignStatus,
} from "@/types/index";
import {
  PIPELINE_LAUNCH_TARGET_DAY,
  PIPELINE_TIMELINE_END_DAY,
  getClientPendingTasks,
  getCurrentPipelineMilestone,
  getPipelineAgeInDays,
  getPipelineDayZero,
  getPipelineHealth,
  getPipelineProgressWithMode,
  getTimelineMilestones,
  isLaunchStatus,
  type PipelineTimelineCampaign,
  type TimelineMilestoneProgress,
  type TimelineMilestoneState,
} from "@/lib/pipeline-timeline";

const PIPELINE_STATUSES: CanonicalCampaignStatus[] = CANONICAL_CAMPAIGN_STATUSES;

const STATUS_BG: Record<CanonicalCampaignStatus, string> = {
  brief_received: "bg-lf-yellow/20 border-lf-yellow",
  campaign_proposal: "bg-blue-50 border-lf-blue",
  ad_creative: "bg-pink-50 border-lf-pink",
  meta_account_setup: "bg-orange-50 border-orange-300",
  live_optimizing: "bg-green-50 border-lf-green",
  reworks: "bg-orange-100 border-orange-500",
  paused: "bg-gray-100 border-gray-400",
  completed_project: "bg-emerald-50 border-emerald-700",
};

const ACTIVE_STATUSES: CanonicalCampaignStatus[] = CANONICAL_CAMPAIGN_STATUSES;

const HEALTH_PRIORITY = {
  critical: 0,
  warning: 1,
  on_track: 2,
  launched: 3,
} as const;

const VIDEO_BRANCH_STORAGE_KEY = "lf_pipeline_video_branch";
const PROJECT_START_STORAGE_KEY = "lf_pipeline_project_start";
const TIMELINE_INFO_WIDTH = 280;
const TIMELINE_DAY_WIDTH = 56;
const TIMELINE_ROW_HEIGHT = 208;

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffInDays(start: Date, end: Date): number {
  return Math.round(
    (startOfDay(end).getTime() - startOfDay(start).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function buildDateRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cursor = startOfDay(start);
  const target = startOfDay(end);

  while (cursor <= target) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function getClientName(campaign: PipelineTimelineCampaign): string {
  return campaign.profiles?.company || campaign.profiles?.full_name || "—";
}

function getCampaignBaseDayZero(campaign: PipelineTimelineCampaign): Date {
  return new Date(campaign.onboarding_submitted_at ?? campaign.created_at);
}

function getCampaignSortTimestamp(campaign: PipelineTimelineCampaign): number {
  return getCampaignBaseDayZero(campaign).getTime();
}

function formatTimelineDate(value: string | null): string {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildProjectStartIso(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
}

function formatProjectDay(ageDays: number): string {
  return ageDays >= 0 ? `J+${ageDays}` : `J${ageDays}`;
}

function getHealthLabel(health: ReturnType<typeof getPipelineHealth>): string {
  switch (health) {
    case "critical":
      return "Retard critique";
    case "warning":
      return "En retard";
    case "launched":
      return "Lancé";
    default:
      return "Dans les temps";
  }
}

function getHealthClasses(health: ReturnType<typeof getPipelineHealth>): string {
  switch (health) {
    case "critical":
      return "bg-red-500 text-white";
    case "warning":
      return "bg-lf-yellow text-black";
    case "launched":
      return "bg-lf-green text-white";
    default:
      return "bg-white text-black";
  }
}

function getStateLabel(state: TimelineMilestoneState): string {
  switch (state) {
    case "done":
      return "Fait";
    case "overdue":
      return "Retard";
    case "in_progress":
      return "En cours";
    default:
      return "À venir";
  }
}

function getStateClasses(state: TimelineMilestoneState): string {
  switch (state) {
    case "done":
      return "bg-lf-green text-white";
    case "overdue":
      return "bg-red-500 text-white";
    case "in_progress":
      return "bg-lf-blue text-white";
    default:
      return "bg-white text-black";
  }
}

function getMilestoneBoxClasses(milestone: TimelineMilestoneProgress): string {
  const base = "absolute h-9 border-2 px-2 text-[10px] font-black uppercase tracking-wide flex items-center justify-center text-center leading-tight";

  if (!milestone.enabled) {
    return `${base} border-dashed border-black/40 bg-white/40 text-lf-gray`;
  }

  if (milestone.state === "done") {
    return `${base} border-lf-green bg-lf-green/15 text-black`;
  }

  if (milestone.state === "overdue") {
    return `${base} border-red-500 bg-red-100 text-red-700`;
  }

  if (milestone.emphasize) {
    return `${base} border-black bg-[#ffd6d6] text-black`;
  }

  if (milestone.dashed) {
    return `${base} border-dashed border-black bg-white/70 text-black`;
  }

  if (milestone.state === "upcoming") {
    return `${base} border-black bg-white/70 text-lf-gray`;
  }

  return `${base} border-black bg-white text-black shadow-[3px_3px_0_#000]`;
}

function compareTimelineCampaigns(
  left: PipelineTimelineCampaign,
  right: PipelineTimelineCampaign,
  requiresLeftVideoScript: boolean,
  requiresRightVideoScript: boolean
): number {
  const leftHealth = getPipelineHealth(left, requiresLeftVideoScript);
  const rightHealth = getPipelineHealth(right, requiresRightVideoScript);

  if (HEALTH_PRIORITY[leftHealth] !== HEALTH_PRIORITY[rightHealth]) {
    return HEALTH_PRIORITY[leftHealth] - HEALTH_PRIORITY[rightHealth];
  }

  const leftAge = getPipelineAgeInDays(left);
  const rightAge = getPipelineAgeInDays(right);

  if (leftAge !== rightAge) {
    return rightAge - leftAge;
  }

  return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
}

function compareNewestCampaigns(
  left: PipelineTimelineCampaign,
  right: PipelineTimelineCampaign
): number {
  const sortDiff = getCampaignSortTimestamp(right) - getCampaignSortTimestamp(left);

  if (sortDiff !== 0) {
    return sortDiff;
  }

  return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
}

export function PipelineClient({
  campaigns,
  isSuperAdmin = false,
}: {
  campaigns: PipelineTimelineCampaign[];
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(campaigns);
  const [viewMode, setViewMode] = useState<"kanban" | "timeline">("kanban");
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [sortMode, setSortMode] = useState<"critical" | "newest">("critical");
  const [draggedCampaignId, setDraggedCampaignId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<CanonicalCampaignStatus | null>(null);
  const [savingCampaignId, setSavingCampaignId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [videoBranchByCampaign, setVideoBranchByCampaign] = useState<Record<string, boolean>>({});
  const [projectStartByCampaign, setProjectStartByCampaign] = useState<Record<string, string>>(
    {}
  );
  const [projectStartDraft, setProjectStartDraft] = useState("");
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<{
    open: boolean;
    campaignId: string;
    campaignName: string;
    clientName: string;
    clientEmail: string;
    clientId: string;
    oldStatus: string;
    newStatus: string;
  } | null>(null);
  const [statusModalLoading, setStatusModalLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(VIDEO_BRANCH_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      setVideoBranchByCampaign(parsed);
    } catch {
      // ignore invalid localStorage payload
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(PROJECT_START_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, string>;
      setProjectStartByCampaign(parsed);
    } catch {
      // ignore invalid localStorage payload
    }
  }, []);

  useEffect(() => {
    setItems(campaigns);
  }, [campaigns]);

  useEffect(() => {
    if (!isSuperAdmin || viewMode !== "timeline") return;

    const refreshId = window.setInterval(() => {
      setCalendarNow(new Date());
      router.refresh();
    }, 60000);

    return () => window.clearInterval(refreshId);
  }, [isSuperAdmin, router, viewMode]);

  const requiresVideoScript = (campaignId: string): boolean =>
    videoBranchByCampaign[campaignId] ?? false;

  const hasProjectStartOverride = (campaignId: string): boolean =>
    Boolean(projectStartByCampaign[campaignId]);

  const toggleVideoBranch = (campaignId: string, enabled: boolean) => {
    setVideoBranchByCampaign((prev) => {
      const next = { ...prev, [campaignId]: enabled };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(VIDEO_BRANCH_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const getDisplayedCampaign = (
    campaign: PipelineTimelineCampaign
  ): PipelineTimelineCampaign => {
    const override = projectStartByCampaign[campaign.id];
    if (!override || !/^\d{4}-\d{2}-\d{2}$/.test(override)) return campaign;

    return {
      ...campaign,
      onboarding_submitted_at: buildProjectStartIso(override),
    };
  };

  const saveProjectStartOverride = (
    campaignId: string,
    nextDate: string | null,
    baseCampaign: PipelineTimelineCampaign
  ) => {
    const baseValue = formatDateInputValue(getCampaignBaseDayZero(baseCampaign));

    setProjectStartByCampaign((prev) => {
      const next = { ...prev };
      const normalizedDate =
        nextDate && nextDate > baseValue ? nextDate : null;

      if (normalizedDate) {
        next[campaignId] = normalizedDate;
      } else {
        delete next[campaignId];
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(PROJECT_START_STORAGE_KEY, JSON.stringify(next));
      }

      return next;
    });
  };

  const displayedStatuses =
    filter === "active" ? ACTIVE_STATUSES : PIPELINE_STATUSES;

  const baseItemsById = new Map(items.map((campaign) => [campaign.id, campaign]));

  const filteredItems = items.filter((campaign) =>
    filter === "active"
      ? ACTIVE_STATUSES.includes(getCanonicalCampaignStatus(campaign))
      : true
  );

  const displayedItems = filteredItems.map(getDisplayedCampaign);

  const sortedItems = [...displayedItems].sort((left, right) => {
    if (sortMode === "newest") {
      return compareNewestCampaigns(
        baseItemsById.get(left.id) ?? left,
        baseItemsById.get(right.id) ?? right
      );
    }

    return compareTimelineCampaigns(
      left,
      right,
      requiresVideoScript(left.id),
      requiresVideoScript(right.id)
    );
  });

  const grouped = displayedStatuses.reduce<Record<CanonicalCampaignStatus, PipelineTimelineCampaign[]>>(
    (acc, status) => {
      acc[status] = sortedItems.filter(
        (campaign) => getCanonicalCampaignStatus(campaign) === status
      );
      return acc;
    },
    {} as Record<CanonicalCampaignStatus, PipelineTimelineCampaign[]>
  );

  const totalActive = items.filter((campaign) =>
    ACTIVE_STATUSES.includes(getCanonicalCampaignStatus(campaign))
  ).length;

  const criticalCount = displayedItems.filter((campaign) => {
    return getPipelineHealth(campaign, requiresVideoScript(campaign.id)) === "critical";
  }).length;
  const newestCount = filteredItems.length;

  const timelineCampaigns = sortedItems;
  const activeTimelineCampaignId =
    selectedCampaignId ?? timelineCampaigns[0]?.id ?? null;
  const selectedCampaign =
    timelineCampaigns.find((campaign) => campaign.id === activeTimelineCampaignId) ??
    null;
  const selectedBaseCampaign = activeTimelineCampaignId
    ? baseItemsById.get(activeTimelineCampaignId) ?? null
    : null;

  useEffect(() => {
    if (!selectedCampaign) {
      setProjectStartDraft("");
      return;
    }

    const fallbackDate = formatDateInputValue(
      getCampaignBaseDayZero(selectedBaseCampaign ?? selectedCampaign)
    );
    setProjectStartDraft(projectStartByCampaign[selectedCampaign.id] ?? fallbackDate);
  }, [projectStartByCampaign, selectedBaseCampaign, selectedCampaign]);

  const moveCampaign = async (
    campaignId: string,
    nextStatus: CanonicalCampaignStatus
  ) => {
    const campaign = items.find((item) => item.id === campaignId);
    if (!campaign || getCanonicalCampaignStatus(campaign) === nextStatus) {
      setDraggedCampaignId(null);
      setDropStatus(null);
      return;
    }

    const previousItems = items;
    const updatedAt = new Date().toISOString();

    setError(null);
    setSavingCampaignId(campaignId);
    setItems((prev) =>
      prev.map((item) =>
        item.id === campaignId
          ? { ...item, status: nextStatus, updated_at: updatedAt }
          : item
      )
    );

    try {
      const res = await fetch("/api/admin/update-campaign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          status: nextStatus,
          notes: campaign.notes ?? null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Impossible de mettre à jour le statut.");
      }
    } catch (e: unknown) {
      setItems(previousItems);
      setError(
        e instanceof Error ? e.message : "Impossible de mettre à jour le statut."
      );
    } finally {
      setSavingCampaignId(null);
      setDraggedCampaignId(null);
      setDropStatus(null);
    }
  };

  return (
    <div>
      {isSuperAdmin && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setViewMode("kanban")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              viewMode === "kanban"
                ? "bg-lf-black text-white shadow-brutal-sm"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            Kanban
          </button>
          <button
            onClick={() => setViewMode("timeline")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              viewMode === "timeline"
                ? "bg-lf-black text-white shadow-brutal-sm"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            Planning calendrier
          </button>
        </div>
      )}

      <div className="mb-6 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-lf-gray">
            Périmètre
          </span>
          <button
            onClick={() => setFilter("active")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              filter === "active"
                ? "bg-lf-black text-white shadow-brutal-sm"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            En cours ({totalActive})
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              filter === "all"
                ? "bg-lf-black text-white shadow-brutal-sm"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            Toutes ({items.length})
          </button>
        </div>
        <span className="hidden h-8 w-px bg-black/20 md:block" />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-lf-gray">
            Tri
          </span>
          <button
            onClick={() => setSortMode("critical")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              sortMode === "critical"
                ? "bg-red-500 text-white shadow-brutal-sm"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            Retards critiques ({criticalCount})
          </button>
          <button
            onClick={() => setSortMode("newest")}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              sortMode === "newest"
                ? "bg-lf-blue text-white shadow-brutal-sm"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            Nouveaux onboardés ({newestCount})
          </button>
        </div>
      </div>

      {viewMode === "timeline" && isSuperAdmin ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <CalendarTimelineView
            campaigns={timelineCampaigns}
            currentDate={calendarNow}
            selectedCampaignId={activeTimelineCampaignId}
            requiresVideoScript={requiresVideoScript}
            isProjectDelayed={hasProjectStartOverride}
            onSelectCampaign={setSelectedCampaignId}
          />
          <TimelineSidebar
            campaign={selectedCampaign}
            baseCampaign={selectedBaseCampaign}
            projectStartOverride={selectedCampaign ? projectStartByCampaign[selectedCampaign.id] ?? null : null}
            projectStartDraft={projectStartDraft}
            requiresVideoScript={selectedCampaign ? requiresVideoScript(selectedCampaign.id) : false}
            onProjectStartDraftChange={setProjectStartDraft}
            onSaveProjectStart={(value) => {
              if (!selectedCampaign || !selectedBaseCampaign) return;
              saveProjectStartOverride(selectedCampaign.id, value, selectedBaseCampaign);
            }}
            onToggleVideoBranch={(enabled) => {
              if (!selectedCampaign) return;
              toggleVideoBranch(selectedCampaign.id, enabled);
            }}
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-medium text-lf-gray">
              Glissez une carte vers une autre colonne pour changer son statut.
            </p>
            {savingCampaignId && (
              <p className="text-xs font-black uppercase tracking-wider text-lf-blue">
                Mise à jour en cours...
              </p>
            )}
          </div>

          {error && (
            <div className="mb-4 border-3 border-red-500 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-4 overflow-x-auto pb-4">
            {displayedStatuses.map((status) => {
              const cols = grouped[status];
              return (
                <div
                  key={status}
                  onDragOver={(e) => {
                    if (!draggedCampaignId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropStatus !== status) setDropStatus(status);
                  }}
                  onDragLeave={() => {
                    if (dropStatus === status) setDropStatus(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!draggedCampaignId) return;
                    const droppedCampaign = items.find((item) => item.id === draggedCampaignId);
                    if (!droppedCampaign) return;
                    const oldStatus = getCanonicalCampaignStatus(droppedCampaign);
                    if (oldStatus === status) {
                      setDraggedCampaignId(null);
                      setDropStatus(null);
                      return;
                    }
                    setStatusModal({
                      open: true,
                      campaignId: draggedCampaignId,
                      campaignName: droppedCampaign.name,
                      clientName: droppedCampaign.profiles?.company || droppedCampaign.profiles?.full_name || "—",
                      clientEmail: droppedCampaign.profiles?.email || "",
                      clientId: droppedCampaign.client_id,
                      oldStatus,
                      newStatus: status,
                    });
                  }}
                  className={`flex-shrink-0 w-72 border-3 border-black transition-colors ${
                    STATUS_BG[status]
                  } ${dropStatus === status ? "ring-4 ring-black/20" : ""}`}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b-3 border-black bg-white/60">
                    <span className="font-black text-xs uppercase tracking-wider">
                      {getCampaignStatusLabel(status)}
                    </span>
                    <span
                      className={`text-xs font-black px-2 py-0.5 border-2 border-black ${getCampaignStatusColor(status)}`}
                    >
                      {cols.length}
                    </span>
                  </div>

                  <div className="p-3 flex flex-col gap-3 min-h-[200px]">
                    {cols.length === 0 ? (
                      <p className="text-xs text-lf-gray font-medium text-center py-8">
                        {dropStatus === status && draggedCampaignId
                          ? "Déposer ici"
                          : "Aucun client"}
                      </p>
                    ) : (
                      cols.map((campaign) => (
                        <PipelineCard
                          key={campaign.id}
                          campaign={campaign}
                          isProjectDelayed={hasProjectStartOverride(campaign.id)}
                          isDragging={draggedCampaignId === campaign.id}
                          isSaving={savingCampaignId === campaign.id}
                          onDragStart={(campaignId) => {
                            setError(null);
                            setDraggedCampaignId(campaignId);
                          }}
                          onDragEnd={() => {
                            setDraggedCampaignId(null);
                            setDropStatus(null);
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {statusModal && (
        <StatusUpdateModal
          open={statusModal.open}
          onClose={() => {
            setStatusModal(null);
            setDraggedCampaignId(null);
            setDropStatus(null);
          }}
          onConfirm={async ({ sendEmail, customMessage, deliverables }) => {
            setStatusModalLoading(true);
            try {
              await moveCampaign(statusModal.campaignId, statusModal.newStatus as import("@/types/index").CanonicalCampaignStatus);
              if (sendEmail) {
                await fetch("/api/admin/send-status-update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    campaignId: statusModal.campaignId,
                    campaignName: statusModal.campaignName,
                    clientId: statusModal.clientId,
                    clientName: statusModal.clientName,
                    clientEmail: statusModal.clientEmail,
                    oldStatus: statusModal.oldStatus,
                    newStatus: statusModal.newStatus,
                    customMessage,
                    deliverables,
                  }),
                });
              }
            } finally {
              setStatusModalLoading(false);
              setStatusModal(null);
            }
          }}
          onCancel={() => {
            setStatusModal(null);
            setDraggedCampaignId(null);
            setDropStatus(null);
          }}
          campaignName={statusModal.campaignName}
          clientName={statusModal.clientName}
          clientEmail={statusModal.clientEmail}
          newStatus={statusModal.newStatus}
          oldStatus={statusModal.oldStatus}
          loading={statusModalLoading}
        />
      )}
    </div>
  );
}

function CalendarTimelineView({
  campaigns,
  currentDate,
  selectedCampaignId,
  requiresVideoScript,
  isProjectDelayed,
  onSelectCampaign,
}: {
  campaigns: PipelineTimelineCampaign[];
  currentDate: Date;
  selectedCampaignId: string | null;
  requiresVideoScript: (campaignId: string) => boolean;
  isProjectDelayed: (campaignId: string) => boolean;
  onSelectCampaign: (campaignId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCenteredTodayRef = useRef(false);
  const today = startOfDay(currentDate);

  const { dates, rangeStart, rangeEnd, todayIndex, timelineWidth } = useMemo(() => {
    const minDayZero = campaigns.length
      ? campaigns
          .map((campaign) => getPipelineDayZero(campaign))
          .reduce((min, current) => (current < min ? current : min))
      : today;

    const maxProjectedEnd = campaigns.length
      ? campaigns
          .map((campaign) => addDays(getPipelineDayZero(campaign), PIPELINE_TIMELINE_END_DAY))
          .reduce((max, current) => (current > max ? current : max))
      : addDays(today, PIPELINE_TIMELINE_END_DAY);

    const effectiveStart = startOfMonth(
      minDayZero < today ? minDayZero : today
    );
    const effectiveEnd = endOfMonth(
      maxProjectedEnd > addDays(today, PIPELINE_TIMELINE_END_DAY)
        ? maxProjectedEnd
        : addDays(today, PIPELINE_TIMELINE_END_DAY)
    );
    const dateRange = buildDateRange(effectiveStart, effectiveEnd);

    return {
      dates: dateRange,
      rangeStart: effectiveStart,
      rangeEnd: effectiveEnd,
      todayIndex: diffInDays(effectiveStart, today),
      timelineWidth: dateRange.length * TIMELINE_DAY_WIDTH,
    };
  }, [campaigns, today]);

  useEffect(() => {
    if (!scrollRef.current || hasCenteredTodayRef.current) return;

    scrollRef.current.scrollLeft = Math.max(
      todayIndex * TIMELINE_DAY_WIDTH - 240,
      0
    );
    hasCenteredTodayRef.current = true;
  }, [todayIndex]);

  const scrollByDays = (days: number) => {
    scrollRef.current?.scrollBy({
      left: days * TIMELINE_DAY_WIDTH,
      behavior: "smooth",
    });
  };

  const scrollToToday = () => {
    scrollRef.current?.scrollTo({
      left: Math.max(todayIndex * TIMELINE_DAY_WIDTH - 240, 0),
      behavior: "smooth",
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
            Planning calendaire
          </p>
          <p className="text-sm font-medium text-lf-gray mt-1">
            Axe réel du{" "}
            <span className="font-black text-black">{formatTimelineDate(rangeStart.toISOString())}</span>
            {" "}au{" "}
            <span className="font-black text-black">{formatTimelineDate(rangeEnd.toISOString())}</span>
            {" "}· J0 = démarrage effectif du projet
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => scrollByDays(-14)}
            className="px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-gray-100 transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5 inline mr-1" />
            - 2 semaines
          </button>
          <button
            onClick={scrollToToday}
            className="px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-yellow hover:shadow-brutal-xs transition-all"
          >
            Aujourd&apos;hui
          </button>
          <button
            onClick={() => scrollByDays(14)}
            className="px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-gray-100 transition-all"
          >
            + 2 semaines
            <ArrowRight className="w-3.5 h-3.5 inline ml-1" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-4">
        <div
          className="min-w-max"
          style={{ width: TIMELINE_INFO_WIDTH + timelineWidth }}
        >
          <CalendarTimelineHeader
            dates={dates}
            timelineWidth={timelineWidth}
            todayIndex={todayIndex}
          />
          <div className="mt-3 flex flex-col gap-3">
            {campaigns.map((campaign) => (
              <CalendarTimelineRow
                key={campaign.id}
                campaign={campaign}
                selected={selectedCampaignId === campaign.id}
                isProjectDelayed={isProjectDelayed(campaign.id)}
                requiresVideoScript={requiresVideoScript(campaign.id)}
                rangeStart={rangeStart}
                timelineWidth={timelineWidth}
                todayIndex={todayIndex}
                dates={dates}
                onSelect={() => onSelectCampaign(campaign.id)}
              />
            ))}
            {campaigns.length === 0 && (
              <div className="card-brutal p-12 text-center text-lf-gray font-medium">
                Aucune campagne dans ce filtre.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarTimelineHeader({
  dates,
  timelineWidth,
  todayIndex,
}: {
  dates: Date[];
  timelineWidth: number;
  todayIndex: number;
}) {
  return (
    <div
      className="grid items-stretch gap-4"
      style={{ gridTemplateColumns: `${TIMELINE_INFO_WIDTH}px ${timelineWidth}px` }}
    >
      <div className="sticky left-0 z-20 border-3 border-black bg-white p-4">
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
          Clients
        </p>
        <p className="text-sm font-medium mt-1">
          Tous les projets alignés sur les dates réelles.
        </p>
      </div>
      <div className="relative border-3 border-black bg-white overflow-hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${dates.length}, ${TIMELINE_DAY_WIDTH}px)` }}
        >
          {dates.map((date, index) => {
            const isToday = index === todayIndex;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const showMonth = date.getDate() === 1 || index === 0;

            return (
              <div
                key={date.toISOString()}
                className={`h-16 border-l border-black/10 px-1 py-2 ${
                  isWeekend ? "bg-black/5" : ""
                } ${isToday ? "bg-lf-yellow/30" : ""}`}
              >
                <p className="text-[9px] font-black uppercase tracking-wider text-lf-gray">
                  {date.toLocaleDateString("fr-FR", { weekday: "short" })}
                </p>
                <p className="text-sm font-black leading-none mt-1">
                  {date.getDate()}
                </p>
                <p className="text-[9px] font-medium text-lf-gray mt-1">
                  {showMonth
                    ? date.toLocaleDateString("fr-FR", { month: "short" })
                    : ""}
                </p>
              </div>
            );
          })}
        </div>
        {todayIndex >= 0 && todayIndex < dates.length && (
          <div
            className="absolute top-0 bottom-0 w-[3px] bg-lf-blue"
            style={{ left: `${todayIndex * TIMELINE_DAY_WIDTH}px` }}
          />
        )}
      </div>
    </div>
  );
}

function CalendarTimelineRow({
  campaign,
  selected,
  isProjectDelayed,
  requiresVideoScript,
  rangeStart,
  timelineWidth,
  todayIndex,
  dates,
  onSelect,
}: {
  campaign: PipelineTimelineCampaign;
  selected: boolean;
  isProjectDelayed: boolean;
  requiresVideoScript: boolean;
  rangeStart: Date;
  timelineWidth: number;
  todayIndex: number;
  dates: Date[];
  onSelect: () => void;
}) {
  const milestones = getTimelineMilestones(campaign, requiresVideoScript).filter(
    (milestone) => milestone.enabled
  );
  const ageDays = getPipelineAgeInDays(campaign);
  const health = getPipelineHealth(campaign, requiresVideoScript);
  const progress = getPipelineProgressWithMode(campaign, requiresVideoScript);
  const currentMilestone = getCurrentPipelineMilestone(campaign, requiresVideoScript);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="grid items-stretch gap-4"
      style={{ gridTemplateColumns: `${TIMELINE_INFO_WIDTH}px ${timelineWidth}px` }}
    >
      <div
        className={`sticky left-0 z-10 border-3 border-black p-4 transition-colors ${
          selected ? "bg-lf-yellow" : "bg-white hover:bg-gray-50"
        }`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="font-black text-sm uppercase truncate">
              {getClientName(campaign)}
            </p>
            <p className="text-xs font-medium text-lf-gray truncate">
              {campaign.name}
            </p>
          </div>
          <span
            className={`text-[10px] font-black px-2 py-1 border-2 border-black whitespace-nowrap ${getHealthClasses(
              health
            )}`}
          >
            {getHealthLabel(health)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span
            className={`text-[10px] font-black px-2 py-1 border-2 border-black ${getCampaignStatusColor(campaign)}`}
          >
            {getCampaignStatusLabel(campaign)}
          </span>
          <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-white">
            {formatProjectDay(ageDays)}
          </span>
          <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-white">
            {progress}%
          </span>
          {isProjectDelayed && (
            <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-lf-yellow">
              Démarrage décalé
            </span>
          )}
          {requiresVideoScript && (
            <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-white flex items-center gap-1">
              <Film className="w-3 h-3" />
              Vidéo
            </span>
          )}
        </div>

        {currentMilestone && (
          <p className="text-xs font-medium text-lf-gray mb-3">
            Étape actuelle :{" "}
            <span className="font-black text-black">{currentMilestone.label}</span>
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-lf-gray">
            J0 : {formatTimelineDate(getPipelineDayZero(campaign).toISOString())}
          </span>
          <Link
            href={`/admin/campaigns/${campaign.id}`}
            className="text-xs font-black uppercase text-lf-blue hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Voir →
          </Link>
        </div>
      </div>

      <div
        className={`relative overflow-hidden border-3 border-black bg-white ${
          selected ? "shadow-[6px_6px_0_#000]" : ""
        }`}
        style={{ height: TIMELINE_ROW_HEIGHT }}
      >
        <div
          className="absolute inset-0 grid pointer-events-none"
          style={{ gridTemplateColumns: `repeat(${dates.length}, ${TIMELINE_DAY_WIDTH}px)` }}
        >
          {dates.map((date, index) => {
            const isToday = index === todayIndex;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            return (
              <div
                key={date.toISOString()}
                className={`border-l border-black/10 ${
                  isWeekend ? "bg-black/5" : ""
                } ${isToday ? "bg-lf-yellow/20" : ""}`}
              />
            );
          })}
        </div>

        {todayIndex >= 0 && todayIndex < dates.length && (
          <div
            className="absolute top-0 bottom-0 w-[3px] bg-lf-blue/70"
            style={{ left: `${todayIndex * TIMELINE_DAY_WIDTH}px` }}
          />
        )}

        {milestones.map((milestone) => {
          const startDate = addDays(getPipelineDayZero(campaign), milestone.startDay);
          const left = diffInDays(rangeStart, startDate) * TIMELINE_DAY_WIDTH;
          const width = Math.max(
            (milestone.endDay - milestone.startDay) * TIMELINE_DAY_WIDTH,
            TIMELINE_DAY_WIDTH
          );

          return (
            <div
              key={milestone.id}
              className={getMilestoneBoxClasses(milestone)}
              style={{
                left,
                width,
                top: `${18 + milestone.lane * 32}px`,
              }}
            >
              {milestone.shortLabel}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineSidebar({
  campaign,
  baseCampaign,
  projectStartOverride,
  projectStartDraft,
  requiresVideoScript,
  onProjectStartDraftChange,
  onSaveProjectStart,
  onToggleVideoBranch,
}: {
  campaign: PipelineTimelineCampaign | null;
  baseCampaign: PipelineTimelineCampaign | null;
  projectStartOverride: string | null;
  projectStartDraft: string;
  requiresVideoScript: boolean;
  onProjectStartDraftChange: (value: string) => void;
  onSaveProjectStart: (value: string | null) => void;
  onToggleVideoBranch: (enabled: boolean) => void;
}) {
  if (!campaign) {
    return (
      <aside className="card-brutal p-6 xl:sticky xl:top-6 h-fit">
        <p className="font-black uppercase tracking-wider text-sm mb-2">
          Timeline client
        </p>
        <p className="text-sm font-medium text-lf-gray">
          Sélectionnez un client pour voir le détail du suivi.
        </p>
      </aside>
    );
  }

  const baseDayZero = getCampaignBaseDayZero(baseCampaign ?? campaign);
  const baseDayZeroValue = formatDateInputValue(baseDayZero);
  const effectiveDayZero = getPipelineDayZero(campaign);
  const effectiveDayZeroValue = formatDateInputValue(effectiveDayZero);
  const isProjectDelayed = Boolean(projectStartOverride);
  const milestones = getTimelineMilestones(campaign, requiresVideoScript);
  const pendingTasks = getClientPendingTasks(campaign);
  const ageDays = getPipelineAgeInDays(campaign);
  const health = getPipelineHealth(campaign, requiresVideoScript);
  const progress = getPipelineProgressWithMode(campaign, requiresVideoScript);
  const launchDeadline = new Date(effectiveDayZero);
  launchDeadline.setDate(launchDeadline.getDate() + PIPELINE_LAUNCH_TARGET_DAY);
  const canResetProjectStart = isProjectDelayed;
  const canSaveProjectStart = projectStartDraft !== effectiveDayZeroValue;

  return (
    <aside className="card-brutal p-6 xl:sticky xl:top-6 h-fit">
      <div className="mb-5">
        <div className="sticker -rotate-1 inline-block mb-3 text-xs">SUIVI</div>
        <h2 className="text-2xl font-black uppercase tracking-tight">
          {getClientName(campaign)}
        </h2>
        <p className="text-sm font-medium text-lf-gray mt-1">{campaign.name}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="border-3 border-black bg-white p-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            J actuel
          </p>
          <p className="text-2xl font-black">{formatProjectDay(ageDays)}</p>
        </div>
        <div className="border-3 border-black bg-white p-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            Progression
          </p>
          <p className="text-2xl font-black">{progress}%</p>
        </div>
      </div>

      <div className="border-3 border-black bg-white p-4 mb-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
              Démarrage projet
            </p>
            <p className="text-sm font-medium">
              Décalez le `J0` si le client a onboardé mais souhaite commencer plus tard.
            </p>
          </div>
          {isProjectDelayed && (
            <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-lf-yellow whitespace-nowrap">
              Décalé
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
              J0 effectif
            </span>
            <input
              type="date"
              value={projectStartDraft}
              min={baseDayZeroValue}
              onChange={(event) => onProjectStartDraftChange(event.target.value)}
              className="mt-1 w-full border-3 border-black bg-white px-3 py-2 text-sm font-medium focus:outline-none focus:border-lf-blue"
            />
          </label>
          <button
            type="button"
            disabled={!canSaveProjectStart}
            onClick={() => {
              const nextDate =
                projectStartDraft === baseDayZeroValue ? null : projectStartDraft;
              onSaveProjectStart(nextDate || null);
            }}
            className={`px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              canSaveProjectStart
                ? "bg-lf-black text-white hover:bg-lf-blue"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            Appliquer
          </button>
          <button
            type="button"
            disabled={!canResetProjectStart}
            onClick={() => {
              onProjectStartDraftChange(baseDayZeroValue);
              onSaveProjectStart(null);
            }}
            className={`px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              canResetProjectStart
                ? "bg-white text-black hover:bg-gray-100"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="border-3 border-black bg-white p-4 mb-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
              Branche vidéo
            </p>
            <p className="text-sm font-medium">
              {requiresVideoScript
                ? "Le client suit aussi le flux script vidéo + montage."
                : "Le client reste sur le flux créatifs statiques par défaut."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onToggleVideoBranch(!requiresVideoScript)}
            className={`px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              requiresVideoScript
                ? "bg-lf-black text-white"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            {requiresVideoScript ? "Vidéo ON" : "Vidéo OFF"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span
          className={`text-xs font-black px-2 py-1 border-2 border-black ${getCampaignStatusColor(campaign)}`}
        >
          {getCampaignStatusLabel(campaign)}
        </span>
        <span
          className={`text-xs font-black px-2 py-1 border-2 border-black ${getHealthClasses(
            health
          )}`}
        >
          {getHealthLabel(health)}
        </span>
      </div>

      <div className="space-y-2 mb-6 text-sm font-medium">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-lf-gray" />
          <span>
            Onboarding reçu :{" "}
            <span className="font-black">
              {formatTimelineDate(baseDayZero.toISOString())}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-lf-gray" />
          <span>
            J0 effectif :{" "}
            <span className="font-black">
              {formatTimelineDate(effectiveDayZero.toISOString())}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Clock3 className="w-4 h-4 text-lf-gray" />
          <span>
            Deadline lancement J+8 :{" "}
            <span className="font-black">{formatTimelineDate(launchDeadline.toISOString())}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-lf-gray" />
          <span>
            Prochain catch-up :{" "}
            <span className="font-black">
              {formatTimelineDate(campaign.profiles?.next_catchup ?? null)}
            </span>
          </span>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4" />
          <h3 className="font-black uppercase tracking-wider text-sm">
            Tâches projet
          </h3>
        </div>
        <div className="flex flex-col gap-2">
          {milestones.map((milestone) => (
            <div key={milestone.id} className="border-2 border-black bg-white p-3">
              <div className="flex items-start justify-between gap-3 mb-1">
                <p className="text-sm font-black uppercase leading-tight">
                  {milestone.label}
                </p>
                <span
                  className={`text-[10px] font-black px-2 py-1 border-2 border-black whitespace-nowrap ${
                    milestone.enabled
                      ? getStateClasses(milestone.state)
                      : "bg-white text-lf-gray"
                  }`}
                >
                  {milestone.enabled ? getStateLabel(milestone.state) : "Non requis"}
                </span>
              </div>
              <p className="text-xs font-medium text-lf-gray">
                Fenêtre J{milestone.startDay} → J{milestone.endDay} · deadline{" "}
                <span className="font-black text-black">{milestone.dueDate}</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4" />
          <h3 className="font-black uppercase tracking-wider text-sm">
            Tâches client
          </h3>
        </div>
        {campaign.client_tasks.length === 0 ? (
          <div className="border-2 border-dashed border-black bg-white p-4 text-sm font-medium text-lf-gray">
            Aucune tâche client créée pour ce compte.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {campaign.client_tasks.map((task) => (
              <div key={task.id} className="border-2 border-black bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-black uppercase leading-tight">
                    {task.title}
                  </p>
                  <span
                    className={`text-[10px] font-black px-2 py-1 border-2 border-black whitespace-nowrap ${
                      task.is_completed
                        ? "bg-lf-green text-white"
                        : "bg-lf-yellow text-black"
                    }`}
                  >
                    {task.is_completed ? "Fait" : "À faire"}
                  </span>
                </div>
                {task.description && (
                  <p className="text-xs font-medium text-lf-gray mt-1">
                    {task.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-3 border-black bg-lf-yellow p-4">
        <p className="text-xs font-black uppercase tracking-wider mb-1">
          Signal d’alerte
        </p>
        <p className="text-sm font-medium">
          {isLaunchStatus(campaign.status)
            ? "Le client est déjà en phase de lancement ou post-lancement."
            : ageDays < 0
              ? `Le projet démarre dans ${Math.abs(ageDays)} jour(s). La deadline J+${PIPELINE_LAUNCH_TARGET_DAY} glisse automatiquement avec ce nouveau J0.`
            : ageDays > PIPELINE_LAUNCH_TARGET_DAY
              ? `Le client a dépassé l’objectif J+${PIPELINE_LAUNCH_TARGET_DAY} sans lancement.`
              : `Le client a encore ${PIPELINE_LAUNCH_TARGET_DAY - ageDays} jour(s) pour atteindre le lancement cible.`}
        </p>
        {pendingTasks.length > 0 && (
          <p className="text-xs font-black uppercase tracking-wider mt-3">
            {pendingTasks.length} tâche{pendingTasks.length > 1 ? "s" : ""} client encore ouverte
            {pendingTasks.length > 1 ? "s" : ""}
          </p>
        )}
      </div>
    </aside>
  );
}

function PipelineCard({
  campaign,
  isProjectDelayed,
  isDragging,
  isSaving,
  onDragStart,
  onDragEnd,
}: {
  campaign: PipelineTimelineCampaign;
  isProjectDelayed: boolean;
  isDragging: boolean;
  isSaving: boolean;
  onDragStart: (campaignId: string) => void;
  onDragEnd: () => void;
}) {
  const clientName = getClientName(campaign);
  const daysAgo = Math.floor(
    (Date.now() - new Date(campaign.updated_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Alerte Meta non lié : statuts au-delà de brief_received sans ad_account_id
  const canonicalStatus = getCanonicalCampaignStatus(campaign);
  const STATUSES_REQUIRING_META = ["campaign_proposal", "ad_creative", "meta_account_setup", "live_optimizing"];
  const metaNotLinked = STATUSES_REQUIRING_META.includes(canonicalStatus) && !campaign.ad_account_id;

  return (
    <Link
      href={`/admin/campaigns/${campaign.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", campaign.id);
        onDragStart(campaign.id);
      }}
      onDragEnd={onDragEnd}
      className={`block p-4 transition-all group cursor-grab active:cursor-grabbing border-3 ${
        metaNotLinked ? "border-red-500 bg-red-50" : "border-black bg-white"
      } ${
        isDragging
          ? "opacity-40"
          : "hover:shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5"
      } ${isSaving ? "ring-4 ring-lf-blue/20" : ""}`}
    >
      <p className="font-black text-sm uppercase truncate mb-1 group-hover:text-lf-blue transition-colors">
        {clientName}
      </p>
      <p className="text-xs text-lf-gray font-medium truncate mb-3">
        {campaign.name}
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {campaign.budget_monthly != null && (
          <span className="flex items-center gap-1 text-xs font-bold bg-lf-yellow border-2 border-black px-2 py-0.5">
            <TrendingUp className="w-3 h-3" />
            {campaign.budget_monthly}€/m
          </span>
        )}
        {campaign.ad_account_id ? (
          <span className="flex items-center gap-1 text-xs font-bold bg-green-100 border-2 border-black px-2 py-0.5">
            <Link2 className="w-3 h-3" />
            Meta lié
          </span>
        ) : metaNotLinked ? (
          <span className="flex items-center gap-1 text-xs font-bold bg-red-100 text-red-700 border-2 border-red-500 px-2 py-0.5 animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            Compte Meta non lié
          </span>
        ) : null}
        {campaign.ai_creative_prompt && (
          <span className="text-xs font-bold bg-purple-100 border-2 border-black px-2 py-0.5">
            IA ✓
          </span>
        )}
        {isProjectDelayed && (
          <span className="text-xs font-bold bg-lf-yellow border-2 border-black px-2 py-0.5">
            J0 décalé
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-lf-gray font-medium">
          <Calendar className="w-3 h-3" />
          {daysAgo === 0 ? "Aujourd'hui" : `il y a ${daysAgo}j`}
        </span>
        <div className="flex items-center gap-2">
          {isSaving && (
            <span className="text-[10px] font-black uppercase tracking-wider text-lf-blue">
              Update...
            </span>
          )}
          <ChevronRight className="w-3.5 h-3.5 text-lf-gray group-hover:text-lf-blue transition-colors" />
        </div>
      </div>
    </Link>
  );
}
