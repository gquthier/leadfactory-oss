export const LOCAL_BACKEND_CAPABILITIES = {
  createBots: true,
  createGroups: true,
  manageParticipants: true,
  triggerAgents: true,
  cancelRuns: true,
  approvals: true,
  agentRecruitment: true,
  /** A phone can be paired to this computer; the grant it receives carries no
   * agent or group creation scope, so native creation stays unavailable. */
  pairedDevices: true,
  pairedDeviceAgentCreation: false,
  inviteGuests: false,
  cloudOrganization: false,
  cloudTools: false,
  computer: false,
  devices: false,
  sharedWorkspaceContext: false,
  /** `/api/local/cloud-link`: mirror the dashboard summary to the web. */
  webDashboard: true,
} as const;

export const LOCAL_PROVIDERS = ["codex", "claude", "cursor", "ollama"] as const;

export interface DurableVoiceBinding {
  planId: string;
  provider: "codex" | "claude";
}

export type DurableVoiceDispatch =
  | {
      state: "pending";
      operationId: string;
      fingerprint: string;
      messageId: string;
    }
  | {
      state: "completed";
      operationId: string;
      fingerprint: string;
      messageId: string;
      runIds: string[];
    };

export interface DurableVoiceCall {
  callId: string;
  requestId: string;
  fingerprint: string;
  botId: string;
  threadId: string;
  binding: DurableVoiceBinding;
  cancelled: boolean;
  dispatch?: DurableVoiceDispatch;
  createdAt: string;
  updatedAt: string;
}

interface MutationBase {
  fingerprint: string;
  createdAt: string;
}

export type DurableMessageMutation =
  | (MutationBase & { state: "pending"; threadId: string })
  | (MutationBase & {
      state: "completed";
      threadId: string;
      messageId: string;
      runIds: string[];
    });

export type DurableGroupMutation =
  | (MutationBase & { state: "pending" })
  | (MutationBase & { state: "completed"; groupId: string });

export interface RecruitmentResult {
  recruitmentId: string;
  sourceAgentId: string;
  sourceRunId: string;
  sourceThreadId: string;
  agent: LocalTeamAgent;
  threadId: string;
  teamThreadId: string;
  eventId: string;
  dispatch: RecruitmentDispatch;
}

export interface AgentManagementResult {
  managementId: string;
  sourceAgentId: string;
  sourceRunId: string;
  sourceThreadId: string;
  agent: LocalTeamAgent;
  threadId: string;
  active: boolean;
  eventId: string;
}

export interface LocalTeamAgent {
  agentId: string;
  slug: string;
  name: string;
  title: string | null;
  description: string | null;
  avatarKind: "procedural" | "upload" | "generated";
  avatarHash: string | null;
  avatarGeneration?: {
    status: "pending" | "needs_configuration" | "submitting" | "submitted" | "ready" | "failed" | "submission_unknown";
    errorCode?: string;
  };
}

export interface RecruitmentDispatch {
  status: "not_requested" | "queued" | "started" | "failed";
  parentRunId: string;
  runId: string | null;
  messageId: string | null;
  error?: string;
}

export interface DurableRoleBinding {
  templateId: "lead-gen-agency" | "service-based-business" | "software";
  roleSlug: string;
  botId: string;
  groupId: string;
}

export interface DurableRoleAffiliation {
  templateId: "lead-gen-agency" | "service-based-business" | "software";
  roleSlug: string;
}

export interface DurableRecruitmentPlan {
  botId: string;
  groupId: string;
  messageId: string;
  /** Set immediately after the bot exists. Missing/false proves a create
   * failed before effect and may be retried; true plus a missing bot is a
   * deletion and must not be resurrected. */
  botCreated?: boolean;
  ollamaBinding?: { providerId: string; model: string };
}

export type LocalAgentEventType = "agent.recruited" | "agent.updated";
export type LocalRoutineEventType = "routine.created" | "routine.updated" | "routine.deleted" | "routine.fired";

/** `changes` of a routine event. `schedule` is the same string as the
 * `schedule` of a `GET /api/crons` row; `trigger` is that row's trigger. */
export interface LocalRoutineEventChanges {
  routineId: string;
  routineName: string;
  schedule: string;
  trigger?: unknown;
  nextRunAt?: string | null;
  endsAt?: string | null;
  enabled?: boolean;
  /** Why the runtime itself changed it (`routine.updated` only). */
  reason?: "expired" | "ended";
}

interface LocalTeamEventBase {
  eventId: string;
  actorAgentId: string;
  subjectAgentId: string;
  /** Public run id; `runId("none")` when no run caused it (a UI edit). */
  runId: string;
  threadId: string;
  createdAt: string;
}

export type LocalTeamEvent =
  | (LocalTeamEventBase & {
      type: LocalAgentEventType;
      changes: {
        name?: string;
        title?: string;
        missionChanged?: boolean;
        active?: boolean;
      };
    })
  | (LocalTeamEventBase & { type: LocalRoutineEventType; changes: LocalRoutineEventChanges });

export type DurableRecruitmentMutation =
  | (MutationBase & {
      state: "pending";
      sourceBotId: string;
      sourceRunId: string;
      sourceThreadId: string;
      plan?: DurableRecruitmentPlan;
    })
  | (MutationBase & {
      state: "completed";
      sourceBotId: string;
      sourceRunId: string;
      sourceThreadId: string;
      result: RecruitmentResult;
      plan?: DurableRecruitmentPlan;
    });

export type DurableManagementMutation =
  | (MutationBase & {
      state: "pending";
      sourceBotId: string;
      sourceRunId: string;
      sourceThreadId: string;
      targetBotId: string;
    })
  | (MutationBase & {
      state: "completed";
      sourceBotId: string;
      sourceRunId: string;
      sourceThreadId: string;
      targetBotId: string;
      result: AgentManagementResult;
    });

export interface DurableIndex {
  version: 2;
  messages: Record<string, DurableMessageMutation>;
  groups: Record<string, DurableGroupMutation>;
  runTriggers: Record<string, string>;
  recruitments: Record<string, DurableRecruitmentMutation>;
  managements: Record<string, DurableManagementMutation>;
  events: LocalTeamEvent[];
  voiceCalls: Record<string, DurableVoiceCall>;
  voiceRequests: Record<string, string>;
  /** Stable company-scoped role identity and verified pack membership. */
  roleBindings: Record<string, DurableRoleBinding>;
  roleAffiliations: Record<string, DurableRoleAffiliation>;
  /** One durable team group per recruiter DM. */
  recruiterGroups: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function validBase(value: Record<string, unknown>): boolean {
  return typeof value.fingerprint === "string" && typeof value.createdAt === "string"
    && (value.state === "pending" || value.state === "completed");
}

const ROLE_TEMPLATES = new Set(["lead-gen-agency", "service-based-business", "software"]);
const ROLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validRecruitmentPlan(value: unknown): value is DurableRecruitmentPlan {
  return isRecord(value) && [value.botId, value.groupId, value.messageId]
    .every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 160)
    && (value.botCreated === undefined || typeof value.botCreated === "boolean")
    && (value.ollamaBinding === undefined || (isRecord(value.ollamaBinding)
      && typeof value.ollamaBinding.providerId === "string" && /^prv_[a-z0-9]{6,40}$/.test(value.ollamaBinding.providerId)
      && typeof value.ollamaBinding.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value.ollamaBinding.model)));
}

function validRecruitmentResult(value: unknown): value is RecruitmentResult {
  if (!isRecord(value) || !isRecord(value.agent)) return false;
  return ["recruitmentId", "sourceAgentId", "sourceRunId", "sourceThreadId", "threadId", "teamThreadId", "eventId"]
    .every((key) => typeof value[key] === "string")
    && typeof value.agent.agentId === "string"
    && typeof value.agent.slug === "string"
    && typeof value.agent.name === "string"
    && (typeof value.agent.title === "string" || value.agent.title === null)
    && (value.agent.description === undefined || typeof value.agent.description === "string" || value.agent.description === null)
    && (value.dispatch === undefined || isRecord(value.dispatch));
}

function validManagementResult(value: unknown): value is AgentManagementResult {
  if (!isRecord(value) || !isRecord(value.agent)) return false;
  return ["managementId", "sourceAgentId", "sourceRunId", "sourceThreadId", "threadId", "eventId"]
    .every((key) => typeof value[key] === "string")
    && typeof value.active === "boolean"
    && typeof value.agent.agentId === "string"
    && typeof value.agent.slug === "string"
    && typeof value.agent.name === "string"
    && (typeof value.agent.title === "string" || value.agent.title === null)
    && (value.agent.description === undefined || typeof value.agent.description === "string" || value.agent.description === null);
}

const TEAM_EVENT_TYPES = new Set([
  "agent.recruited", "agent.updated",
  "routine.created", "routine.updated", "routine.deleted", "routine.fired",
]);

function validRoutineChanges(value: Record<string, unknown>): boolean {
  return typeof value.routineId === "string" && typeof value.routineName === "string"
    && typeof value.schedule === "string"
    && (value.nextRunAt === undefined || value.nextRunAt === null || typeof value.nextRunAt === "string")
    && (value.endsAt === undefined || value.endsAt === null || typeof value.endsAt === "string")
    && (value.enabled === undefined || typeof value.enabled === "boolean");
}

export function validTeamEvent(value: unknown): value is LocalTeamEvent {
  return isRecord(value)
    && typeof value.type === "string" && TEAM_EVENT_TYPES.has(value.type)
    && ["eventId", "actorAgentId", "subjectAgentId", "runId", "threadId", "createdAt"]
      .every((key) => typeof value[key] === "string")
    && isRecord(value.changes)
    && (!value.type.startsWith("routine.") || validRoutineChanges(value.changes));
}

export function emptyDurableIndex(): DurableIndex {
  return {
    version: 2,
    messages: {},
    groups: {},
    runTriggers: {},
    recruitments: {},
    managements: {},
    events: [],
    voiceCalls: {},
    voiceRequests: {},
    roleBindings: {},
    roleAffiliations: {},
    recruiterGroups: {},
  };
}

/** Validate current state and migrate the original completed-only index. */
export function normalizeDurableIndex(value: unknown): DurableIndex {
  if (!isRecord(value)) throw new Error("collaboration-index.json must contain a JSON object");
  if (value.version === 1) {
    if (!isRecord(value.messages) || !isRecord(value.groups) || !stringRecord(value.runTriggers)) {
      throw new Error("collaboration-index.json version 1 has an invalid shape");
    }
    const migrated = emptyDurableIndex();
    migrated.runTriggers = { ...value.runTriggers };
    for (const [key, raw] of Object.entries(value.messages)) {
      if (!isRecord(raw) || typeof raw.fingerprint !== "string" || typeof raw.threadId !== "string"
        || typeof raw.messageId !== "string" || !Array.isArray(raw.runIds)
        || raw.runIds.some((id) => typeof id !== "string")) {
        throw new Error(`collaboration-index.json has an invalid message entry: ${key}`);
      }
      migrated.messages[key] = {
        state: "completed",
        fingerprint: raw.fingerprint,
        threadId: raw.threadId,
        messageId: raw.messageId,
        runIds: raw.runIds as string[],
        createdAt: new Date(0).toISOString(),
      };
    }
    for (const [key, raw] of Object.entries(value.groups)) {
      if (!isRecord(raw) || typeof raw.fingerprint !== "string" || typeof raw.groupId !== "string") {
        throw new Error(`collaboration-index.json has an invalid group entry: ${key}`);
      }
      migrated.groups[key] = {
        state: "completed",
        fingerprint: raw.fingerprint,
        groupId: raw.groupId,
        createdAt: new Date(0).toISOString(),
      };
    }
    return migrated;
  }
  if (value.version !== 2 || !isRecord(value.messages) || !isRecord(value.groups)
    || !stringRecord(value.runTriggers) || !isRecord(value.recruitments)) {
    throw new Error("collaboration-index.json version or shape is invalid");
  }
  for (const [key, raw] of Object.entries(value.messages)) {
    if (!isRecord(raw) || !validBase(raw) || typeof raw.threadId !== "string"
      || (raw.state === "completed" && (typeof raw.messageId !== "string" || !Array.isArray(raw.runIds)
        || raw.runIds.some((id) => typeof id !== "string")))) {
      throw new Error(`collaboration-index.json has an invalid message entry: ${key}`);
    }
  }
  for (const [key, raw] of Object.entries(value.groups)) {
    if (!isRecord(raw) || !validBase(raw)
      || (raw.state === "completed" && typeof raw.groupId !== "string")) {
      throw new Error(`collaboration-index.json has an invalid group entry: ${key}`);
    }
  }
  for (const [key, raw] of Object.entries(value.recruitments)) {
    if (!isRecord(raw) || !validBase(raw) || typeof raw.sourceBotId !== "string"
      || typeof raw.sourceRunId !== "string" || typeof raw.sourceThreadId !== "string"
      || (raw.plan !== undefined && !validRecruitmentPlan(raw.plan))
      || (raw.state === "completed" && !validRecruitmentResult(raw.result))) {
      throw new Error(`collaboration-index.json has an invalid recruitment entry: ${key}`);
    }
  }
  const managements = value.managements === undefined ? {} : value.managements;
  const events = value.events === undefined ? [] : value.events;
  if (!isRecord(managements) || !Array.isArray(events) || events.length > 1_000 || events.some((event) => !validTeamEvent(event))) {
    throw new Error("collaboration-index.json has invalid local team history");
  }
  const validatedManagements: Record<string, DurableManagementMutation> = {};
  for (const [key, raw] of Object.entries(managements)) {
    if (!isRecord(raw) || !validBase(raw) || typeof raw.sourceBotId !== "string"
      || typeof raw.sourceRunId !== "string" || typeof raw.sourceThreadId !== "string"
      || typeof raw.targetBotId !== "string"
      || (raw.state === "completed" && !validManagementResult(raw.result))) {
      throw new Error(`collaboration-index.json has an invalid management entry: ${key}`);
    }
    validatedManagements[key] = raw as unknown as DurableManagementMutation;
  }
  const voiceCalls = value.voiceCalls === undefined ? {} : value.voiceCalls;
  const voiceRequests = value.voiceRequests === undefined ? {} : value.voiceRequests;
  if (!isRecord(voiceCalls) || !stringRecord(voiceRequests)) {
    throw new Error("collaboration-index.json has invalid voice task history");
  }
  const validatedVoiceCalls: Record<string, DurableVoiceCall> = {};
  for (const [key, raw] of Object.entries(voiceCalls)) {
    if (!isRecord(raw) || raw.callId !== key || typeof raw.requestId !== "string"
      || typeof raw.fingerprint !== "string" || typeof raw.botId !== "string"
      || typeof raw.threadId !== "string" || typeof raw.cancelled !== "boolean"
      || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string"
      || !isRecord(raw.binding) || typeof raw.binding.planId !== "string"
      || (raw.binding.provider !== "codex" && raw.binding.provider !== "claude")) {
      throw new Error(`collaboration-index.json has an invalid voice call entry: ${key}`);
    }
    if (raw.dispatch !== undefined) {
      if (!isRecord(raw.dispatch)
        || (raw.dispatch.state !== "pending" && raw.dispatch.state !== "completed")
        || typeof raw.dispatch.operationId !== "string" || typeof raw.dispatch.fingerprint !== "string"
        || typeof raw.dispatch.messageId !== "string"
        || (raw.dispatch.state === "completed"
          && (!Array.isArray(raw.dispatch.runIds) || raw.dispatch.runIds.some((id) => typeof id !== "string")))) {
        throw new Error(`collaboration-index.json has an invalid voice dispatch entry: ${key}`);
      }
    }
    validatedVoiceCalls[key] = raw as unknown as DurableVoiceCall;
  }
  for (const [requestId, callId] of Object.entries(voiceRequests)) {
    if (!validatedVoiceCalls[callId] || validatedVoiceCalls[callId]!.requestId !== requestId) {
      throw new Error(`collaboration-index.json has an invalid voice request entry: ${requestId}`);
    }
  }
  const roleBindings = value.roleBindings === undefined ? {} : value.roleBindings;
  const roleAffiliations = value.roleAffiliations === undefined ? {} : value.roleAffiliations;
  const recruiterGroups = value.recruiterGroups === undefined ? {} : value.recruiterGroups;
  if (!isRecord(roleBindings) || !isRecord(roleAffiliations) || !stringRecord(recruiterGroups)) {
    throw new Error("collaboration-index.json has invalid role recruitment state");
  }
  for (const [identity, raw] of Object.entries(roleBindings)) {
    if (!isRecord(raw) || typeof raw.templateId !== "string" || !ROLE_TEMPLATES.has(raw.templateId)
      || typeof raw.roleSlug !== "string" || !ROLE_SLUG.test(raw.roleSlug)
      || typeof raw.botId !== "string" || typeof raw.groupId !== "string" || identity !== `${raw.templateId}:${raw.roleSlug}`) {
      throw new Error(`collaboration-index.json has an invalid role binding: ${identity}`);
    }
  }
  for (const [botId, raw] of Object.entries(roleAffiliations)) {
    if (!botId || !isRecord(raw) || typeof raw.templateId !== "string" || !ROLE_TEMPLATES.has(raw.templateId)
      || typeof raw.roleSlug !== "string" || !ROLE_SLUG.test(raw.roleSlug)) {
      throw new Error(`collaboration-index.json has an invalid role affiliation: ${botId}`);
    }
  }
  return {
    ...(value as unknown as DurableIndex),
    managements: validatedManagements,
    events: events as LocalTeamEvent[],
    voiceCalls: validatedVoiceCalls,
    voiceRequests,
    roleBindings: roleBindings as unknown as Record<string, DurableRoleBinding>,
    roleAffiliations: roleAffiliations as unknown as Record<string, DurableRoleAffiliation>,
    recruiterGroups,
  };
}
