import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkills } from '../scripts/install-skills.mjs';

test('the three agency operations skills install independently without replacing user content', async t => {
  const target = await mkdtemp(join(tmpdir(), 'agency-operations-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  const names = ['agency-portfolio-ops', 'outbound-campaign-ops', 'outbound-reply-qualification'];
  const result = await installSkills({ target, only: names });
  assert.deepEqual(result.installed.toSorted(), names.toSorted());
  for (const name of names) {
    assert.match(await readFile(join(target, name, 'SKILL.md'), 'utf8'), new RegExp(`name: ${name}`));
    assert.match(await readFile(join(target, name, 'LICENSE.txt'), 'utf8'), /MIT License/);
  }
  await assert.rejects(installSkills({ target, only: names }), /collision/);
});
