import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

test('le template embarque exactement les notes du second cerveau', async () => {
  const template = JSON.parse(await readFile(path.join(root, 'templates/lead-gen-agency.company-template.json'), 'utf8'));
  const notes = new Map(template.notes.map(note => [note.path, note.text]));
  assert.equal(notes.size, template.notes.length, 'pas de notes dupliquées');
  async function walk(dir, prefix = '') {
    const files = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink(), 'le pack ne référence pas de fichier externe');
      const relative = prefix + item.name;
      if (item.isDirectory()) files.push(...await walk(path.join(dir, item.name), relative + '/'));
      else if (item.name.endsWith('.md')) files.push(relative);
    }
    return files;
  }
  const files = await walk(path.join(root, 'vault'));
  assert.equal(files.length, notes.size);
  for (const file of files) assert.equal(notes.get(file), await readFile(path.join(root, 'vault', file), 'utf8'), file);
  for (const p of [...template.folders, ...notes.keys()]) {
    assert.ok(!p.includes('\\') && !p.includes('\0'));
    assert.ok(p.split('/').every(segment => segment && !segment.startsWith('.')), p);
  }
  assert.equal(new Set(template.bots.map(bot => bot.slug)).size, template.bots.length);
  assert.equal(template.bots.length, 6);
  assert.deepEqual(template.routines, []);
});
