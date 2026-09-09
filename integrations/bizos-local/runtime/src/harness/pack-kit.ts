// The embedded kits — what `scripts/sync-agency-kit.mjs` stages under
// `agency-kit/` (beside `harness/` in both `src` and `dist`): the LeadFactory
// cockpit at the kit root, and the e-commerce cockpit under `ecommerce/`.
//
// A kit is plain files shipped verbatim (MIT): a `createApp` module, a public
// folder, a template in `CompanyTemplate` form, skills (`SKILL.md` plus
// `references/`) and vault notes. This module reads them — strictly, with
// every path vetted and no symlink followed — and nothing here writes.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompanyTemplate, TemplateBot } from "./company-os.js";

/** The staged kit, resolved from this module's own location, never from a machine path. */
export const DEFAULT_KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "agency-kit");

export const MAX_DOCUMENT_CHARS = 60_000;

export class PackError extends Error {
  constructor(message: string, readonly code: string = "pack_error", readonly status = 400) {
    super(message);
    this.name = "PackError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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
    throw new PackError(`invalid path ${JSON.stringify(path)}`, "invalid_path");
  }
  return segments;
}

function templateBot(raw: unknown): TemplateBot {
  if (!isRecord(raw)) throw new PackError("template bot is not an object", "invalid_template");
  const string = (key: string, required = true): string => {
    const value = raw[key];
    if (typeof value !== "string" || (required && !value.trim())) {
      if (required) throw new PackError(`template bot lacks ${key}`, "invalid_template");
      return "";
    }
    return value;
  };
  const slug = string("slug");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new PackError(`template bot slug ${slug} is invalid`, "invalid_template");
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

/** A `CompanyTemplate` out of a kit's JSON. Routines are never taken from a
 * kit: nothing scheduled comes from a file. */
export function parseTemplate(raw: unknown): CompanyTemplate {
  if (!isRecord(raw)) throw new PackError("template is not an object", "invalid_template");
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id)) throw new PackError("template id is invalid", "invalid_template");
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new PackError("template name is missing", "invalid_template");
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) throw new PackError("template version is invalid", "invalid_template");
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  const bots = Array.isArray(raw.bots) ? raw.bots : [];
  for (const folder of folders) {
    if (typeof folder !== "string") throw new PackError("template folder is not a string", "invalid_template");
    vaultSegments(folder);
  }
  const parsedNotes = notes.map((note) => {
    if (!isRecord(note) || typeof note.path !== "string" || typeof note.text !== "string") {
      throw new PackError("template note is malformed", "invalid_template");
    }
    vaultSegments(note.path);
    return { path: note.path, text: note.text };
  });
  const parsedBots = bots.map(templateBot);
  const slugs = new Set(parsedBots.map((bot) => bot.slug));
  if (slugs.size !== parsedBots.length) throw new PackError("template bot slugs collide", "invalid_template");
  return {
    id: raw.id,
    version: raw.version,
    name: raw.name,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    folders: folders as string[],
    notes: parsedNotes,
    bots: parsedBots,
    ...(isRecord(raw.team) && typeof raw.team.name === "string" ? { team: { name: raw.team.name } } : {}),
    routines: [],
  };
}

// ── skills ───────────────────────────────────────────────────────────────

export interface SkillSummary {
  name: string;
  description: string;
  references: string[];
}

/** `description:` out of a SKILL.md front matter, one line, bounded. */
function skillDescription(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return "";
  const line = match[1]!.split(/\r?\n/).find((row) => row.startsWith("description:"));
  return line ? line.slice("description:".length).trim().replace(/^["']|["']$/g, "").slice(0, 600) : "";
}

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const REFERENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export function regularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function regularDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every `skills/<name>/SKILL.md` of a kit, with its regular reference
 * files; a symlinked skill or reference is simply not there. */
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

// ── the kit ──────────────────────────────────────────────────────────────

export interface PackKit {
  root: string;
  template: CompanyTemplate;
  skills: SkillSummary[];
}

/** Reads one kit: its template file (a `CompanyTemplate` JSON) and its skills. */
export function loadKit(kitRoot: string, templateFile: string, what: string): PackKit {
  const templatePath = join(kitRoot, templateFile);
  if (!regularFile(templatePath)) throw new PackError(`the ${what} kit is not embedded in this build`, "kit_missing", 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(templatePath, "utf8"));
  } catch (error) {
    throw new PackError(`the ${what} template is unreadable: ${error instanceof Error ? error.message : String(error)}`, "invalid_template", 503);
  }
  const template = parseTemplate(parsed);
  const skills = scanSkills(kitRoot);
  const notes = [...template.notes];
  const paths = new Set(notes.map(note => note.path));
  const folders = new Set(template.folders);
  for (const license of ["LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM-LICENSE.txt"]) {
    if (!regularFile(join(kitRoot, license))) continue;
    const path = `skills/${license === "LICENSE" ? "LICENSE.txt" : license}`;
    if (!paths.has(path)) { notes.push({ path, text: readFileSync(join(kitRoot, license), "utf8") }); paths.add(path); }
    folders.add("skills");
  }
  for (const skill of skills) {
    const relativeFiles = [`skills/${skill.name}/SKILL.md`, ...skill.references.map(name => `skills/${skill.name}/references/${name}`)];
    for (const license of ["LICENSE", "LICENSE.txt", "LICENSE.md"]) {
      if (regularFile(join(kitRoot, "skills", skill.name, license))) relativeFiles.push(`skills/${skill.name}/${license}`);
    }
    for (const path of relativeFiles) {
      if (paths.has(path)) continue;
      const file = resolveInside(kitRoot, vaultSegments(path)).absolute;
      notes.push({ path, text: readFileSync(file, "utf8") });
      paths.add(path);
      folders.add(path.slice(0, path.lastIndexOf("/")));
    }
  }
  return { root: kitRoot, template: { ...template, notes, folders: [...folders] }, skills };
}

export function kitPresent(kitRoot: string, templateFile: string): boolean {
  return existsSync(join(kitRoot, templateFile));
}

/**
 * A file strictly inside `root`: every segment vetted, no symlink anywhere on
 * the way (the real path must still start with the root's real path), and a
 * regular file at the end. Directories are allowed when `directory` is set.
 */
export function resolveInside(root: string, segments: string[], options: { directory?: boolean } = {}): { absolute: string; kind: "file" | "directory" } {
  let part = root;
  for (const segment of ["", ...segments]) {
    if (segment) part = join(part, segment);
    try {
      if (lstatSync(part).isSymbolicLink()) throw new PackError("links are not readable through this tool", "invalid_path", 403);
    } catch (error) {
      if (error instanceof PackError) throw error;
      throw new PackError(`not found: ${segments.join("/")}`, "not_found", 404);
    }
  }
  const absolute = join(root, ...segments);
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    throw new PackError(`not found: ${segments.join("/")}`, "not_found", 404);
  }
  if (stats.isSymbolicLink()) throw new PackError(`refused: ${segments.join("/")} is a link`, "invalid_path", 403);
  const realRoot = realpathSync(root);
  const real = realpathSync(absolute);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new PackError(`refused: ${segments.join("/")} leaves the folder`, "invalid_path", 403);
  }
  if (stats.isDirectory()) {
    if (!options.directory) throw new PackError(`${segments.join("/")} is a folder`, "invalid_path");
    return { absolute, kind: "directory" };
  }
  if (!stats.isFile()) throw new PackError(`refused: ${segments.join("/")}`, "invalid_path", 403);
  return { absolute, kind: "file" };
}

export function readBounded(path: string): { text: string; truncated: boolean } {
  const text = readFileSync(path, "utf8");
  return text.length > MAX_DOCUMENT_CHARS
    ? { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true }
    : { text, truncated: false };
}
