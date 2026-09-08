import type { Clock } from "./clock.js";
import { newId } from "./ids.js";
import { singleLine } from "./prompt.js";
import type { Storage } from "./storage.js";
import type { Group } from "./types.js";

export const GROUPS_FILE = "groups.json";

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

function memberList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  return [...new Set(ids)].slice(0, 32);
}

export function normalizeGroup(raw: unknown): Group | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = trimmed(record.id, 64);
  const name = oneLine(record.name, 60);
  if (!id || !name) return null;
  return {
    id,
    name,
    memberIds: memberList(record.memberIds),
    pinned: record.pinned === true,
    archived: record.archived === true,
    unread: record.unread === true,
    ...(trimmed(record.lastMessagePreview, 200)
      ? { lastMessagePreview: trimmed(record.lastMessagePreview, 200) }
      : {}),
    createdAt: trimmed(record.createdAt, 40) ?? new Date(0).toISOString(),
  };
}

export class GroupStore {
  private groups: Group[];

  constructor(
    private readonly storage: Storage,
    private readonly clock: Clock,
  ) {
    const raw = this.storage.readJson<unknown[]>(GROUPS_FILE, []);
    this.groups = (Array.isArray(raw) ? raw : [])
      .map(normalizeGroup)
      .filter((group): group is Group => group !== null);
  }

  list(): Group[] {
    return this.groups.map((group) => ({ ...group, memberIds: [...group.memberIds] }));
  }

  get(id: string): Group | undefined {
    const found = this.groups.find((group) => group.id === id);
    return found ? { ...found, memberIds: [...found.memberIds] } : undefined;
  }

  private persist(): void {
    this.storage.writeJson(GROUPS_FILE, this.groups);
  }

  create(input: { name: string; memberIds: string[] }): Group {
    const name = trimmed(input.name, 60);
    if (!name) throw new Error("a group needs a name");
    const group: Group = {
      id: newId("grp"),
      name,
      memberIds: memberList(input.memberIds),
      pinned: false,
      archived: false,
      unread: false,
      createdAt: this.clock.nowIso(),
    };
    this.groups.push(group);
    this.persist();
    return { ...group, memberIds: [...group.memberIds] };
  }

  update(
    id: string,
    patch: Partial<{ name: string; memberIds: string[]; pinned: boolean; archived: boolean; unread: boolean }>,
  ): Group {
    const index = this.groups.findIndex((group) => group.id === id);
    const current = this.groups[index];
    if (index < 0 || !current) throw new Error("group not found");
    const next = normalizeGroup({ ...current, ...patch, id: current.id });
    if (!next) throw new Error("invalid group patch");
    this.groups[index] = next;
    this.persist();
    return { ...next, memberIds: [...next.memberIds] };
  }

  setPreview(id: string, preview: string): void {
    const index = this.groups.findIndex((group) => group.id === id);
    const current = this.groups[index];
    if (index < 0 || !current) return;
    this.groups[index] = { ...current, lastMessagePreview: preview.slice(0, 200) };
    this.persist();
  }

  remove(id: string): void {
    const before = this.groups.length;
    this.groups = this.groups.filter((group) => group.id !== id);
    if (this.groups.length !== before) this.persist();
  }

  /** A deleted bot must not linger as a phantom member. */
  removeMember(botId: string): void {
    let changed = false;
    this.groups = this.groups.map((group) => {
      if (!group.memberIds.includes(botId)) return group;
      changed = true;
      return { ...group, memberIds: group.memberIds.filter((id) => id !== botId) };
    });
    if (changed) this.persist();
  }
}
