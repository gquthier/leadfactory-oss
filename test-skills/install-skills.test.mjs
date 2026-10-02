import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installSkills, listSkills, SKILLS_ROOT } from '../scripts/install-skills.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-skills.mjs');
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'lf-skills-'));
// Les 21 skills adaptés du dépôt amont. D'autres skills peuvent coexister dans skills/ (écrits par d'autres).
const UPSTREAM = ['campaign-proposal','client-onboarding-flow','cold-call-expert','cold-traffic-landing-page','competitor-ads-research','creative-brief','creative-statics','creative-statics-v2','data-scraping','deep-search','devis-vercel-generator','meta-ads-copywriter','meta-ads-creative-framework','meta-campaign-launcher','meta-lead-notifications','outbound-sequence-writer','rework-campaign','sales-call-analyzer','sales-follow-up-sequence','vsl-copywriter','vsl-end-to-end-builder'];

test('21 skills, frontmatter name unique et égal au dossier', async () => {
  const skills = await listSkills(SKILLS_ROOT);
  assert.ok(skills.length >= 21);
  const names = skills.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'noms de skills non uniques');
  for (const n of UPSTREAM) assert.ok(names.includes(n), `skill amont manquant : ${n}`);
  for (const s of skills) assert.equal(s.name, s.dir);
  for (const s of skills.filter((x) => UPSTREAM.includes(x.dir))) {
    const text = await fs.readFile(path.join(s.path, 'SKILL.md'), 'utf8');
    assert.match(text, /^---\r?\n[\s\S]*?\ndescription:\s*\S/, `${s.dir} : description manquante`);
  }
});

test('installe tous les skills dans un tmpdir (copie des dossiers seulement)', async () => {
  const target = await tmp();
  const res = await installSkills({ target });
  const all = await listSkills(SKILLS_ROOT);
  assert.equal(res.installed.length, all.length);
  for (const n of UPSTREAM) assert.ok(res.installed.includes(n));
  assert.equal((await fs.readdir(target)).length, all.length);
  for (const s of all) {
    const copied = await fs.readFile(path.join(target, s.dir, 'SKILL.md'), 'utf8');
    const original = await fs.readFile(path.join(s.path, 'SKILL.md'), 'utf8');
    assert.equal(copied, original);
  }
});

test('refuse une collision avant toute écriture, sans écraser', async () => {
  const target = await tmp();
  const skills = await listSkills(SKILLS_ROOT);
  const existing = path.join(target, skills[3].dir);
  await fs.mkdir(existing, { recursive: true });
  await fs.writeFile(path.join(existing, 'SKILL.md'), 'contenu utilisateur');
  await assert.rejects(installSkills({ target }), /collision/);
  assert.equal(await fs.readFile(path.join(existing, 'SKILL.md'), 'utf8'), 'contenu utilisateur');
  const entries = await fs.readdir(target);
  assert.deepEqual(entries, [skills[3].dir], 'aucun autre dossier ne doit avoir été écrit');
});

test('--only installe un sous-ensemble ; CLI retourne un code non nul sur collision', async () => {
  const target = await tmp();
  const out = execFileSync('node', [SCRIPT, '--target', target, '--only', 'creative-brief,deep-search'], { encoding: 'utf8' });
  assert.match(out, /2 skill\(s\)/);
  assert.deepEqual((await fs.readdir(target)).sort(), ['creative-brief', 'deep-search']);
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--target', target, '--only', 'deep-search'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});

test('aucun chemin utilisateur ni secret historique dans les skills', async () => {
  const bad = /\/Users\/|~\/skills|service_role|xoxb-|supabase/i;
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else assert.doesNotMatch(await fs.readFile(p, 'utf8'), bad, `motif interdit dans ${p}`);
    }
  }
  for (const n of UPSTREAM) await walk(path.join(SKILLS_ROOT, n));
});
