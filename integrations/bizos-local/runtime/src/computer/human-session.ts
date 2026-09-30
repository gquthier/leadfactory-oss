// The person drove their agent's computer themselves (Take control).
//
// That happens in the desktop panel, against the machine, without a turn and
// without this runtime: the agent never saw it. So the desktop reports each
// session when control is given back, and the agent's NEXT turn gets one line
// of context saying so — then the note is gone. Without it an agent whose
// person had just signed it in to a site answered that "its isolated browser"
// was empty and the login "could not transfer".
//
// At most one note per agent, the most recent (a second session widens the
// first). It survives a restart in a small JSON file of the harness state.

/** Which machine the agent's computer is: the persistent cloud one, or the
 * browser on this computer. Only changes the words, never the facts. */
export type ComputerKind = "cloud" | "local";

export interface HumanSessionInput {
  startedAt: string;
  endedAt?: string;
  url?: string;
}

export interface HumanSessionNote extends HumanSessionInput {
  /** Bumped by every report, so a turn that read an older note does not
   * consume a newer one. */
  revision: number;
}

/** A report the route refuses. `status` is the HTTP answer. */
export class HumanSessionError extends Error {
  constructor(readonly status: 400 | 404, message: string) {
    super(message);
  }
}

export const HUMAN_SESSIONS_FILE = "computer-human-sessions.json";
export const HUMAN_SESSION_URL_MAX = 500;
/** A session older than this is not "just now"; a clock ahead by more than
 * the skew is not this machine's clock. */
export const HUMAN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const HUMAN_SESSION_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_NOTES = 200;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isoTime(value: unknown, field: string, nowMs: number): number {
  if (typeof value !== "string" || value.length > 40 || !ISO.test(value)) {
    throw new HumanSessionError(400, `${field} must be an ISO 8601 date-time with a time zone.`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new HumanSessionError(400, `${field} is not a valid date.`);
  if (ms > nowMs + HUMAN_SESSION_CLOCK_SKEW_MS) throw new HumanSessionError(400, `${field} is in the future.`);
  if (ms < nowMs - HUMAN_SESSION_MAX_AGE_MS) throw new HumanSessionError(400, `${field} is too old.`);
  return ms;
}

/** The last page, as the agent may see it: http(s) only, without the query,
 * the fragment or any user:password (a sign-in link can carry a token in
 * each). A path too long to be useful falls back to the site itself. */
export function sanitizeSessionUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048) {
    throw new HumanSessionError(400, "url must be a non-empty http(s) URL.");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new HumanSessionError(400, "url must be a valid http(s) URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HumanSessionError(400, "url must be an http(s) URL.");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const clean = url.toString();
  return clean.length <= HUMAN_SESSION_URL_MAX ? clean : `${url.origin}/`;
}

/** Strict: `{ startedAt, endedAt?, url? }` and nothing else. */
export function parseHumanSession(raw: unknown, nowMs: number): HumanSessionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HumanSessionError(400, "A JSON object is required.");
  }
  const body = raw as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => !["startedAt", "endedAt", "url"].includes(key));
  if (unknown) throw new HumanSessionError(400, `Unknown field: ${unknown}.`);
  const started = isoTime(body.startedAt, "startedAt", nowMs);
  const session: HumanSessionInput = { startedAt: new Date(started).toISOString() };
  if (body.endedAt !== undefined && body.endedAt !== null) {
    const ended = isoTime(body.endedAt, "endedAt", nowMs);
    if (ended < started) throw new HumanSessionError(400, "endedAt must not be before startedAt.");
    session.endedAt = new Date(ended).toISOString();
  }
  if (body.url !== undefined && body.url !== null) session.url = sanitizeSessionUrl(body.url);
  return session;
}

function validNote(value: unknown): HumanSessionNote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.startedAt !== "string" || !Number.isFinite(Date.parse(row.startedAt))) return null;
  if (row.endedAt !== undefined && (typeof row.endedAt !== "string" || !Number.isFinite(Date.parse(row.endedAt)))) return null;
  let url: string | undefined;
  if (row.url !== undefined) {
    try { url = sanitizeSessionUrl(row.url); } catch { return null; }
  }
  return {
    startedAt: row.startedAt,
    ...(typeof row.endedAt === "string" ? { endedAt: row.endedAt } : {}),
    ...(url ? { url } : {}),
    revision: typeof row.revision === "number" && Number.isSafeInteger(row.revision) ? row.revision : 0,
  };
}

export interface HumanSessionPersistence {
  read(): unknown;
  write(notes: Record<string, HumanSessionNote>): void;
}

/** The pending notes, one per agent. */
export class HumanSessionNotes {
  private readonly notes = new Map<string, HumanSessionNote>();
  private revision = 0;

  constructor(private readonly persistence?: HumanSessionPersistence) {
    let stored: unknown = {};
    try { stored = persistence?.read() ?? {}; } catch { stored = {}; }
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [botId, value] of Object.entries(stored as Record<string, unknown>)) {
        const note = validNote(value);
        if (!note) continue;
        this.notes.set(botId, note);
        this.revision = Math.max(this.revision, note.revision);
      }
    }
  }

  /** Keep the most recent session; a second one before the next turn widens
   * the first (earliest start, latest end, newest known page). */
  record(botId: string, session: HumanSessionInput): HumanSessionNote {
    const previous = this.notes.get(botId);
    const ends = [previous?.endedAt, session.endedAt].filter((value): value is string => Boolean(value));
    const url = session.url ?? previous?.url;
    const note: HumanSessionNote = {
      startedAt: previous && Date.parse(previous.startedAt) < Date.parse(session.startedAt) ? previous.startedAt : session.startedAt,
      ...(ends.length ? { endedAt: ends.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) } : {}),
      ...(url ? { url } : {}),
      revision: ++this.revision,
    };
    this.notes.delete(botId);
    this.notes.set(botId, note);
    while (this.notes.size > MAX_NOTES) this.notes.delete(this.notes.keys().next().value!);
    this.save();
    return note;
  }

  peek(botId: string): HumanSessionNote | null {
    return this.notes.get(botId) ?? null;
  }

  /** The turn that showed `seen` started: drop it, unless a newer report
   * arrived in between (that one is for the turn after). */
  consume(botId: string, seen: HumanSessionNote): boolean {
    if (this.notes.get(botId)?.revision !== seen.revision) return false;
    this.notes.delete(botId);
    this.save();
    return true;
  }

  forget(botId: string): void {
    if (this.notes.delete(botId)) this.save();
  }

  private save(): void {
    try { this.persistence?.write(Object.fromEntries(this.notes)); } catch { /* memory still holds it */ }
  }
}

const pad = (value: number): string => String(value).padStart(2, "0");
const localDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** HH:MM on this machine's clock, with the day when it is not today. */
function localClock(date: Date, now: Date): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return localDay(date) === localDay(now) ? time : `${localDay(date)} ${time}`;
}

function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The one line the agent's next turn gets. Runtime-supplied context: the
 * page address is the only thing in it the person's session produced. */
export function humanSessionContextLine(note: HumanSessionInput, input: { kind: ComputerKind; now: Date }): string {
  const start = new Date(note.startedAt);
  const end = note.endedAt ? new Date(note.endedAt) : null;
  const when = end
    ? `from ${localClock(start, input.now)} to ${localClock(end, input.now)}`
    : `from ${localClock(start, input.now)}`;
  const machine = input.kind === "cloud" ? "your virtual computer" : "your browser";
  return `Your user used ${machine} themselves (Take control) ${when} (local time, ${utcOffset(start)})`
    + `${note.url ? `; last page: ${note.url}` : ""}. Anything they signed into there is now available to you: `
    + "if they mention it, computer_observe your computer first.";
}

// ── the agent's side of a refusal ───────────────────────────────────────

/** What the agent reads when its person is driving its computer. */
export const HUMAN_CONTROL_MESSAGE =
  "Your user is using your computer right now (Take control); wait for them to give it back, do not retry.";

/** The server refused because the person holds the seat. */
export class ComputerInHumanControlError extends Error {
  constructor() {
    super(HUMAN_CONTROL_MESSAGE);
  }
}

/** Every way "the person has the computer" reaches here: the cloud seat's
 * `computer_in_human_control` (409), the desktop bridge's and this manager's
 * own refusals. */
export function isHumanControlError(error: unknown): boolean {
  if (error instanceof ComputerInHumanControlError) return true;
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "computer_in_human_control") return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /computer_in_human_control|user has taken control of this computer|user still controls this computer/i.test(message);
}
