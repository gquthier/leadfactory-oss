import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../lib/app.mjs';
import { Store } from '../lib/store.mjs';

async function start(options = {}) {
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), 'commerce-test-'));
  const app = await createApp({ ...options, dataDir });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, method = 'GET', body, headers = {}) => {
    const r = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
  return { ...app, dataDir, request };
}

test('profile, linked records and dashboard survive exact export/import and restart', async t => {
  let app = await start();
  const dir = app.dataDir;
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const profile = await app.request('/api/profile', 'PUT', { storeName: 'Atelier Démo', market: 'France' });
  assert.equal(profile.status, 200);
  assert.ok(profile.body.updatedAt);
  const before = (await app.request('/api/meta')).body.revision;
  const product = await app.request('/api/products', 'POST', { name: 'Pochette Démo', price: 29, cost: 7 });
  assert.equal(product.status, 201);
  assert.equal(product.body.status, 'idea');
  const fixtures = {
    competitors: { name: 'Concurrent Démo', productId: product.body.id, url: 'https://example.com' },
    suppliers: { name: 'Fournisseur Démo', productId: product.body.id, unitCost: 7 },
    storefronts: { name: 'Boutique Démo', productIds: [product.body.id] },
    creatives: { title: 'Brief Démo', productId: product.body.id },
    campaigns: { name: 'Campagne Démo', channel: 'meta', productId: product.body.id },
    tasks: { title: 'Contrôler les coûts', stage: 'sourcing', productId: product.body.id },
    deliverables: { title: 'Brief boutique', stage: 'store', content: 'Fixture fictive', productId: product.body.id },
    metrics: { date: '2026-09-09', spend: 0, revenue: 0, orders: 0 },
  };
  for (const [collection, data] of Object.entries(fixtures)) {
    assert.equal((await app.request(`/api/${collection}`, 'POST', data)).status, 201, collection);
  }
  assert.equal((await app.request('/api/tasks', 'POST', { title: 'Relation invalide', stage: 'store', productId: 'missing' })).status, 400);
  assert.equal((await app.request('/api/metrics', 'POST', { date: '2026-02-31' })).status, 400);
  assert.equal((await app.request('/api/dashboard', 'PUT', { title: 'Atelier Démo', sections: [{ id: 'note', title: 'Prochaine étape', type: 'note', text: 'Recette de la boutique' }] })).status, 200);
  const exported = (await app.request('/api/export')).body;
  assert.notEqual((await app.request('/api/meta')).body.revision, before);
  assert.equal((await app.request('/api/import', 'POST', exported)).status, 200);
  assert.deepEqual((await app.request('/api/state')).body, exported);
  await app.close();
  app = await start({ dataDir: dir });
  assert.deepEqual((await app.request('/api/state')).body, exported);
  const revision = (await app.request('/api/meta')).body.revision;
  assert.equal((await app.request('/api/dashboard', 'PUT', { sections: [{ id: 'bad', type: 'javascript', title: 'Invalid' }] })).status, 400);
  assert.equal((await app.request('/api/import', 'POST', { version: 1 })).status, 400);
  assert.equal((await app.request('/api/meta')).body.revision, revision);
  assert.equal((await app.request(`/api/products/${product.body.id}`, 'DELETE')).status, 200);
  const state = (await app.request('/api/state')).body;
  assert.equal(state.competitors.length, 1);
  assert.equal(state.competitors[0].productId, null);
  assert.deepEqual(state.storefronts[0].productIds, []);
});

test('ticket authentication closes all business routes and never exports the service credential', async t => {
  const token = 'fixture-service-token-'.repeat(3);
  const app = await start({ accessToken: token, hostedBy: 'bizos-local' });
  t.after(async () => { await app.close(); await rm(app.dataDir, { recursive: true, force: true }); });
  for (const path of ['/api/state', '/api/schema', '/api/meta', '/api/profile', '/api/dashboard', '/api/products', '/api/export']) {
    assert.equal((await app.request(path)).status, 401, path);
  }
  const ticket = app.issueDashboardTicket();
  const opened = await app.request('/api/session', 'POST', { ticket });
  assert.equal(opened.status, 200);
  const cookie = opened.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal((await app.request('/api/session', 'POST', { ticket })).status, 401);
  const state = await app.request('/api/export', 'GET', undefined, { Cookie: cookie.split(';')[0] });
  assert.equal(state.status, 200);
  assert.ok(!JSON.stringify(state.body).includes(token));
  assert.equal((await app.request('/api/products', 'POST', { name: 'Blocked' }, { Cookie: cookie.split(';')[0], Origin: 'https://example.com' })).status, 403);
});

test('mirrors finish in commit order when the first callback is suspended', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const snapshots = [];
  const app = await start({ onMutation: async ({ state }) => {
    if (state.products.length === 1) { entered(); await gate; }
    snapshots.push(state.products.length);
  } });
  t.after(async () => { release(); await app.close(); await rm(app.dataDir, { recursive: true, force: true }); });
  const a = app.request('/api/products', 'POST', { name: 'A' });
  await ready;
  const b = app.request('/api/products', 'POST', { name: 'B' });
  const deadline = Date.now() + 5000;
  while (app.store.read().products.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.store.read().products.length, 2);
  assert.deepEqual(snapshots, []);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(snapshots, [1, 2]);
});

test('competing stale-lock recovery admits only one store and preserves invalid data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'commerce-lock-'));
  const stores = Array.from({ length: 8 }, () => new Store(dir));
  t.after(async () => { await Promise.all(stores.map(s => s.close())); await rm(dir, { recursive: true, force: true }); });
  await writeFile(join(dir, 'db.lock'), JSON.stringify({ pid: 2147483647 }));
  const outcomes = await Promise.allSettled(stores.map(s => s.load()));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const winner = stores[outcomes.findIndex(r => r.status === 'fulfilled')];
  await winner.close();
  const bad = '{ invalid JSON';
  await writeFile(join(dir, 'db.json'), bad);
  const refused = new Store(dir);
  await assert.rejects(refused.load(), /JSON invalide/);
  assert.equal(await readFile(join(dir, 'db.json'), 'utf8'), bad);
});
