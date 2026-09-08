// The LeadFactory agency pack inside Local BizOS.
//
// One embedded kit (`agency-kit/`, MIT, staged by `scripts/sync-agency-kit.mjs`)
// becomes, on the person's explicit install: a dedicated vault with the
// pack's notes and six role folders, six real agents working from those
// folders, a team thread, and ONE cockpit instance — the kit's own
// `createApp` bound to `127.0.0.1` on an ephemeral port, its store under
// `<harness root>/agency/data`. The person opens that URL; the agents reach
// the same instance through the typed tools below. There is no second
// store and nothing writes `db.json` behind the cockpit's back.
//
// Everything here is resumable: `install.json` records each step as it
// lands (vault, each bot by slug, the group, the greetings), a second
// install joins the first, and a restart after a crash adopts what already
// exists rather than making it twice. A note the person edited is never
// rewritten; only a missing note is written.
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexDynamicTool } from "./codex-driver.js";
import type { CompanyTemplate, TemplateBot } from "./company-os.js";
import { DIRECTORY_MODE, FILE_MODE, writeFileAtomic } from "./storage.js";
import type { Bot, CreateBotInput, Group, Run, UpdateBotInput } from "./types.js";
import {
  AGENCY_PROFILE_FIELDS,
  AGENCY_TOOL_SPECS,
  CAMPAIGN_FIELDS,
  CLIENT_FIELDS,
  DELIVERABLE_FIELDS,
  TASK_FIELDS,
  isAgencyToolName,
} from "./agency-tools.js";

/** Where the pack lives under the harness root: `agency/{data,vault,install.json}`. */
export const AGENCY_DIRECTORY = "agency";
export const INSTALL_FILE = "install.json";

/** The embedded kit, beside `harness/` in both `src` and `dist`. Resolved
 * from this module's own location, never from a machine path. */
export const DEFAULT_KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "agency-kit");

const TEMPLATE_FILE = "templates/lead-gen-agency.company-template.json";
const MAX_DOCUMENT_CHARS = 60_000;
const MAX_LIST_ITEMS = 200;
const PREVIEW_CHARS = 300;

export function agencyVaultPath(rootDir: string): string {
  return join(rootDir, AGENCY_DIRECTORY, "vault");
}

export class AgencyError extends Error {
  constructor(message: string, readonly code: string = "agency_error", readonly status = 400) {
    super(message);
    this.name = "AgencyError";
  }
}

// ── the kit ──────────────────────────────────────────────────────────────

export interface SkillSummary {
  name: string;
  description: string;
  references: string[];
}

export interface AgencyKit {
  root: string;
  template: CompanyTemplate;
  skills: SkillSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A vault-relative path, split and refused if any segment could leave the
 * vault or name something hidden — the same door as `company-os.ts`. */
export function vaultSegments(path: string): string[] {
  const segments = path.split("/");
  if (
    !segments.length
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".")
      || segment.includes("\\") || segment.includes("\0") || segment.length > 120)
  ) {
    throw new AgencyError(`invalid path ${JSON.stringify(path)}`, "invalid_path");
  }
  return segments;
}

function templateBot(raw: unknown): TemplateBot {
  if (!isRecord(raw)) throw new AgencyError("template bot is not an object", "invalid_template");
  const string = (key: string, required = true): string => {
    const value = raw[key];
    if (typeof value !== "string" || (required && !value.trim())) {
      if (required) throw new AgencyError(`template bot lacks ${key}`, "invalid_template");
      return "";
    }
    return value;
  };
  const slug = string("slug");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new AgencyError(`template bot slug ${slug} is invalid`, "invalid_template");
  const thinking = raw.thinking;
  return {
    slug,
    name: string("name"),
    title: string("title"),
    description: string("description", false),
    instructions: string("instructions", false),
    ...(thinking === "low" || thinking === "medium" || thinking === "high" || thinking === "xhigh" ? { thinking } : {}),
    ...(raw.pinned === true ? { pinned: true } : {}),
    ...(typeof raw.welcome === "string" && raw.welcome.trim() ? { welcome: raw.welcome } : {}),
  };
}

export function parseTemplate(raw: unknown): CompanyTemplate {
  if (!isRecord(raw)) throw new AgencyError("template is not an object", "invalid_template");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id)) throw new AgencyError("template id is invalid", "invalid_template");
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new AgencyError("template name is missing", "invalid_template");
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) throw new AgencyError("template version is invalid", "invalid_template");
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  const bots = Array.isArray(raw.bots) ? raw.bots : [];
  for (const folder of folders) {
    if (typeof folder !== "string") throw new AgencyError("template folder is not a string", "invalid_template");
    vaultSegments(folder);
  }
  const parsedNotes = notes.map((note) => {
    if (!isRecord(note) || typeof note.path !== "string" || typeof note.text !== "string") {
      throw new AgencyError("template note is malformed", "invalid_template");
    }
    vaultSegments(note.path);
    return { path: note.path, text: note.text };
  });
  const parsedBots = bots.map(templateBot);
  const slugs = new Set(parsedBots.map((bot) => bot.slug));
  if (slugs.size !== parsedBots.length) throw new AgencyError("template bot slugs collide", "invalid_template");
  return {
    id: raw.id,
    version: raw.version,
    name: raw.name,
    folders: folders as string[],
    notes: parsedNotes,
    bots: parsedBots,
    ...(isRecord(raw.team) && typeof raw.team.name === "string" ? { team: { name: raw.team.name } } : {}),
    routines: [],
  };
}

/** `description:` out of a SKILL.md front matter, one line, bounded. */
function skillDescription(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return "";
  const line = match[1]!.split(/\r?\n/).find((row) => row.startsWith("description:"));
  return line ? line.slice("description:".length).trim().replace(/^["']|["']$/g, "").slice(0, 600) : "";
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REFERENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function regularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function regularDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function scanSkills(kitRoot: string): SkillSummary[] {
  const skillsDir = join(kitRoot, "skills");
  if (!regularDirectory(skillsDir)) return [];
  const skills: SkillSummary[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !SKILL_NAME.test(entry.name)) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!regularFile(skillFile)) continue;
    const referencesDir = join(skillsDir, entry.name, "references");
    const references = regularDirectory(referencesDir)
      ? readdirSync(referencesDir, { withFileTypes: true })
        .filter((reference) => reference.isFile() && REFERENCE_NAME.test(reference.name))
        .map((reference) => reference.name)
        .sort()
      : [];
    skills.push({ name: entry.name, description: skillDescription(readFileSync(skillFile, "utf8")), references });
  }
  return skills;
}

export function loadKit(kitRoot: string = DEFAULT_KIT_ROOT): AgencyKit {
  const templatePath = join(kitRoot, TEMPLATE_FILE);
  if (!regularFile(templatePath)) throw new AgencyError("the agency kit is not embedded in this build", "kit_missing", 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(templatePath, "utf8"));
  } catch (error) {
    throw new AgencyError(`the agency template is unreadable: ${error instanceof Error ? error.message : String(error)}`, "invalid_template", 503);
  }
  return { root: kitRoot, template: parseTemplate(parsed), skills: scanSkills(kitRoot) };
}

/**
 * A file strictly inside `root`: every segment vetted, no symlink anywhere on
 * the way (the real path must still start with the root's real path), and a
 * regular file at the end. Directories are allowed when `directory` is set.
 */
export function resolveInside(root: string, segments: string[], options: { directory?: boolean } = {}): { absolute: string; kind: "file" | "directory" } {
  const absolute = join(root, ...segments);
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    throw new AgencyError(`not found: ${segments.join("/")}`, "not_found", 404);
  }
  if (stats.isSymbolicLink()) throw new AgencyError(`refused: ${segments.join("/")} is a link`, "invalid_path", 403);
  const realRoot = realpathSync(root);
  const real = realpathSync(absolute);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new AgencyError(`refused: ${segments.join("/")} leaves the folder`, "invalid_path", 403);
  }
  if (stats.isDirectory()) {
    if (!options.directory) throw new AgencyError(`${segments.join("/")} is a folder`, "invalid_path");
    return { absolute, kind: "directory" };
  }
  if (!stats.isFile()) throw new AgencyError(`refused: ${segments.join("/")}`, "invalid_path", 403);
  return { absolute, kind: "file" };
}

function readBounded(path: string): { text: string; truncated: boolean } {
  const text = readFileSync(path, "utf8");
  return text.length > MAX_DOCUMENT_CHARS
    ? { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true }
    : { text, truncated: false };
}

// ── the vault ────────────────────────────────────────────────────────────

export type AgencyVaultSeed = "seeded" | "completed" | "kept";

/**
 * Writes the pack's folders and notes into `vaultDir`, and only what is
 * missing: a note already there — the person's, an agent's, or a previous
 * install's — is never rewritten. Validates every path before touching disk.
 */
export function ensureAgencyVault(vaultDir: string, template: CompanyTemplate): { outcome: AgencyVaultSeed; written: number } {
  for (const folder of template.folders) vaultSegments(folder);
  for (const note of template.notes) vaultSegments(note.path);
  const fresh = !existsSync(vaultDir);
  mkdirSync(vaultDir, { recursive: true, mode: DIRECTORY_MODE });
  for (const folder of template.folders) {
    mkdirSync(join(vaultDir, ...vaultSegments(folder)), { recursive: true, mode: DIRECTORY_MODE });
  }
  let written = 0;
  for (const note of template.notes) {
    const absolute = join(vaultDir, ...vaultSegments(note.path));
    if (existsSync(absolute)) continue;
    mkdirSync(dirname(absolute), { recursive: true, mode: DIRECTORY_MODE });
    writeFileSync(absolute, note.text, { mode: FILE_MODE });
    written += 1;
  }
  return { outcome: fresh ? "seeded" : written > 0 ? "completed" : "kept", written };
}

/** The folder a template bot works from: `Agents/<Name>/` in the pack's vault. */
export function roleFolder(vaultDir: string, bot: TemplateBot): string {
  return join(vaultDir, "Agents", ...vaultSegments(bot.name));
}

/** What every agent of the pack is told about its tools — appended to the
 * pack's own instructions, naming exactly the tools the runtime grants. */
export const TOOLS_INSTRUCTIONS = `## Runtime tools (Local BizOS)
Your cockpit is the LeadFactory agency dashboard installed in this app (Apps → Agency). You reach its data only through these tools, granted to each of your runs and revoked when the run ends or is stopped:
- agency_context — the agency profile and the list of clients, or one client's dossier (clientId; format markdown for the export).
- agency_clients — list, get, create, update clients.
- agency_campaigns, agency_tasks, agency_deliverables — list, get, create, update, always for ONE clientId.
- agency_onboarding — the client questionnaire: schema, get, save (draft), submit. Marking it reviewed is the person's act in the dashboard; there is no review tool.
- agency_profile_update — the agency's own profile.
- agency_list_skills, agency_read_skill — the agency skills (SKILL.md, then its references). Read the one skill the task calls for, not all of them.
- agency_read_document — a note of the agency vault (Processes/, Knowledge/, Clients/, Campaigns/, your role folder).
Rules: work on one client at a time and pass its clientId; a campaign, task or deliverable of another client is refused. Nothing here sends emails, publishes ads, spends money or invoices: those stay with the person and their own tools. A tool result is the only proof that a change happened; never report a change you did not get back from a tool.`;

export function botInstructions(bot: TemplateBot): string {
  return `${bot.instructions.trim()}\n\n${TOOLS_INSTRUCTIONS}`.slice(0, 6000);
}

// ── the install journal ──────────────────────────────────────────────────

export type InstallStatus = "installing" | "ready" | "error";

export interface InstallJournal {
  version: 1;
  template: { id: string; version: number; name: string };
  status: InstallStatus;
  /** The last step reached: vault, bot:<slug>, group, welcome, ready. */
  step: string;
  startedAt: string;
  updatedAt: string;
  vault: AgencyVaultSeed | null;
  /** Template bot slug → roster bot id, written the moment each bot exists. */
  bots: Record<string, string>;
  groupId?: string;
  /** Slugs whose welcome message is already in their chat. */
  welcomed: string[];
  error?: string;
}

function readJournal(path: string): InstallJournal | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new AgencyError(`install.json cannot be read: ${error instanceof Error ? error.message : String(error)}`, "journal_corrupt", 500);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgencyError("install.json is corrupt; move it aside to reinstall", "journal_corrupt", 500);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.template) || !isRecord(parsed.bots)
    || !["installing", "ready", "error"].includes(String(parsed.status))
    || Object.values(parsed.bots).some((id) => typeof id !== "string")) {
    throw new AgencyError("install.json has an invalid shape; move it aside to reinstall", "journal_corrupt", 500);
  }
  return {
    ...(parsed as unknown as InstallJournal),
    welcomed: Array.isArray(parsed.welcomed) ? parsed.welcomed.filter((slug): slug is string => typeof slug === "string") : [],
  };
}

// ── the host ─────────────────────────────────────────────────────────────

/** What the pack needs from the harness — its real contracts, nothing more. */
export interface AgencyHost {
  listBots(): Promise<Bot[]>;
  createBot(input: CreateBotInput): Promise<Bot>;
  updateBot(id: string, patch: UpdateBotInput): Promise<Bot>;
  listGroups(): Promise<Group[]>;
  createGroup(input: { name: string; memberIds: string[] }): Promise<Group>;
  /** A first bot message already in its chat, with no run behind it. `key`
   * makes it exist at most once, whatever happens between the append and
   * the journal entry that records it. */
  greet(botId: string, text: string, key: string): Promise<void>;
  run(runId: string): Promise<Run | undefined>;
}

/** The harness as the pack's host. Typed structurally so a test can pass a
 * real harness without importing the whole composition root here. */
export function hostFromHarness(harness: {
  bots: Pick<AgencyHost, never> & { list(): Promise<Bot[]>; create(input: CreateBotInput): Promise<Bot>; update(id: string, patch: UpdateBotInput): Promise<Bot> };
  groups: { list(): Promise<Group[]>; create(input: { name: string; memberIds: string[] }): Promise<Group> };
  threads: { greet(botId: string, text: string, key?: string): Promise<unknown> };
  runs: { get(id: string): Promise<Run | undefined> };
}): AgencyHost {
  return {
    listBots: () => harness.bots.list(),
    createBot: (input) => harness.bots.create(input),
    updateBot: (id, patch) => harness.bots.update(id, patch),
    listGroups: () => harness.groups.list(),
    createGroup: (input) => harness.groups.create(input),
    greet: async (botId, text, key) => { await harness.threads.greet(botId, text, key); },
    run: (id) => harness.runs.get(id),
  };
}

// ── the service ──────────────────────────────────────────────────────────

export interface AgencyServiceOptions {
  /** The harness root (`<state>/runtime`); the pack lives under `agency/`. */
  rootDir: string;
  host: AgencyHost;
  kitRoot?: string;
  nowIso?: () => string;
  log?: (line: string) => void;
  /** The `fetch` the tools reach the cockpit with (a test can hold a request). */
  fetchImpl?: typeof fetch;
}

/** The capability a tool call arrives with: one bot, one thread, one run. */
export interface AgencyScope {
  botId: string;
  threadId: string;
  runId: string;
}

export interface AgencyState {
  installed: boolean;
  status: "not-installed" | InstallStatus;
  template: { id: string; name: string; version: number };
  dashboardUrl: string | null;
  /** Roster bots of the pack that still exist, in template order. */
  bots: Array<{ slug: string; botId: string; name: string }>;
  groupId: string | null;
  skillsCount: number;
  error?: string;
}

interface CockpitApp {
  server: Server;
  close(): Promise<void>;
  issueDashboardTicket(): string;
}

/** One tool call: its capability and its cancellation. Never shared. */
interface CallContext {
  scope: AgencyScope;
  signal: AbortSignal;
}

const ACTIVE_RUN_STATES = new Set<Run["state"]>(["queued", "working", "waiting_input"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

export class AgencyService {
  readonly rootDir: string;
  readonly kitRoot: string;
  private readonly host: AgencyHost;
  private readonly nowIso: () => string;
  private readonly log: (line: string) => void;
  private readonly fetchImpl: typeof fetch;
  /**
   * The cockpit's service credential: random, in memory, for this process
   * only. It travels in the `Authorization` header of the service's own
   * requests and nowhere else — not in a URL, a tool result, an error, a
   * note, or an agent's environment. A person gets in with a one-use ticket
   * (`open()`), never with this.
   */
  private readonly accessToken = randomBytes(32).toString("hex");
  /** In-flight tool calls by run id, so a STOP aborts their requests. */
  private readonly activeCalls = new Map<string, Set<AbortController>>();
  private kit: AgencyKit | null = null;
  private kitError: string | null = null;
  private journal: InstallJournal | null = null;
  private journalError: string | null = null;
  private installing: Promise<AgencyState> | null = null;
  private app: CockpitApp | null = null;
  private appUrl: string | null = null;
  private appStarting: Promise<string> | null = null;
  private appError: string | null = null;
  private closed = false;

  constructor(options: AgencyServiceOptions) {
    this.rootDir = options.rootDir;
    this.kitRoot = options.kitRoot ?? DEFAULT_KIT_ROOT;
    this.host = options.host;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.log = options.log ?? (() => undefined);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.reloadJournal();
  }

  get agencyDir(): string {
    return join(this.rootDir, AGENCY_DIRECTORY);
  }

  get vaultDir(): string {
    return agencyVaultPath(this.rootDir);
  }

  get dataDir(): string {
    return join(this.agencyDir, "data");
  }

  private get journalPath(): string {
    return join(this.agencyDir, INSTALL_FILE);
  }

  private reloadJournal(): void {
    try {
      this.journal = readJournal(this.journalPath);
      this.journalError = null;
    } catch (error) {
      this.journal = null;
      this.journalError = error instanceof Error ? error.message : String(error);
    }
  }

  private writeJournal(journal: InstallJournal): void {
    mkdirSync(this.agencyDir, { recursive: true, mode: DIRECTORY_MODE });
    writeFileAtomic(this.journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    this.journal = journal;
    this.journalError = null;
  }

  /** The kit, loaded once. A missing kit is a state (`kit_missing`), not a crash. */
  private requireKit(): AgencyKit {
    if (this.kit) return this.kit;
    if (this.kitError) throw new AgencyError(this.kitError, "kit_missing", 503);
    try {
      this.kit = loadKit(this.kitRoot);
      return this.kit;
    } catch (error) {
      this.kitError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private kitOrNull(): AgencyKit | null {
    try {
      return this.requireKit();
    } catch {
      return null;
    }
  }

  /** True for a bot the pack created — the only bots the agency tools serve. */
  isAgencyBot(botId: string): boolean {
    return Boolean(this.journal && Object.values(this.journal.bots).includes(botId));
  }

  // ── status ──

  async state(): Promise<AgencyState> {
    const kit = this.kitOrNull();
    const template = kit?.template ?? { id: "lead-gen-agency", name: "Lead Gen Agency", version: 0 };
    const base = {
      template: { id: template.id, name: template.name, version: template.version },
      skillsCount: kit?.skills.length ?? 0,
    };
    if (this.journalError) {
      return { ...base, installed: false, status: "error", dashboardUrl: null, bots: [], groupId: null, error: this.journalError };
    }
    if (!kit) {
      return { ...base, installed: false, status: "error", dashboardUrl: null, bots: [], groupId: null, error: this.kitError ?? "agency kit missing" };
    }
    const journal = this.journal;
    if (!journal) {
      return { ...base, installed: false, status: "not-installed", dashboardUrl: null, bots: [], groupId: null };
    }
    const roster = await this.host.listBots();
    const bots = kit.template.bots.flatMap((row) => {
      const botId = journal.bots[row.slug];
      const bot = botId ? roster.find((candidate) => candidate.id === botId) : undefined;
      return bot ? [{ slug: row.slug, botId: bot.id, name: bot.name }] : [];
    });
    const installed = journal.status === "ready";
    const error = journal.status === "error" ? journal.error : this.appError ?? undefined;
    return {
      ...base,
      installed,
      status: journal.status === "ready" && this.appError ? "error" : journal.status,
      dashboardUrl: this.appUrl,
      bots,
      groupId: journal.groupId ?? null,
      ...(error ? { error } : {}),
    };
  }

  /** `GET`: the state, with the cockpit up when the pack is installed — and
   * nothing else touched. */
  async status(): Promise<AgencyState> {
    if (this.journal?.status === "ready" && !this.closed) {
      try {
        await this.ensureCockpit();
      } catch {
        // Reported through `appError` in the state below.
      }
    }
    return this.state();
  }

  // ── the cockpit ──

  private async ensureCockpit(): Promise<string> {
    if (this.closed) throw new AgencyError("the agency runtime is shutting down", "closed", 503);
    if (this.appUrl) return this.appUrl;
    if (!this.appStarting) {
      this.appStarting = this.startCockpit().finally(() => {
        this.appStarting = null;
      });
    }
    return this.appStarting;
  }

  private async startCockpit(): Promise<string> {
    const kit = this.requireKit();
    mkdirSync(this.dataDir, { recursive: true, mode: DIRECTORY_MODE });
    try {
      // A literal specifier: the packaging graph walks it. Loaded here rather
      // than at module top so a build without the kit still boots the sidecar
      // and answers `kit_missing` instead of failing to import.
      const { createApp } = await import("../agency-kit/lib/app.mjs");
      // Hosted: every `/api/*` route of the cockpit now requires this
      // service's bearer or a session cookie obtained from a ticket.
      const app = await createApp({
        dataDir: this.dataDir,
        publicDir: join(kit.root, "public"),
        hostedBy: "bizos-local",
        accessToken: this.accessToken,
      });
      const url = await new Promise<string>((resolveUrl, reject) => {
        app.server.once("error", reject);
        app.server.listen(0, "127.0.0.1", () => {
          const address = app.server.address();
          if (!address || typeof address === "string") {
            reject(new Error("the cockpit did not bind a TCP port"));
            return;
          }
          resolveUrl(`http://127.0.0.1:${address.port}`);
        });
      }).catch(async (error: unknown) => {
        await app.close().catch(() => undefined);
        throw error;
      });
      this.app = app;
      this.appUrl = url;
      this.appError = null;
      this.log(`agency cockpit listening on ${url}`);
      return url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appError = message;
      throw new AgencyError(`the agency cockpit could not start: ${message}`, "cockpit_error", 503);
    }
  }

  /**
   * The dashboard URL for a PERSON to open, when installed; an explicit
   * error otherwise. The URL carries a one-use ticket in its fragment
   * (`#connect=<64 hex>`, 60 s): the page exchanges it for an HttpOnly
   * session cookie and clears the fragment. This is the only place a ticket
   * is issued; no agent tool can reach it.
   */
  async open(): Promise<AgencyState> {
    if (this.journal?.status !== "ready") {
      throw new AgencyError("the agency pack is not installed; install it first", "not_installed", 409);
    }
    const url = await this.ensureCockpit();
    const app = this.app;
    if (!app) throw new AgencyError("the agency cockpit is not running", "cockpit_error", 503);
    const ticket = app.issueDashboardTicket();
    return { ...(await this.state()), dashboardUrl: `${url}/#connect=${ticket}` };
  }

  /** A run stopped or ended: its in-flight tool requests are abandoned. The
   * capability itself is revoked by the broker; this cuts what it started. */
  abortRun(runId: string): void {
    const controllers = this.activeCalls.get(runId);
    if (!controllers) return;
    this.activeCalls.delete(runId);
    for (const controller of controllers) controller.abort();
  }

  /** Stops the cockpit: the port closes and `db.lock` is released. Idempotent. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.appStarting) await this.appStarting.catch(() => undefined);
    const app = this.app;
    this.app = null;
    this.appUrl = null;
    if (app) {
      app.server.closeAllConnections?.();
      await app.close();
    }
  }

  // ── install ──

  /** `POST install`: creates what is missing, joins an install in flight,
   * answers the same state a `GET` would. */
  install(): Promise<AgencyState> {
    if (this.installing) return this.installing;
    this.installing = this.runInstall().finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  private async runInstall(): Promise<AgencyState> {
    if (this.closed) throw new AgencyError("the agency runtime is shutting down", "closed", 503);
    if (this.journalError) throw new AgencyError(this.journalError, "journal_corrupt", 500);
    const kit = this.requireKit();
    if (this.journal?.status === "ready") {
      await this.ensureCockpit();
      return this.state();
    }
    const template = kit.template;
    const now = this.nowIso();
    const journal: InstallJournal = this.journal
      ? { ...this.journal, status: "installing", updatedAt: now, welcomed: [...this.journal.welcomed] }
      : {
        version: 1,
        template: { id: template.id, version: template.version, name: template.name },
        status: "installing",
        step: "start",
        startedAt: now,
        updatedAt: now,
        vault: null,
        bots: {},
        welcomed: [],
      };
    delete journal.error;
    const step = (name: string): void => {
      journal.step = name;
      journal.updatedAt = this.nowIso();
      this.writeJournal(journal);
      this.log(`agency install: ${name}`);
    };
    try {
      step("vault");
      const vault = ensureAgencyVault(this.vaultDir, template);
      journal.vault = journal.vault === "seeded" ? "seeded" : vault.outcome;

      const roster = await this.host.listBots();
      for (const row of template.bots) {
        const folder = roleFolder(this.vaultDir, row);
        mkdirSync(folder, { recursive: true, mode: DIRECTORY_MODE });
        const recorded = journal.bots[row.slug];
        let bot = recorded ? roster.find((candidate) => candidate.id === recorded) : undefined;
        // A crash between the roster write and the journal write leaves a bot
        // the journal does not know. Its working folder is this pack's role
        // folder — nothing else creates a bot there — so it is adopted, not
        // duplicated.
        bot ??= roster.find((candidate) => candidate.workspacePath === folder && !candidate.archived);
        if (!bot) {
          step(`bot:${row.slug}`);
          bot = await this.host.createBot({
            name: row.name,
            title: row.title,
            description: row.description,
            instructions: botInstructions(row),
            ...(row.thinking ? { thinking: row.thinking } : {}),
            workspacePath: folder,
            notifyOnFinish: true,
          });
          roster.push(bot);
          if (row.pinned) await this.host.updateBot(bot.id, { pinned: true });
        }
        journal.bots[row.slug] = bot.id;
        step(`bot:${row.slug}:done`);
      }

      const memberIds = template.bots.map((row) => journal.bots[row.slug]).filter((id): id is string => Boolean(id));
      if (memberIds.length > 1) {
        step("group");
        const groups = await this.host.listGroups();
        const teamName = template.team?.name ?? template.name;
        const sameMembers = (group: Group) => group.memberIds.length === memberIds.length && memberIds.every((id) => group.memberIds.includes(id));
        let group = journal.groupId ? groups.find((candidate) => candidate.id === journal.groupId) : undefined;
        group ??= groups.find((candidate) => !candidate.archived && candidate.name === teamName && sameMembers(candidate));
        group ??= await this.host.createGroup({ name: teamName.slice(0, 60), memberIds });
        journal.groupId = group.id;
        step("group:done");
      }

      for (const row of template.bots) {
        const botId = journal.bots[row.slug];
        if (!row.welcome || !botId || journal.welcomed.includes(row.slug)) continue;
        step(`welcome:${row.slug}`);
        await this.host.greet(botId, row.welcome, `agency:${template.id}:${template.version}:welcome:${row.slug}:${botId}`);
        journal.welcomed.push(row.slug);
        step(`welcome:${row.slug}:done`);
      }

      step("cockpit");
      await this.ensureCockpit();
      journal.status = "ready";
      step("ready");
      return this.state();
    } catch (error) {
      journal.status = "error";
      journal.error = error instanceof Error ? error.message : String(error);
      journal.updatedAt = this.nowIso();
      this.writeJournal(journal);
      throw error instanceof AgencyError ? error : new AgencyError(journal.error, "install_failed", 500);
    }
  }

  // ── the cockpit API, for the tools ──

  /** The service's own request headers: the bearer, and nothing an agent sees. */
  private serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.accessToken}`, ...extra };
  }

  /**
   * Still allowed to act, NOW: the run was not stopped (signal), the bot is
   * still the pack's, and its run is still active. Called before every write
   * and before every result leaves, so a capability that ended between a read
   * and its write neither writes nor hands back what it read.
   */
  private async ensureLive(ctx: CallContext): Promise<void> {
    if (ctx.signal.aborted) throw new AgencyError("the run was stopped; the request was abandoned", "run_stopped", 403);
    await this.authorize(ctx.scope);
  }

  private async api(ctx: CallContext, method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<unknown> {
    const url = await this.ensureCockpit();
    // A write is re-authorised at the last moment. What the cockpit has
    // already accepted when a STOP lands is not undone: an accepted write
    // is a write, and the result says so by being returned or not.
    if (WRITE_METHODS.has(method)) await this.ensureLive(ctx);
    const response = await this.fetchImpl(`${url}/api${path}`, {
      method,
      headers: this.serviceHeaders({ accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const record = isRecord(payload) ? payload : {};
      const message = typeof record.error === "string" ? record.error : `cockpit answered ${response.status}`;
      const field = typeof record.field === "string" ? ` (field: ${record.field})` : "";
      throw new AgencyError(`${message}${field}`, "cockpit_refused", response.status);
    }
    return payload;
  }

  // ── the tools ──

  private async authorize(scope: AgencyScope): Promise<void> {
    if (!this.journal || !this.isAgencyBot(scope.botId)) {
      throw new AgencyError("the agency tools are granted only to the agents of the installed agency pack", "not_agency_agent", 403);
    }
    const run = await this.host.run(scope.runId);
    if (!run || run.botId !== scope.botId || run.threadId !== scope.threadId || !ACTIVE_RUN_STATES.has(run.state)) {
      throw new AgencyError("the agency tools are available only during an active run of this agent", "run_not_active", 403);
    }
  }

  /**
   * One call, fully bounded: the scope is checked on entry, before every
   * write and before the result leaves; the arguments are vetted; the
   * cockpit's own validation is kept; every client relation is verified.
   * The context is this call's alone — a STOP aborts its requests through
   * `abortRun`, and nothing about it is kept on the service.
   */
  async callTool(scope: AgencyScope, name: string, argumentsValue: unknown): Promise<unknown> {
    if (!isAgencyToolName(name)) throw new AgencyError(`unknown agency tool: ${name}`, "unknown_tool", 404);
    await this.authorize(scope);
    const args = argumentsValue === undefined || argumentsValue === null ? {} : argumentsValue;
    if (!isRecord(args)) throw new AgencyError("tool arguments must be an object", "invalid_arguments");
    const controller = new AbortController();
    const ctx: CallContext = { scope, signal: controller.signal };
    const inFlight = this.activeCalls.get(scope.runId) ?? new Set<AbortController>();
    inFlight.add(controller);
    this.activeCalls.set(scope.runId, inFlight);
    try {
      const result = await this.dispatch(ctx, name, args);
      await this.ensureLive(ctx);
      return result;
    } catch (error) {
      if (ctx.signal.aborted && !(error instanceof AgencyError)) {
        throw new AgencyError("the run was stopped; the request was abandoned", "run_stopped", 403);
      }
      throw error;
    } finally {
      inFlight.delete(controller);
      if (inFlight.size === 0 && this.activeCalls.get(scope.runId) === inFlight) this.activeCalls.delete(scope.runId);
    }
  }

  private dispatch(ctx: CallContext, name: string, args: Record<string, unknown>): Promise<unknown> | unknown {
    switch (name) {
      case "agency_context": return this.context(ctx, args);
      case "agency_clients": return this.clients(ctx, args);
      case "agency_campaigns": return this.related(ctx, "campaigns", "campaignId", CAMPAIGN_FIELDS, args);
      case "agency_tasks": return this.related(ctx, "tasks", "taskId", TASK_FIELDS, args);
      case "agency_deliverables": return this.related(ctx, "deliverables", "deliverableId", DELIVERABLE_FIELDS, args);
      case "agency_onboarding": return this.onboarding(ctx, args);
      case "agency_profile_update": return this.profileUpdate(ctx, args);
      case "agency_list_skills": return this.listSkills();
      case "agency_read_skill": return this.readSkill(args);
      case "agency_read_document": return this.readDocument(args);
      default: throw new AgencyError(`unknown agency tool: ${String(name)}`, "unknown_tool", 404);
    }
  }

  /** The dynamic tools for one run: each call re-authorises through
   * `scopeOf`, so a revoked capability refuses mid-turn. */
  dynamicTools(scopeOf: () => AgencyScope): CodexDynamicTool[] {
    return AGENCY_TOOL_SPECS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      // `async` so a revoked capability is a rejection, never a synchronous
      // throw inside the driver's dispatch.
      call: async (argumentsValue: unknown) => this.callTool(scopeOf(), tool.name, argumentsValue),
    }));
  }

  private optionalId(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new AgencyError(`${field} is not a valid id`, "invalid_arguments");
    return value;
  }

  private requireId(value: unknown, field: string): string {
    const id = this.optionalId(value, field);
    if (!id) throw new AgencyError(`${field} is required`, "invalid_arguments");
    return id;
  }

  private action(value: unknown, allowed: readonly string[]): string {
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new AgencyError(`action must be one of ${allowed.join(", ")}`, "invalid_arguments");
    }
    return value;
  }

  /** `data` restricted to the fields the cockpit knows for this resource;
   * an unknown field is refused rather than dropped, so an agent learns. */
  private data(value: unknown, fields: Record<string, unknown>, required: boolean): Record<string, unknown> {
    if (value === undefined || value === null) {
      if (required) throw new AgencyError("data is required", "invalid_arguments");
      return {};
    }
    if (!isRecord(value)) throw new AgencyError("data must be an object", "invalid_arguments");
    const unknown = Object.keys(value).find((key) => !(key in fields));
    if (unknown) throw new AgencyError(`unknown field ${unknown}; allowed: ${Object.keys(fields).join(", ")}`, "invalid_arguments");
    if (required && Object.keys(value).length === 0) throw new AgencyError("data is empty", "invalid_arguments");
    return { ...value };
  }

  private summary(item: unknown): Record<string, unknown> {
    if (!isRecord(item)) return {};
    const { onboarding, ...rest } = item;
    return {
      ...rest,
      ...(isRecord(onboarding) ? { onboardingStatus: onboarding.status ?? null } : onboarding === null ? { onboardingStatus: null } : {}),
    };
  }

  private preview(item: unknown): Record<string, unknown> {
    if (!isRecord(item)) return {};
    const content = typeof item.content === "string" ? item.content : "";
    return { ...item, content: content.slice(0, PREVIEW_CHARS), contentLength: content.length, contentTruncated: content.length > PREVIEW_CHARS };
  }

  private async context(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const clientId = this.optionalId(args.clientId, "clientId");
    if (!clientId) {
      const [agency, clients] = await Promise.all([this.api(ctx, "GET", "/agency"), this.api(ctx, "GET", "/clients")]);
      const list = Array.isArray(clients) ? clients : [];
      return {
        agency,
        clients: list.slice(0, MAX_LIST_ITEMS).map((client) => {
          const record = isRecord(client) ? client : {};
          return { id: record.id, company: record.company, status: record.status, updatedAt: record.updatedAt };
        }),
        clientsCount: list.length,
      };
    }
    if (args.format === "markdown") {
      const url = await this.ensureCockpit();
      const response = await this.fetchImpl(`${url}/api/clients/${encodeURIComponent(clientId)}/dossier.md`, {
        headers: this.serviceHeaders(),
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new AgencyError(typeof payload.error === "string" ? payload.error : `cockpit answered ${response.status}`, "cockpit_refused", response.status);
      }
      const text = await response.text();
      return { clientId, format: "markdown", markdown: text.slice(0, MAX_DOCUMENT_CHARS), truncated: text.length > MAX_DOCUMENT_CHARS };
    }
    const dossier = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
    const client = isRecord(dossier.client) ? dossier.client : {};
    const deliverables = Array.isArray(dossier.deliverables) ? dossier.deliverables : [];
    return {
      client: this.summary(client),
      onboarding: isRecord(client.onboarding)
        ? { status: client.onboarding.status ?? null, step: client.onboarding.step ?? null, submittedAt: client.onboarding.submittedAt ?? null, reviewedAt: client.onboarding.reviewedAt ?? null }
        : null,
      campaigns: dossier.campaigns ?? [],
      tasks: dossier.tasks ?? [],
      deliverables: deliverables.map((item) => this.preview(item)),
    };
  }

  private async clients(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const action = this.action(args.action, ["list", "get", "create", "update"]);
    if (action === "list") {
      const clients = await this.api(ctx, "GET", "/clients");
      const list = Array.isArray(clients) ? clients : [];
      return { resource: "clients", count: list.length, items: list.slice(0, MAX_LIST_ITEMS).map((item) => this.summary(item)) };
    }
    if (action === "create") {
      const created = await this.api(ctx, "POST", "/clients", this.data(args.data, CLIENT_FIELDS, true)) as Record<string, unknown>;
      return { resource: "client", id: created.id, updatedAt: created.updatedAt, item: this.summary(created) };
    }
    const clientId = this.requireId(args.clientId, "clientId");
    if (action === "get") {
      const dossier = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
      return { resource: "client", id: clientId, item: this.summary(dossier.client) };
    }
    const updated = await this.api(ctx, "PATCH", `/clients/${encodeURIComponent(clientId)}`, this.data(args.data, CLIENT_FIELDS, true)) as Record<string, unknown>;
    return { resource: "client", id: clientId, updatedAt: updated.updatedAt, item: this.summary(updated) };
  }

  /** The client-bounded resources. Every path checks that the record — and
   * any campaign it names — belongs to `clientId`; otherwise it is refused. */
  private async related(
    ctx: CallContext,
    resource: "campaigns" | "tasks" | "deliverables",
    idField: string,
    fields: Record<string, unknown>,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const action = this.action(args.action, ["list", "get", "create", "update"]);
    const clientId = this.requireId(args.clientId, "clientId");
    const singular = resource.slice(0, -1);
    const ownedBy = (item: unknown): item is Record<string, unknown> => isRecord(item) && item.clientId === clientId;
    const dossier = async () => {
      const found = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
      const rows = found[resource];
      return Array.isArray(rows) ? rows.filter(ownedBy) : [];
    };
    const refuse = (id: string) => new AgencyError(`${singular} ${id} does not belong to client ${clientId}`, "other_client", 403);
    const assertCampaign = async (campaignId: unknown) => {
      if (campaignId === undefined || campaignId === null) return;
      const id = this.requireId(campaignId, "campaignId");
      const found = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
      const campaigns = Array.isArray(found.campaigns) ? found.campaigns : [];
      if (!campaigns.some((row) => isRecord(row) && row.id === id)) throw new AgencyError(`campaign ${id} does not belong to client ${clientId}`, "other_client", 403);
    };
    if (action === "list") {
      const items = await dossier();
      return {
        resource,
        clientId,
        count: items.length,
        items: items.slice(0, MAX_LIST_ITEMS).map((item) => (resource === "deliverables" ? this.preview(item) : item)),
      };
    }
    if (action === "create") {
      const data = this.data(args.data, fields, true);
      await assertCampaign(data.campaignId);
      const created = await this.api(ctx, "POST", `/${resource}`, { ...data, clientId }) as Record<string, unknown>;
      return { resource: singular, id: created.id, clientId, updatedAt: created.updatedAt, item: created };
    }
    const id = this.requireId(args[idField], idField);
    const existing = (await dossier()).find((item) => item.id === id);
    if (!existing) throw refuse(id);
    if (action === "get") return { resource: singular, id, clientId, item: existing };
    const data = this.data(args.data, fields, true);
    if ("campaignId" in data) await assertCampaign(data.campaignId);
    const updated = await this.api(ctx, "PATCH", `/${resource}/${encodeURIComponent(id)}`, data) as Record<string, unknown>;
    return { resource: singular, id, clientId, updatedAt: updated.updatedAt, item: updated };
  }

  private async onboarding(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const action = this.action(args.action, ["schema", "get", "save", "submit"]);
    if (action === "schema") return this.api(ctx, "GET", "/onboarding/schema");
    const clientId = this.requireId(args.clientId, "clientId");
    const path = `/clients/${encodeURIComponent(clientId)}/onboarding`;
    if (action === "get") return { clientId, ...(await this.api(ctx, "GET", path) as Record<string, unknown>) };
    if (action === "save") {
      const allowed = { company: true, offer: true, target: true, campaign: true, delivery: true, step: true };
      const data = this.data(args.data, allowed, true);
      return { clientId, ...(await this.api(ctx, "PUT", path, data) as Record<string, unknown>) };
    }
    const result = await this.api(ctx, "POST", `${path}/submit`) as Record<string, unknown>;
    const brief = isRecord(result.brief) ? result.brief : {};
    return {
      clientId,
      onboarding: result.onboarding,
      progress: result.progress,
      campaign: result.campaign,
      brief: { id: brief.id, title: brief.title, type: brief.type },
      tasks: result.tasks,
      client: this.summary(result.client),
    };
  }

  private async profileUpdate(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const data = this.data(args.data, AGENCY_PROFILE_FIELDS, true);
    const updated = await this.api(ctx, "PUT", "/agency", data) as Record<string, unknown>;
    return { resource: "agency", updatedAt: updated.updatedAt, item: updated };
  }

  private listSkills(): unknown {
    const kit = this.requireKit();
    return { count: kit.skills.length, skills: kit.skills };
  }

  private readSkill(args: Record<string, unknown>): unknown {
    const kit = this.requireKit();
    const name = args.name;
    if (typeof name !== "string" || !SKILL_NAME.test(name)) throw new AgencyError("name must be a skill name as listed", "invalid_arguments");
    const skill = kit.skills.find((candidate) => candidate.name === name);
    if (!skill) throw new AgencyError(`unknown skill ${name}`, "not_found", 404);
    const reference = args.reference;
    let segments: string[];
    if (reference === undefined || reference === null || reference === "") {
      segments = ["skills", name, "SKILL.md"];
    } else {
      if (typeof reference !== "string" || !REFERENCE_NAME.test(reference) || !skill.references.includes(reference)) {
        throw new AgencyError(`reference must be one of: ${skill.references.join(", ") || "(none)"}`, "invalid_arguments");
      }
      segments = ["skills", name, "references", reference];
    }
    const target = resolveInside(kit.root, segments);
    const { text, truncated } = readBounded(target.absolute);
    return { name, reference: segments.length === 4 ? reference : null, path: segments.join("/"), text, truncated, references: skill.references };
  }

  private readDocument(args: Record<string, unknown>): unknown {
    if (!this.journal) throw new AgencyError("the agency vault is not installed", "not_installed", 409);
    const raw = args.path;
    if (raw !== undefined && typeof raw !== "string") throw new AgencyError("path must be a string", "invalid_arguments");
    const path = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
    const segments = path ? vaultSegments(path) : [];
    const target = resolveInside(this.vaultDir, segments, { directory: true });
    if (target.kind === "directory") {
      const entries = readdirSync(target.absolute, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isFile()))
        .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "folder" : "file" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { path, kind: "folder", entries };
    }
    if (!/\.(md|txt|json)$/i.test(target.absolute)) throw new AgencyError("only .md, .txt and .json notes can be read", "invalid_path", 403);
    const { text, truncated } = readBounded(target.absolute);
    return { path, kind: "file", text, truncated };
  }
}
