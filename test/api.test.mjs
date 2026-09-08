// API : validation, relations, import/export, onboarding, génération, demo.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createCampaign, createClient, request, startServer } from './harness.mjs';

test('validation des champs client', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const noName = await request(app.port, '/api/clients', { method: 'POST', body: { contact: 'Sans entreprise' } });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /company/);

  const badEmail = await request(app.port, '/api/clients', {
    method: 'POST',
    body: { company: 'X', email: 'pas-un-email' }
  });
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.body.field, 'email');

  const badStatus = await request(app.port, '/api/clients', {
    method: 'POST',
    body: { company: 'X', status: 'super-client' }
  });
  assert.equal(badStatus.status, 400);
  assert.match(badStatus.body.error, /prospect/);

  const badBudget = await request(app.port, '/api/clients', { method: 'POST', body: { company: 'X', budget: -5 } });
  assert.equal(badBudget.status, 400);

  const tooLong = await request(app.port, '/api/clients', { method: 'POST', body: { company: 'x'.repeat(200) } });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /120 caractères/);

  const ok = await request(app.port, '/api/clients', {
    method: 'POST',
    body: { company: '  Agence OK  ', email: 'hello@example.com', budget: '1200,50' }
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.company, 'Agence OK');
  assert.equal(ok.body.budget, 1200.5);
  assert.equal(ok.body.status, 'prospect');

  const missing = await request(app.port, '/api/clients/inconnu-42', { method: 'PATCH', body: { company: 'Z' } });
  assert.equal(missing.status, 404);
});

test('les relations entre entités sont vérifiées', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const orphan = await request(app.port, '/api/campaigns', {
    method: 'POST',
    body: { clientId: 'client-inexistant', name: 'X', channel: 'meta' }
  });
  assert.equal(orphan.status, 400);
  assert.match(orphan.body.error, /Client introuvable/);

  const clientA = await createClient(app.port, { company: 'A' });
  const clientB = await createClient(app.port, { company: 'B' });
  const campaignA = await createCampaign(app.port, clientA.id);

  const badChannel = await request(app.port, '/api/campaigns', {
    method: 'POST',
    body: { clientId: clientA.id, name: 'X', channel: 'tiktok' }
  });
  assert.equal(badChannel.status, 400);
  assert.equal(badChannel.body.field, 'channel');

  const crossed = await request(app.port, '/api/tasks', {
    method: 'POST',
    body: { clientId: clientB.id, campaignId: campaignA.id, title: 'Tâche croisée' }
  });
  assert.equal(crossed.status, 400);
  assert.match(crossed.body.error, /autre client/);

  const moved = await request(app.port, `/api/campaigns/${campaignA.id}`, {
    method: 'PATCH',
    body: { clientId: clientB.id }
  });
  assert.equal(moved.status, 400);

  // Suppression client => cascade sur campagnes, tâches, livrables.
  await request(app.port, '/api/tasks', { method: 'POST', body: { clientId: clientA.id, title: 'A faire' } });
  const del = await request(app.port, `/api/clients/${clientA.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const state = (await request(app.port, '/api/state')).body;
  assert.equal(state.clients.length, 1);
  assert.equal(state.campaigns.length, 0);
  assert.equal(state.tasks.length, 0);

  // Suppression campagne => tâches conservées mais détachées.
  const campaignB = await createCampaign(app.port, clientB.id);
  await request(app.port, '/api/tasks', {
    method: 'POST',
    body: { clientId: clientB.id, campaignId: campaignB.id, title: 'Liee' }
  });
  await request(app.port, `/api/campaigns/${campaignB.id}`, { method: 'DELETE' });
  const after = (await request(app.port, '/api/state')).body;
  assert.equal(after.tasks.length, 1);
  assert.equal(after.tasks[0].campaignId, null);
});

test('la checklist onboarding est idempotente', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port);

  const first = await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'POST' });
  assert.equal(first.status, 200);
  assert.ok(first.body.created.length >= 5);
  const count = first.body.created.length;

  const second = await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'POST' });
  assert.equal(second.body.created.length, 0);
  assert.equal(second.body.skipped, count);

  const tasks = (await request(app.port, '/api/state')).body.tasks;
  assert.equal(tasks.length, count);

  // Même après avoir coche une étape, aucun doublon n'est recréé.
  await request(app.port, `/api/tasks/${tasks[0].id}`, { method: 'PATCH', body: { done: true } });
  const third = await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'POST' });
  assert.equal(third.body.created.length, 0);
  assert.equal((await request(app.port, '/api/state')).body.tasks.length, count);
});

test('la génération est déterministe et annoncée comme modèle', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Déterministe SA', audience: 'DSI' });
  const campaign = await createCampaign(app.port, client.id);

  const a = await request(app.port, '/api/generate', {
    method: 'POST',
    body: { kind: 'cold-email', clientId: client.id, campaignId: campaign.id }
  });
  const b = await request(app.port, '/api/generate', {
    method: 'POST',
    body: { kind: 'cold-email', clientId: client.id, campaignId: campaign.id }
  });
  assert.equal(a.status, 201);
  assert.equal(a.body.content, b.body.content, 'deux générations identiques doivent donner le même texte');
  assert.notEqual(a.body.id, b.body.id);
  assert.equal(a.body.generated, true);
  assert.match(a.body.content, /Message 1/);
  assert.match(a.body.content, /Message 2/);
  assert.match(a.body.content, /Message 3/);
  assert.match(a.body.content, /Modèle prérempli/);
  assert.match(a.body.content, /Aucune IA, aucun envoi/);
  assert.match(a.body.content, /DSI/);

  const creative = await request(app.port, '/api/generate', {
    method: 'POST',
    body: { kind: 'creative-brief', clientId: client.id, campaignId: campaign.id }
  });
  assert.equal(creative.status, 201);
  assert.equal(creative.body.type, 'creative-brief');
  assert.match(creative.body.content, /brief texte/);

  const onboarding = await request(app.port, '/api/generate', {
    method: 'POST',
    body: { kind: 'onboarding-brief', clientId: client.id }
  });
  assert.equal(onboarding.body.type, 'brief');

  const unknown = await request(app.port, '/api/generate', {
    method: 'POST',
    body: { kind: 'vidéo-ads', clientId: client.id }
  });
  assert.equal(unknown.status, 400);

  const wrongClient = await createClient(app.port, { company: 'Autre' });
  const mismatch = await request(app.port, '/api/generate', {
    method: 'POST',
    body: { kind: 'cold-email', clientId: wrongClient.id, campaignId: campaign.id }
  });
  assert.equal(mismatch.status, 400);
});

test('export puis import restitue exactement les données', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Export SARL' });
  await createCampaign(app.port, client.id);
  await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'POST' });

  const exported = await request(app.port, '/api/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers['content-disposition'], /leadfactory-export\.json/);
  const snapshot = JSON.parse(exported.text);

  const other = await startServer();
  t.after(() => other.close());
  const imported = await request(other.port, '/api/import', { method: 'POST', body: snapshot });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported.clients, 1);

  const restored = (await request(other.port, '/api/state')).body;
  assert.deepEqual(restored, snapshot);
});

test('un import invalide est refusé et ne détruit rien', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Intacte SAS' });

  const full = (extra) => ({ version: 1, clients: [], campaigns: [], tasks: [], deliverables: [], ...extra });

  const broken = await request(app.port, '/api/import', {
    method: 'POST',
    body: full({ campaigns: [{ id: 'x', clientId: 'fantome', name: 'X', channel: 'meta' }] })
  });
  assert.equal(broken.status, 400);
  assert.match(broken.body.error, /Client introuvable/);

  const duplicated = await request(app.port, '/api/import', {
    method: 'POST',
    body: full({ clients: [{ id: 'a', company: 'Un' }, { id: 'a', company: 'Deux' }] })
  });
  assert.equal(duplicated.status, 400);
  assert.match(duplicated.body.error, /dupliqué/);

  const badVersion = await request(app.port, '/api/import', { method: 'POST', body: full({ version: 99 }) });
  assert.equal(badVersion.status, 400);

  // Un objet vide ou partiel ne doit jamais écraser la base (version + 4 collections exigées).
  const empty = await request(app.port, '/api/import', { method: 'POST', body: {} });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, 'version');
  const partial = await request(app.port, '/api/import', { method: 'POST', body: { version: 1, clients: [] } });
  assert.equal(partial.status, 400);
  assert.equal(partial.body.field, 'campaigns');
  const noVersion = await request(app.port, '/api/import', {
    method: 'POST',
    body: { clients: [], campaigns: [], tasks: [], deliverables: [] }
  });
  assert.equal(noVersion.status, 400);

  const state = (await request(app.port, '/api/state')).body;
  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].company, 'Intacte SAS');
  assert.equal(state.clients[0].id, client.id);
  const onDisk = JSON.parse(await fs.readFile(path.join(app.dataDir, 'db.json'), 'utf8'));
  assert.equal(onDisk.clients[0].company, 'Intacte SAS');
});

test('un export de plus de 2 Mo se réimporte, la capacité de stockage est bornée', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Volume SAS' });
  for (let i = 0; i < 51; i += 1) {
    const res = await request(app.port, '/api/deliverables', {
      method: 'POST',
      body: { clientId: client.id, type: 'brief', title: `Doc ${i}`, content: 'x'.repeat(40_000) }
    });
    assert.equal(res.status, 201);
  }
  const exported = await request(app.port, '/api/export');
  assert.equal(exported.status, 200);
  assert.ok(exported.text.length > 2_000_000, 'export au-delà de 2 Mo');
  const snapshot = JSON.parse(exported.text);

  const other = await startServer();
  t.after(() => other.close());
  const imported = await request(other.port, '/api/import', { method: 'POST', body: snapshot });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported.deliverables, 51);
  assert.deepEqual((await request(other.port, '/api/state')).body, snapshot);

  // Dépassement de capacité : refusé avant écriture, base intacte.
  const bloated = structuredClone(snapshot);
  for (let i = 0; i < 520; i += 1) {
    bloated.deliverables.push({ id: `big-${i}`, clientId: client.id, type: 'brief', title: `Big ${i}`, content: 'y'.repeat(40_000) });
  }
  const tooBig = await request(other.port, '/api/import', { method: 'POST', body: bloated });
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.error, /Capacité de stockage dépassée/);
  const onDisk = JSON.parse(await fs.readFile(path.join(other.dataDir, 'db.json'), 'utf8'));
  assert.equal(onDisk.deliverables.length, 51);
});

test('export Markdown du dossier client', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Dossier SARL', contact: 'Lou' });
  const campaign = await createCampaign(app.port, client.id, { name: 'Cold Q3' });
  await request(app.port, '/api/tasks', {
    method: 'POST',
    body: { clientId: client.id, campaignId: campaign.id, title: 'Préparer la liste' }
  });
  await request(app.port, '/api/generate', { method: 'POST', body: { kind: 'creative-brief', clientId: client.id } });

  const res = await request(app.port, `/api/clients/${client.id}/dossier.md`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.text, /# Dossier client : Dossier SARL/);
  assert.match(res.text, /Cold Q3/);
  assert.match(res.text, /\[ \] Préparer la liste/);
  assert.match(res.text, /Brief créatif/);

  const missing = await request(app.port, '/api/clients/inconnu/dossier.md');
  assert.equal(missing.status, 404);
});

test('la démo ne se charge que sur une base vide', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const first = await request(app.port, '/api/demo', { method: 'POST' });
  assert.equal(first.status, 201);
  const state = (await request(app.port, '/api/state')).body;
  assert.equal(state.clients[0].company, 'Atelier Démo');
  assert.match(state.clients[0].email, /example\.com$/);
  assert.equal(state.campaigns.length, 1);

  const second = await request(app.port, '/api/demo', { method: 'POST' });
  assert.equal(second.status, 409);
  assert.equal((await request(app.port, '/api/state')).body.clients.length, 1);
});

test('les livrables sont éditables et rattachés correctement', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port);
  const created = await request(app.port, '/api/deliverables', {
    method: 'POST',
    body: { clientId: client.id, type: 'brief', title: 'Brief initial', content: 'v1' }
  });
  assert.equal(created.status, 201);

  const updated = await request(app.port, `/api/deliverables/${created.body.id}`, {
    method: 'PATCH',
    body: { content: 'v2 revue' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.content, 'v2 revue');
  assert.equal(updated.body.title, 'Brief initial');

  const badType = await request(app.port, '/api/deliverables', {
    method: 'POST',
    body: { clientId: client.id, type: 'podcast', title: 'X' }
  });
  assert.equal(badType.status, 400);

  const removed = await request(app.port, `/api/deliverables/${created.body.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await request(app.port, '/api/state')).body.deliverables.length, 0);
});

test('routes et méthodes inconnues renvoient des codes utiles', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await request(app.port, '/api/nawak')).status, 404);
  assert.equal((await request(app.port, '/api/clients', { method: 'PUT', body: {} })).status, 405);
  const badJson = await request(app.port, '/api/clients', { method: 'POST', body: '{ pas du json' });
  assert.equal(badJson.status, 400);
  assert.match(badJson.body.error, /JSON invalide/);
});
