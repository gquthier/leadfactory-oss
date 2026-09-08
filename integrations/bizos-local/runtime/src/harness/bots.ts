import type { Clock } from "./clock.js";
import { newId } from "./ids.js";
import { singleLine } from "./prompt.js";
import type { Storage } from "./storage.js";
import type { Bot, BotStatus, CreateBotInput, ReasoningEffort, UpdateBotInput } from "./types.js";

export const BOTS_FILE = "bots.json";

/** Rakazo's roster palette, in order — bot N takes colour N. */
export const BOT_COLORS = [
  "#7C5CFF",
  "#22B8CF",
  "#F76707",
  "#37B24D",
  "#E8590C",
  "#F03E3E",
  "#1C7ED6",
  "#AE3EC9",
] as const;

export function colorForIndex(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length] ?? BOT_COLORS[0];
}

const EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);

function trimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

/** A name is one line. See `prompt.singleLine`: the persona and the transcript
 * are ONE text item, so a newline in a name writes a new pseudo-section of the
 * prompt. Applied on read as well as on write — a value written by an older
 * build is already on disk. */
function oneLine(value: unknown, max: number): string | undefined {
  const text = trimmed(value, max);
  return text ? singleLine(text, max) : undefined;
}

export function normalizeBot(raw: unknown, index: number): Bot | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = trimmed(record.id, 64);
  const name = oneLine(record.name, 60);
  if (!id || !name) return null;
  const effort = record.thinking;
  return {
    id,
    name,
    ...(oneLine(record.title, 80) ? { title: oneLine(record.title, 80) } : {}),
    ...(trimmed(record.description, 600) ? { description: trimmed(record.description, 600) } : {}),
    ...(trimmed(record.instructions, 6000) ? { instructions: trimmed(record.instructions, 6000) } : {}),
    color: trimmed(record.color, 32) ?? colorForIndex(index),
    ...(trimmed(record.avatarUrl, 4_000_000) ? { avatarUrl: trimmed(record.avatarUrl, 4_000_000) } : {}),
    avatarKind:
      record.avatarKind === "upload" || record.avatarKind === "generated"
        ? record.avatarKind
        : "procedural",
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
      ? (record.status as BotStatus)
      : "idle",
    ...(trimmed(record.lastMessagePreview, 200)
      ? { lastMessagePreview: trimmed(record.lastMessagePreview, 200) }
      : {}),
    // A roster the user reordered comes back in that order. Rows written
    // before this field existed fall back to their position in the file.
    sortOrder:
      typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
        ? Math.trunc(record.sortOrder)
        : index,
    createdAt: trimmed(record.createdAt, 40) ?? new Date(0).toISOString(),
  };
}

export class BotStore {
  private bots: Bot[];

  constructor(
    private readonly storage: Storage,
    private readonly clock: Clock,
  ) {
    const raw = this.storage.readJson<unknown[]>(BOTS_FILE, []);
    this.bots = (Array.isArray(raw) ? raw : [])
      .map((row, index) => normalizeBot(row, index))
      .filter((bot): bot is Bot => bot !== null);
  }

  /** Roster order is `sortOrder`, then insertion order for ties — the same
   * order the sidebar draws and the order a group message fans out in. */
  list(): Bot[] {
    return this.bots
      .map((bot, index) => ({ bot, index }))
      .sort((a, b) => a.bot.sortOrder - b.bot.sortOrder || a.index - b.index)
      .map(({ bot }) => ({ ...bot }));
  }

  get(id: string): Bot | undefined {
    const found = this.bots.find((bot) => bot.id === id);
    return found ? { ...found } : undefined;
  }

  private persist(): void {
    this.storage.writeJson(BOTS_FILE, this.bots);
  }

  create(input: CreateBotInput): Bot {
    const name = trimmed(input.name, 60);
    if (!name) throw new Error("a bot needs a name");
    const bot: Bot = {
      id: newId("bot"),
      name,
      ...(trimmed(input.title, 80) ? { title: trimmed(input.title, 80) } : {}),
      ...(trimmed(input.description, 600) ? { description: trimmed(input.description, 600) } : {}),
      ...(trimmed(input.instructions, 6000) ? { instructions: trimmed(input.instructions, 6000) } : {}),
      color: trimmed(input.color, 32) ?? colorForIndex(this.bots.length),
      avatarKind: "procedural",
      ...(trimmed(input.model, 120) ? { model: trimmed(input.model, 120) } : {}),
      ...(EFFORTS.has(input.thinking as ReasoningEffort) ? { thinking: input.thinking } : {}),
      // A template creates its agents with the vault as their folder; the
      // person's own "New agent" never sends one (the folder is chosen in
      // the agent's settings, where it is checked).
      ...(trimmed(input.workspacePath, 1000) ? { workspacePath: trimmed(input.workspacePath, 1000) } : {}),
      pinned: false,
      archived: false,
      unread: false,
      ...(trimmed(input.sectionId, 64) ? { sectionId: trimmed(input.sectionId, 64) } : {}),
      notifyOnFinish: input.notifyOnFinish !== false,
      status: "idle",
      sortOrder: this.bots.reduce((highest, row) => Math.max(highest, row.sortOrder + 1), 0),
      createdAt: this.clock.nowIso(),
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

  /** Runtime-only fields the renderer reads off the roster row. Persisted
   * with the rest so a restart shows `idle` rather than a stale `working`
   * — the status is reset on load by `resetTransient`. */
  setStatus(id: string, status: BotStatus, lastMessagePreview?: string): Bot | undefined {
    const index = this.bots.findIndex((bot) => bot.id === id);
    const current = this.bots[index];
    if (index < 0 || !current) return undefined;
    const next: Bot = {
      ...current,
      status,
      ...(lastMessagePreview ? { lastMessagePreview: lastMessagePreview.slice(0, 200) } : {}),
    };
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

  duplicate(id: string): Bot {
    const source = this.bots.find((bot) => bot.id === id);
    if (!source) throw new Error("bot not found");
    const copy: Bot = {
      ...source,
      id: newId("bot"),
      name: `${source.name} copy`.slice(0, 60),
      pinned: false,
      unread: false,
      status: "idle",
      sortOrder: this.bots.reduce((highest, row) => Math.max(highest, row.sortOrder + 1), 0),
      createdAt: this.clock.nowIso(),
    };
    delete copy.lastMessagePreview;
    this.bots.push(copy);
    this.persist();
    return { ...copy };
  }

  setAvatar(id: string, avatar: { dataUrl: string } | { url: string } | null): Bot {
    const index = this.bots.findIndex((bot) => bot.id === id);
    const current = this.bots[index];
    if (index < 0 || !current) throw new Error("bot not found");
    const next: Bot = { ...current };
    if (avatar === null) {
      delete next.avatarUrl;
      next.avatarKind = "procedural";
    } else if ("dataUrl" in avatar) {
      next.avatarUrl = avatar.dataUrl;
      next.avatarKind = "upload";
    } else {
      next.avatarUrl = avatar.url;
      next.avatarKind = "generated";
    }
    this.bots[index] = next;
    this.persist();
    return { ...next };
  }
}
