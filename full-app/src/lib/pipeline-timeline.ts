import {
  getCanonicalCampaignStatus,
  type CampaignStatus,
} from "@/types/index";

export type PipelineClientTask = {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PipelineTimelineCampaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  budget_monthly: number | null;
  created_at: string;
  updated_at: string;
  ad_account_id: string | null;
  ai_creative_prompt: string | null;
  notes: string | null;
  client_id: string;
  onboarding_response_id: string | null;
  onboarding_submitted_at: string | null;
  profiles: {
    full_name: string;
    company: string | null;
    email: string;
    next_catchup: string | null;
  } | null;
  client_tasks: PipelineClientTask[];
};

export type TimelineMilestoneState =
  | "done"
  | "in_progress"
  | "upcoming"
  | "overdue";

export type TimelineMilestoneId =
  | "onboarding"
  | "proposal"
  | "creative_static"
  | "script_video"
  | "meta_setup"
  | "client_realise"
  | "montage_video"
  | "add_to_campaigns"
  | "launch";

export type TimelineMilestoneDefinition = {
  id: TimelineMilestoneId;
  label: string;
  shortLabel: string;
  startDay: number;
  endDay: number;
  dueDay: number;
  lane: number;
  optional?: boolean;
  dashed?: boolean;
  emphasize?: boolean;
  videoOnly?: boolean;
};

export type TimelineMilestoneProgress = TimelineMilestoneDefinition & {
  dueDate: string;
  state: TimelineMilestoneState;
  complete: boolean;
  enabled: boolean;
};

export type PipelineHealth = "on_track" | "warning" | "critical" | "launched";

export const PIPELINE_TIMELINE_END_DAY = 13;
export const PIPELINE_LAUNCH_TARGET_DAY = 8;

export const TIMELINE_MILESTONES: TimelineMilestoneDefinition[] = [
  {
    id: "onboarding",
    label: "Onboarding",
    shortLabel: "Onboarding",
    startDay: 0,
    endDay: 2,
    dueDay: 2,
    lane: 0,
  },
  {
    id: "proposal",
    label: "Proposition de campagne",
    shortLabel: "Proposition",
    startDay: 1,
    endDay: 3,
    dueDay: 3,
    lane: 1,
  },
  {
    id: "creative_static",
    label: "Creative static",
    shortLabel: "Creative static",
    startDay: 3,
    endDay: 5,
    dueDay: 5,
    lane: 2,
    emphasize: true,
  },
  {
    id: "script_video",
    label: "Script vidéo (VSL & ADS)",
    shortLabel: "Script vidéo",
    startDay: 3,
    endDay: 5,
    dueDay: 5,
    lane: 3,
    dashed: true,
    optional: true,
    videoOnly: true,
  },
  {
    id: "meta_setup",
    label: "Mise en place du compte Meta",
    shortLabel: "Compte Meta",
    startDay: 5,
    endDay: 7,
    dueDay: 6,
    lane: 2,
  },
  {
    id: "client_realise",
    label: "Client réalise",
    shortLabel: "Client réalise",
    startDay: 5,
    endDay: 8,
    dueDay: 8,
    lane: 3,
    videoOnly: true,
  },
  {
    id: "montage_video",
    label: "Montage vidéo",
    shortLabel: "Montage vidéo",
    startDay: 8,
    endDay: 10,
    dueDay: 10,
    lane: 4,
    videoOnly: true,
  },
  {
    id: "add_to_campaigns",
    label: "Ajout aux campagnes",
    shortLabel: "Ajout campagnes",
    startDay: 10,
    endDay: 12,
    dueDay: 12,
    lane: 4,
    videoOnly: true,
  },
  {
    id: "launch",
    label: "Lancement",
    shortLabel: "Lancement",
    startDay: 7,
    endDay: 13,
    dueDay: PIPELINE_LAUNCH_TARGET_DAY,
    lane: 1,
  },
];

const POST_LAUNCH_STATUSES = new Set([
  "live_optimizing",
  "reworks",
  "paused",
  "completed_project",
]);

export function isLaunchStatus(status: CampaignStatus): boolean {
  return POST_LAUNCH_STATUSES.has(getCanonicalCampaignStatus(status));
}

export function getPipelineDayZero(campaign: PipelineTimelineCampaign): Date {
  return new Date(campaign.onboarding_submitted_at ?? campaign.created_at);
}

export function getPipelineAgeInDays(campaign: PipelineTimelineCampaign): number {
  const dayZero = getPipelineDayZero(campaign);
  const now = new Date();
  const diffMs = now.getTime() - dayZero.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getClientPendingTasks(campaign: PipelineTimelineCampaign): PipelineClientTask[] {
  return campaign.client_tasks.filter((task) => !task.is_completed);
}

function isMilestoneComplete(
  campaign: PipelineTimelineCampaign,
  milestoneId: TimelineMilestoneId,
  requiresVideoScript: boolean
): boolean {
  const workflowStatus = getCanonicalCampaignStatus(campaign);
  const liveLike = POST_LAUNCH_STATUSES.has(workflowStatus);
  const pendingTasks = getClientPendingTasks(campaign);

  switch (milestoneId) {
    case "onboarding":
      return workflowStatus !== "brief_received";
    case "proposal":
      return !["brief_received", "campaign_proposal"].includes(workflowStatus);
    case "creative_static":
      return Boolean(campaign.ai_creative_prompt) || workflowStatus === "meta_account_setup" || liveLike;
    case "script_video":
      if (!requiresVideoScript) return false;
      return liveLike || pendingTasks.length === 0;
    case "meta_setup":
      return Boolean(campaign.ad_account_id) || liveLike;
    case "client_realise":
      if (!requiresVideoScript) return false;
      return liveLike || (campaign.client_tasks.length > 0 && pendingTasks.length === 0);
    case "montage_video":
      if (!requiresVideoScript) return false;
      return liveLike;
    case "add_to_campaigns":
      if (!requiresVideoScript) return false;
      return liveLike;
    case "launch":
      return liveLike;
    default:
      return false;
  }
}

function addDays(baseDate: Date, days: number): Date {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export function getTimelineMilestones(
  campaign: PipelineTimelineCampaign,
  requiresVideoScript = false
): TimelineMilestoneProgress[] {
  const dayZero = getPipelineDayZero(campaign);
  const ageDays = getPipelineAgeInDays(campaign);

  return TIMELINE_MILESTONES.map((milestone) => {
    const enabled = !milestone.videoOnly || requiresVideoScript;
    const complete = enabled
      ? isMilestoneComplete(campaign, milestone.id, requiresVideoScript)
      : false;
    let state: TimelineMilestoneState = "upcoming";

    if (!enabled) {
      state = "upcoming";
    } else if (complete) {
      state = "done";
    } else if (ageDays > milestone.dueDay) {
      state = "overdue";
    } else if (ageDays >= milestone.startDay) {
      state = "in_progress";
    }

    return {
      ...milestone,
      complete,
      enabled,
      state,
      dueDate: formatDate(addDays(dayZero, milestone.dueDay)),
    };
  });
}

export function getPipelineHealth(
  campaign: PipelineTimelineCampaign,
  requiresVideoScript = false
): PipelineHealth {
  const ageDays = getPipelineAgeInDays(campaign);
  const milestones = getTimelineMilestones(campaign, requiresVideoScript).filter(
    (milestone) => !milestone.optional && milestone.enabled
  );

  if (POST_LAUNCH_STATUSES.has(getCanonicalCampaignStatus(campaign))) {
    return "launched";
  }

  if (ageDays > PIPELINE_LAUNCH_TARGET_DAY) {
    return "critical";
  }

  if (milestones.some((milestone) => milestone.state === "overdue")) {
    return "warning";
  }

  return "on_track";
}

export function getPipelineProgress(campaign: PipelineTimelineCampaign): number {
  return getPipelineProgressWithMode(campaign, false);
}

export function getPipelineProgressWithMode(
  campaign: PipelineTimelineCampaign,
  requiresVideoScript = false
): number {
  const milestones = getTimelineMilestones(campaign, requiresVideoScript).filter(
    (milestone) => !milestone.optional && milestone.enabled
  );
  const completed = milestones.filter((milestone) => milestone.complete).length;

  return Math.round((completed / milestones.length) * 100);
}

export function getCurrentPipelineMilestone(
  campaign: PipelineTimelineCampaign,
  requiresVideoScript = false
): TimelineMilestoneProgress | null {
  const milestones = getTimelineMilestones(campaign, requiresVideoScript).filter(
    (milestone) => !milestone.optional && milestone.enabled
  );

  return milestones.find((milestone) => !milestone.complete) ?? milestones[milestones.length - 1] ?? null;
}
