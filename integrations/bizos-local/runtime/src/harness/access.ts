// Settings → Access: the folders of this Mac the user hands to their agents.
//
// The rules here are the product's safety story, so they are stated once and
// enforced in one place:
//
//  1. A path NEVER comes from the renderer. It comes from the native folder
//     picker in the main process (`dialog.showOpenDialog`) or from one of the
//     shortcuts the main process resolved with `app.getPath`. Everything that
//     arrives is canonicalized with `realpath` before it is compared to
//     anything, because a lexical prefix test is defeated by a symlink the
//     model can create itself.
//  2. A grant must live inside the user's home folder, must be a real
//     directory, and must not be the home folder itself — sharing `$HOME`
//     read-write would quietly include every folder on the deny list below.
//  3. The deny list is absolute. It refuses a path that IS a denied folder,
//     one INSIDE a denied folder, and one that CONTAINS a denied folder
//     (`~/Library` covers `~/Library/Keychains`, so it is refused too).
//  4. Network volumes are refused even when a home folder sits on one.
//  5. WRITE is a second question. Every path into `read-write` — the picker's
//     ticket, a `folderId` shortcut, and flipping an existing grant — goes
//     through a native `dialog.showMessageBox` in the main process that names
//     the folder and says the agents can modify files in it. A boolean over the
//     bridge is a request; the sheet is the consent. `read` asks nothing: it is
//     what the picker's own dialog already described.
//
// What a mode really means is spelled out in `types.ts` and in doc 05: `read`
// is a name in the prompt plus a root the BizOS document tool will read from;
// `read-write` additionally reaches the codex sandbox as a writable root.
import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, sep } from "node:path";
import { knownBinDirectories } from "./env-path.js";
import type {
  AccessGrant,
  AccessGrantInput,
  AccessGrantPatch,
  AccessMode,
  AccessScope,
  AccessSettings,
  FolderSuggestion,
} from "./types.js";

export const ACCESS_MODES: AccessMode[] = ["read", "read-write"];
export const MAX_GRANTS = 24;
export const MAX_SCOPE_BOTS = 32;

/**
 * How often the WRITE sheet may be raised, and how many may be open at once
 * (one).
 *
 * Rule 5 above says every road into `read-write` goes through a native
 * `dialog.showMessageBox`, and it did — with nothing standing between the
 * bridge and that dialog. `access.grant({folderId:"documents",
 * mode:"read-write"})` in a loop, from a renderer somebody owns, stacked
 * modal sheets faster than the user could dismiss them, until an Allow meant
 * for one of them landed on another. A question is a resource like any other:
 * one at a time, and no more of them in ten seconds than a person asks. Same
 * shape and same numbers as the external-link sheet (`EXTERNAL_OPEN_LIMIT` /
 * `EXTERNAL_OPEN_WINDOW_MS` in `policy.ts`), because it is the same story.
 */
export const WRITE_SHEET_LIMIT = 3;
export const WRITE_SHEET_WINDOW_MS = 10_000;

/** A refusal the bridge can name (`ipc.runHandler` uses `name` as the code). */
export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_access";
  }
}

/** Folders no grant may ever cover, in any mode. Relative to the home
 * folder, so a test can point `home` anywhere. */
export const DENIED_RELATIVE = [
  "Library/Keychains",
  /**
   * This app's own data folder.
   *
   * It holds the user's LIVE BizOS session. Chromium writes the cookie store
   * under `Partitions/` and, until the build is Developer-ID signed and
   * notarised, writes it in CLEAR (`EnableCookieEncryption` is off in
   * `after-pack.ts`) — verified on this machine: `sb-…-auth-token` sits there as
   * readable base64 JSON, with no `v10` record anywhere in the file. codex's
   * seatbelt profile starts from `(allow file-read*)`, and a command that
   * SUCCEEDS raises no approval card, so a bot with a shell could read the
   * session token with no grant, no toggle and nothing on screen. It also holds
   * `settings.json` — where `codexPath` lives — and every transcript.
   *
   * The real path is also passed in from `app.getPath("userData")`
   * (`deniedDirectories`'s second argument): this literal is the floor, so a
   * build that forgets to pass it is still closed.
   */
  "Library/Application Support/Local BizOS",
  ".ssh",
  ".gnupg",
  ".codex",
  ".config",
] as const;

export function deniedDirectories(home: string, extra: readonly string[] = []): string[] {
  const all = [
    ...DENIED_RELATIVE.map((relative) => join(home, relative)),
    ...extra.filter((path) => typeof path === "string" && path.trim().length > 0),
  ];
  return [...new Set(all)];
}

/**
 * Folders this Mac runs PROGRAMS from — `~/.local/bin`, `~/bin`, the nvm and
 * volta shims, homebrew.
 *
 * They may be shared read-only. They may never be shared read-WRITE: the app
 * looks for `codex` on exactly this PATH (`env-path.ts` → `codex-status.ts`),
 * so a bot able to write `~/.local/bin/codex` is a bot that runs an arbitrary
 * program as the user, outside every sandbox, at the next launch. Sharing a
 * PARENT (`~/.local`) is the same door, so containment is checked both ways.
 */
export function executableDirectories(home: string): string[] {
  return knownBinDirectories(home);
}

/** Mount points that are never local storage. `/Volumes` is where macOS
 * mounts an SMB or AFP share, and a shared network folder is somebody
 * else's disk. */
const NETWORK_PREFIXES = ["/Volumes", "/Network", "/net"];

function isNetworkPath(path: string): boolean {
  return NETWORK_PREFIXES.some((prefix) => within(path, prefix));
}

export interface AccessPolicy {
  home: string;
  /** Absolute folders no grant may cover, on top of `DENIED_RELATIVE` — the
   * app's own data folder, resolved by Electron. */
  denied?: string[];
  realpath(path: string): string;
  isDirectory(path: string): boolean;
}

export function defaultAccessPolicy(home: string = homedir(), denied: string[] = []): AccessPolicy {
  return {
    home: canonical(home),
    denied: denied.map((path) => canonical(path)),
    realpath: (path) => realpathSync(path),
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** The one door a path enters through. Throws `AccessError` with a sentence
 * the user can act on — never silently swaps the path for something else. */
export function canonicalizeSharedPath(raw: unknown, policy: AccessPolicy): string {
  if (typeof raw !== "string" || !raw.trim()) throw new AccessError("that is not a folder path");
  const trimmed = raw.trim();
  if (!isAbsolute(trimmed)) throw new AccessError("a shared folder must be an absolute path");
  // Checked BEFORE `realpath`: a share that is not mounted right now is
  // still somebody else's disk, and `~/.ssh` on a Mac that has never made
  // one is still `~/.ssh` — "there is no folder there" would be the wrong
  // answer to give about either.
  if (isNetworkPath(trimmed)) {
    throw new AccessError("network volumes cannot be shared — pick a folder on this Mac");
  }
  // The home folder itself is refused with its own sentence before the deny
  // list gets to it: "~/Library/Keychains is never shared" is a true but
  // useless answer to "can I share my home folder?".
  assertNotHome(trimmed, policy.home);
  assertNotDenied(trimmed, policy);
  let path: string;
  try {
    path = policy.realpath(trimmed);
  } catch {
    throw new AccessError(`there is no folder at ${trimmed}`);
  }
  if (!policy.isDirectory(path)) throw new AccessError(`${trimmed} is not a folder`);
  if (isNetworkPath(path)) {
    throw new AccessError("network volumes cannot be shared — pick a folder on this Mac");
  }
  assertNotHome(path, policy.home);
  if (!within(path, policy.home)) {
    throw new AccessError("a shared folder must live inside your home folder");
  }
  assertNotDenied(path, policy);
  return path;
}

/** Read is fine anywhere the deny list allows; WRITE is not. Checked at the
 * moment the mode is set, so it also covers "share read, then switch it". */
export function assertModeAllowed(path: string, mode: AccessMode, policy: AccessPolicy): void {
  if (mode !== "read-write") return;
  for (const directory of executableDirectories(policy.home)) {
    if (!within(path, directory) && !within(directory, path)) continue;
    throw new AccessError(
      `${displayPath(directory, policy.home)} is where this Mac keeps the programs it runs — ` +
        "you can share it read-only, but not read & write",
    );
  }
}

function assertNotHome(path: string, home: string): void {
  if (path !== home) return;
  throw new AccessError(
    "sharing your whole home folder is not something this app will do — pick a folder inside it, or turn on Full disk (read-only)",
  );
}

/** Both directions: a path INSIDE a denied folder, and one that CONTAINS
 * it. Run on the raw path and again on the canonical one, because only the
 * second sees through a symlink and only the first sees a folder that does
 * not exist yet. */
function assertNotDenied(path: string, policy: AccessPolicy): void {
  for (const denied of deniedDirectories(policy.home, policy.denied ?? [])) {
    if (within(path, denied) || within(denied, path)) {
      throw new AccessError(`${displayPath(denied, policy.home)} is never shared`);
    }
  }
}

/** `/Users/ada/Documents` → `~/Documents`, the way the Finder says it. */
export function displayPath(path: string, home: string): string {
  return path === home ? "~" : within(path, home) ? `~${path.slice(home.length)}` : path;
}

export function labelForPath(path: string): string {
  return basename(path) || path;
}

/** The shortcuts offered without granting anything. Resolved in the main
 * process with `app.getPath`; this is the fallback when it is not there. */
export function defaultSuggestions(home: string): FolderSuggestion[] {
  return ["Desktop", "Documents", "Downloads"].map((name) => ({
    folderId: name.toLowerCase(),
    path: join(home, name),
    label: name,
  }));
}

/**
 * What a native dialog actually authorised.
 *
 * A ticket is NOT "a path the user touched": it is the whole permission the
 * sheet described — this folder, this much power, for these bots. Binding only
 * the path was the residual hole: the picker's sheet says "your agents will be
 * able to READ what is in this folder", and `grant({nonce, mode:"read-write"})`
 * then wrote a durable writable root the user was never shown. So the mode and
 * the scope travel WITH the nonce, and a request that asks for more than the
 * ticket carries has to go back through a native confirmation before it counts.
 */
export interface FolderTicket {
  path: string;
  mode: AccessMode;
  scope: AccessScope;
}

/**
 * Single-use tickets for the native folder picker.
 *
 * `grant({path})` used to be a privileged call that took a string: a renderer
 * that never opened a dialog could grant itself `~/Documents` read-write. The
 * picker now issues a nonce bound to what the user chose in the system dialog,
 * and a grant redeems it once. A nonce that is replayed, forged, or five
 * minutes old is simply not a folder.
 */
export const PICK_TICKET_TTL_MS = 5 * 60_000;
const MAX_OPEN_TICKETS = 8;

export class FolderTickets {
  private readonly tickets = new Map<string, FolderTicket & { at: number }>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mint: () => string = () => randomBytes(24).toString("base64url"),
  ) {}

  issue(ticket: FolderTicket): string {
    this.sweep();
    // A dialog nobody acted on must not pile up.
    if (this.tickets.size >= MAX_OPEN_TICKETS) {
      const oldest = [...this.tickets.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.tickets.delete(oldest[0]);
    }
    const nonce = this.mint();
    this.tickets.set(nonce, { ...ticket, at: this.now() });
    return nonce;
  }

  /** The permission this nonce stands for, ONCE. `null` afterwards, always. */
  redeem(nonce: unknown): FolderTicket | null {
    this.sweep();
    if (typeof nonce !== "string" || !nonce) return null;
    const ticket = this.tickets.get(nonce);
    if (!ticket) return null;
    this.tickets.delete(nonce);
    return { path: ticket.path, mode: ticket.mode, scope: ticket.scope };
  }

  private sweep(): void {
    const deadline = this.now() - PICK_TICKET_TTL_MS;
    for (const [nonce, ticket] of this.tickets) {
      if (ticket.at <= deadline) this.tickets.delete(nonce);
    }
  }
}

/** `"all"` or exactly these bots.
 *
 * An EMPTY list stays empty: it means nobody. Folding it back to `"all"`
 * would turn "I just unchecked the last agent" into "every agent may read
 * this folder" — an ambiguous input must never widen a permission. */
function normalizeScope(raw: unknown): AccessScope {
  if (raw === undefined || raw === null || raw === "all") return "all";
  if (!Array.isArray(raw)) throw new AccessError("scope must be \"all\" or a list of bot ids");
  const ids = raw
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 64));
  if (ids.length > MAX_SCOPE_BOTS) throw new AccessError(`a grant covers at most ${MAX_SCOPE_BOTS} bots`);
  return [...new Set(ids)];
}

function normalizeMode(raw: unknown): AccessMode {
  if (raw === undefined || raw === null) return "read";
  if (!ACCESS_MODES.includes(raw as AccessMode)) throw new AccessError("unknown access mode");
  return raw as AccessMode;
}

function normalizeLabel(raw: unknown, path: string): string {
  const label = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
  return label || labelForPath(path);
}

/** Coerce whatever is on disk into the contract. Lenient like
 * `normalizeSettings`: a settings file written by an older build must not
 * brick the app. Paths are NOT re-canonicalized here (that needs the
 * filesystem); they were canonical when they were granted, and every read of
 * a shared folder is checked again at the moment it happens. */
export function normalizeAccess(raw: unknown): AccessSettings {
  const record = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(record.grants) ? record.grants : [];
  const grants: AccessGrant[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path || !isAbsolute(path) || seen.has(path)) continue;
    seen.add(path);
    let scope: AccessScope = "all";
    try {
      scope = normalizeScope(row.scope);
    } catch {
      scope = "all";
    }
    grants.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `acc_${seen.size}`,
      path,
      label: normalizeLabel(row.label, path),
      mode: ACCESS_MODES.includes(row.mode as AccessMode) ? (row.mode as AccessMode) : "read",
      scope,
      grantedAt:
        typeof row.grantedAt === "string" && row.grantedAt ? row.grantedAt : new Date(0).toISOString(),
    });
    if (grants.length >= MAX_GRANTS) break;
  }
  return { grants, fullDiskRead: record.fullDiskRead === true };
}

/** Does this grant reach this bot? */
export function grantCoversBot(grant: AccessGrant, botId: string): boolean {
  return grant.scope === "all" || grant.scope.includes(botId);
}

export interface AccessJournalEntry {
  at: string;
  action: "granted" | "updated" | "revoked" | "full-disk-read";
  id?: string;
  path?: string;
  mode?: AccessMode;
  scope?: AccessScope;
  enabled?: boolean;
}

export interface AccessStoreDependencies {
  read(): AccessSettings;
  write(value: AccessSettings): void;
  policy: AccessPolicy;
  nowIso(): string;
  newId(): string;
  /** Every change is written to `native/access.ndjson`, so "who was given
   * what, when" survives the window that showed it. */
  journal(entry: AccessJournalEntry): void;
}

export class AccessStore {
  constructor(private readonly deps: AccessStoreDependencies) {}

  list(): AccessSettings {
    return this.deps.read();
  }

  /** The grants that apply to one bot, canonical paths, newest last. */
  forBot(botId: string): AccessGrant[] {
    return this.list().grants.filter((grant) => grantCoversBot(grant, botId));
  }

  /** Folders this bot may write in — the codex sandbox's extra roots. */
  writableRootsFor(botId: string): string[] {
    return this.forBot(botId)
      .filter((grant) => grant.mode === "read-write")
      .map((grant) => grant.path);
  }

  /** Folders the BizOS document tool may read from for this bot. */
  readableRootsFor(botId: string): string[] {
    return this.forBot(botId).map((grant) => grant.path);
  }

  grant(input: AccessGrantInput): AccessGrant {
    const path = canonicalizeSharedPath(input.path, this.deps.policy);
    assertModeAllowed(path, normalizeMode(input.mode), this.deps.policy);
    const current = this.list();
    const existing = current.grants.find((grant) => grant.path === path);
    const grant: AccessGrant = {
      id: existing?.id ?? this.deps.newId(),
      path,
      label: normalizeLabel(input.label, path),
      mode: normalizeMode(input.mode),
      scope: normalizeScope(input.scope),
      grantedAt: this.deps.nowIso(),
    };
    if (!existing && current.grants.length >= MAX_GRANTS) {
      throw new AccessError(`you can share at most ${MAX_GRANTS} folders`);
    }
    const grants = existing
      ? current.grants.map((row) => (row.id === grant.id ? grant : row))
      : [...current.grants, grant];
    this.deps.write({ ...current, grants });
    this.deps.journal({
      at: grant.grantedAt,
      action: existing ? "updated" : "granted",
      id: grant.id,
      path: grant.path,
      mode: grant.mode,
      scope: grant.scope,
    });
    return grant;
  }

  update(id: string, patch: AccessGrantPatch): AccessGrant {
    const current = this.list();
    const existing = current.grants.find((grant) => grant.id === id);
    if (!existing) throw new AccessError("that shared folder is gone");
    const next: AccessGrant = {
      ...existing,
      ...(patch.label !== undefined ? { label: normalizeLabel(patch.label, existing.path) } : {}),
      ...(patch.mode !== undefined ? { mode: normalizeMode(patch.mode) } : {}),
      ...(patch.scope !== undefined ? { scope: normalizeScope(patch.scope) } : {}),
    };
    // "Share read, then flip it to read & write" is the same door as granting
    // read-write outright.
    assertModeAllowed(next.path, next.mode, this.deps.policy);
    this.deps.write({
      ...current,
      grants: current.grants.map((grant) => (grant.id === id ? next : grant)),
    });
    this.deps.journal({
      at: this.deps.nowIso(),
      action: "updated",
      id: next.id,
      path: next.path,
      mode: next.mode,
      scope: next.scope,
    });
    return next;
  }

  revoke(id: string): AccessGrant | null {
    const current = this.list();
    const existing = current.grants.find((grant) => grant.id === id);
    if (!existing) return null;
    this.deps.write({ ...current, grants: current.grants.filter((grant) => grant.id !== id) });
    this.deps.journal({
      at: this.deps.nowIso(),
      action: "revoked",
      id: existing.id,
      path: existing.path,
      mode: existing.mode,
    });
    return existing;
  }

  setFullDiskRead(enabled: boolean): AccessSettings {
    const current = this.list();
    const next = { ...current, fullDiskRead: enabled === true };
    this.deps.write(next);
    this.deps.journal({ at: this.deps.nowIso(), action: "full-disk-read", enabled: next.fullDiskRead });
    return next;
  }
}
