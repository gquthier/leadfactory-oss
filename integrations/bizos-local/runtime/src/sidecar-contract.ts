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
} as const;

export const LOCAL_PROVIDERS = ["codex", "claude", "cursor"] as const;

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
  agent: { agentId: string; slug: string; name: string; title: string | null };
  threadId: string;
  teamThreadId: string;
  eventId: string;
}

export interface AgentManagementResult {
  managementId: string;
  sourceAgentId: string;
  sourceRunId: string;
  sourceThreadId: string;
  agent: { agentId: string; slug: string; name: string; title: string | null };
  threadId: string;
  active: boolean;
  eventId: string;
}

export interface LocalTeamEvent {
  eventId: string;
  type: "agent.recruited" | "agent.updated";
  actorAgentId: string;
  subjectAgentId: string;
  runId: string;
  threadId: string;
  createdAt: string;
  changes: {
    name?: string;
    title?: string;
    missionChanged?: boolean;
    active?: boolean;
  };
}

export type DurableRecruitmentMutation =
  | (MutationBase & {
      state: "pending";
      sourceBotId: string;
      sourceRunId: string;
      sourceThreadId: string;
    })
  | (MutationBase & {
      state: "completed";
      sourceBotId: string;
      sourceRunId: string;
      sourceThreadId: string;
      result: RecruitmentResult;
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

function validRecruitmentResult(value: unknown): value is RecruitmentResult {
  if (!isRecord(value) || !isRecord(value.agent)) return false;
  return ["recruitmentId", "sourceAgentId", "sourceRunId", "sourceThreadId", "threadId", "teamThreadId", "eventId"]
    .every((key) => typeof value[key] === "string")
    && typeof value.agent.agentId === "string"
    && typeof value.agent.slug === "string"
    && typeof value.agent.name === "string"
    && (typeof value.agent.title === "string" || value.agent.title === null);
}

function validManagementResult(value: unknown): value is AgentManagementResult {
  if (!isRecord(value) || !isRecord(value.agent)) return false;
  return ["managementId", "sourceAgentId", "sourceRunId", "sourceThreadId", "threadId", "eventId"]
    .every((key) => typeof value[key] === "string")
    && typeof value.active === "boolean"
    && typeof value.agent.agentId === "string"
    && typeof value.agent.slug === "string"
    && typeof value.agent.name === "string"
    && (typeof value.agent.title === "string" || value.agent.title === null);
}

function validTeamEvent(value: unknown): value is LocalTeamEvent {
  return isRecord(value)
    && (value.type === "agent.recruited" || value.type === "agent.updated")
    && ["eventId", "actorAgentId", "subjectAgentId", "runId", "threadId", "createdAt"]
      .every((key) => typeof value[key] === "string")
    && isRecord(value.changes);
}

export function emptyDurableIndex(): DurableIndex {
  return { version: 2, messages: {}, groups: {}, runTriggers: {}, recruitments: {}, managements: {}, events: [] };
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
  return {
    ...(value as unknown as DurableIndex),
    managements: validatedManagements,
    events: events as LocalTeamEvent[],
  };
}
