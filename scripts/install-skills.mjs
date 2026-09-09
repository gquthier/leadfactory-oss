#!/usr/bin/env node
// Installe les dossiers de skills de ./skills vers un dossier cible (Codex, Claude Code, autre agent).
// Zéro dépendance. Refuse toute collision avant d'écrire quoi que ce soit. Ne modifie aucune config globale.
//
//   node scripts/install-skills.mjs --target <dossier> [--pack agency|ecommerce] [--only a,b] [--dry-run]
//
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_ROOT = path.resolve(HERE, '..', 'skills');

function parseArgs(argv) {
  const out = { target: null, only: null, dryRun: false, help: false, pack: "agency" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a.startsWith('--target=')) out.target = a.slice('--target='.length);
    else if (a === '--pack') out.pack = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`option inconnue : ${a}`);
  }
  if (!["agency", "ecommerce"].includes(out.pack)) throw new Error("--pack doit être agency ou ecommerce");
  if (out.only) out.only = out.only.split(',').map((s) => s.trim()).filter(Boolean);
  return out;
}

export function parseFrontmatterName(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => /^name:\s*/.test(l));
  return line ? line.replace(/^name:\s*/, '').trim().replace(/^["']|["']$/g, '') : null;
}

export async function listSkills(root = SKILLS_ROOT) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue;
    const skillFile = path.join(root, e.name, 'SKILL.md');
    let text;
    try { text = await fs.readFile(skillFile, 'utf8'); } catch { continue; }
    skills.push({ dir: e.name, path: path.join(root, e.name), name: parseFrontmatterName(text) });
  }
  return skills;
}

async function exists(p) {
  try { await fs.lstat(p); return true; } catch { return false; }
}

export async function installSkills({ target, only = null, dryRun = false, root = SKILLS_ROOT, log = () => {} }) {
  if (!target) throw new Error('--target <dossier> est obligatoire');
  const targetAbs = path.resolve(target);
  let skills = await listSkills(root);
  if (only) {
    const missing = only.filter((n) => !skills.some((s) => s.dir === n));
    if (missing.length) throw new Error(`skills inconnus : ${missing.join(', ')}`);
    skills = skills.filter((s) => only.includes(s.dir));
  }
  if (!skills.length) throw new Error(`aucun skill trouvé dans ${root}`);

  // Contrôles avant toute écriture : noms uniques, collisions.
  const seen = new Map();
  for (const s of skills) {
    if (!s.name) throw new Error(`${s.dir}/SKILL.md : frontmatter sans "name"`);
    if (s.name !== s.dir) throw new Error(`${s.dir}/SKILL.md : name "${s.name}" différent du dossier`);
    if (seen.has(s.name)) throw new Error(`nom de skill dupliqué : ${s.name}`);
    seen.set(s.name, s.dir);
  }
  const collisions = [];
  for (const s of skills) if (await exists(path.join(targetAbs, s.dir))) collisions.push(s.dir);
  if (collisions.length) {
    throw new Error(`collision : déjà présent dans ${targetAbs} → ${collisions.join(', ')}. Rien n'a été écrit. Supprimez ou renommez ces dossiers, ou utilisez --only pour en exclure.`);
  }

  if (dryRun) { for (const s of skills) log(`(dry-run) ${s.dir} → ${path.join(targetAbs, s.dir)}`); return { installed: [], target: targetAbs }; }

  await fs.mkdir(targetAbs, { recursive: true });
  const installed = [];
  for (const s of skills) {
    await fs.cp(s.path, path.join(targetAbs, s.dir), { recursive: true, errorOnExist: true, force: false });
    installed.push(s.dir);
    log(`+ ${s.dir}`);
  }
  return { installed, target: targetAbs };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.target) {
      console.log('Usage : node scripts/install-skills.mjs --target <dossier> [--pack agency|ecommerce] [--only a,b] [--dry-run]');
      process.exit(args.help ? 0 : 2);
    }
    const root = args.pack === "ecommerce" ? path.resolve(HERE, "..", "ecommerce", "skills") : SKILLS_ROOT;
    const res = await installSkills({ ...args, root, log: console.log });
    if (!args.dryRun) console.log(`${res.installed.length} skill(s) installé(s) dans ${res.target}. Relancez votre agent pour les charger.`);
  } catch (err) {
    console.error(`Erreur : ${err.message}`);
    process.exit(1);
  }
}
