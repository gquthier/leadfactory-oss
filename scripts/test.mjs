// Keep the dependency-free cockpit suite separate from the optional BizOS runtime.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const files = ['test', 'test-skills', 'test-pack'].flatMap((dir) =>
  readdirSync(resolve(root, dir))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => resolve(root, dir, name))
);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
