// The template catalogue and its registry — what Apps → Second brain offers
// under "Templates", and what remembers which ones were created.
//
// A template (`company-os.ts`: notes, agents, an optional team) is applied
// into a MANAGED VAULT of its own, `<stateRoot>/vaults/<templateId>/`, never
// into a folder that already holds something. The person's existing brain,
// its notes and their roster are never touched: a template adds a vault, its
// agents and their first words, and that is all. The catalogue is built in as
// flat TypeScript modules so the packaged app ships it; nothing on disk can
// add an id. New companies see three ordered choices while two legacy ids
// remain readable so existing workspaces keep opening unchanged.
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
import { COMPANY_OS, segmentsOf, TEMPLATE_FILE, type CompanyTemplate, type TemplateBot, type TemplateState, type VaultSeed } from "./company-os.js";
import { FILE_MODE, type Storage } from "./storage.js";
import { ECOMMERCE_FALLBACK, ecommerceTemplate } from "./template-ecommerce.js";
import { LEAD_GEN_AGENCY } from "./template-lead-gen-agency.js";
import { SERVICE_BASED_BUSINESS } from "./template-service-based-business.js";
import { SOFTWARE } from "./template-software.js";
import type { Bot } from "./types.js";
import { DEFAULT_KIT_ROOT, kitPresent, loadKit } from "./pack-kit.js";

/** Every id this runtime must continue to understand on disk. Company OS and
 * E-commerce are legacy creation choices: existing bindings/installations
 * still open unchanged, but a new company is offered only the three ids in
 * `CREATION_TEMPLATE_IDS`. `TEMPLATE_IDS` remains the known-id alias for old
 * imports that use it as a registry/workspace whitelist. */
export const KNOWN_TEMPLATE_IDS = ["company-os", "lead-gen-agency", "ecommerce", "service-based-business", "software"] as const;
export const TEMPLATE_IDS = KNOWN_TEMPLATE_IDS;
export type TemplateId = (typeof KNOWN_TEMPLATE_IDS)[number];

/** The exact, ordered choices for creating a new company. */
export const CREATION_TEMPLATE_IDS = ["lead-gen-agency", "service-based-business", "software"] as const;
export type CreationTemplateId = (typeof CREATION_TEMPLATE_IDS)[number];

/** Marks the new-company layout introduced for on-demand teams. Journals
 * written before this marker deliberately keep the roster semantics they
 * started with, even though the catalogue now bootstraps only a CEO. */
export const CEO_ON_DEMAND_CREATION = "ceo-on-demand-v1" as const;
export type TemplateCreationMode = typeof CEO_ON_DEMAND_CREATION;

function isCreationTemplateId(id: string): id is CreationTemplateId {
  return (CREATION_TEMPLATE_IDS as readonly string[]).includes(id);
}

/** Creation-only adaptation. Legacy payloads and journals retain their exact
 * original semantics; archived role sources remain available in source.md. */
export function creationTemplateOf(source: CompanyTemplate): CompanyTemplate {
  if (!isCreationTemplateId(source.id)) return source;
  const director = source.bots[0];
  if (!director) throw new BrainError(`${source.name} has no CEO role`);
  const specialists = source.bots.slice(1);
  const delegation = "From the CEO DM, use recruit_agent with role_slug and a bounded initial_task to create or reuse a specialist and dispatch real work. A team group appears on the first recruitment. An @Name handoff works only inside an existing group containing that agent. Check the actual tool result; a role file or inbox memo never executes work.";
  const bootstrap = "Only CEO is active at bootstrap, with one direct conversation and no team group. Specialist roles are saved under Roles/ and are recruited only when an authorized mission needs them.";
  const adapt = (text: string): string => {
    let result = text
      .replaceAll("A direct chat cannot silently hand work to the preinstalled group; tell the user to open the team chat when collaboration is needed.", delegation)
      .replaceAll("A direct message has no automatic route into the preinstalled team.", delegation)
      .replaceAll("There is no native send from a CEO or director DM into an existing group. Direct the user to the team chat instead of pretending the handoff ran.", delegation)
      .replaceAll("The six roster entries are persistent executable agents created by the installer, not characters described by Markdown.", bootstrap)
      .replaceAll("This vault installs eleven persistent software-company agents, their team group specification, reusable processes and an offline-safe state helper.", "This vault starts with CEO alone, ten dormant specialist roles, reusable processes and an offline-safe state helper.")
      .replaceAll("Verify the eleven persistent agents and the Software team group exist in runtime state.", "Verify that only CEO and its direct conversation exist at bootstrap; after recruitment, verify only the specialists and group actually returned by the runtime.")
      .replaceAll("A DM does not dispatch work to another agent.", delegation)
      .replaceAll("A DM does not dispatch another agent.", delegation)
      .replaceAll("DMs do not dispatch.", delegation)
      .replaceAll("A direct agent chat cannot dispatch another agent.", delegation)
      .replaceAll("Coordinate a teammate only in a team chat that contains both agents.", delegation)
      .replaceAll("Service Business Team", "current team")
      .replaceAll("persisted @Name handoff only in the Software team group", "recruit_agent with initial_task from a DM, or persisted @Name handoff in an existing team group")
      .replaceAll("Software team group", "current team group");
    if (director.name !== "CEO") result = result.replaceAll(director.name, "CEO");
    for (const role of specialists) {
      result = result.replaceAll(`Agents/${role.name}/${role.name}.md`, `Roles/${role.slug}/system.md`);
      result = result.replaceAll(`Agents/${role.name}/AGENTS.md`, `Roles/${role.slug}/system.md`);
    }
    return result;
  };
  const roleNotes = (role: TemplateBot): string => source.notes
    .filter((note) => note.path.startsWith(`Agents/${role.name}/`))
    .map((note) => `## Retained context: ${note.path}\n\n${note.text.trim()}`)
    .join("\n\n");
  const originalTeam = source.notes.find((note) => note.path === "Agents/TEAM.md")?.text ?? source.notes.find((note) => note.path === "Team.md")?.text;
  const customRoleIndex = originalTeam?.indexOf("## Recruitable specialists") ?? -1;
  const customRoleLibrary = customRoleIndex >= 0 ? originalTeam!.slice(customRoleIndex) : "";
  const catalog = [
    "# Available specialist roles", "", bootstrap,
    "Choose the closest blueprint for the authorized mission. A role definition is not an active agent. Use a custom bounded role only when no blueprint fits.", "",
    "| role_slug | Role | Responsibility | Prompt |", "|---|---|---|---|",
    ...specialists.map((role) => `| ${role.slug} | ${role.name} | ${role.description.replaceAll("|", "\\|")} | Roles/${role.slug}/system.md |`),
    "", delegation, "",
    "Codex and Claude receive these tools when exposed by the runtime. Cursor has no injected recruitment tools. Use the company's connected plan and current runtime permissions; recruitment does not grant new access, spending or publication authority.",
    "Supply a description, bounded context and initial_task. A profile photo is optional raster image data, not a generated-image promise. Report started only when a real run ID is returned; otherwise report the recorded failure or queued state.",
    "Original source prompts are archived in each source.md for reference; system.md is the current executable role context. Preserve owner edits.", "",
    customRoleLibrary,
  ].join("\n");
  const team = `# Team\n\n${bootstrap}\n\nThe owner sets the mission and authority in Company.md. CEO is the only default member. Inspect runtime state for the current roster; this file is not a live membership database.\n\n${delegation}\n\nRead Roles/README.md for the available role library. Give every task its objective, sources, permitted actions, output, acceptance evidence, budget and stop condition. Respect the runtime's chain and STOP limits. No routine is active on installation.\n`;
  const notes = source.notes
    .filter((note) => !note.path.startsWith("Agents/") && note.path !== "Team.md")
    .map((note) => ({ ...note, text: adapt(note.text) }));
  const rootAgent = notes.find((note) => note.path === "AGENTS.md");
  if (rootAgent) rootAgent.text = `${bootstrap}\n\n${delegation}\n\n${rootAgent.text}`;
  const directorPrefix = `Agents/${director.name}/`;
  for (const note of source.notes.filter((candidate) => candidate.path.startsWith(directorPrefix))) {
    const filename = note.path.slice(directorPrefix.length).replaceAll(director.name, "CEO");
    notes.push({ path: `Agents/CEO/${filename}`, text: adapt(note.text) });
  }
  notes.push({ path: "Team.md", text: team });
  notes.push({ path: "Agents/TEAM.md", text: team });
  notes.push({ path: "Roles/README.md", text: catalog });
  if (originalTeam) notes.push({ path: "Roles/source.md", text: originalTeam });
  notes.push({ path: "Agents/CEO/source.md", text: `${director.instructions.trim()}\n\n${roleNotes(director)}\n` });
  notes.push({ path: "Agents/CEO/system.md", text: `${bootstrap}\n\n${delegation}\n\n${adapt(director.instructions.trim())}\n\n${adapt(roleNotes(director))}\n` });
  for (const role of specialists) {
    const fullSource = `${role.instructions.trim()}${roleNotes(role) ? `\n\n${roleNotes(role)}` : ""}\n`;
    notes.push({
      path: `Roles/${role.slug}/role.json`,
      text: `${JSON.stringify({ version: 1, templateId: source.id, slug: role.slug, name: role.name, title: role.title, description: role.description }, null, 2)}\n`,
    });
    notes.push({ path: `Roles/${role.slug}/source.md`, text: fullSource });
    const rolePath = `../../Roles/${role.slug}/system.md`;
    const executable = adapt(fullSource)
      .replaceAll(`then \`${role.name}.md\``, `then \`${rolePath}\``)
      .replaceAll(`then ${role.name}.md`, `then ${rolePath}`)
      .replaceAll("then your named role sheet", `then ${rolePath}`)
      .replaceAll("then your role sheet", `then ${rolePath}`);
    notes.push({ path: `Roles/${role.slug}/system.md`, text: executable });
  }
  const ceo: TemplateBot = {
    ...director, slug: "ceo", name: "CEO",
    title: director.slug === "ceo" ? director.title : "Chief executive and owner interface",
    description: `The company's only active bootstrap agent. ${director.description}`.slice(0, 600),
    // Keep the runtime entry compact and below the persisted instruction limit.
    // The complete company-specific role lives in a normal external file.
    instructions: [
      "You are CEO. " + bootstrap, delegation,
      "Before working, read system.md in your working folder (Agents/CEO), ../../AGENTS.md and ../../Roles/README.md. system.md contains your full company-specific role; source.md is a legacy archive, not current operating instructions.",
      "Recruit only when useful for an already-authorized mission, with the closest role_slug, concrete initial_task and needed context. That operational delegation needs no second ceremonial approval. It grants no new files, spending, publishing or external-action authority. Inspect tool results and actual run status before claiming that work started or finished.",
      "The runtime manifest is authoritative. Use the user's connected plan and existing permission settings. Do not invent tools, teammates, photo generation, messages or outcomes. Unknown facts stay TODO; preserve owner files and verify deliverables.",
    ].join("\n\n"),
    pinned: true,
    welcome: "Bonjour, je suis le CEO de votre nouvelle entreprise. Dites-moi le premier résultat que vous voulez : je m’y mets directement et je recrute un spécialiste seulement si c’est utile. Rien n’est encore lancé.",
  };
  return {
    ...source,
    description: `Start with CEO and a shared second brain. Recruit ${specialists.length} available specialist roles only when needed.`,
    folders: [...source.folders.filter((folder) => !folder.startsWith("Agents/")), "Agents/CEO", "Roles", ...specialists.map((role) => `Roles/${role.slug}`)],
    notes, bots: [ceo], team: undefined,
  };
}

/** Built-in packs. E-commerce is read from the embedded kit
 * (`agency-kit/ecommerce/template.json`) when staged, or its shipped fallback
 * when not. Lead Gen likewise prefers the staged kit. Resolved per call so a
 * kit staged after boot is seen; kit reads are cached by their modules. */
export function templateOf(id: TemplateId): CompanyTemplate {
  switch (id) {
    case "company-os":
      return COMPANY_OS;
    case "lead-gen-agency": {
      const file = "templates/lead-gen-agency.company-template.json";
      const template = kitPresent(DEFAULT_KIT_ROOT, file) ? loadKit(DEFAULT_KIT_ROOT, file, "agency").template : LEAD_GEN_AGENCY;
      return { ...template, description: template.description || LEAD_GEN_AGENCY.description, team: template.team ?? { name: "LeadFactory Agency" } };
    }
    case "ecommerce":
      return ecommerceTemplate();
    case "service-based-business":
      return SERVICE_BASED_BUSINESS;
    case "software":
      return SOFTWARE;
    default:
      throw new BrainError(`template ${JSON.stringify(id)} is not in the catalogue`, "not_found");
  }
}

/** The catalogue as a record — the fallback e-commerce pack, for callers
 * that want a static shape (tests, summaries). Prefer `templateOf`. */
export const TEMPLATE_CATALOG: Readonly<Record<TemplateId, CompanyTemplate>> = {
  "company-os": COMPANY_OS,
  "lead-gen-agency": LEAD_GEN_AGENCY,
  ecommerce: ECOMMERCE_FALLBACK,
  "service-based-business": SERVICE_BASED_BUSINESS,
  software: SOFTWARE,
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (KNOWN_TEMPLATE_IDS as readonly string[]).includes(value);
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
  /** Present only for new one-CEO installations. Absence is legacy and must
   * keep the original full-roster semantics. */
  creationMode?: TemplateCreationMode;
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
  creationMode?: TemplateCreationMode;
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
    || (raw.creationMode !== undefined && raw.creationMode !== CEO_ON_DEMAND_CREATION)
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
    ...(raw.creationMode === CEO_ON_DEMAND_CREATION ? { creationMode: CEO_ON_DEMAND_CREATION } : {}),
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
      (!isRecord(group) || typeof group.id !== "string" || !group.id || typeof group.created !== "boolean")) ||
    (raw.creationMode !== undefined && raw.creationMode !== CEO_ON_DEMAND_CREATION)
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
    ...(raw.creationMode === CEO_ON_DEMAND_CREATION ? { creationMode: CEO_ON_DEMAND_CREATION } : {}),
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
  /** Dormant role library for on-demand creation; never roster members. */
  availableRoles?: Array<{ slug: string; name: string; title: string }>;
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
  const creation = isCreationTemplateId(template.id) ? creationTemplateOf(template) : template;
  const payload = installation && !installation.creationMode ? template : creation;
  return {
    id: template.id as TemplateId,
    name: template.name,
    description: payload.description ?? "",
    version: template.version,
    notes: payload.notes.length,
    folders: payload.folders.length,
    agents: payload.bots
      .map((bot) => ({ slug: bot.slug, name: bot.name, title: bot.title })),
    ...(isCreationTemplateId(template.id)
      ? { availableRoles: template.bots.slice(1).map((bot) => ({ slug: bot.slug, name: bot.name, title: bot.title })) }
      : {}),
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
