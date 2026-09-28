#!/usr/bin/env node
// Source-only release export. Exact reviewed allowlist; no live vault or profile input.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUNTIME = 'integrations/bizos-local/runtime';
export const EXPORT_IDS = ['company-os', 'ecommerce', 'lead-gen-agency', 'service-based-business', 'software'];
const PACK_IDS = ['lead-gen-agency', 'ecommerce'];
const GENERATED_IGNORES = new Set(PACK_IDS.map(id => `${id}/cockpit/.gitignore`));
const LICENSE_FILES = [
  ['LICENSE', `${RUNTIME}/LICENSE`], ['NOTICE', `${RUNTIME}/NOTICE`],
  ['licenses/openmausbot-Apache-2.0.txt', `${RUNTIME}/LICENSES/openmausbot-Apache-2.0.txt`],
  ['licenses/rakazo-Apache-2.0.txt', `${RUNTIME}/LICENSES/rakazo-Apache-2.0.txt`],
  ['licenses/leadfactory-MIT.txt', 'LICENSE'],
  ['licenses/skills-UPSTREAM-LICENSE.txt', 'UPSTREAM-LICENSE.txt'],
  ['licenses/skills-THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
];
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = content => createHash('sha256').update(content).digest('hex');

export function safeExportPath(path) {
  if (typeof path !== 'string' || !path || /[\\\0:\r\n]/.test(path) || path.split('/').some(segment =>
    !segment || segment.startsWith('.') || /^(?:data|node_modules|dist|build|coverage|credentials?(?:\.json)?|connections\.json)$/i.test(segment)
    || /\.(?:pem|key|log)$/i.test(segment))) throw new Error(`unsafe export path: ${String(path)}`);
  return path;
}

function sourceFile(root, path) {
  safeExportPath(path);
  let current = root;
  if (lstatSync(current).isSymbolicLink()) throw new Error('refusing source root symlink');
  for (const segment of path.split('/')) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`refusing symlink: ${path}`);
  }
  if (!lstatSync(current).isFile()) throw new Error(`not a source file: ${path}`);
  return readFileSync(current);
}

/** Build and validate all bytes before touching an output directory. The CLI
 * supplies templateOf/creationTemplateOf from a fresh local runtime build. */
export function buildExport({ sourceRoot, templates, creationIds, creationTemplateOf, allowlist, sourceRevision = null, sourceDirty = false }) {
  if (sourceRevision !== null && !/^[0-9a-f]{40,64}$/.test(sourceRevision)) throw new Error('invalid source revision');
  const actualIds = templates.map(template => template.id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(EXPORT_IDS)) throw new Error('export requires the five known template IDs');
  if (!Array.isArray(creationIds) || creationIds.some(id => !EXPORT_IDS.includes(id))) throw new Error('invalid creation template IDs');
  if (allowlist?.version !== 1 || !allowlist.packs || Object.keys(allowlist.packs).sort().join() !== [...PACK_IDS].sort().join()) throw new Error('invalid export allowlist');
  const files = new Map();
  const add = (path, content, generatedIgnore = false) => {
    if (!generatedIgnore || !GENERATED_IGNORES.has(path)) safeExportPath(path);
    if (files.has(path)) throw new Error(`duplicate export path: ${path}`);
    if (typeof content !== 'string' && !Buffer.isBuffer(content)) throw new Error(`invalid file content: ${path}`);
    files.set(path, content);
  };
  const rows = [];
  for (const template of [...templates].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    const { id } = template;
    if (!Array.isArray(template.notes) || !Array.isArray(template.folders)) throw new Error(`invalid template: ${id}`);
    for (const folder of template.folders) safeExportPath(folder);
    const manifest = json(template);
    add(`${id}/template.json`, manifest);
    for (const note of template.notes) add(`${id}/vault/${safeExportPath(note.path)}`, note.text);
    const creationSupported = creationIds.includes(id);
    add(`${id}/README.md`, `# ${template.name}\n\nRuntime ID: \`${id}\`. Current native BizOS creation starts with CEO and its thread; specialist source roles remain available for recruitment on demand.\n\nUse the existing native BizOS template installer for an executable workspace, shared tools and agent threads. \`template.json\` is the resolved source manifest; \`vault/\` is its reusable source content. \`installation-template.json\` records the current creation transformation without personal context. Copying files alone does not create agents or activate tools.\n\n${PACK_IDS.includes(id) ? 'For the standalone local cockpit, open \`cockpit/\` and run \`npm start\` with Node.js 22+. It starts empty and requires no dependencies. Read \`cockpit/EXPORT.md\`.' : 'Start by reading the vault entrypoint and the declared role/process notes. Native operational scripts are under the paths declared by the manifest; they are local source tools, not an automatic runtime.'}\n\nRuntime-derived manifests/native scripts retain AGPL-3.0-only (\`LICENSE\`, \`NOTICE\`, \`licenses/\`). Agency/E-commerce source resources retain MIT and their embedded notices; see the export root \`SOURCE.md\` for exact source provenance and access. Keep client data and personal connections outside Git and reusable releases.\n`);
    let installation;
    if (creationSupported) {
      installation = creationTemplateOf(template);
      if (installation.id !== id) throw new Error(`installation template mismatch: ${id}`);
      for (const folder of installation.folders) safeExportPath(folder);
      const paths = new Set();
      for (const note of installation.notes) {
        safeExportPath(note.path);
        if (paths.has(note.path)) throw new Error(`duplicate installation note: ${note.path}`);
        paths.add(note.path);
      }
      add(`${id}/installation-template.json`, json(installation));
    }
    for (const [target, source] of LICENSE_FILES) add(`${id}/${target}`, sourceFile(sourceRoot, source));
    if (PACK_IDS.includes(id)) {
      const paths = allowlist.packs[id];
      if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string')) throw new Error(`invalid allowlist for ${id}`);
      for (const source of [...paths].sort()) add(`${id}/cockpit/${source}`, sourceFile(sourceRoot, source));
      // Keep the two original layouts: E-commerce imports the shared ../../lib.
      // Tests/build scripts are not shipped as broken npm commands in this source export.
      add(`${id}/cockpit/package.json`, json({ name: `bizos-template-${id}`, version: '1.0.0', private: true, type: 'module', license: 'MIT', engines: { node: '>=22' }, scripts: { start: `node ${id === 'ecommerce' ? 'ecommerce/' : ''}server.mjs` } }));
      add(`${id}/cockpit/.gitignore`, 'data/\n.env\n.env.*\nnode_modules/\n*.log\n*.local.json\n.DS_Store\nexports/\n', true);
      add(`${id}/cockpit/EXPORT.md`, `# Portable ${template.name} cockpit\n\nRun \`npm start\` here with Node.js 22+. No dependencies are required. The database starts empty; no account or routine is enabled. The source layout is preserved, including E-commerce's shared helpers. Private data created while using this copy must never be committed or added to a template release.\n\nOnly reviewed source files are included. For the complete development/test workspace, see the private source repository. Cockpit and original pack resources are MIT with their supplied notices. Runtime-derived manifests outside this folder retain AGPL-3.0-only.\n`);
    }
    rows.push({ id, name: template.name, version: template.version, creationSupported, cockpit: PACK_IDS.includes(id) ? `${id}/cockpit` : null, manifest: `${id}/template.json`, manifestSha256: hash(manifest), installationManifest: installation ? `${id}/installation-template.json` : null, license: 'AGPL-3.0-only; embedded MIT resources retain their notices' });
  }
  const sourceUrl = sourceRevision ? `https://github.com/gquthier/leadfactory-oss/tree/${sourceRevision}` : null;
  for (const path of allowlist.runtimeSources ?? []) add(`source/${path}`, sourceFile(sourceRoot, path));
  add('index.json', json({ version: 1, source: 'templateOf + creationTemplateOf from the local runtime', provenance: { repository: 'https://github.com/gquthier/leadfactory-oss', revision: sourceRevision, dirty: sourceDirty, sourceUrl }, distribution: 'private GitHub; source-only export', aliases: { 'work-os': 'company-os' }, templates: rows }));
  add('README.md', '# BizOS native template source export\n\nFive runtime IDs are exported; `work-os` is a name alias for `company-os`, never a sixth ID. `template.json` is the exact source manifest returned by the pack loader, including bundled skills. `vault/` materializes its notes; empty folders remain declared by the manifest. `installation-template.json` records the current CEO-only creation transformation for all five creation IDs. Existing E-commerce installations keep their historical roster. These files do not start agents or grant authority by themselves.\n\nAgency and E-commerce include dependency-free runnable cockpits under `cockpit/` (`npm start`, Node.js 22+). Data and personal connections are created only when used and are never part of the release. Do not commit those files. The source templates carry no client history. SaaS execution must use authorized broker tools, never platform credentials; standalone BYOK is a separate user-owned context.\n\nRuntime-derived manifests, transformations and native operational scripts retain AGPL-3.0-only. Cockpits, original Agency/E-commerce documents and MIT skill adaptations retain their supplied MIT notices. The umbrella repository visibility is private; licenses do not change that visibility. No app installation, public binary, cloud deployment or live provider validation is certified by this export. `integrity.json` hashes every other exported file.\n');
  add('SOURCE.md', `# Preferred source and licenses\n\nRuntime-derived templates and their operational scripts retain AGPL-3.0-only. The reviewed original modules and generation/export scripts are included under \`source/\`; the complete corresponding local runtime and test/build inputs are in the source repository at ${sourceUrl ?? 'the revision recorded by the release maintainer'}. Repository access stays private; recipients must receive access to this corresponding source when receiving these AGPL portions.\n\nAgency/E-commerce source notes, skills and cockpits retain their supplied MIT licenses and attributions. This export does not relicense those resources as proprietary. ${sourceDirty ? 'This is a development export from a dirty tree; it is not an exact committed release.' : 'The provenance revision identifies the committed source; file hashes in integrity.json identify the exported bytes.'}\n`);
  const sorted = new Map([...files].sort(([a], [b]) => a.localeCompare(b, 'en')));
  // Detect file/directory collisions before writing, including a note "a" and "a/b".
  for (const path of sorted.keys()) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) {
      if (sorted.has(parts.join('/'))) throw new Error(`duplicate file/directory path: ${path}`);
      parts.pop();
    }
  }
  sorted.set('integrity.json', json({ version: 1, files: Object.fromEntries([...sorted].map(([path, content]) => [path, hash(content)])) }));
  return sorted;
}

export function writeExport(output, files) {
  const destination = resolve(output);
  // lstat catches dangling links too; never replace a previous export or user folder.
  try { lstatSync(destination); throw new Error('export output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const path of files.keys()) if (!GENERATED_IGNORES.has(path)) safeExportPath(path);
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(destination, { mode: 0o700 });
  for (const [path, content] of files) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx', mode: 0o644 });
  }
}

export async function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) throw new Error('usage: node scripts/export-templates.mjs --output <new-directory>');
  const output = resolve(argv[1]);
  if (existsSync(output)) throw new Error('export output already exists');
  const runtime = join(ROOT, RUNTIME);
  const build = spawnSync('npm', ['run', 'build'], { cwd: runtime, stdio: 'inherit', shell: false });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('runtime build failed; nothing exported');
  const api = await import(pathToFileURL(join(runtime, 'dist/harness/templates.js')).href);
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim());
  const files = buildExport({ sourceRoot: ROOT, templates: api.KNOWN_TEMPLATE_IDS.map(id => api.templateOf(id)), creationIds: api.CREATION_TEMPLATE_IDS, creationTemplateOf: api.creationTemplateOf, sourceRevision, sourceDirty, allowlist: JSON.parse(readFileSync(join(ROOT, 'templates/export-allowlist.json'), 'utf8')) });
  writeExport(output, files);
  console.log(`Exported ${EXPORT_IDS.length} templates and ${files.size} reviewed files.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
