import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion } from '../lib/ai.mjs';
import { Store } from '../lib/store.mjs';
import { createClient, request, startServer, tempDir } from './harness.mjs';

const answers = {
  offer: { service: 'Service de démonstration', problem: 'Besoin fictif', promise: 'Livrer un diagnostic' },
  target: { profile: 'Entreprises de démonstration', exclusions: 'Secteurs hors brief' },
  campaign: { channel: 'organic', objective: 'Tester un message', qualifiedLead: 'Besoin et interlocuteur identifiés', kpi: 'Réponses qualifiées', budget: 0 }
};

test('un état revu importé sans questionnaire est refusé sans effacer le client', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port);
  const backup = (await request(app.port, '/api/export')).body;
  backup.clients[0].onboarding = { status: 'reviewed' };
  const imported = await request(app.port, '/api/import', { method: 'POST', body: backup });
  assert.equal(imported.status, 400);
  const state = (await request(app.port, '/api/state')).body;
  assert.equal(state.clients[0].id, client.id);
  assert.equal(state.clients[0].onboarding, null);
});

test('budget zéro explicite accepté ; suppression campagne ou brief remet en brouillon et conserve un export restaurable', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port);
  const base = `/api/clients/${client.id}/onboarding`;
  assert.equal((await request(app.port, base, { method: 'PUT', body: answers })).status, 200);
  for (const resource of ['campaigns', 'deliverables']) {
    const submitted = await request(app.port, `${base}/submit`, { method: 'POST' });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.campaign.budget, 0);
    assert.equal((await request(app.port, `${base}/review`, { method: 'POST' })).status, 200);
    const id = resource === 'campaigns' ? submitted.body.campaign.id : submitted.body.brief.id;
    assert.equal((await request(app.port, `/api/${resource}/${id}`, { method: 'DELETE' })).status, 200);
    const state = (await request(app.port, '/api/state')).body;
    assert.equal(state.clients[0].onboarding.status, 'draft');
    assert.equal(state.clients[0].onboarding.reviewedAt, null);
    const backup = (await request(app.port, '/api/export')).body;
    assert.equal((await request(app.port, '/api/import', { method: 'POST', body: backup })).status, 200);
  }
});

test('un test de clé en vol ne valide ni une nouvelle clé ni une connexion supprimée', async (t) => {
  let release;
  let started;
  const fetchImpl = async () => {
    started();
    await new Promise(resolve => { release = resolve; });
    return { ok: true, status: 200 };
  };
  const app = await startServer(undefined, { fetchImpl });
  t.after(() => app.close());
  const route = '/api/connections/openrouter';
  for (const change of ['replace', 'disconnect']) {
    await request(app.port, route, { method: 'PUT', body: { apiKey: 'fixture-key-A', model: 'fixture/model' } });
    const entered = new Promise(resolve => { started = resolve; });
    const testing = request(app.port, `${route}/test`, { method: 'POST' });
    await entered;
    if (change === 'replace') await request(app.port, route, { method: 'PUT', body: { apiKey: 'fixture-key-B' } });
    else await request(app.port, route, { method: 'DELETE' });
    release();
    assert.equal((await testing).status, 409);
    const current = (await request(app.port, '/api/connections')).body.openrouter;
    assert.equal(current.status, change === 'replace' ? 'configured' : 'unconfigured');
    assert.equal(current.verifiedAt, null);
  }
});

test('le timeout IA couvre aussi la lecture du corps après les en-têtes', async () => {
  let signal;
  const fetchImpl = async (_url, init) => {
    signal = init.signal;
    return {
      ok: true,
      status: 200,
      json: () => new Promise(resolve => setTimeout(() => resolve({ choices: [{ message: { content: 'trop tard' } }] }), 60))
    };
  };
  await assert.rejects(
    chatCompletion({ apiKey: 'fixture-key', model: 'fixture/model', messages: [], fetchImpl, timeoutMs: 10 }),
    error => error.status === 504
  );
  assert.equal(signal.aborted, true);
});

test('un fichier disque structurellement incomplet ne devient pas une base vide', async (t) => {
  const dir = await tempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'db.json'), '{}');
  const store = new Store(dir);
  await assert.rejects(store.load(), /incomplet/);
  assert.equal(await fs.readFile(path.join(dir, 'db.json'), 'utf8'), '{}');
  await assert.rejects(fs.stat(path.join(dir, 'db.lock')), { code: 'ENOENT' });
});
