// Thread persistence: one append-only NDJSON file per thread, one JSON
// message per line. A snapshot is the tail of that file; older pages walk
// backwards from a cursor. Appending never rewrites history, so a crash
// mid-turn costs at most the line being written.
import type { Clock } from "./clock.js";
import { newMessageId } from "./ids.js";
import type { Storage } from "./storage.js";
import {
  threadIdForTarget,
  type MessageBlock,
  type MessageRole,
  type ThreadMessage,
  type ThreadSnapshot,
  type ThreadTarget,
} from "./types.js";

export const DEFAULT_PAGE_SIZE = 60;

export function previewOf(blocks: MessageBlock[]): string {
  for (const block of blocks) {
    if (block.kind === "text" && block.text.trim()) return block.text.trim().slice(0, 200);
    if (block.kind === "card") return block.title.slice(0, 200);
    if (block.kind === "ask") return block.summary.slice(0, 200);
  }
  return "";
}

function isMessage(row: unknown): row is ThreadMessage {
  if (!row || typeof row !== "object") return false;
  const record = row as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.threadId === "string" &&
    typeof record.seq === "number" &&
    Array.isArray(record.blocks)
  );
}

export class ThreadStore {
  /** seq is per-thread and monotonic. It is recovered from the file ONCE
   * per thread per process and then kept here: `append` used to re-read and
   * re-parse the entire NDJSON on every single message (quadratic on a long
   * conversation) and take the maximum with `Math.max(...rows)`, which
   * throws RangeError somewhere past a hundred thousand lines. */
  private readonly sequences = new Map<string, number>();
  private readonly unread = new Set<string>();

  constructor(
    private readonly storage: Storage,
    private readonly clock: Clock,
  ) {}

  private rows(threadId: string): ThreadMessage[] {
    return collapseMessages(
      this.storage.readNdjson<unknown>(this.storage.threadPath(threadId)).filter(isMessage),
    );
  }

  /** Highest seq on disk, by a loop — never a spread into `Math.max`. */
  private highestOnDisk(threadId: string): number {
    let highest = 0;
    for (const row of this.storage.readNdjson<unknown>(this.storage.threadPath(threadId))) {
      if (isMessage(row) && row.seq > highest) highest = row.seq;
    }
    return highest;
  }

  private nextSeq(threadId: string): number {
    const cached = this.sequences.get(threadId);
    const next = (cached ?? this.highestOnDisk(threadId)) + 1;
    this.sequences.set(threadId, next);
    return next;
  }

  snapshot(target: ThreadTarget, activeRunIds: string[] = []): ThreadSnapshot {
    const threadId = threadIdForTarget(target);
    const rows = this.rows(threadId);
    const page = rows.slice(-DEFAULT_PAGE_SIZE);
    const first = page[0];
    return {
      threadId,
      target,
      messages: page,
      olderCursor: rows.length > page.length && first ? first.id : null,
      activeRunIds,
      unread: this.unread.has(threadId),
      updatedAt: rows.at(-1)?.createdAt ?? this.clock.nowIso(),
    };
  }

  page(target: ThreadTarget, before?: string): { messages: ThreadMessage[]; olderCursor: string | null } {
    const threadId = threadIdForTarget(target);
    const rows = this.rows(threadId);
    const end = before ? rows.findIndex((row) => row.id === before) : rows.length;
    const stop = end < 0 ? rows.length : end;
    const start = Math.max(0, stop - DEFAULT_PAGE_SIZE);
    const messages = rows.slice(start, stop);
    const first = messages[0];
    return { messages, olderCursor: start > 0 && first ? first.id : null };
  }

  /** Forward pagination used by polling clients. `null` means the cursor never
   * existed; silently returning an empty page would strand that client forever. */
  pageAfter(
    target: ThreadTarget,
    after: string,
    limit = DEFAULT_PAGE_SIZE,
  ): { messages: ThreadMessage[]; nextCursor: string; hasMore: boolean } | null {
    const rows = this.rows(threadIdForTarget(target));
    const index = rows.findIndex((row) => row.id === after);
    if (index < 0) return null;
    const size = Math.max(1, Math.min(limit, 200));
    const messages = rows.slice(index + 1, index + 1 + size);
    return {
      messages,
      nextCursor: messages.at(-1)?.id ?? after,
      hasMore: index + 1 + messages.length < rows.length,
    };
  }

  append(
    threadId: string,
    input: {
      role: MessageRole;
      deliveryState?: "control" | "complete";
      blocks: MessageBlock[];
      botId?: string;
      runId?: string;
      replyToMessageId?: string;
      /** A caller-chosen id, for a message that must exist at most once
       * (a template greeting written again after a crash). The log stays
       * append-only; a second line with the same id collapses on read. */
      id?: string;
    },
  ): ThreadMessage {
    const message: ThreadMessage = {
      id: input.id ?? newMessageId(),
      threadId,
      seq: this.nextSeq(threadId),
      role: input.role,
      ...(input.deliveryState ? { deliveryState: input.deliveryState } : {}),
      blocks: input.blocks,
      ...(input.botId ? { botId: input.botId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      createdAt: this.clock.nowIso(),
    };
    this.storage.appendNdjson(this.storage.threadPath(threadId), message);
    return message;
  }

  /** A streaming bot message is rewritten as it grows. The log stays
   * append-only — a later line for the same id wins on read. */
  replace(message: ThreadMessage): ThreadMessage {
    this.storage.appendNdjson(this.storage.threadPath(message.threadId), message);
    return message;
  }

  get(threadId: string, messageId: string): ThreadMessage | undefined {
    return [...this.rows(threadId)].reverse().find((row) => row.id === messageId);
  }

  /** "Clear" must mean cleared. The transcript AND the raw protocol tee go:
   * leaving `native/<threadId>.ndjson` behind kept a redacted copy of the
   * whole conversation the user just asked to be rid of. Forgetting the
   * codex resume cursor is the dispatcher's half of the same promise. */
  clear(target: ThreadTarget): void {
    const threadId = threadIdForTarget(target);
    this.storage.removeFile(this.storage.threadPath(threadId));
    this.storage.removeFile(this.storage.nativePath(threadId));
    this.sequences.delete(threadId);
    this.unread.delete(threadId);
  }

  markRead(target: ThreadTarget): void {
    this.unread.delete(threadIdForTarget(target));
  }

  markUnread(target: ThreadTarget): void {
    this.unread.add(threadIdForTarget(target));
  }

  isUnread(threadId: string): boolean {
    return this.unread.has(threadId);
  }
}

/** Later lines for the same message id supersede earlier ones — the file is
 * append-only, so a streamed message appears many times. */
export function collapseMessages(rows: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}
