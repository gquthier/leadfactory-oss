// Durable state for the local runtime, under
// `<userData>/localbizos/`:
//
//   settings.json  bots.json  groups.json  routines.json  runs.json
//   threads/<name>.ndjson          one JSON message per line, append-only
//   native/<name>.ndjson           redacted protocol tee, debug only
//   workspaces/<name>/             each bot's codex cwd
//
// `<name>` is `safeFileName(id)`, NOT the id: a thread id is `bot:abc` and
// lands on disk as `bot-abc.ndjson`.
//
// Every write is atomic (write a sibling temp file, fsync, rename) so a
// crash mid-write leaves the previous file intact rather than a truncated
// one. Everything is 0600: this directory holds the user's conversations.
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

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
    try {
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: FILE_MODE });
    } catch {
      /* never let persistence break a run */
    }
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

  /** Replace a thread log wholesale — used by `threads.clear`. */
  rewriteNdjson(path: string, rows: unknown[]): void {
    writeFileAtomic(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  }

  removeFile(path: string): void {
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
    writeSync(descriptor, contents);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
}
