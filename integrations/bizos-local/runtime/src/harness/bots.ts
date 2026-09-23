import { randomBytes } from "node:crypto";
import { parseAvatarDataUrl } from "./avatar.js";
import type { Clock } from "./clock.js";
import { newId } from "./ids.js";
import { singleLine } from "./prompt.js";
import type { Storage } from "./storage.js";
import type {
  AvatarGenerationStatus,
  Bot,
  BotStatus,
  CreateBotInput,
  InternalAvatarGeneration,
  PublicAvatarGeneration,
  ReasoningEffort,
  UpdateBotInput,
} from "./types.js";

export const BOTS_FILE = "bots.json";
export const AVATAR_WORKER_LEASE_MS = 120_000;
export const DEFAULT_AVATAR_PROMPT = "Create a fictional adult human professional headshot, centered head and shoulders, looking at the camera, clean studio lighting, a solid background, no text, no letters, no logo, no watermark.";

export const BOT_COLORS = [
  "#7C5CFF", "#22B8CF", "#F76707", "#37B24D", "#E8590C", "#F03E3E", "#1C7ED6", "#AE3EC9",
] as const;

const EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);
const AVATAR_STATES = new Set<AvatarGenerationStatus>([
  "pending", "needs_configuration", "submitting", "submitted", "ready", "failed", "submission_unknown",
]);

export interface AvatarWorkerJob {
  id: string;
  botId: string;
  prompt: string;
  taskId?: string;
  state: "submitting" | "submitted";
  createdAt: string;
  leaseToken: string;
}

export type AvatarWorkerReport =
  | { jobId: string; leaseToken: string; event: "submitted"; taskId: string }
  | { jobId: string; leaseToken: string; event: "ready"; dataUrl: string }
  | { jobId: string; leaseToken: string; event: "failed"; errorCode: string }
  | { jobId: string; leaseToken: string; event: "submission_unknown"; errorCode?: string };

export class AvatarGenerationError extends Error {
  constructor(readonly code: "avatar_job_not_found" | "invalid_avatar_lease", message: string) {
    super(message);
  }
}

export function colorForIndex(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length] ?? BOT_COLORS[0];
}

function trimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function oneLine(value: unknown, max: number): string | undefined {
  const text = trimmed(value, max);
  return text ? singleLine(text, max) : undefined;
}

function generationPrompt(value: unknown, color: string): string {
  if (value === undefined || value === null || value === "") {
    const paletteColor = /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : BOT_COLORS[0];
    return `${DEFAULT_AVATAR_PROMPT.slice(0, -1)} in palette color ${paletteColor}.`;
  }
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) {
    throw new Error("avatarPrompt must be a non-empty string of at most 2000 characters");
  }
  return value.trim();
}

function newGeneration(botId: string, prompt: unknown, color: string, now: string, revision = 1): InternalAvatarGeneration {
  return {
    active: true,
    revision,
    jobId: newId("avj"),
    prompt: generationPrompt(prompt, color),
    state: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizedGeneration(raw: unknown, botId: string, createdAt: string): InternalAvatarGeneration | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    const state = value.state as AvatarGenerationStatus;
    const taskIdValid = value.taskId === undefined
      || (typeof value.taskId === "string" && value.taskId.length > 0 && value.taskId.length <= 512);
    const leaseParts = [value.leaseToken, value.leaseWorkerId, value.leaseExpiresAt];
    const hasLease = leaseParts.some((part) => part !== undefined);
    const leaseValid = !hasLease || (leaseParts.every((part) => typeof part === "string" && part.length > 0)
      && Number.isFinite(Date.parse(value.leaseExpiresAt as string)));
    const stateValid = (state === "submitting" && hasLease && value.taskId === undefined)
      || (state === "submitted" && typeof value.taskId === "string")
      || ((state === "pending" || state === "needs_configuration") && value.taskId === undefined && !hasLease)
      || (["ready", "failed", "submission_unknown"] as AvatarGenerationStatus[]).includes(state);
    const valid = typeof value.active === "boolean"
      && typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0
      && typeof value.jobId === "string" && value.jobId.length > 0 && value.jobId.length <= 80
      && typeof value.prompt === "string" && value.prompt.length > 0 && value.prompt.length <= 2_000
      && AVATAR_STATES.has(state) && stateValid
      && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
      && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
      && taskIdValid && leaseValid
      && (value.errorCode === undefined || (typeof value.errorCode === "string" && value.errorCode.length > 0 && value.errorCode.length <= 80))
      && (value.leaseToken === undefined || typeof value.leaseToken === "string")
      && (value.leaseWorkerId === undefined || typeof value.leaseWorkerId === "string")
      && (value.leaseExpiresAt === undefined || typeof value.leaseExpiresAt === "string");
    if (valid) return { ...value } as unknown as InternalAvatarGeneration;
  }
  return {
    active: true,
    revision: 1,
    jobId: `corrupt-${botId}`.slice(0, 80),
    prompt: DEFAULT_AVATAR_PROMPT,
    state: "failed",
    errorCode: "corrupt_state",
    createdAt,
    updatedAt: createdAt,
  };
}

export function publicAvatarGeneration(value: InternalAvatarGeneration | undefined): PublicAvatarGeneration | undefined {
  if (!value?.active) return undefined;
  return { status: value.state, ...(value.errorCode ? { errorCode: value.errorCode } : {}) };
}

export function normalizeBot(raw: unknown, index: number): Bot | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = trimmed(record.id, 64);
  const name = oneLine(record.name, 60);
  if (!id || !name) return null;
  const effort = record.thinking;
  const createdAt = trimmed(record.createdAt, 40) ?? new Date(0).toISOString();
  return {
    id,
    name,
    ...(oneLine(record.title, 80) ? { title: oneLine(record.title, 80) } : {}),
    ...(trimmed(record.description, 600) ? { description: trimmed(record.description, 600) } : {}),
    ...(trimmed(record.instructions, 16_000) ? { instructions: trimmed(record.instructions, 16_000) } : {}),
    color: trimmed(record.color, 32) ?? colorForIndex(index),
    ...(trimmed(record.avatarUrl, 4_000_000) ? { avatarUrl: trimmed(record.avatarUrl, 4_000_000) } : {}),
    avatarKind: record.avatarKind === "upload" || record.avatarKind === "generated" ? record.avatarKind : "procedural",
    ...(record.avatarGenerationInternal !== undefined
      ? { avatarGenerationInternal: normalizedGeneration(record.avatarGenerationInternal, id, createdAt) }
      : {}),
    ...(trimmed(record.model, 120) ? { model: trimmed(record.model, 120) } : {}),
    ...(EFFORTS.has(effort as ReasoningEffort) ? { thinking: effort as ReasoningEffort } : {}),
    ...(trimmed(record.workspacePath, 1000) ? { workspacePath: trimmed(record.workspacePath, 1000) } : {}),
    ...(trimmed(record.planId, 64) ? { planId: trimmed(record.planId, 64) } : {}),
    ...(trimmed(record.providerId, 64) ? { providerId: trimmed(record.providerId, 64) } : {}),
    pinned: record.pinned === true,
    archived: record.archived === true,
    unread: record.unread === true,
    ...(trimmed(record.sectionId, 64) ? { sectionId: trimmed(record.sectionId, 64) } : {}),
    notifyOnFinish: record.notifyOnFinish !== false,
    status: (["idle", "working", "waiting"] as BotStatus[]).includes(record.status as BotStatus)
      ? record.status as BotStatus : "idle",
    ...(trimmed(record.lastMessagePreview, 200) ? { lastMessagePreview: trimmed(record.lastMessagePreview, 200) } : {}),
    sortOrder: typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder) ? Math.trunc(record.sortOrder) : index,
    createdAt,
  };
}

export class BotStore {
  private bots: Bot[];

  constructor(private readonly storage: Storage, private readonly clock: Clock) {
    const raw = this.storage.readJsonStrict<unknown[]>(BOTS_FILE, []);
    if (!Array.isArray(raw)) throw new Error(`${BOTS_FILE} is corrupt (expected an array)`);
    this.bots = raw.map(normalizeBot).filter((bot): bot is Bot => bot !== null);
  }

  list(): Bot[] {
    return this.bots.map((bot, index) => ({ bot, index }))
      .sort((a, b) => a.bot.sortOrder - b.bot.sortOrder || a.index - b.index)
      .map(({ bot }) => ({ ...bot }));
  }

  get(id: string): Bot | undefined {
    const found = this.bots.find((bot) => bot.id === id);
    return found ? { ...found } : undefined;
  }

  private persist(): void { this.storage.writeJson(BOTS_FILE, this.bots); }

  create(input: CreateBotInput, id?: string): Bot {
    const name = trimmed(input.name, 60);
    if (!name) throw new Error("a bot needs a name");
    if (id && this.bots.some((bot) => bot.id === id)) throw new Error("that bot id is taken");
    const botId = id ?? newId("bot");
    const suppliedAvatar = input.avatarDataUrl === undefined ? null : parseAvatarDataUrl(input.avatarDataUrl);
    const createdAt = this.clock.nowIso();
    const color = trimmed(input.color, 32) ?? colorForIndex(this.bots.length);
    const bot: Bot = {
      id: botId,
      name,
      ...(trimmed(input.title, 80) ? { title: trimmed(input.title, 80) } : {}),
      ...(trimmed(input.description, 600) ? { description: trimmed(input.description, 600) } : {}),
      ...(trimmed(input.instructions, 16_000) ? { instructions: trimmed(input.instructions, 16_000) } : {}),
      color,
      ...(suppliedAvatar ? { avatarUrl: suppliedAvatar.dataUrl } : {}),
      avatarKind: suppliedAvatar ? "upload" : "procedural",
      ...(!suppliedAvatar ? { avatarGenerationInternal: newGeneration(botId, input.avatarPrompt, color, createdAt) } : {}),
      ...(trimmed(input.model, 120) ? { model: trimmed(input.model, 120) } : {}),
      ...(EFFORTS.has(input.thinking as ReasoningEffort) ? { thinking: input.thinking } : {}),
      ...(trimmed(input.workspacePath, 1000) ? { workspacePath: trimmed(input.workspacePath, 1000) } : {}),
      ...(trimmed(input.planId, 64) ? { planId: trimmed(input.planId, 64) } : {}),
      ...(trimmed(input.providerId, 64) ? { providerId: trimmed(input.providerId, 64) } : {}),
      pinned: false,
      archived: false,
      unread: false,
      ...(trimmed(input.sectionId, 64) ? { sectionId: trimmed(input.sectionId, 64) } : {}),
      notifyOnFinish: input.notifyOnFinish !== false,
      status: "idle",
      sortOrder: this.bots.reduce((highest, row) => Math.max(highest, row.sortOrder + 1), 0),
      createdAt,
    };
    this.bots.push(bot);
    this.persist();
    return { ...bot };
  }

  update(id: string, patch: UpdateBotInput): Bot {
    const index = this.bots.findIndex((bot) => bot.id === id);
    const current = this.bots[index];
    if (index < 0 || !current) throw new Error("bot not found");
    const next = normalizeBot({ ...current, ...patch, id: current.id }, index);
    if (!next) throw new Error("invalid bot patch");
    this.bots[index] = next;
    this.persist();
    return { ...next };
  }

  setStatus(id: string, status: BotStatus, lastMessagePreview?: string): Bot | undefined {
    const index = this.bots.findIndex((bot) => bot.id === id);
    const current = this.bots[index];
    if (index < 0 || !current) return undefined;
    const next: Bot = { ...current, status, ...(lastMessagePreview ? { lastMessagePreview: lastMessagePreview.slice(0, 200) } : {}) };
    this.bots[index] = next;
    this.persist();
    return { ...next };
  }

  resetTransient(): void {
    let changed = false;
    this.bots = this.bots.map((bot) => {
      if (bot.status === "idle") return bot;
      changed = true;
      return { ...bot, status: "idle" };
    });
    if (changed) this.persist();
  }

  remove(id: string): void {
    const before = this.bots.length;
    this.bots = this.bots.filter((bot) => bot.id !== id);
    if (this.bots.length !== before) this.persist();
  }

  duplicate(id: string, duplicateId = newId("bot")): Bot {
    const source = this.bots.find((bot) => bot.id === id);
    if (!source) throw new Error("bot not found");
    const createdAt = this.clock.nowIso();
    const copy: Bot = {
      ...source,
      id: duplicateId,
      name: `${source.name} copy`.slice(0, 60),
      pinned: false,
      unread: false,
      status: "idle",
      sortOrder: this.bots.reduce((highest, row) => Math.max(highest, row.sortOrder + 1), 0),
      createdAt,
    };
    delete copy.lastMessagePreview;
    delete copy.avatarGeneration;
    delete copy.avatarGenerationInternal;
    if (!copy.avatarUrl) copy.avatarGenerationInternal = newGeneration(copy.id, undefined, copy.color, createdAt);
    this.bots.push(copy);
    this.persist();
    return { ...copy };
  }

  setAvatar(id: string, avatar: { dataUrl: string } | { url: string } | null): Bot {
    const index = this.bots.findIndex((bot) => bot.id === id);
    const current = this.bots[index];
    if (index < 0 || !current) throw new Error("bot not found");
    const next: Bot = { ...current };
    if (next.avatarGenerationInternal) {
      next.avatarGenerationInternal = {
        ...next.avatarGenerationInternal,
        active: false,
        revision: next.avatarGenerationInternal.revision + 1,
        updatedAt: this.clock.nowIso(),
      };
    }
    if (avatar === null) {
      delete next.avatarUrl;
      next.avatarKind = "procedural";
    } else if ("dataUrl" in avatar) {
      next.avatarUrl = parseAvatarDataUrl(avatar.dataUrl).dataUrl;
      next.avatarKind = "upload";
    } else {
      next.avatarUrl = avatar.url;
      next.avatarKind = "generated";
    }
    this.bots[index] = next;
    this.persist();
    return { ...next };
  }

  generateAvatar(id: string, prompt?: string): Bot {
    const index = this.bots.findIndex((bot) => bot.id === id);
    const current = this.bots[index];
    if (index < 0 || !current) throw new Error("bot not found");
    const revision = (current.avatarGenerationInternal?.revision ?? 0) + 1;
    const next: Bot = { ...current, avatarGenerationInternal: newGeneration(id, prompt, current.color, this.clock.nowIso(), revision) };
    delete next.avatarGeneration;
    this.bots[index] = next;
    this.persist();
    return { ...next };
  }

  claimAvatar(workerId: string, configured: boolean): { job: AvatarWorkerJob | null } {
    const nowMs = this.clock.now().getTime();
    let changed = false;
    for (const bot of this.bots) {
      const job = bot.avatarGenerationInternal;
      if (!job?.active) continue;
      const expired = job.leaseExpiresAt !== undefined && Date.parse(job.leaseExpiresAt) <= nowMs;
      if (expired && job.state === "submitting" && !job.taskId) {
        bot.avatarGenerationInternal = {
          ...job,
          state: "submission_unknown",
          errorCode: "submission_outcome_unknown",
          updatedAt: this.clock.nowIso(),
          leaseToken: undefined,
          leaseWorkerId: undefined,
          leaseExpiresAt: undefined,
        };
        changed = true;
      } else if (expired) {
        delete job.leaseToken;
        delete job.leaseWorkerId;
        delete job.leaseExpiresAt;
        changed = true;
      }
    }
    if (!configured) {
      for (const bot of this.bots) {
        const job = bot.avatarGenerationInternal;
        if (job?.active && job.state === "pending") {
          job.state = "needs_configuration";
          job.updatedAt = this.clock.nowIso();
          changed = true;
        }
      }
      if (changed) this.persist();
      return { job: null };
    }
    const bot = this.bots.find((candidate) => {
      const job = candidate.avatarGenerationInternal;
      if (!job?.active) return false;
      if (job.state === "pending" || job.state === "needs_configuration") return !job.leaseToken;
      return job.state === "submitted" && (!job.leaseToken || job.leaseWorkerId === workerId);
    });
    const job = bot?.avatarGenerationInternal;
    if (!bot || !job) {
      if (changed) this.persist();
      return { job: null };
    }
    if (job.state === "pending" || job.state === "needs_configuration") job.state = "submitting";
    job.leaseToken = randomBytes(24).toString("base64url");
    job.leaseWorkerId = workerId;
    job.leaseExpiresAt = new Date(nowMs + AVATAR_WORKER_LEASE_MS).toISOString();
    job.updatedAt = this.clock.nowIso();
    this.persist();
    return { job: {
      id: job.jobId,
      botId: bot.id,
      prompt: job.prompt,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      state: job.state as "submitting" | "submitted",
      createdAt: job.createdAt,
      leaseToken: job.leaseToken,
    } };
  }

  reportAvatar(input: AvatarWorkerReport): { ok: true; applied: boolean; status: "submitted" | "ready" | "failed" | "submission_unknown" } {
    const bot = this.bots.find((candidate) => candidate.avatarGenerationInternal?.jobId === input.jobId);
    const job = bot?.avatarGenerationInternal;
    if (!bot || !job) throw new AvatarGenerationError("avatar_job_not_found", "Avatar generation job was not found.");
    if (!job.leaseToken || job.leaseToken !== input.leaseToken || !job.leaseExpiresAt
      || Date.parse(job.leaseExpiresAt) <= this.clock.now().getTime()) {
      throw new AvatarGenerationError("invalid_avatar_lease", "Avatar generation lease is invalid or expired.");
    }
    const clearLease = () => {
      delete job.leaseToken;
      delete job.leaseWorkerId;
      delete job.leaseExpiresAt;
      job.updatedAt = this.clock.nowIso();
    };
    if (input.event === "submitted") {
      if (job.taskId && job.taskId !== input.taskId) {
        throw new AvatarGenerationError("invalid_avatar_lease", "Avatar task identity cannot change.");
      }
      job.taskId = input.taskId;
      job.state = "submitted";
      clearLease();
      this.persist();
      return { ok: true, applied: job.active, status: "submitted" };
    }
    if (input.event === "ready") {
      const avatar = parseAvatarDataUrl(input.dataUrl);
      const applied = job.active;
      job.state = "ready";
      delete job.errorCode;
      clearLease();
      if (applied) {
        bot.avatarUrl = avatar.dataUrl;
        bot.avatarKind = "generated";
      }
      this.persist();
      return { ok: true, applied, status: "ready" };
    }
    job.state = input.event;
    job.errorCode = input.event === "submission_unknown" ? input.errorCode ?? "submission_outcome_unknown" : input.errorCode;
    clearLease();
    this.persist();
    return { ok: true, applied: job.active, status: input.event };
  }
}
