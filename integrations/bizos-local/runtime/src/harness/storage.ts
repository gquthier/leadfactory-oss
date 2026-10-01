// Durable state for the local runtime, under
// `<userData>/localbizos/`:
//
//   settings.json  bots.json  groups.json  routines.json  runs.json
//   threads/<name>.ndjson          one JSON message per line, append-only
//   native/<name>.ndjson           Cursor protocol tee, only with LOCALBIZOS_DEBUG_TEE=1
//   workspaces/<name>/             each bot's codex cwd
//
// `<name>` is `safeFileName(id)`, NOT the id: a thread id is `bot:abc` and
// lands on disk as `bot-abc.ndjson`.
//
// Every write is atomic (write a sibling temp file, fsync, rename) so a
// crash mid-write leaves the previous file intact rather than a truncated
// one. Everything is 0600: this directory holds the user's conversations.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const FILE_MODE = 0o600;
export const DIRECTORY_MODE = 0o700;

/** A thread id (`bot:xyz`) is not a file name — `:` reads as a path
 * separator in the macOS Finder and `..` would escape the directory. Every
 * run of characters outside `[A-Za-z0-9_-]` collapses to a single `-` and
 * leading/trailing dashes are trimmed, so `bot:abc` is stored as `bot-abc`
 * and `../../etc/passwd` as `etc-passwd`. An id that reduces to nothing
 * becomes `unnamed`. */
export function safeFileName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "unnamed";
}

export interface StorageLayout {
  root: string;
  threadsDir: string;
  nativeDir: string;
  workspacesDir: string;
}

export function storageLayout(root: string): StorageLayout {
  return {
    root,
    threadsDir: join(root, "threads"),
    nativeDir: join(root, "native"),
    workspacesDir: join(root, "workspaces"),
  };
}

export class Storage {
  readonly layout: StorageLayout;
  private readonly blockedThreadPaths = new Set<string>();

  /** A revoked QuickChat must stay deleted even if a provider writes after abort. */
  blockThread(threadId: string): void {
    this.blockedThreadPaths.add(this.threadPath(threadId));
    this.blockedThreadPaths.add(this.nativePath(threadId));
  }

  constructor(root: string) {
    this.layout = storageLayout(root);
    for (const directory of Object.values(this.layout)) {
      mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    }
  }

  /** Read a JSON document, falling back to `fallback` when the file is
   * absent, empty, or unparseable — a corrupted file must not brick the
   * app, and an empty store is the same thing as a fresh install. */
  readJson<T>(name: string, fallback: T): T {
    const path = join(this.layout.root, name);
    try {
      const raw = readFileSync(path, "utf8");
      if (!raw.trim()) return fallback;
      const parsed: unknown = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
  }

  /** Security-sensitive journals use this reader. Silently replacing a
   * damaged pairing, idempotency or run ledger with an empty object can
   * re-admit a revoked device or execute a command twice, so those callers
   * must stop and ask for repair instead. */
  readJsonStrict<T>(name: string, fallback: T): T {
    const path = join(this.layout.root, name);
    if (!existsSync(path)) return fallback;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      throw new Error(`${name} cannot be read`, { cause: error });
    }
    if (!raw.trim()) throw new Error(`${name} is corrupt (empty)`);
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || parsed === undefined) throw new Error("empty JSON value");
      return parsed as T;
    } catch (error) {
      throw new Error(`${name} is corrupt`, { cause: error });
    }
  }

  writeJson(name: string, value: unknown): void {
    writeFileAtomic(join(this.layout.root, name), `${JSON.stringify(value, null, 2)}\n`);
  }

  threadPath(threadId: string): string {
    return join(this.layout.threadsDir, `${safeFileName(threadId)}.ndjson`);
  }

  nativePath(threadId: string): string {
    return join(this.layout.nativeDir, `${safeFileName(threadId)}.ndjson`);
  }

  workspacePath(botId: string): string {
    const path = join(this.layout.workspacesDir, safeFileName(botId));
    mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE });
    return path;
  }

  appendNdjson(path: string, entry: unknown): void {
    if (this.blockedThreadPaths.has(path)) return;
    const descriptor = openSync(path, "a", FILE_MODE);
    try {
      const bytes = Buffer.from(`${JSON.stringify(entry)}\n`);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
  }

  readNdjson<T>(path: string): T[] {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    const rows: T[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        // One corrupt line (a torn append after a hard crash) drops that
        // line, not the conversation around it.
      }
    }
    return rows;
  }

  /** Preview bytes belong to runtime state, while agent attachments are
   * business files. Reclaim only direct, unshared files in our preview cache. */
  purgeThreadPreviews(threadId: string): void {
    const directory = join(this.layout.root, "previews");
    if (!existsSync(directory)) return;
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()
      || realpathSync(directory) !== join(realpathSync(this.layout.root), "previews")) return;
    const log = this.threadPath(threadId);
    type PreviewRecord = { preview?: { image?: { path?: string } } };
    const candidates = new Set<string>();
    for (const row of this.readNdjson<PreviewRecord>(log)) {
      const path = row?.preview?.image?.path;
      if (typeof path === "string" && dirname(path) === directory && /^prv_[a-f0-9]{24}\.(?:png|jpg|gif|webp)$/.test(basename(path))) candidates.add(path);
    }
    if (!candidates.size) return;
    // Cache images are content-addressed and can belong to several threads.
    for (const name of readdirSync(this.layout.threadsDir)) {
      const path = join(this.layout.threadsDir, name);
      if (path === log || !name.endsWith(".ndjson") || lstatSync(path).isSymbolicLink()) continue;
      for (const row of this.readNdjson<PreviewRecord>(path)) {
        const preview = row?.preview?.image?.path;
        if (typeof preview === "string") candidates.delete(preview);
      }
    }
    for (const path of candidates) this.removeFile(path, true);
  }

  /** Replace a thread log wholesale — used by `threads.clear`. */
  rewriteNdjson(path: string, rows: unknown[]): void {
    if (this.blockedThreadPaths.has(path)) return;
    writeFileAtomic(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  }

  removeFile(path: string, strict = false): void {
    if (strict) {
      try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return;
    }
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best effort */
    }
  }

  /** Delete a directory and everything under it — a deleted bot's workspace.
   * Best effort: a file the user has open elsewhere must not fail a delete. */
  removeDirectory(path: string): void {
    try {
      // Only a direct child of our own workspace store is disposable. A
      // selected user project (or a workspace root redirected by a symlink)
      // never becomes our property because an agent used it.
      const workspaces = resolve(this.layout.workspacesDir);
      if (dirname(resolve(path)) !== workspaces) return;
      if (lstatSync(workspaces).isSymbolicLink()) return;
      const canonicalRoot = realpathSync(this.layout.root);
      const canonicalWorkspaces = realpathSync(workspaces);
      const inside = relative(canonicalRoot, canonicalWorkspaces);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || resolve(canonicalRoot, inside) !== canonicalWorkspaces) return;
      if (lstatSync(path).isSymbolicLink()) {
        unlinkSync(path);
        return;
      }
      rmSync(path, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Write-temp + fsync + rename. The rename is atomic on the same
 * filesystem, so a reader sees either the old file or the new one. */
export function writeFileAtomic(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  const descriptor = openSync(temporary, "w", FILE_MODE);
  try {
    const bytes = Buffer.from(contents);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  // Windows cannot fsync a directory handle (EPERM). The file bytes have
  // already been flushed, and the same-directory rename remains atomic.
  if (process.platform === "win32") return;
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
