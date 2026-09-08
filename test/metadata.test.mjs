// GET /api/meta : métadonnées de synchronisation, sans aucun contenu métier.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createClient, createCampaign, request, startServer, tempDir } from './harness.mjs';

async function meta(port) {
  const res = await request(port, '/api/meta');
  assert.equal(res.status, 200);
  return res;
}

test('le cockpit embarqué indique BizOS sans exporter de configuration de l’hôte', async (t) => {
  const app = await startServer(undefined, { hostedBy: 'bizos-local' });
  t.after(() => app.close());
  const res = await meta(app.port);
  assert.equal(res.body.hostedBy, 'bizos-local');
  const exported = await request(app.port, '/api/export');
  assert.equal(Object.hasOwn(exported.body, 'hostedBy'), false);
});

test('meta expose exactement produit, version d\'API, révision et instance', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const res = await meta(app.port);
  assert.deepEqual(Object.keys(res.body).sort(), ['apiVersion', 'instanceId', 'product', 'revision']);
  assert.equal(res.body.product, 'leadfactory-oss');
  assert.equal(res.body.apiVersion, 1);
  assert.match(res.body.revision, /^[0-9a-f]{32}$/);
  assert.match(res.body.instanceId, /^[0-9a-f-]{36}$/);
});

test('la révision est stable tant que rien ne change', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await createClient(app.port);
  const first = (await meta(app.port)).body;
  const second = (await meta(app.port)).body;
  const third = (await meta(app.port)).body;
  assert.equal(first.revision, second.revision);
  assert.equal(second.revision, third.revision);
  assert.equal(first.instanceId, third.instanceId);
});

test('chaque changement réel produit une révision différente', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const seen = new Set();
  const track = async (label) => {
    const { revision } = (await meta(app.port)).body;
    assert.ok(!seen.has(revision), `révision inchangée après : ${label}`);
    seen.add(revision);
    return revision;
  };

  await track('base vide');
  const client = await createClient(app.port);
  await track('création client');

  const campaign = await createCampaign(app.port, client.id);
  await track('création campagne');

  await request(app.port, `/api/clients/${client.id}`, { method: 'PATCH', body: { goal: '20 RDV' } });
  await track('modification client');

  await request(app.port, '/api/agency', { method: 'PUT', body: { name: 'Agence Démo' } });
  await track('profil d\'agence');

  await request(app.port, `/api/campaigns/${campaign.id}`, { method: 'DELETE' });
  await track('suppression campagne');

  await request(app.port, `/api/clients/${client.id}`, { method: 'DELETE' });
  await track('suppression client');
});

test('un import change la révision, y compris à nombre d\'enregistrements égal', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const client = await createClient(app.port, { company: 'Avant' });
  const before = (await meta(app.port)).body.revision;

  const exported = (await request(app.port, '/api/export')).body;
  const modified = {
    ...exported,
    clients: exported.clients.map((c) => ({ ...c, company: 'Après' }))
  };
  const imported = await request(app.port, '/api/import', { method: 'POST', body: modified });
  assert.equal(imported.status, 200);

  const after = (await meta(app.port)).body.revision;
  assert.notEqual(after, before);
  assert.equal((await request(app.port, '/api/clients')).body[0].company, 'Après');
  assert.equal((await request(app.port, '/api/clients')).body[0].id, client.id);
});

test('un état identique donne la même révision dans une autre instance', async (t) => {
  const first = await startServer();
  const client = await createClient(first.port, { company: 'Miroir' });
  await createCampaign(first.port, client.id);
  const revision = (await meta(first.port)).body.revision;
  const instanceId = (await meta(first.port)).body.instanceId;
  await first.close();

  const copy = await tempDir();
  await fs.copyFile(path.join(first.dataDir, 'db.json'), path.join(copy, 'db.json'));
  const second = await startServer(copy);
  t.after(() => second.close());

  const other = (await meta(second.port)).body;
  assert.equal(other.revision, revision, 'même contenu = même empreinte');
  assert.notEqual(other.instanceId, instanceId, 'instanceId propre à chaque createApp');
});

test('meta ne divulgue ni contenu client, ni chemin local, ni secret', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await createClient(app.port, {
    company: 'Cabinet Secret SARL',
    contact: 'Zoé Dupont',
    email: 'zoe@exemple.test',
    notes: 'note confidentielle'
  });
  await request(app.port, '/api/connections/openrouter', {
    method: 'PUT',
    body: { apiKey: 'sk-or-v1-secret-de-test', model: 'demo/modele' }
  });

  const raw = (await meta(app.port)).text;
  for (const forbidden of [
    'Cabinet Secret',
    'Zoé Dupont',
    'zoe@exemple.test',
    'note confidentielle',
    'sk-or-v1',
    app.dataDir,
    'db.json',
    'openrouter'
  ]) {
    assert.ok(!raw.includes(forbidden), `meta ne doit pas contenir « ${forbidden} » : ${raw}`);
  }
});

test('meta refuse les méthodes d\'écriture et les sous-chemins', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await request(app.port, '/api/meta', { method: 'POST', body: {} })).status, 404);
  assert.equal((await request(app.port, '/api/meta/revision')).status, 404);
});
