import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
test('creative pack installs offline with scripts, font licenses, no Pixabay audio and preserves collisions', async t => {
  const target = await mkdtemp(join(tmpdir(), 'leadfactory-creative-'));
  t.after(() => rm(target, {recursive:true,force:true}));
  const script = join(root, 'scripts/install-skills.mjs');
  const run = () => execFileSync(process.execPath, [script, '--pack', 'creative', '--target', target], {encoding:'utf8'});
  assert.match(run(), /12 skill/);
  const files = await readdir(target);
  assert.equal(files.length, 12);
  for (const name of files) {
    assert.equal(await readFile(join(target,name,'SKILL.md'),'utf8'), await readFile(join(root,'extras/creative-engine/skills',name,'SKILL.md'),'utf8'));
    assert.match(await readFile(join(target,name,'LICENSE.txt'),'utf8'), /Apache License/);
  }
  assert.ok((await readdir(join(target,'hyperframes-creative/frame-presets/code-editorial/fonts'))).includes('OFL-inter.txt'));
  const audio = join(target,'media-use/audio/assets/sfx');
  assert.deepEqual(JSON.parse(await readFile(join(audio,'manifest.json'),'utf8')), {});
  assert.ok((await readdir(audio)).every(name => !name.endsWith('.mp3')));
  assert.throws(run, /collision/);
  assert.equal((await readdir(target)).length, 12);
});
