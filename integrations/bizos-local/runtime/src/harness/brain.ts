// The second brain — what the local workspace has written down, as a graph.
//
// A vault is a folder of notes: the agents' workspaces by default, or any
// folder the user shared in Settings → Access. Every markdown or text file
// is a note; `[[wikilinks]]` and relative markdown links between them are
// edges. The desktop draws the graph and the folder tree from what this
// module answers, and — since the vault is the user's own folder — writes
// back into it: a new note, a new folder, an edit, a rename, a soft delete.
// Nothing leaves the Mac.
//
// Every write goes through the same door as `readNote`: the path is split on
// `/`, refused if a segment is `..`, `.`, hidden, or holds a separator or a
// NUL, and the result is canonicalized with `realpath` and checked to be
// inside the vault — so a symlink planted in the folder cannot be written
// through. A delete is Obsidian's: the entry moves to `<vault>/.trash/`.
//
// Bounded on purpose: a vault of ten thousand files is scanned up to the
// caps below and the answer says so, instead of hanging the sidecar.
//
// The renderer mirrors these types by hand in the desktop repository
// (`ts/bizos/apps/local-brain.std.ts`): change a shape here, change it there.
import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";

export const MAX_NOTES = 4_000;
export const MAX_DEPTH = 12;
export const MAX_NOTE_BYTES = 512 * 1024;
export const MAX_READ_BYTES = 200 * 1024;
/** How many rows the folder tree may carry — Obsidian shows everything, the
 * sidecar answers within one response. Past it the scan says `truncated`. */
export const MAX_TREE_ENTRIES = 20_000;
/** The longest name a new note or folder may be given. */
export const MAX_NAME_CHARS = 120;
/** Obsidian's soft delete: the folder a trashed entry lands in. */
export const TRASH_DIRECTORY = ".trash";
/** Where a Mac keeps Obsidian, when the person has it. */
export const OBSIDIAN_APP = "/Applications/Obsidian.app";
const NOTE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".obsidian", ".trash", "dist", "build", ".next", ".cache"]);

export interface BrainRoot {
  id: string;
  label: string;
  path: string;
  /** `false` for a folder shared read-only: every write route refuses it.
   * Absent means writable — the starter vault and the agent workspaces are
   * this app's own folders. */
  writable?: boolean;
}

export interface BrainNote {
  /** The note's path inside the vault, `/`-separated. Doubles as the graph node id. */
  id: string;
  title: string;
  folder: string;
  extension: string;
  bytes: number;
  modifiedAt: string;
  /** Note ids this note links to (resolved), in document order, unique. */
  links: string[];
  /** Link targets that resolved to no note — they still shape the graph as ghosts. */
  unresolved: string[];
  backlinks: number;
}

/** One row of the folder tree. Obsidian shows a vault whole, so this is
 * every entry — folders (empty ones included), notes, and the files that are
 * not notes — not just the ones the graph knows about. */
export interface BrainTreeNode {
  name: string;
  path: string;
  kind: "folder" | "note" | "file";
  /** Folders only, possibly empty. */
  children?: BrainTreeNode[];
  /** Notes only: the id `readNote` and the graph use. */
  noteId?: string;
  /** Files only. */
  bytes?: number;
  modifiedAt?: string;
}

/** What this vault lets the desktop offer: writing, and Obsidian itself. */
export interface BrainCapabilities {
  write: boolean;
  obsidian: boolean;
}

export interface BrainGraph {
  nodes: Array<{ id: string; title: string; links: number; backlinks: number; ghost: boolean }>;
  edges: Array<{ source: string; target: string }>;
}

export interface BrainScan {
  root: BrainRoot;
  scannedAt: string;
  notes: BrainNote[];
  tree: BrainTreeNode[];
  graph: BrainGraph;
  truncated: boolean;
  /** How many notes were seen, including the ones past the cap. */
  seen: number;
  capabilities: BrainCapabilities;
}

/**
 * The four answers a vault operation can refuse with. The name doubles as
 * the IPC error code, which the sidecar turns into a status: `not_found` is
 * 404, `read_only` 403, `exists` 409, and everything else 400.
 */
export type BrainErrorCode = "invalid_payload" | "not_found" | "read_only" | "exists";

export class BrainError extends Error {
  constructor(message: string, readonly code: BrainErrorCode = "invalid_payload") {
    super(message);
    this.name = code;
  }
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function toId(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function titleOf(id: string, text: string | null): string {
  if (text) {
    const heading = /^#\s+(.+?)\s*$/m.exec(text.slice(0, 4_000));
    if (heading?.[1]) return heading[1].trim().slice(0, 120);
    const front = /^---\s*\n(?:[\s\S]*?\n)?title:\s*["']?(.+?)["']?\s*\n[\s\S]*?^---/m.exec(text.slice(0, 4_000));
    if (front?.[1]) return front[1].trim().slice(0, 120);
  }
  return basename(id, extname(id));
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Raw link targets in document order: wikilinks first-class, then relative
 * markdown links. Code is skipped the way Obsidian skips it: a `[[link]]`
 * inside backticks or a fenced block is text about a link, not a link. */
export function extractLinkTargets(source: string): string[] {
  const text = source.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const targets: string[] = [];
  for (const match of text.matchAll(WIKILINK)) {
    const target = match[1]?.trim();
    if (target) targets.push(target);
  }
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const target = match[1]?.trim();
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    targets.push(decodeURIComponent(target.split("#")[0] ?? target));
  }
  return targets;
}

/**
 * Obsidian's rule, roughly: a wikilink names a note by its title/basename
 * (shortest path wins), a markdown link is relative to the linking note.
 */
export function resolveLink(target: string, fromId: string, index: { byBase: Map<string, string[]>; ids: Set<string> }): string | null {
  const cleaned = target.replace(/\\/g, "/").replace(/^\.\//, "");
  const withExt = extname(cleaned) ? cleaned : `${cleaned}.md`;
  const relativeToNote = posix.normalize(posix.join(posix.dirname(fromId), withExt));
  if (index.ids.has(relativeToNote)) return relativeToNote;
  if (index.ids.has(withExt)) return withExt;
  if (index.ids.has(cleaned)) return cleaned;
  const base = posix.basename(withExt).toLowerCase();
  const candidates = index.byBase.get(base) ?? index.byBase.get(posix.basename(cleaned).toLowerCase()) ?? [];
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
}

interface Found {
  id: string;
  absolute: string;
  bytes: number;
  modifiedAt: string;
}

/** Obsidian's order: case-insensitive, ties broken so the list is stable. */
function byName(a: BrainTreeNode, b: BrainTreeNode): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name);
}

/**
 * One pass over the vault that answers both questions: the notes the graph
 * is built from, and the whole folder tree the explorer draws. Hidden
 * entries, symlinks and the skipped directories (`.obsidian`, `.trash`,
 * `node_modules`, …) are in neither — the way Obsidian's file explorer
 * shows a vault.
 */
function walk(root: string): { found: Found[]; tree: BrainTreeNode[]; truncated: boolean; seen: number } {
  const found: Found[] = [];
  let seen = 0;
  let rows = 0;
  let truncated = false;
  const visit = (directory: string, prefix: string, depth: number): BrainTreeNode[] => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return [];
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const folders: BrainTreeNode[] = [];
    const files: BrainTreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        const children = visit(absolute, path, depth + 1);
        if (rows >= MAX_TREE_ENTRIES) {
          truncated = true;
          continue;
        }
        rows += 1;
        folders.push({ name: entry.name, path, kind: "folder", children });
        continue;
      }
      if (!entry.isFile()) continue;
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(absolute);
      } catch {
        continue; // vanished mid-scan
      }
      const isNote = NOTE_EXTENSIONS.has(extname(entry.name).toLowerCase());
      const modifiedAt = stats.mtime.toISOString();
      if (isNote) {
        seen += 1;
        if (found.length >= MAX_NOTES) truncated = true;
        else found.push({ id: path, absolute, bytes: stats.size, modifiedAt });
      }
      if (rows >= MAX_TREE_ENTRIES) {
        truncated = true;
        continue;
      }
      rows += 1;
      files.push({
        name: entry.name,
        path,
        kind: isNote ? "note" : "file",
        bytes: stats.size,
        modifiedAt,
        ...(isNote ? { noteId: path } : {}),
      });
    }
    folders.sort(byName);
    files.sort(byName);
    return [...folders, ...files];
  };
  const tree = visit(root, "", 0);
  return { found, tree, truncated, seen };
}

export function scanVault(
  root: BrainRoot,
  now: () => Date = () => new Date(),
  options: { obsidian?: boolean } = {},
): BrainScan {
  let canonical: string;
  try {
    canonical = realpathSync(root.path);
    if (!statSync(canonical).isDirectory()) throw new Error("not a folder");
  } catch {
    throw new BrainError(`${root.label} is not a folder this Mac can read`, "not_found");
  }
  const { found, tree, truncated, seen } = walk(canonical);
  const ids = new Set(found.map((file) => file.id));
  const byBase = new Map<string, string[]>();
  for (const file of found) {
    const base = posix.basename(file.id).toLowerCase();
    byBase.set(base, [...(byBase.get(base) ?? []), file.id]);
  }
  const index = { byBase, ids };
  const backlinks = new Map<string, number>();
  const notes: BrainNote[] = found.map((file) => {
    let text: string | null = null;
    if (file.bytes <= MAX_NOTE_BYTES) {
      try {
        text = readFileSync(file.absolute, "utf8");
      } catch {
        text = null;
      }
    }
    const links: string[] = [];
    const unresolved: string[] = [];
    if (text) {
      for (const target of extractLinkTargets(text)) {
        const resolved = resolveLink(target, file.id, index);
        if (resolved && resolved !== file.id) {
          if (!links.includes(resolved)) links.push(resolved);
        } else if (!resolved && !unresolved.includes(target)) {
          unresolved.push(target.slice(0, 120));
        }
      }
    }
    for (const target of links) backlinks.set(target, (backlinks.get(target) ?? 0) + 1);
    return {
      id: file.id,
      title: titleOf(file.id, text),
      folder: posix.dirname(file.id) === "." ? "" : posix.dirname(file.id),
      extension: extname(file.id).toLowerCase(),
      bytes: file.bytes,
      modifiedAt: file.modifiedAt,
      links,
      unresolved: unresolved.slice(0, 50),
      backlinks: 0,
    };
  });
  for (const note of notes) note.backlinks = backlinks.get(note.id) ?? 0;
  const ghosts = new Map<string, number>();
  const edges: BrainGraph["edges"] = [];
  for (const note of notes) {
    for (const target of note.links) edges.push({ source: note.id, target });
    for (const target of note.unresolved) {
      const ghostId = `ghost:${target}`;
      ghosts.set(ghostId, (ghosts.get(ghostId) ?? 0) + 1);
      edges.push({ source: note.id, target: ghostId });
    }
  }
  const graph: BrainGraph = {
    nodes: [
      ...notes.map((note) => ({ id: note.id, title: note.title, links: note.links.length, backlinks: note.backlinks, ghost: false })),
      ...[...ghosts.entries()].map(([id, count]) => ({ id, title: id.slice(6), links: 0, backlinks: count, ghost: true })),
    ],
    edges,
  };
  return {
    root,
    scannedAt: now().toISOString(),
    notes,
    tree,
    graph,
    truncated,
    seen,
    capabilities: {
      write: root.writable !== false,
      obsidian: options.obsidian ?? obsidianInstalled(),
    },
  };
}

/** Whether this Mac has Obsidian — the desktop only offers the row if so. */
export function obsidianInstalled(): boolean {
  return existsSync(OBSIDIAN_APP);
}

export interface BrainNoteContent {
  id: string;
  title: string;
  text: string;
  truncated: boolean;
  bytes: number;
}

// ── inside the vault ────────────────────────────────────────────────────

/** The vault itself, symlinks resolved once so every check below compares
 * canonical paths. */
function vaultOf(root: BrainRoot): string {
  try {
    const canonical = realpathSync(root.path);
    if (!statSync(canonical).isDirectory()) throw new Error("not a folder");
    return canonical;
  } catch {
    throw new BrainError(`${root.label} is not a folder this Mac can read`, "not_found");
  }
}

/** A `/`-separated vault path, split and refused if any segment could leave
 * the vault or name something the vault does not show. */
function segmentsOf(path: string, what: string): string[] {
  if (typeof path !== "string" || path.includes("\0") || path.includes("\\")) {
    throw new BrainError(`that is not ${what} in this vault`);
  }
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length > MAX_DEPTH) throw new BrainError(`that is not ${what} in this vault`);
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.trim() === "") {
      throw new BrainError(`that is not ${what} in this vault`);
    }
  }
  return segments;
}

interface VaultEntry {
  vault: string;
  absolute: string;
  /** The path inside the vault, `/`-separated — what every route answers. */
  path: string;
  stats: Stats;
}

/** An entry that already exists inside the vault, symlinks resolved: a
 * symlink pointing outside is refused here, not followed. */
function entryIn(root: BrainRoot, path: string, what = "an entry"): VaultEntry {
  const vault = vaultOf(root);
  const segments = segmentsOf(path, what);
  if (segments.length === 0) throw new BrainError(`that is not ${what} in this vault`);
  let absolute: string;
  let stats: ReturnType<typeof statSync>;
  try {
    absolute = realpathSync(resolve(vault, ...segments));
    stats = statSync(absolute);
  } catch {
    throw new BrainError(`that ${what.replace(/^an? /, "")} is not in this vault`, "not_found");
  }
  if (!within(absolute, vault) || absolute === vault) {
    throw new BrainError(`that ${what.replace(/^an? /, "")} is not in this vault`, "not_found");
  }
  return { vault, absolute, path: toId(vault, absolute), stats };
}

/** The folder a new entry goes into. The vault's own root is `""` or `"/"`. */
function folderIn(root: BrainRoot, folder: string): { vault: string; absolute: string; path: string } {
  const vault = vaultOf(root);
  const segments = segmentsOf(folder ?? "", "a folder");
  if (segments.length === 0) return { vault, absolute: vault, path: "" };
  const entry = entryIn(root, segments.join("/"), "a folder");
  if (!entry.stats.isDirectory()) throw new BrainError("that is not a folder in this vault");
  return { vault: entry.vault, absolute: entry.absolute, path: entry.path };
}

/** A name the vault may carry: one segment, visible, bounded. */
function nameFor(name: unknown, what: string): string {
  if (typeof name !== "string") throw new BrainError(`${what} needs a name`);
  const trimmed = name.trim();
  if (!trimmed) throw new BrainError(`${what} needs a name`);
  if (trimmed.length > MAX_NAME_CHARS) throw new BrainError(`that name is longer than ${MAX_NAME_CHARS} characters`);
  if (trimmed === "." || trimmed === ".." || trimmed.startsWith(".")) throw new BrainError("that name is not allowed here");
  if (/[/\\\u0000-\u001f]/.test(trimmed)) throw new BrainError("a name cannot contain a slash or a control character");
  return trimmed;
}

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

function isNotePath(path: string): boolean {
  return NOTE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** One note's text, bounded, and only from inside the vault. */
export function readNote(root: BrainRoot, id: string): BrainNoteContent {
  const entry = entryIn(root, id, "a note");
  if (!isNotePath(entry.absolute)) throw new BrainError("that is not a note in this vault");
  if (!entry.stats.isFile()) throw new BrainError("that is not a note");
  const buffer = readFileSync(entry.absolute);
  const truncated = buffer.length > MAX_READ_BYTES;
  const text = buffer.subarray(0, MAX_READ_BYTES).toString("utf8");
  return { id: entry.path, title: titleOf(entry.path, text), text, truncated, bytes: buffer.length };
}

// ── writing ─────────────────────────────────────────────────────────────

/**
 * A new note, the way pressing "New note" in Obsidian makes one: an empty
 * `Untitled.md` in the folder, or `Untitled 1.md`, `Untitled 2.md`… when
 * that name is taken. A name the person actually typed is never silently
 * renumbered — a collision is `exists`, so they can decide.
 */
export function createNote(root: BrainRoot, folder: string, name?: string): { id: string; title: string } {
  const target = folderIn(root, folder);
  const chosen = typeof name === "string" && name.trim() ? nameFor(name, "a note") : null;
  let base = "Untitled";
  let extension = ".md";
  if (chosen) {
    const chosenExtension = extname(chosen).toLowerCase();
    if (NOTE_EXTENSIONS.has(chosenExtension)) {
      base = chosen.slice(0, chosen.length - chosenExtension.length);
      extension = chosenExtension;
    } else {
      base = chosen;
    }
    if (!base.trim()) throw new BrainError("a note needs a name");
  }
  let fileName = `${base}${extension}`;
  if (existsSync(join(target.absolute, fileName))) {
    if (chosen) throw new BrainError(`${fileName} already exists in this folder`, "exists");
    let index = 1;
    do {
      if (index > 999) throw new BrainError("this folder already holds too many untitled notes", "exists");
      fileName = `${base} ${index}${extension}`;
      index += 1;
    } while (existsSync(join(target.absolute, fileName)));
  }
  try {
    // `wx`: the file is created or nothing is, so a note written between the
    // check above and here is never overwritten.
    writeFileSync(join(target.absolute, fileName), "", { mode: 0o600, flag: "wx" });
  } catch {
    throw new BrainError(`${fileName} already exists in this folder`, "exists");
  }
  return { id: joinPath(target.path, fileName), title: basename(fileName, extname(fileName)) };
}

/** A new folder inside the vault. */
export function createFolder(root: BrainRoot, folder: string, name: string): { path: string } {
  const target = folderIn(root, folder);
  const safe = nameFor(name, "a folder");
  try {
    mkdirSync(join(target.absolute, safe), { mode: 0o700 });
  } catch {
    throw new BrainError(`${safe} already exists in this folder`, "exists");
  }
  return { path: joinPath(target.path, safe) };
}

/** The editor's save: a note that already exists, replaced whole, bounded. */
export function writeNote(root: BrainRoot, id: string, text: string): { id: string; bytes: number; modifiedAt: string } {
  if (typeof text !== "string") throw new BrainError("a note is text");
  if (Buffer.byteLength(text, "utf8") > MAX_NOTE_BYTES) {
    throw new BrainError(`a note is at most ${Math.round(MAX_NOTE_BYTES / 1024)} KB`);
  }
  const entry = entryIn(root, id, "a note");
  if (!isNotePath(entry.absolute)) throw new BrainError("that is not a note this app writes");
  if (!entry.stats.isFile()) throw new BrainError("that is not a note");
  writeFileSync(entry.absolute, text, { mode: 0o600 });
  const stats = statSync(entry.absolute);
  return { id: entry.path, bytes: stats.size, modifiedAt: stats.mtime.toISOString() };
}

/**
 * Rename inside the same folder — a note or a folder. A note keeps its
 * extension when the new name has none, the way Obsidian keeps `.md`.
 * Links in OTHER notes are not rewritten: this app renames the file, it does
 * not edit the vault behind the person's back.
 */
export function renameEntry(root: BrainRoot, path: string, name: string): { path: string; id?: string } {
  const entry = entryIn(root, path);
  const safe = nameFor(name, "an entry");
  const isNote = entry.stats.isFile() && isNotePath(entry.absolute);
  const target = isNote && !isNotePath(safe) ? `${safe}${extname(entry.absolute)}` : safe;
  const absolute = join(dirname(entry.absolute), target);
  if (absolute === entry.absolute) return { path: entry.path, ...(isNote ? { id: entry.path } : {}) };
  if (existsSync(absolute)) throw new BrainError(`${target} already exists in this folder`, "exists");
  renameSync(entry.absolute, absolute);
  const renamed = toId(entry.vault, absolute);
  return { path: renamed, ...(isNote ? { id: renamed } : {}) };
}

/** Obsidian's delete: the entry moves to `<vault>/.trash/`, renumbered when
 * something of that name is already in there. Nothing is erased. */
export function trashEntry(root: BrainRoot, path: string): { trashed: string } {
  const entry = entryIn(root, path);
  const trash = join(entry.vault, TRASH_DIRECTORY);
  mkdirSync(trash, { recursive: true, mode: 0o700 });
  const name = basename(entry.absolute);
  const extension = entry.stats.isDirectory() ? "" : extname(name);
  const base = extension ? name.slice(0, name.length - extension.length) : name;
  let candidate = name;
  for (let index = 1; existsSync(join(trash, candidate)); index += 1) {
    if (index > 999) throw new BrainError("the trash already holds too many copies of that name", "exists");
    candidate = `${base} ${index}${extension}`;
  }
  renameSync(entry.absolute, join(trash, candidate));
  return { trashed: `${TRASH_DIRECTORY}/${candidate}` };
}

export type BrainOpenMode = "reveal" | "default" | "obsidian";
const OPEN_MODES: readonly BrainOpenMode[] = ["reveal", "default", "obsidian"];

/** How `openEntry` reaches the system — injected so a test can read the
 * exact argv instead of opening windows on the machine running it. */
export type BrainSpawn = (command: string, args: string[]) => void;

function launch(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/**
 * Show the entry in the Finder, open it with its default app, or hand it to
 * Obsidian. `/usr/bin/open` by absolute path, argv only — no shell, so a
 * file name is never a command. macOS only; elsewhere there is nothing to
 * ask.
 */
export function openEntry(
  root: BrainRoot,
  path: string,
  mode: BrainOpenMode,
  options: { spawn?: BrainSpawn; platform?: NodeJS.Platform } = {},
): { ok: true } {
  if (!OPEN_MODES.includes(mode)) throw new BrainError("that is not a way to open a note");
  const entry = entryIn(root, path);
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new BrainError("opening a note outside this app is a macOS feature");
  }
  const args = mode === "reveal"
    ? ["-R", entry.absolute]
    : mode === "default"
      ? [entry.absolute]
      : [`obsidian://open?path=${encodeURIComponent(entry.absolute)}`];
  (options.spawn ?? launch)("/usr/bin/open", args);
  return { ok: true };
}

/** Folder names the desktop shows for a root, `~`-shortened. */
export function displayRoot(path: string, home: string): string {
  return within(path, home) ? `~${path.slice(home.length)}` : path;
}

/**
 * The starter brain: three linked notes that show what a vault is, written
 * once into an empty folder and never touched again. A person who already
 * has a vault shares it in Settings → Access and picks it instead.
 */
export const STARTER_NOTES: ReadonlyArray<{ path: string; text: string }> = [
  {
    path: "Welcome.md",
    text: [
      "# Welcome to your second brain",
      "",
      "This folder is a vault: every `.md` or `.txt` file in it is a note, and a `[[wikilink]]` between two notes is a line in the graph.",
      "",
      "- [[How linking works]] explains the graph.",
      "- [[What your agents write]] explains where their notes go.",
      "- [[Sharing your own vault]] explains how to use an Obsidian folder here.",
      "",
      "Nothing in this folder leaves this Mac.",
      "",
    ].join("\n"),
  },
  {
    path: "How linking works.md",
    text: [
      "# How linking works",
      "",
      "Write `[[Welcome]]` in any note and the graph draws a line from that note to [[Welcome]]. A link to a note that does not exist yet, like [[Someday]], is drawn as a hollow dot until the note is written.",
      "",
      "A note's page lists its links out and the notes that link to it (its backlinks). The better connected a note is, the bigger its dot.",
      "",
    ].join("\n"),
  },
  {
    path: "What your agents write.md",
    text: [
      "# What your agents write",
      "",
      "Each local agent has its own workspace folder. Pick **Agent workspaces** in the vault menu to see what they have written so far, with the same graph and folder views as here.",
      "",
      "Ask an agent to keep its notes in Markdown with `[[wikilinks]]` and its work becomes part of the brain. See [[Welcome]].",
      "",
    ].join("\n"),
  },
  {
    path: "Sharing your own vault.md",
    text: [
      "# Sharing your own vault",
      "",
      "Already keep notes in Obsidian or a folder of Markdown files? Share that folder in Settings → Access, then pick it in the vault menu. Links are resolved the way Obsidian resolves them: by note name, shortest path first.",
      "",
      "Share it read-write and your agents can add notes to it too. Back to [[Welcome]].",
      "",
    ].join("\n"),
  },
];

/** Writes the starter notes into `path` when it does not exist yet. */
export function seedStarterVault(path: string): boolean {
  if (existsSync(path)) return false;
  mkdirSync(path, { recursive: true, mode: 0o700 });
  for (const note of STARTER_NOTES) writeFileSync(join(path, note.path), note.text, { mode: 0o600 });
  return true;
}

export { dirname as _dirnameForTests };
