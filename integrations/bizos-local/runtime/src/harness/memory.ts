// Agent memory, the Hermes way: two small Markdown files the agent keeps
// itself with its ordinary file tools. No memory tool, no database.
//
//   * `MEMORY.md` — in the agent's own folder: what THIS agent has learned.
//   * `USER.md`   — one per company: who the person is, how they like to work.
//     At the root of the bound second brain, else at the runtime profile's
//     local workspace root.
//
// Both are read once when a provider session starts and handed to the agent
// inside its brief, with a fill gauge ("MEMORY.md [67% — 1,474/2,200 chars]")
// so it consolidates before the file becomes a transcript. The caps are small
// on purpose: this text rides in every cached prompt.
//
// The runtime only ever CREATES a missing file (`wx`); it never rewrites one,
// so a person's own notes in USER.md are never clobbered. A symlink or a
// non-file is not read: the brief would otherwise ship whatever file it points
// to to a model provider.
import { closeSync, lstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecretsInText } from "./redact.js";

export const AGENT_MEMORY_FILE = "MEMORY.md";
export const USER_MEMORY_FILE = "USER.md";
export const AGENT_MEMORY_CAP = 2200;
export const USER_MEMORY_CAP = 1375;
/** Past its cap a file is still shown, up to this much more, so the agent can
 * consolidate what is there rather than lose it. */
const OVERFLOW_SHOWN = 0.25;

export interface MemoryFile {
  name: typeof AGENT_MEMORY_FILE | typeof USER_MEMORY_FILE;
  path: string;
  cap: number;
  /** Sanitised content, possibly cut past the overflow allowance. */
  text: string;
  /** Characters in the file as stored. */
  chars: number;
  truncated: boolean;
  /** Absent/unreadable (symlink, directory, permission): named, not shown. */
  available: boolean;
  writable: boolean;
}

export interface MemorySnapshot {
  agent: MemoryFile;
  user: MemoryFile;
  /** The provider sandbox cannot write anywhere. */
  readOnly: boolean;
}

const HEADERS: Record<MemoryFile["name"], string> = {
  [AGENT_MEMORY_FILE]: "# Memory\n",
  [USER_MEMORY_FILE]: "# User\n",
};

/** Create the file when it does not exist. Never overwrites. */
export function ensureMemoryFile(path: string, name: MemoryFile["name"]): void {
  try {
    writeFileSync(path, HEADERS[name], { flag: "wx", mode: 0o600 });
  } catch {
    // EEXIST is the normal case; anything else (read-only volume, missing
    // folder) leaves the file absent and the brief says so.
  }
}

/** The fence the memory text is quoted inside; nothing in it may close it. */
const FENCE_END = ">>>";

function sanitise(text: string): string {
  return redactSecretsInText(text)
    // eslint-disable-next-line no-control-regex -- keep \t and \n only
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, "")
    .replaceAll("<<<", "‹‹‹")
    .replaceAll(FENCE_END, "›››")
    .trim();
}

export function readMemoryFile(input: { path: string; name: MemoryFile["name"]; cap: number; writable: boolean }): MemoryFile {
  const base = { name: input.name, path: input.path, cap: input.cap, writable: input.writable };
  const limit = Math.ceil(input.cap * (1 + OVERFLOW_SHOWN));
  try {
    const stat = lstatSync(input.path);
    if (!stat.isFile()) return { ...base, text: "", chars: 0, truncated: false, available: false };
    // Read a bounded prefix only: a pasted 50 MB log must not stall a turn.
    const bytes = Buffer.alloc(Math.min(stat.size, limit * 4));
    const fd = openSync(input.path, "r");
    let read = 0;
    try {
      read = readSync(fd, bytes, 0, bytes.length, 0);
    } finally {
      closeSync(fd);
    }
    const raw = bytes.subarray(0, read).toString("utf8");
    // Characters as the agent will count them; past the byte bound the size in
    // bytes is a good enough gauge (it is far over the cap either way).
    const chars = stat.size > bytes.length ? stat.size : raw.length;
    const text = sanitise(raw);
    const truncated = text.length > limit || stat.size > bytes.length;
    return { ...base, text: truncated ? `${text.slice(0, limit)} [truncated]` : text, chars, truncated, available: true };
  } catch {
    return { ...base, text: "", chars: 0, truncated: false, available: false };
  }
}

/** Create-if-missing, then read both files. */
export function loadMemory(input: {
  agentDir: string;
  userDir: string;
  readOnly: boolean;
  /** Whether the agent's tools can write in `userDir` without an approval. */
  userWritable: boolean;
}): MemorySnapshot {
  const agentPath = join(input.agentDir, AGENT_MEMORY_FILE);
  const userPath = join(input.userDir, USER_MEMORY_FILE);
  ensureMemoryFile(agentPath, AGENT_MEMORY_FILE);
  ensureMemoryFile(userPath, USER_MEMORY_FILE);
  return {
    readOnly: input.readOnly,
    agent: readMemoryFile({ path: agentPath, name: AGENT_MEMORY_FILE, cap: AGENT_MEMORY_CAP, writable: !input.readOnly }),
    user: readMemoryFile({ path: userPath, name: USER_MEMORY_FILE, cap: USER_MEMORY_CAP, writable: !input.readOnly && input.userWritable }),
  };
}

const count = (value: number): string => value.toLocaleString("en-US");

/** `MEMORY.md [67% — 1,474/2,200 chars]` */
export function memoryGauge(file: Pick<MemoryFile, "name" | "chars" | "cap">): string {
  return `${file.name} [${Math.round((file.chars / file.cap) * 100)}% — ${count(file.chars)}/${count(file.cap)} chars]`;
}

function renderFile(file: MemoryFile, role: string): string {
  // eslint-disable-next-line no-control-regex -- a path is one line
  const path = file.path.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");
  if (!file.available) return `${file.name} — ${role}: ${path} (not readable right now)`;
  const notes = [
    file.chars > file.cap ? "over its cap: consolidate it now (merge, shorten, drop stale lines)" : "",
    !file.writable ? "read-only for you here" : "",
  ].filter(Boolean);
  return [
    `${memoryGauge(file)} — ${role}: ${path}${notes.length ? ` (${notes.join("; ")})` : ""}`,
    `<<<${file.name}`,
    file.text,
    FENCE_END,
  ].join("\n");
}

/** The memory section of the brief. */
export function renderMemory(snapshot: MemorySnapshot): string {
  return [
    "Memory: two small files, loaded when a session starts. " + (snapshot.readOnly
      ? "Memory is read-only in this sandbox: use it, don't try to edit it."
      : "Keep them yourself with your normal file tools. Store facts, not orders, one per line: `- (YYYY-MM-DD) fact`. Update them silently when you learn something durable (preferences, decisions, people, context); never narrate it. Stay under the cap: consolidate rather than append forever."),
    renderFile(snapshot.agent, "your own notes"),
    renderFile(snapshot.user, "the person and the company, shared by the team"),
  ].join("\n");
}
