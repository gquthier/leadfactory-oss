// The template catalogue and its registry — what Apps → Second brain offers
// under "Templates", and what remembers which ones were created.
//
// A template (`company-os.ts`: notes, agents, an optional team) is applied
// into a MANAGED VAULT of its own, `<stateRoot>/vaults/<templateId>/`, never
// into a folder that already holds something. The person's existing brain,
// its notes and their roster are never touched: a template adds a vault, its
// agents and their first words, and that is all. The catalogue is built in —
// two packs, both flat TypeScript modules so the packaged app ships them —
// and nothing on disk can add a third.
//
// `templates.json` is the registry. It holds two things:
//   - `installations`: templates that were applied whole, one per id, with
//     the vault they made and the roster ids of the agents they created;
//   - `pending`: the JOURNAL of an application in progress. Every identity
//     is written here BEFORE the effect it names — the staging folder before
//     it is seeded, an agent's id before the agent is created, a welcome's
//     message id before it is appended, the team's id before the group — and
//     marked done after. A crash anywhere, even between an effect and its
//     mark, leaves a journal from which the next attempt finds what exists
//     by id and finishes the rest, so nothing is ever made twice; and an
//     agent the person deleted in between is marked so and not recreated.
//
// What is refused, and why:
//   - a folder already at `vaults/<id>` that no journal accounts for: it is
//     not this app's to adopt, whatever it holds. A folder the journal says
//     was being seeded is accepted only after it is checked to hold the pack;
//   - a symlink where `vaults/`, `vaults/<id>` or `templates.json` should be:
//     a link planted there would let a write land elsewhere; a folder that
//     cannot be examined at all is refused the same way;
//   - a registry that cannot be parsed, or whose rows name anything but the
//     canonical vault of their template: silently starting from empty would
//     create a second copy of everything the lost registry remembered, and a
//     row naming another folder would make that folder a writable root.
//
// The legacy `template.json` — the Company OS applied at first launch into
// `<stateRoot>/brain` — is read, never rewritten, and counts as a Company OS
// installation only when it is COMPLETE: the brain was seeded (not "kept"
// over a person's notes) and at least one of the agents it created is still
// in the roster. Otherwise the catalogue offers to create the Company OS in
// a managed vault like any other template.
//
// The desktop reads `TemplateSummary` and `harness.templates.apply`'s answer
// over two loopback routes (`sidecar.ts`: `GET /api/local/brain/templates`,
// `POST /api/local/brain/templates/apply`) and mirrors the shapes by hand in
// its repository (`ts/bizos/apps/local-brain.std.ts`; the routes are written
// up in its `LOCAL_RUNTIME.md`): change a shape here, change it there.
//
// THE BINDING (`workspace-binding.json`). A local workspace works in ONE
// vault: the person chooses a template and a vault once — a new managed
// vault, or an existing writable root — and that choice is pinned. It is
// written BEFORE the template's first effect, it is idempotent for the same
// request, and any other template or root afterwards is refused (409). There
// is no reset route: the file is the person's to move, deliberately. Once
// bound, the second brain exposes that vault and nothing else, new agents
// get their folder in it, and the packs (`pack.ts`) keep their data in it.
import { existsSync, lstatSync, writeFileSync, type Stats } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BrainError, type BrainRoot } from "./brain.js";
import { COMPANY_OS, segmentsOf, TEMPLATE_FILE, type CompanyTemplate, type TemplateState, type VaultSeed } from "./company-os.js";
import { FILE_MODE, type Storage } from "./storage.js";
import { ECOMMERCE_FALLBACK, ecommerceTemplate } from "./template-ecommerce.js";
import { LEAD_GEN_AGENCY } from "./template-lead-gen-agency.js";
import type { Bot } from "./types.js";
import { DEFAULT_KIT_ROOT, kitPresent, loadKit } from "./pack-kit.js";

/** The built-in catalogue, in the order the desktop lists it. */
export const TEMPLATE_IDS = ["company-os", "lead-gen-agency", "ecommerce"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** The two flat packs, plus the e-commerce pack read from the embedded kit
 * (`agency-kit/ecommerce/template.json`) when it is staged, or the shipped
 * fallback (`template-ecommerce.ts`) when it is not. Resolved per call so a
 * kit staged after boot is seen; the kit read is cached by its module. */
export function templateOf(id: TemplateId): CompanyTemplate {
  if (id === "company-os") return COMPANY_OS;
  if (id === "lead-gen-agency") {
    const file = "templates/lead-gen-agency.company-template.json";
    const template = kitPresent(DEFAULT_KIT_ROOT, file) ? loadKit(DEFAULT_KIT_ROOT, file, "agency").template : LEAD_GEN_AGENCY;
    return { ...template, description: template.description || LEAD_GEN_AGENCY.description, team: template.team ?? { name: "LeadFactory Agency" } };
  }
  return ecommerceTemplate();
}

/** The catalogue as a record — the fallback e-commerce pack, for callers
 * that want a static shape (tests, summaries). Prefer `templateOf`. */
export const TEMPLATE_CATALOG: Readonly<Record<TemplateId, CompanyTemplate>> = {
  "company-os": COMPANY_OS,
  "lead-gen-agency": LEAD_GEN_AGENCY,
  ecommerce: ECOMMERCE_FALLBACK,
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

/** The registry file, next to `bots.json`. */
export const TEMPLATES_FILE = "templates.json";
/** Where every managed vault lives, under the runtime root. */
export const VAULTS_DIRECTORY = "vaults";
/** The root id a managed vault answers to in `brain.roots()`. */
export function vaultRootId(id: TemplateId): string {
  return `vault:${id}`;
}
/** The managed vault's folder, relative to the runtime root. */
export function vaultPathOf(id: TemplateId): string {
  return `${VAULTS_DIRECTORY}/${id}`;
}

/** A template applied whole. */
export interface TemplateInstallation {
  id: TemplateId;
  version: number;
  /** `vault:<id>` for a managed vault, `brain` for the legacy Company OS,
   * or the bound root's id when the template was installed into an
   * existing vault the person chose (`workspace-binding.json`). */
  rootId: string;
  /** The vault folder: relative to the runtime root for a managed vault
   * (`vaults/<id>`) or the legacy brain (`brain`); ABSOLUTE for a vault the
   * person chose — and then it must be the bound vault, nothing else. */
  vaultPath: string;
  appliedAt: string;
  vault: VaultSeed;
  /** Template agent slug → roster bot id, for the agents that were created. */
  bots: Record<string, string>;
  groupId?: string;
  /** Always empty: the catalogue creates no routine. Kept for the legacy row. */
  routineIds: string[];
}

/** One agent in the journal: its id, written before it exists. */
export interface PendingBot {
  id: string;
  /** Set once the roster persisted it. */
  created: boolean;
  /** Set by `bots.remove` — the person deleted it; a retry leaves it out. */
  removed?: boolean;
}

/** One welcome in the journal: its message id, written before it is appended. */
export interface PendingWelcome {
  id: string;
  /** Set once the message is in the thread and the bot marked unread. */
  posted: boolean;
}

/** The journal of an application in progress — see the module comment. */
export interface PendingInstallation {
  id: TemplateId;
  version: number;
  startedAt: string;
  /** The staging folder's name under `vaults/`, from before it is seeded
   * until the vault is in place: a folder at `vaults/<id>` while this is set
   * may be that staging folder, renamed a moment before the crash. */
  staging?: string;
  /** Set once the vault is in place: `seeded` for a managed vault this
   * application made; `completed` or `kept` for an existing vault the
   * template's missing notes were written into (or found complete). */
  vault?: PendingSeed;
  bots: Record<string, PendingBot>;
  welcomes: Record<string, PendingWelcome>;
  group?: { id: string; created: boolean };
}

export interface TemplateRegistry {
  version: 1;
  installations: Partial<Record<TemplateId, TemplateInstallation>>;
  pending: Partial<Record<TemplateId, PendingInstallation>>;
}

const EMPTY_REGISTRY: TemplateRegistry = { version: 1, installations: {}, pending: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(value)) {
    if (typeof id !== "string" || !id) return null;
    out[key] = id;
  }
  return out;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

const SEEDS: readonly VaultSeed[] = ["seeded", "upgraded", "kept"];
/** What the journal may say about a vault in progress. */
export type PendingSeed = "seeded" | "completed" | "kept";
const PENDING_SEEDS: readonly PendingSeed[] = ["seeded", "completed", "kept"];

/** A slug the catalogue could have written. */
function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** A staging folder name this module makes: hidden, under `vaults/`, one segment. */
function isStagingName(id: TemplateId, value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^\\.${id}\\.staging-[0-9]+-[0-9a-f]{8}$`).test(value);
}

function installationOf(raw: unknown, id: TemplateId, binding: WorkspaceBinding | null): TemplateInstallation {
  if (!isRecord(raw) || raw.id !== id) throw corrupt(`installation ${id}`);
  const bots = stringMap(raw.bots);
  const routineIds = stringList(raw.routineIds);
  if (
    typeof raw.version !== "number" ||
    typeof raw.rootId !== "string" ||
    typeof raw.vaultPath !== "string" ||
    typeof raw.appliedAt !== "string" ||
    !SEEDS.includes(raw.vault as VaultSeed) ||
    !bots ||
    !routineIds ||
    (raw.groupId !== undefined && typeof raw.groupId !== "string")
  ) {
    throw corrupt(`installation ${id}`);
  }
  // The ONLY places an installation may point at: its own managed vault, or
  // — for the Company OS launch applied — the brain. A row naming any other
  // folder would make that folder a writable root with no grant behind it.
  const managed = raw.rootId === vaultRootId(id) && raw.vaultPath === vaultPathOf(id);
  const legacy = id === "company-os" && raw.rootId === "brain" && raw.vaultPath === "brain";
  // A vault the person chose: only the one the binding names, by id AND path.
  const bound = binding !== null && binding.templateId === id && raw.rootId === binding.rootId && raw.vaultPath === binding.path;
  if (!managed && !legacy && !bound) throw corrupt(`installation ${id} names a folder that is not its vault`);
  if (Object.keys(bots).some((slug) => !isSlug(slug))) throw corrupt(`installation ${id}`);
  return {
    id,
    version: raw.version,
    rootId: raw.rootId,
    vaultPath: raw.vaultPath,
    appliedAt: raw.appliedAt,
    vault: raw.vault as VaultSeed,
    bots,
    ...(raw.groupId ? { groupId: raw.groupId } : {}),
    routineIds,
  };
}

function pendingBots(value: unknown): Record<string, PendingBot> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, PendingBot> = {};
  for (const [slug, row] of Object.entries(value)) {
    if (!isSlug(slug) || !isRecord(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "boolean") return null;
    if (row.removed !== undefined && typeof row.removed !== "boolean") return null;
    out[slug] = { id: row.id, created: row.created, ...(row.removed ? { removed: true } : {}) };
  }
  return out;
}

function pendingWelcomes(value: unknown): Record<string, PendingWelcome> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, PendingWelcome> = {};
  for (const [slug, row] of Object.entries(value)) {
    if (!isSlug(slug) || !isRecord(row) || typeof row.id !== "string" || !row.id || typeof row.posted !== "boolean") return null;
    out[slug] = { id: row.id, posted: row.posted };
  }
  return out;
}

function pendingOf(raw: unknown, id: TemplateId): PendingInstallation {
  if (!isRecord(raw) || raw.id !== id) throw corrupt(`journal ${id}`);
  const bots = pendingBots(raw.bots);
  const welcomes = pendingWelcomes(raw.welcomes);
  const group = raw.group;
  if (
    typeof raw.version !== "number" ||
    typeof raw.startedAt !== "string" ||
    (raw.staging !== undefined && !isStagingName(id, raw.staging)) ||
    (raw.vault !== undefined && !PENDING_SEEDS.includes(raw.vault as PendingSeed)) ||
    !bots ||
    !welcomes ||
    (group !== undefined &&
      (!isRecord(group) || typeof group.id !== "string" || !group.id || typeof group.created !== "boolean"))
  ) {
    throw corrupt(`journal ${id}`);
  }
  return {
    id,
    version: raw.version,
    startedAt: raw.startedAt,
    ...(raw.staging ? { staging: raw.staging } : {}),
    ...(raw.vault ? { vault: raw.vault as PendingSeed } : {}),
    bots,
    welcomes,
    ...(group ? { group: { id: (group as { id: string }).id, created: (group as { created: boolean }).created } } : {}),
  };
}

function corrupt(what: string): BrainError {
  return new BrainError(
    `${TEMPLATES_FILE} is damaged (${what}) — nothing was changed. Repair or move that file before creating a template.`,
  );
}

/** `lstat` that answers `null` for "not there" and refuses to guess about
 * anything else: a folder that cannot be examined is not a folder this app
 * writes next to. */
export function lstatOrNull(path: string, what: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new BrainError(`${what} cannot be examined (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  }
}

/** Refuses a symlink — or anything unexaminable — where a file or folder this
 * module owns should be. */
export function refuseSymlink(path: string, what: string): void {
  if (lstatOrNull(path, what)?.isSymbolicLink()) {
    throw new BrainError(`${what} is a link, and this app does not write through links`);
  }
}

/**
 * The registry, read strictly. A damaged file is an error the caller shows,
 * not an empty registry: an empty registry would apply every template a
 * second time, on top of the agents the damaged file remembered.
 */
export function readTemplateRegistry(storage: Storage, binding: WorkspaceBinding | null = readWorkspaceBinding(storage)): TemplateRegistry {
  refuseSymlink(join(storage.layout.root, TEMPLATES_FILE), TEMPLATES_FILE);
  let raw: unknown;
  try {
    raw = storage.readJsonStrict<unknown>(TEMPLATES_FILE, EMPTY_REGISTRY);
  } catch {
    throw corrupt("unreadable");
  }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.installations) || !isRecord(raw.pending)) {
    throw corrupt("shape");
  }
  const registry: TemplateRegistry = { version: 1, installations: {}, pending: {} };
  for (const [key, value] of Object.entries(raw.installations)) {
    if (!isTemplateId(key)) throw corrupt(`unknown template ${key}`);
    registry.installations[key] = installationOf(value, key, binding);
  }
  for (const [key, value] of Object.entries(raw.pending)) {
    if (!isTemplateId(key)) throw corrupt(`unknown template ${key}`);
    if (registry.installations[key]) throw corrupt(`${key} is both installed and in progress`);
    registry.pending[key] = pendingOf(value, key);
  }
  return registry;
}

export function writeTemplateRegistry(storage: Storage, registry: TemplateRegistry): void {
  refuseSymlink(join(storage.layout.root, TEMPLATES_FILE), TEMPLATES_FILE);
  storage.writeJson(TEMPLATES_FILE, registry);
}

/**
 * The legacy `template.json` as a Company OS installation on the `brain`
 * root — only when it is complete. `vault: "kept"` means the Company OS was
 * never written (the person already had notes there); an empty `bots` map
 * means the roster already had agents and the CEO was never created. Either
 * way the promise of the catalogue row — the notes AND the agents — is not on
 * this Mac, so the row offers to create it in a vault of its own.
 */
export function legacyCompanyOsInstallation(
  storage: Storage,
  brainDir: string,
  roster: ReadonlyArray<Bot>,
): TemplateInstallation | null {
  const state = storage.readJson<TemplateState | null>(TEMPLATE_FILE, null);
  if (!state || !isRecord(state) || state.id !== COMPANY_OS.id) return null;
  if (state.vault !== "seeded" && state.vault !== "upgraded") return null;
  const bots = stringMap(state.bots) ?? {};
  const present = Object.fromEntries(Object.entries(bots).filter(([, botId]) => roster.some((bot) => bot.id === botId)));
  if (Object.keys(present).length === 0) return null;
  try {
    if (!lstatSync(brainDir).isDirectory()) return null;
  } catch {
    return null;
  }
  return {
    id: "company-os",
    version: typeof state.version === "number" ? state.version : COMPANY_OS.version,
    rootId: "brain",
    vaultPath: "brain",
    appliedAt: typeof state.appliedAt === "string" ? state.appliedAt : "",
    vault: state.vault,
    bots: present,
    ...(typeof state.groupId === "string" && state.groupId ? { groupId: state.groupId } : {}),
    routineIds: stringList(state.routineIds) ?? [],
  };
}

/** The vault folder of an installation, absolute. */
export function installationVaultDir(storage: Storage, installation: TemplateInstallation): string {
  return isAbsolute(installation.vaultPath) ? installation.vaultPath : join(storage.layout.root, installation.vaultPath);
}

/** Whether an installation's vault is where it should be. `missing` is a
 * folder that is not there; `unreadable` is a link, a file, or a folder that
 * cannot be examined — none of which is opened. */
export type InstallationStatus = "ready" | "missing" | "unreadable";

export function installationStatus(storage: Storage, installation: TemplateInstallation): InstallationStatus {
  let stats: Stats | null;
  try {
    stats = lstatOrNull(installationVaultDir(storage, installation), installation.vaultPath);
  } catch {
    return "unreadable";
  }
  if (!stats) return "missing";
  return stats.isDirectory() && !stats.isSymbolicLink() ? "ready" : "unreadable";
}

/** The sentence `apply` answers for an installation whose vault is not usable. */
export function describeUnavailable(template: CompanyTemplate, installation: TemplateInstallation, status: InstallationStatus): BrainError {
  return status === "missing"
    ? new BrainError(`the vault of ${template.name} is no longer at ${installation.vaultPath} — put it back to open it`, "not_found")
    : new BrainError(`what is at ${installation.vaultPath} is not the vault of ${template.name} — this app does not open it`, "not_found");
}

/**
 * True when the folder holds every note and folder of the pack as regular
 * entries — the check a folder at `vaults/<id>` passes before a journal that
 * only says "seeding had started" is allowed to claim it. Bounded by the
 * pack: one `lstat` per note and folder, nothing read.
 */
export function holdsTemplate(path: string, template: CompanyTemplate): boolean {
  try {
    for (const folder of template.folders) {
      if (!lstatSync(join(path, ...segmentsOf(folder))).isDirectory()) return false;
    }
    for (const note of template.notes) {
      if (!lstatSync(join(path, ...segmentsOf(note.path))).isFile()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The managed vaults as roots, only those whose folder is a real directory
 * right now: a vault the person moved away is left out, a symlink planted
 * in its place is left out and reported, and neither breaks the others. A
 * folder that cannot be examined at all throws — the caller decides what
 * that hides.
 *
 * `pending` adds the vault of an application in progress. The desktop is
 * not offered it — half a template is not a vault to work in — but an agent
 * created by that application already has its folder there, and deleting
 * the agent must trash the folder in ITS vault, not leave it behind.
 */
export function managedVaultRoots(
  storage: Storage,
  registry: TemplateRegistry,
  log: (message: string) => void = (message) => console.warn(`Local BizOS: ${message}`),
  options: { pending?: boolean } = {},
): BrainRoot[] {
  const vaults = join(storage.layout.root, VAULTS_DIRECTORY);
  const vaultsStats = lstatOrNull(vaults, `${VAULTS_DIRECTORY}/`);
  if (!vaultsStats) return [];
  if (vaultsStats.isSymbolicLink()) {
    log(`${VAULTS_DIRECTORY}/ is a link; template vaults are not offered`);
    return [];
  }
  const roots: BrainRoot[] = [];
  for (const id of TEMPLATE_IDS) {
    const installation = registry.installations[id];
    if (installation) {
      if (installation.rootId === "brain") continue;
    } else if (!(options.pending && registry.pending[id]?.vault)) {
      continue;
    }
    // Canonical by construction: `installationOf` refused any other path.
    const vaultPath = vaultPathOf(id);
    const path = join(storage.layout.root, vaultPath);
    const stats = lstatOrNull(path, vaultPath);
    if (!stats) continue;
    if (stats.isSymbolicLink()) {
      log(`${vaultPath} is a link; that vault is not offered`);
      continue;
    }
    if (!stats.isDirectory()) continue;
    roots.push({ id: vaultRootId(id), label: templateOf(id).name, path, writable: true });
  }
  return roots;
}

/** What the catalogue row shows. */
export interface TemplateSummary {
  id: TemplateId;
  name: string;
  description: string;
  version: number;
  /** Files the vault starts with that the second brain reads as notes. */
  notes: number;
  folders: number;
  agents: Array<{ slug: string; name: string; title: string }>;
  installed?: { rootId: string; appliedAt: string; bots: number; status: InstallationStatus };
  /** True for the template this workspace is bound to (`workspace-binding.json`). */
  bound?: boolean;
}

export function summarize(
  storage: Storage,
  template: CompanyTemplate,
  installation: TemplateInstallation | null,
  roster: ReadonlyArray<Bot>,
): TemplateSummary {
  return {
    id: template.id as TemplateId,
    name: template.name,
    description: template.description ?? "",
    version: template.version,
    notes: template.notes.length,
    folders: template.folders.length,
    agents: template.bots.map((bot) => ({ slug: bot.slug, name: bot.name, title: bot.title })),
    ...(installation
      ? {
          installed: {
            rootId: installation.rootId,
            appliedAt: installation.appliedAt,
            // What is actually in the roster, not what was created: an agent
            // the person deleted is not counted back.
            bots: Object.values(installation.bots).filter((botId) => roster.some((bot) => bot.id === botId)).length,
            status: installationStatus(storage, installation),
          },
        }
      : {}),
  };
}

// ── the binding ──────────────────────────────────────────────────────────

export const BINDING_FILE = "workspace-binding.json";

/** The one template/vault pair a local workspace works in. */
export interface WorkspaceBinding {
  version: 1;
  templateId: TemplateId;
  /** `vault:<templateId>` for a managed vault this app made, `brain` for the
   * legacy second brain, `agency` for the vault of an older agency
   * installation, or the id of a writable shared folder (`acc_…`). */
  rootId: string;
  label: string;
  /** Absolute. For a managed vault: `<runtime root>/vaults/<templateId>`. */
  path: string;
  boundAt: string;
}

/** What `GET /api/local/workspace-template` answers. */
export interface WorkspaceTemplateProjection {
  binding: null | { templateId: TemplateId; rootId: string; label: string; path: string };
  templates: Array<{ id: TemplateId; name: string; description: string }>;
  vaults: Array<{ rootId: string; label: string; path: string; writable: boolean }>;
  canBind: boolean;
}

function bindingCorrupt(what: string): BrainError {
  return new BrainError(
    `${BINDING_FILE} is damaged (${what}) — nothing was changed. Repair or move that file before using templates.`,
  );
}

/** The binding, read strictly: a damaged file is an error, never "unbound"
 * (unbound would let a second template be installed beside the first). */
export function readWorkspaceBinding(storage: Storage): WorkspaceBinding | null {
  const path = join(storage.layout.root, BINDING_FILE);
  refuseSymlink(path, BINDING_FILE);
  let raw: unknown;
  try {
    raw = storage.readJsonStrict<unknown>(BINDING_FILE, null);
  } catch {
    throw bindingCorrupt("unreadable");
  }
  if (raw === null) return null;
  if (!isRecord(raw) || raw.version !== 1) throw bindingCorrupt("shape");
  if (!isTemplateId(raw.templateId)) throw bindingCorrupt("unknown template");
  if (typeof raw.rootId !== "string" || !raw.rootId || raw.rootId === "new" || raw.rootId === "workspaces") throw bindingCorrupt("root");
  if (typeof raw.path !== "string" || !isAbsolute(raw.path)) throw bindingCorrupt("path");
  if (typeof raw.label !== "string" || typeof raw.boundAt !== "string") throw bindingCorrupt("shape");
  // A managed root names its canonical folder and no other.
  if (raw.rootId.startsWith("vault:")) {
    if (raw.rootId !== vaultRootId(raw.templateId) || raw.path !== join(storage.layout.root, vaultPathOf(raw.templateId))) {
      throw bindingCorrupt("managed vault path");
    }
  }
  return { version: 1, templateId: raw.templateId, rootId: raw.rootId, label: raw.label, path: raw.path, boundAt: raw.boundAt };
}

/**
 * Writes the binding, exclusively: the file is created or nothing is, so two
 * processes binding at once cannot both believe they won. `false` says the
 * file was already there — the caller re-reads it and compares.
 */
export function writeWorkspaceBinding(storage: Storage, binding: WorkspaceBinding): boolean {
  const path = join(storage.layout.root, BINDING_FILE);
  refuseSymlink(path, BINDING_FILE);
  try {
    writeFileSync(path, `${JSON.stringify(binding, null, 2)}\n`, { mode: FILE_MODE, flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export function hasWorkspaceBinding(storage: Storage): boolean {
  return existsSync(join(storage.layout.root, BINDING_FILE));
}

/** The refusal every route answers once the workspace is bound elsewhere. */
export function bindingConflict(binding: WorkspaceBinding, templateId: string, rootId?: string): BrainError {
  const template = isTemplateId(binding.templateId) ? templateOf(binding.templateId).name : binding.templateId;
  return new BrainError(
    rootId && templateId === binding.templateId
      ? `this workspace is bound to ${template} in ${binding.label} (${binding.rootId}); it cannot be moved to ${rootId}`
      : `this workspace is bound to ${template} (${binding.rootId}); another template cannot be installed beside it`,
    "exists",
  );
}
