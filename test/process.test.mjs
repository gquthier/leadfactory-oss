// Verrou entre processus réels et intégrité du bundle statique servi.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { Store } from '../lib/store.mjs';
import { request, startServer, tempDir } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function waitFor(child, pattern) {
  return new Promise((resolve, reject) => {
    let out = '';
    const onData = (chunk) => {
      out += chunk.toString();
      if (pattern.test(out)) resolve(out);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`processus terminé (${code}) : ${out}`)));
  });
}

test('un second processus sur le même DATA_DIR est refusé, puis accepté après arrêt propre', async () => {
  const dir = await tempDir();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    env: { ...process.env, DATA_DIR: dir, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await waitFor(child, /démarre sur/);
    const lock = JSON.parse(await fs.readFile(path.join(dir, 'db.lock'), 'utf8'));
    assert.equal(lock.pid, child.pid);

    const second = new Store(dir);
    await assert.rejects(() => second.load(), new RegExp(`processus ${child.pid}`));

    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    await exited;
    await assert.rejects(() => fs.stat(path.join(dir, 'db.lock')), 'verrou relâché par l’arrêt propre');

    const third = await startServer(dir);
    assert.equal((await request(third.port, '/api/state')).status, 200);
    await third.close();
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

test('le script servi au navigateur est syntaxiquement valide et ne fige pas le port', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const script = await request(app.port, '/app.js');
  assert.equal(script.status, 200);
  assert.doesNotThrow(() => new vm.Script(script.text, { filename: 'app.js' }));
  const page = await request(app.port, '/');
  assert.doesNotMatch(page.text, /4310/);
  assert.match(page.text, /id="host-label"/);
});
