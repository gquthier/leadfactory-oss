import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExport, writeExport, safeExportPath } from '../scripts/export-templates.mjs';

const ids = ['company-os', 'lead-gen-agency', 'service-based-business', 'software', 'ecommerce'];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'template-export-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM-LICENSE.txt', 'integrations/bizos-local/runtime/LICENSE', 'integrations/bizos-local/runtime/NOTICE', 'integrations/bizos-local/runtime/LICENSES/openmausbot-Apache-2.0.txt', 'integrations/bizos-local/runtime/LICENSES/rakazo-Apache-2.0.txt', 'public/ready.txt']) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), `reviewed ${file}\n`);
  }
  const templates = ids.map(id => ({ id, name: id, version: 1, folders: ['Processes'], notes: [{ path: 'Processes/Start.md', text: 'Reusable instructions\n' }], bots: [], routines: [] }));
  const options = { sourceRoot: root, templates, creationIds: ids.filter(id => id !== 'ecommerce'), creationTemplateOf: source => ({ ...source, bots: [{ slug: 'ceo' }] }), allowlist: { version: 1, packs: { 'lead-gen-agency': ['public/ready.txt'], ecommerce: ['public/ready.txt'] } } };
  return { root, options };
}

test('five exports are deterministic, native creation is explicit, private and unlisted files stay outside', t => {
  const { root, options } = fixture(t);
  for (const file of ['.env', 'data/client-a.json', '.git/config', 'public/client-b.txt', 'vault/Clients/Real client.md']) {
    mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), 'PRIVATE-SENTINEL');
  }
  const first = buildExport(options), second = buildExport(options);
  assert.deepEqual([...first], [...second]);
  const index = JSON.parse(first.get('index.json'));
  assert.deepEqual(index.templates.map(row => row.id).sort(), ids.toSorted());
  assert.equal(index.templates.find(row => row.id === 'ecommerce').creationSupported, false);
  assert.equal(first.has('work-os/template.json'), false);
  assert.deepEqual(JSON.parse(first.get('lead-gen-agency/installation-template.json')).bots, [{ slug: 'ceo' }]);
  assert.equal(first.get('lead-gen-agency/vault/Processes/Start.md'), 'Reusable instructions\n');
  assert.ok([...first.values()].every(content => !String(content).includes('PRIVATE-SENTINEL')));
  const destination = join(root, 'output'); writeExport(destination, first);
  assert.equal(readFileSync(join(destination, 'index.json'), 'utf8'), first.get('index.json'));
  assert.throws(() => writeExport(destination, first), /exist/i);
  assert.equal(readFileSync(join(destination, 'index.json'), 'utf8'), first.get('index.json'));
});

test('invalid IDs, duplicate paths and unsafe note paths fail before any output', t => {
  const { root, options } = fixture(t);
  for (const path of ['../client.md', '/private/key', 'C:/private/key', 'a\\b.md', '.env', 'a/.git/config', 'data/clients.json', 'keys/client.pem', 'a/credentials.json', 'a/connections.json']) assert.throws(() => safeExportPath(path), /unsafe/i, path);
  assert.throws(() => buildExport({ ...options, templates: options.templates.map((row, i) => i ? row : { ...row, id: 'work-os' }) }), /template/i);
  const original = options.templates[0];
  for (const notes of [[{ path: '../private.md', text: '' }], [...original.notes, ...original.notes]]) {
    assert.throws(() => buildExport({ ...options, templates: [{ ...original, notes }, ...options.templates.slice(1)] }), /unsafe|duplicate/i);
  }
  assert.equal(existsSync(join(root, 'output')), false);
});

test('allowlisted symlinks, parent symlinks and secret filenames are refused', t => {
  const { root, options } = fixture(t);
  const allow = path => ({ version: 1, packs: { 'lead-gen-agency': [path], ecommerce: [] } });
  symlinkSync(join(root, 'LICENSE'), join(root, 'public/link.txt'));
  symlinkSync(join(root, 'public'), join(root, 'linked'));
  assert.throws(() => buildExport({ ...options, allowlist: allow('public/link.txt') }), /symlink/i);
  assert.throws(() => buildExport({ ...options, allowlist: allow('linked/ready.txt') }), /symlink/i);
  assert.throws(() => buildExport({ ...options, allowlist: allow('.env') }), /unsafe/i);
  assert.throws(() => buildExport({ ...options, allowlist: allow('missing.md') }), /ENOENT|missing/i);
});

test('a preexisting or symlink output never overwrites personal files', t => {
  const { root, options } = fixture(t);
  const output = join(root, 'linked-output'); symlinkSync(join(root, 'public'), output);
  assert.throws(() => writeExport(output, buildExport(options)), /exist|symlink/i);
  assert.equal(readFileSync(join(root, 'public/ready.txt'), 'utf8'), 'reviewed public/ready.txt\n');
});
