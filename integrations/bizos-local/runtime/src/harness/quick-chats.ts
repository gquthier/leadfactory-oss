import { createHash } from "node:crypto";
import type { Clock } from "./clock.js";
import type { Storage } from "./storage.js";
import type { Bot } from "./types.js";
import { singleLine } from "./prompt.js";

export interface QuickChat { id: string; title: string; createdAt: string; updatedAt: string }
export const QUICK_CHATS_FILE = "quick-chats.json";
export const quickMessageId = (requestId: string): string => `qmsg_${createHash("sha256").update(requestId).digest("hex").slice(0, 40)}`;

/** Workspace-local conversations. These records never enter the agent roster. */
export class QuickChatStore {
  private readonly chats: QuickChat[];
  constructor(private readonly storage: Storage, private readonly clock: Clock) {
    const raw = storage.readJsonStrict<unknown>(QUICK_CHATS_FILE, []);
    if (!Array.isArray(raw) || raw.some(row => !row || typeof row !== "object" ||
      !/^qchat_[a-f0-9]{32}$/.test(row.id) || typeof row.title !== "string" ||
      typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") ||
      new Set(raw.map(row => row.id)).size !== raw.length) throw new Error("quick-chats.json is corrupt");
    this.chats = raw;
  }
  list(): QuickChat[] { return this.chats.map(row => ({ ...row })).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string): QuickChat { const chat = this.chats.find(row => row.id === id); if (!chat) throw new Error("Chat not found in this workspace"); return { ...chat }; }
  create(requestId: string): QuickChat {
    const id = `qchat_${createHash("sha256").update(requestId).digest("hex").slice(0,32)}`;
    const existing = this.chats.find(row => row.id === id);
    if (existing) return { ...existing };
    const chat = { id, title: "New chat", createdAt: this.clock.nowIso(), updatedAt: this.clock.nowIso() };
    this.chats.push(chat); this.persist(); return { ...chat };
  }
  touch(id: string, firstMessage?: string): void {
    const chat = this.chats.find(row => row.id === id); if (!chat) throw new Error("Chat not found");
    if (firstMessage && chat.title === "New chat") chat.title = singleLine(firstMessage, 72);
    chat.updatedAt = this.clock.nowIso(); this.persist();
  }
  /** Internal executor only: no BotStore write, persona, agent folder or roster row. */
  executor(id: string): Bot | undefined {
    const chat = this.chats.find(row => row.id === id); if (!chat) return undefined;
    return { id, name: "Assistant", color: "#FF6A3D", avatarKind: "procedural", pinned: false,
      archived: false, unread: false, notifyOnFinish: false, status: "idle", sortOrder: 0, createdAt: chat.createdAt };
  }
  private persist() { this.storage.writeJson(QUICK_CHATS_FILE, this.chats); }
}
