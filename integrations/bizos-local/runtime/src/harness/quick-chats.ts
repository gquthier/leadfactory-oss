import { isPersonalModelSelection, selectionBotFields, type PersonalModelSelection } from "./model-selection.js";
import { createHash } from "node:crypto";
import type { Clock } from "./clock.js";
import type { Storage } from "./storage.js";
import { collapseMessages } from "./threads.js";
import type { Bot, MessageBlock, Run, ThreadMessage } from "./types.js";

export interface QuickChatSource { threadId: string; messageId: string; excerpt: string }
export interface QuickChat { id: string; title: string; createdAt: string; updatedAt: string; lastMessageAt?: string; expiresAt: string; modelSelection?: PersonalModelSelection; source?: QuickChatSource }
export const QUICK_CHATS_FILE = "quick-chats.json";
export const EXPIRED_QUICK_CHATS_FILE = "expired-quick-chats.json";
const REQUEST_ALIASES_FILE = "quick-chat-request-aliases.json";
export const QUICK_CHAT_TTL_MS = 24 * 60 * 60 * 1000;
const chatIdPattern = /^qchat_[a-f0-9]{32}$/;
const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export const quickMessageId = (requestId: string): string => `qmsg_${createHash("sha256").update(requestId).digest("hex").slice(0, 40)}`;

/** Only conversation content counts. Progress, approvals, system events,
 * previews and re-persisting the same message never postpone deletion. */
function contentFingerprint(message: ThreadMessage): string | undefined {
  if ((message.role !== "user" && message.role !== "bot") || message.deliveryState === "control" || !Array.isArray(message.blocks)) return undefined;
  const content = message.blocks.flatMap<MessageBlock>(block => {
    if (block.kind === "text") return block.text.trim() ? [{ kind: "text", text: block.text }] : [];
    if (block.kind === "image" || block.kind === "file" || block.kind === "card") return [block];
    return [];
  });
  return content.length ? createHash("sha256").update(JSON.stringify(content)).digest("hex") : undefined;
}

export class QuickChatStore {
  private chats: QuickChat[];
  private requestAliases: Record<string, string>;
  private readonly expired: Set<string>;
  private readonly pendingPurge: Set<string>;
  private readonly fingerprints = new Map<string, Map<string, string>>();
  private purge?: (id: string) => void;
  private onExpired?: (id: string) => void;
  private cancelTimer?: () => void;
  private stopped = false;
  private sweeping = false;

  constructor(private readonly storage: Storage, private readonly clock: Clock) {
    const tombstones = storage.readJsonStrict<unknown>(EXPIRED_QUICK_CHATS_FILE, []);
    if (!Array.isArray(tombstones) || tombstones.some(id => typeof id !== "string" || !chatIdPattern.test(id))) throw new Error("expired-quick-chats.json is corrupt");
    this.expired = new Set(tombstones);
    const aliases = storage.readJsonStrict<unknown>(REQUEST_ALIASES_FILE, {});
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)
      || Object.entries(aliases).some(([request, chat]) => !chatIdPattern.test(request) || typeof chat !== "string" || !chatIdPattern.test(chat)))
      throw new Error("quick-chat-request-aliases.json is corrupt");
    this.requestAliases = aliases as Record<string, string>;
    this.pendingPurge = new Set(tombstones);
    for (const id of this.expired) storage.blockThread(`chat:${id}`);
    const raw = storage.readJsonStrict<unknown>(QUICK_CHATS_FILE, []);
    if (!Array.isArray(raw) || raw.some(row => !row || typeof row !== "object" || !chatIdPattern.test(row.id) || typeof row.title !== "string" || !validDate(row.createdAt) || !validDate(row.updatedAt) || (row.lastMessageAt !== undefined && !validDate(row.lastMessageAt))) || new Set(raw.map(row => row.id)).size !== raw.length) throw new Error("quick-chats.json is corrupt");
    if (raw.some(row => row.modelSelection !== undefined && !isPersonalModelSelection(row.modelSelection))) throw new Error("quick-chats.json model selection is corrupt");
    if (raw.some(row => row.source !== undefined && (!row.source || typeof row.source !== "object"
      || typeof row.source.threadId !== "string" || typeof row.source.messageId !== "string" || typeof row.source.excerpt !== "string")))
      throw new Error("quick-chats.json source is corrupt");
    const legacyRuns = storage.readJson<Run[]>("runs.json", []);
    this.chats = raw.filter(row => !this.expired.has(row.id)).map(row => {
      const fingerprints = new Map<string, string>();
      let lastMessageAt: string | undefined = row.lastMessageAt;
      const messages = collapseMessages(storage.readNdjson<ThreadMessage>(storage.threadPath(`chat:${row.id}`)).filter(message => message && typeof message.id === "string" && typeof message.seq === "number"));
      for (const message of messages) {
        const fingerprint = contentFingerprint(message);
        if (!fingerprint) continue;
        fingerprints.set(message.id, fingerprint);
        // Legacy streaming rows kept the turn-start createdAt. Their linked
        // completed run is the only durable evidence of a later answer.
        if (row.lastMessageAt === undefined && message.role === "bot" && message.runId) {
          const run = Array.isArray(legacyRuns) ? legacyRuns.find(run => run.id === message.runId && run.threadId === `chat:${row.id}`) : undefined;
          const at = run?.endedAt ?? run?.updatedAt;
          if (validDate(at) && (!lastMessageAt || Date.parse(at) > Date.parse(lastMessageAt))) lastMessageAt = at;
        }
        if (validDate(message.createdAt) && (!lastMessageAt || Date.parse(message.createdAt) > Date.parse(lastMessageAt))) lastMessageAt = message.createdAt;
      }
      // The old store's updatedAt recorded user sends only. Retain that
      // evidence alongside assistant messages when migrating old records.
      if (row.lastMessageAt === undefined && fingerprints.size && (!lastMessageAt || Date.parse(row.updatedAt) > Date.parse(lastMessageAt))) lastMessageAt = row.updatedAt;
      this.fingerprints.set(row.id, fingerprints);
      const updatedAt = lastMessageAt ?? row.createdAt;
      return { id: row.id, title: "QuickChat", createdAt: row.createdAt, updatedAt,
        ...(lastMessageAt ? { lastMessageAt } : {}), ...(row.modelSelection ? { modelSelection: row.modelSelection } : {}),
        ...(row.source ? { source: row.source } : {}), expiresAt: new Date(Date.parse(updatedAt) + QUICK_CHAT_TTL_MS).toISOString() };
    });
    // UX-02 (.46): several QuickChats that never carried a message are one
    // intention repeated. Keep the newest empty one; the others expire now and
    // go through the same durable revocation and purge as a 24 h expiry.
    const empties = this.chats.filter(row => this.isEmpty(row.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const duplicate of empties.slice(1)) duplicate.expiresAt = duplicate.createdAt;
    if (JSON.stringify(raw) !== JSON.stringify(this.chats)) this.persist();
  }

  /** A chat with no conversation content yet (progress and control rows never count). */
  private isEmpty(id: string): boolean {
    const row = this.chats.find(chat => chat.id === id);
    // A chat someone already configured (model choice) is theirs, not a blank one.
    return (this.fingerprints.get(id)?.size ?? 0) === 0 && !row?.lastMessageAt && !row?.modelSelection;
  }

  /** The newest QuickChat nobody has written in yet, if any. */
  emptyChat(): QuickChat | undefined {
    this.sweep();
    return this.chats.filter(row => this.isEmpty(row.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(row => ({ ...row }))[0];
  }

  /** Bound after dispatcher/stores exist. Tombstones replay cleanup after a
   * crash between revocation and the final unlink. No message content is kept. */
  start(purge?: (id: string) => void, onExpired?: (id: string) => void): void {
    if (purge) this.purge = purge;
    if (onExpired) this.onExpired = onExpired;
    this.stopped = false;
    this.sweep();
  }
  stop(): void { this.stopped = true; this.cancelTimer?.(); this.cancelTimer = undefined; }
  expiredIds(): string[] { this.sweep(); return [...this.expired]; }

  sweep(): void {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = this.chats.filter(row => Date.parse(row.expiresAt) <= this.clock.now().getTime());
      if (due.length) {
        for (const chat of due) this.expired.add(chat.id);
        // Revoke durably BEFORE aborting execution or unlinking anything.
        this.storage.writeJson(EXPIRED_QUICK_CHATS_FILE, [...this.expired]);
        for (const chat of due) {
          this.storage.blockThread(`chat:${chat.id}`);
          this.pendingPurge.add(chat.id);
          this.fingerprints.delete(chat.id);
        }
        this.chats = this.chats.filter(row => !this.expired.has(row.id));
        this.persist();
        for (const chat of due) this.onExpired?.(chat.id);
      }
      if (this.purge) for (const id of this.pendingPurge) {
        try { this.purge(id); this.pendingPurge.delete(id); }
        catch { /* Already revoked; a failed cleanup cannot block other chats. */ }
      }
    } finally {
      this.sweeping = false;
      this.schedule();
    }
  }

  list(): QuickChat[] { this.sweep(); return this.chats.map(row => ({ ...row })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string): QuickChat {
    this.sweep();
    const chat = this.chats.find(row => row.id === id);
    if (!chat || this.expired.has(id)) throw new Error("Chat not found in this workspace (it may have expired)");
    return { ...chat };
  }
  create(requestId: string, source?: QuickChatSource | boolean): QuickChat {
    this.sweep();
    const dedicated = Boolean(source);
    const id = `qchat_${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}`;
    if (this.expired.has(id)) throw new Error("QuickChat expired; create a new QuickChat with a new request id");
    if (source && typeof source === "object") {
      const bySource = this.chats.find(row => row.source?.threadId === source.threadId && row.source.messageId === source.messageId);
      if (bySource) return { ...bySource };
    }
    const alias = this.requestAliases[id];
    if (alias) {
      const reused = this.chats.find(row => row.id === alias);
      if (reused && !this.expired.has(alias)) return { ...reused };
    }
    const existing = this.chats.find(row => row.id === id);
    if (existing) {
      if (source && typeof source === "object" && (existing.source?.threadId !== source.threadId || existing.source.messageId !== source.messageId))
        throw new Error("QuickChat request id belongs to another source message");
      return { ...existing };
    }
    // A new intention while an empty QuickChat is still open reuses it: the
    // sidebar never shows two blank chats (UX-02). Once someone wrote in it, a
    // new intention gets its own chat as before.
    const blank = dedicated ? undefined : this.emptyChat();
    if (blank) {
      // A new intention is activity: the reused blank chat gets a fresh day.
      const row = this.chats.find(chat => chat.id === blank.id)!;
      row.updatedAt = this.clock.nowIso();
      row.expiresAt = new Date(this.clock.now().getTime() + QUICK_CHAT_TTL_MS).toISOString();
      this.requestAliases[id] = blank.id;
      this.storage.writeJson(REQUEST_ALIASES_FILE, this.requestAliases);
      this.persist(); this.schedule();
      return { ...row };
    }
    const now = this.clock.nowIso();
    const chat: QuickChat = { id, title: "QuickChat", createdAt: now, updatedAt: now,
      ...(source && typeof source === "object" ? { source } : {}),
      expiresAt: new Date(this.clock.now().getTime() + QUICK_CHAT_TTL_MS).toISOString() };
    this.chats.push(chat); this.persist(); this.schedule(); return { ...chat };
  }
  recordMessage(message: ThreadMessage): void {
    if (!message.threadId.startsWith("chat:")) return;
    const id = message.threadId.slice(5);
    this.get(id); // A callback delivered after sleep cannot revive an expired chat.
    const fingerprint = contentFingerprint(message);
    if (!fingerprint) return;
    const fingerprints = this.fingerprints.get(id) ?? new Map<string, string>();
    if (fingerprints.get(message.id) === fingerprint) return;
    fingerprints.set(message.id, fingerprint); this.fingerprints.set(id, fingerprints);
    const chat = this.chats.find(row => row.id === id)!;
    chat.lastMessageAt = new Date(Math.max(Date.parse(chat.updatedAt), this.clock.now().getTime())).toISOString();
    chat.updatedAt = chat.lastMessageAt;
    chat.expiresAt = new Date(Date.parse(chat.updatedAt) + QUICK_CHAT_TTL_MS).toISOString();
    this.persist(); this.schedule();
  }
  setModelSelection(id: string, selection: PersonalModelSelection): QuickChat {
    this.get(id);
    const chat = this.chats.find(row => row.id === id)!;
    chat.modelSelection = { ...selection };
    // Configuration is not message activity and must not extend the TTL.
    this.persist();
    return this.get(id);
  }
  executor(id: string): Bot | undefined {
    this.sweep();
    const chat = this.chats.find(row => row.id === id);
    if (!chat || this.expired.has(id)) return undefined;
    return { ...(chat.modelSelection ? selectionBotFields(chat.modelSelection) : {}), id, name: "QuickChat", color: "#FF6A3D", avatarKind: "procedural", pinned: false, archived: false, unread: false, notifyOnFinish: false, status: "idle", sortOrder: 0, createdAt: chat.createdAt };
  }
  private schedule(): void {
    this.cancelTimer?.(); this.cancelTimer = undefined;
    if (this.stopped || !this.purge) return;
    let next = this.pendingPurge.size ? this.clock.now().getTime() + 60_000 : Infinity;
    for (const chat of this.chats) next = Math.min(next, Date.parse(chat.expiresAt));
    if (Number.isFinite(next)) this.cancelTimer = this.clock.setTimeout(() => {
      // A failed unlink is retried next minute and on every read/start.
      try { this.sweep(); } catch { /* revocation remains durable */ }
    }, Math.max(1, Math.min(QUICK_CHAT_TTL_MS, next - this.clock.now().getTime())));
  }
  private persist(): void { this.storage.writeJson(QUICK_CHATS_FILE, this.chats); }
}
