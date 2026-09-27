import { randomInt } from "node:crypto";
import { constants, type Dir, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  canonicalizeContextPath,
  within,
  type AccessPolicy,
} from "./access.js";
import type { ContextReference } from "./onboarding.js";

const MAX_PAGE_BYTES = 8192;
const MAX_ENTRIES = 100;
const MAX_SCANNED_ENTRIES = 1000;
// Opaque continuations retain the iterator: following a page never rescans its
// prefix. Bounded handles expire and are consumed once, including on failure.
const listings = new Map<
  number,
  {
    dir: Dir;
    root: CheckedPath;
    target: CheckedPath;
    scope: string;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function retainListing(
  dir: Dir,
  root: CheckedPath,
  target: CheckedPath,
  scope: string,
): number {
  if (listings.size >= 32) {
    const oldest = listings.keys().next().value!;
    const previous = listings.get(oldest)!;
    listings.delete(oldest);
    clearTimeout(previous.timer);
    void previous.dir.close().catch(() => undefined);
  }
  let cursor: number;
  do {
    cursor = randomInt(1, 2 ** 48 - 1);
  } while (listings.has(cursor));
  const timer = setTimeout(() => {
    listings.delete(cursor);
    void dir.close().catch(() => undefined);
  }, 5 * 60_000);
  timer.unref();
  listings.set(cursor, { dir, root, target, scope, timer });
  return cursor;
}
const EXCLUDED =
  /^(?:\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|node_modules|vendor|dist|build|coverage|id_rsa|id_ed25519|credentials(?:[._-].*)?|secrets?(?:[._-].*)?|tokens?(?:[._-].*)?|.*\.(?:key|pem))$/i;

export class ContextReferenceError extends Error {}
function changed(): never {
  throw new ContextReferenceError(
    "The selected context moved or changed. Restore the original item at its selected path, or create a new local workspace and select it there.",
  );
}
function badPath(): never {
  throw new ContextReferenceError(
    "That path is outside the selected context or is not readable.",
  );
}
function segments(path: unknown, emptyAllowed = false): string[] {
  if (
    typeof path !== "string" ||
    path.length > 2048 ||
    (!emptyAllowed && !path)
  )
    badPath();
  if (path === "" && emptyAllowed) return [];
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        EXCLUDED.test(part) ||
        /[\\\\:\u0000-\u001f\u007f]/.test(part),
    )
  )
    badPath();
  return parts;
}
function pageNumber(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new ContextReferenceError(
      "Use a nonnegative bounded page offset or size.",
    );
  return value;
}
interface CheckedPath {
  path: string;
  stats: BigIntStats[];
}
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function samePathIdentity(before: CheckedPath, after: CheckedPath): void {
  if (
    before.path !== after.path ||
    before.stats.length !== after.stats.length ||
    before.stats.some((stat, index) => !sameIdentity(stat, after.stats[index]!))
  )
    changed();
}
async function rootOf(
  reference: ContextReference,
  policy: AccessPolicy,
): Promise<CheckedPath> {
  let root: string;
  try {
    root = canonicalizeContextPath(
      reference.sourcePath,
      reference.sourceKind,
      policy,
    );
  } catch {
    changed();
  }
  try {
    const stat = await lstat(root, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      (reference.sourceKind === "folder" ? !stat.isDirectory() : !stat.isFile())
    )
      changed();
    if ((await realpath(root)) !== root) changed();
    return { path: root, stats: [stat] };
  } catch {
    changed();
  }
}
async function targetOf(
  root: CheckedPath,
  parts: string[],
): Promise<CheckedPath> {
  let current = root.path;
  const stats = [...root.stats];
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current, { bigint: true });
      if (
        stat.isSymbolicLink() ||
        !within(current, root.path) ||
        (await realpath(current)) !== current
      )
        badPath();
      stats.push(stat);
    } catch {
      badPath();
    }
  }
  return { path: current, stats };
}

export async function listContextDirectory(
  reference: ContextReference,
  input: { path?: string; cursor?: number; limit?: number },
  policy: AccessPolicy,
  scope = "",
): Promise<{
  path: string;
  entries: Array<{ name: string; kind: "file" | "folder" }>;
  nextCursor: number | null;
}> {
  if (reference.sourceKind !== "folder")
    throw new ContextReferenceError(
      "A single file reference has no directory to list.",
    );
  const path = input.path ?? "";
  const parts = segments(path, true);
  const cursor = pageNumber(input.cursor, 0, Number.MAX_SAFE_INTEGER);
  const limit = pageNumber(input.limit, 50, MAX_ENTRIES);
  if (limit === 0)
    throw new ContextReferenceError("Choose a page size from 1 to 100.");
  const previous = cursor ? listings.get(cursor) : undefined;
  if (cursor && !previous)
    throw new ContextReferenceError(
      "This directory page expired. List the folder again without a cursor.",
    );
  if (previous) {
    listings.delete(cursor);
    clearTimeout(previous.timer);
  }
  let dir = previous?.dir;
  let retained = false;
  try {
    if (previous && previous.scope !== scope) badPath();
    const root = await rootOf(reference, policy);
    const target = await targetOf(root, parts);
    if (!target.stats.at(-1)!.isDirectory()) badPath();
    if (previous) {
      samePathIdentity(previous.root, root);
      samePathIdentity(previous.target, target);
    }
    dir ??= await opendir(target.path);
    const entries: Array<{ name: string; kind: "file" | "folder" }> = [];
    let ended = false;
    for (
      let scanned = 0;
      scanned < MAX_SCANNED_ENTRIES && entries.length < limit;
      scanned += 1
    ) {
      const entry = await dir.read();
      if (!entry) {
        ended = true;
        break;
      }
      if (
        entry.name.startsWith(".") ||
        EXCLUDED.test(entry.name) ||
        /[\\:\u0000-\u001f\u007f]/.test(entry.name) ||
        entry.isSymbolicLink()
      )
        continue;
      if (entry.isFile() || entry.isDirectory())
        entries.push({
          name: entry.name,
          kind: entry.isFile() ? "file" : "folder",
        });
    }
    const currentRoot = await rootOf(reference, policy);
    samePathIdentity(root, currentRoot);
    samePathIdentity(target, await targetOf(currentRoot, parts));
    const nextCursor = ended ? null : retainListing(dir, root, target, scope);
    retained = nextCursor !== null;
    return { path, entries, nextCursor };
  } finally {
    if (dir && !retained) await dir.close().catch(() => undefined);
  }
}

export async function readContextFile(
  reference: ContextReference,
  input: { path: string; offset?: number; maxBytes?: number },
  policy: AccessPolicy,
): Promise<{
  path: string;
  bytesRead: number;
  size: number;
  nextOffset: number | null;
  format: "utf8" | "base64";
  text?: string;
  base64?: string;
  mimeHint: string;
}> {
  const parts = segments(input.path);
  if (
    reference.sourceKind === "file" &&
    (parts.length !== 1 || parts[0] !== reference.sourceLabel)
  )
    badPath();
  const offset = pageNumber(input.offset, 0, Number.MAX_SAFE_INTEGER);
  const maxBytes = pageNumber(input.maxBytes, MAX_PAGE_BYTES, MAX_PAGE_BYTES);
  if (maxBytes === 0)
    throw new ContextReferenceError("Choose a page size from 1 to 8192 bytes.");
  const root = await rootOf(reference, policy);
  const target =
    reference.sourceKind === "file" ? root : await targetOf(root, parts);
  const before = target.stats.at(-1)!;
  if (!before.isFile() || before.isSymbolicLink()) badPath();
  const handle = await open(
    target.path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => badPath());
  try {
    const actual = await handle.stat({ bigint: true });
    if (
      !actual.isFile() ||
      actual.dev !== before.dev ||
      actual.ino !== before.ino
    )
      badPath();
    const size = Number(actual.size);
    if (!Number.isSafeInteger(size))
      throw new ContextReferenceError(
        "This file is too large for byte offsets on this runtime.",
      );
    const buffer = Buffer.alloc(Math.min(maxBytes, Math.max(0, size - offset)));
    const result = await handle.read(buffer, 0, buffer.length, offset);
    let bytesRead = result.bytesRead;
    let page = buffer.subarray(0, bytesRead);
    const currentRoot = await rootOf(reference, policy);
    samePathIdentity(root, currentRoot);
    const currentTarget =
      reference.sourceKind === "file"
        ? currentRoot
        : await targetOf(currentRoot, parts);
    samePathIdentity(target, currentTarget);
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      !sameIdentity(actual, after) ||
      !sameIdentity(after, currentTarget.stats.at(-1)!)
    )
      changed();
    let mimeHint = basename(target.path).toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream";
    let text: string | undefined;
    if (mimeHint !== "application/pdf") {
      for (
        let trim = 0;
        trim <= 3 && (bytesRead - trim > 0 || bytesRead === 0);
        trim += 1
      ) {
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
            page.subarray(0, bytesRead - trim),
          );
          if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded)) {
            text = decoded;
            bytesRead -= trim;
            page = page.subarray(0, bytesRead);
            break;
          }
        } catch {
          /* try a shorter UTF-8 boundary, then return raw bytes */
        }
      }
    }
    if (text !== undefined) mimeHint = "text/plain; charset=utf-8";
    return {
      path: input.path,
      bytesRead,
      size,
      nextOffset: offset + bytesRead < size ? offset + bytesRead : null,
      format: text === undefined ? "base64" : "utf8",
      ...(text === undefined ? { base64: page.toString("base64") } : { text }),
      mimeHint,
    };
  } finally {
    await handle.close();
  }
}
