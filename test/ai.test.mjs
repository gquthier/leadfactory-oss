// Connexion OpenRouter et rédaction IA : transport simulé, clé jamais exposée.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { OPENROUTER_CHAT_URL, OPENROUTER_KEY_URL } from '../lib/ai.mjs';
import { createCampaign, createClient, mockFetch, request, startServer } from './harness.mjs';

const KEY = 'sk-or-v1-secret-de-test-0000';

function connectionsOnDisk(dir) {
  return fs.readFile(path.join(dir, 'connections.json'), 'utf8');
}

test('la clé est stockée à part (0600), jamais renvoyée par l’API ni l’export', async (t) => {
  const fetchImpl = mockFetch({});
  const app = await startServer(undefined, { fetchImpl });
  t.after(() => app.close());

  const initial = await request(app.port, '/api/connections');
  assert.deepEqual(initial.body.openrouter, { configured: false, model: '', status: 'unconfigured', verifiedAt: null, lastError: null, updatedAt: null });

  const saved = await request(app.port, '/api/connections/openrouter', {
    method: 'PUT',
    body: { apiKey: KEY, model: 'openai/gpt-4o-mini' }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.openrouter.configured, true);
  assert.equal(saved.body.openrouter.status, 'configured');
  assert.equal(saved.body.openrouter.model, 'openai/gpt-4o-mini');
  assert.doesNotMatch(saved.text, /secret-de-test/);
  assert.equal(fetchImpl.calls.length, 0, 'enregistrer ne déclenche aucun appel fournisseur');

  const stat = await fs.stat(path.join(app.dataDir, 'connections.json'));
  assert.equal(stat.mode & 0o777, 0o600);
  assert.match(await connectionsOnDisk(app.dataDir), /secret-de-test/);

  for (const route of ['/api/state', '/api/export', '/api/connections', '/api/agency']) {
    const res = await request(app.port, route);
    assert.doesNotMatch(res.text, /secret-de-test/, `${route} ne doit pas contenir la clé`);
  }
  await createClient(app.port, { company: 'Pour forcer une écriture' });
  const db = await fs.readFile(path.join(app.dataDir, 'db.json'), 'utf8');
  assert.doesNotMatch(db, /secret-de-test/);

  const badModel = await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { model: 'pas un modèle !' } });
  assert.equal(badModel.status, 400);
  const withSpace = await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { apiKey: 'sk avec espace' } });
  assert.equal(withSpace.status, 400);

  // Changer seulement le modèle conserve la clé.
  const modelOnly = await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { model: 'anthropic/claude-sonnet-4' } });
  assert.equal(modelOnly.body.openrouter.configured, true);
  assert.equal(modelOnly.body.openrouter.model, 'anthropic/claude-sonnet-4');

  // Déconnexion : la clé disparaît réellement du disque.
  const removed = await request(app.port, '/api/connections/openrouter', { method: 'DELETE' });
  assert.equal(removed.body.openrouter.configured, false);
  assert.doesNotMatch(await connectionsOnDisk(app.dataDir), /secret-de-test/);

  const noKey = await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { model: 'x/y' } });
  assert.equal(noKey.status, 400);
});

test('le test de clé n’a lieu que sur demande et ne stocke qu’un statut sûr', async (t) => {
  let keyStatus = 200;
  const fetchImpl = mockFetch({
    [OPENROUTER_KEY_URL]: (init) => {
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
      return { status: keyStatus, body: { data: { label: 'ma-cle', limit: 10, usage: 0.5 } } };
    }
  });
  const app = await startServer(undefined, { fetchImpl });
  t.after(() => app.close());

  const noKey = await request(app.port, '/api/connections/openrouter/test', { method: 'POST' });
  assert.equal(noKey.status, 400);
  assert.equal(fetchImpl.calls.length, 0);

  await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { apiKey: KEY, model: 'openai/gpt-4o-mini' } });
  assert.equal(fetchImpl.calls.length, 0, 'aucun appel au démarrage ni à l’enregistrement');

  const ok = await request(app.port, '/api/connections/openrouter/test', { method: 'POST' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.openrouter.status, 'verified');
  assert.ok(ok.body.openrouter.verifiedAt);
  assert.equal(fetchImpl.calls.length, 1);
  assert.doesNotMatch(ok.text, /ma-cle|secret-de-test/, 'rien du corps fournisseur ni de la clé');
  assert.doesNotMatch(await connectionsOnDisk(app.dataDir), /ma-cle/);

  keyStatus = 401;
  const ko = await request(app.port, '/api/connections/openrouter/test', { method: 'POST' });
  assert.equal(ko.status, 401);
  assert.match(ko.body.error, /Clé refusée/);
  const after = (await request(app.port, '/api/connections')).body.openrouter;
  assert.equal(after.status, 'error');
  assert.equal(after.verifiedAt, null);
  assert.match(after.lastError, /401/);
  assert.equal(after.configured, true, 'la clé reste enregistrée après un test échoué');

  // Redémarrage : le statut persiste, aucun appel fournisseur au chargement.
  const before = fetchImpl.calls.length;
  await app.close();
  const again = await startServer(app.dataDir, { fetchImpl });
  t.after(() => again.close());
  assert.equal(fetchImpl.calls.length, before);
  assert.equal((await request(again.port, '/api/connections')).body.openrouter.status, 'error');
});

test('rédaction IA : succès = livrable source=ai du bon client, échec = aucun livrable', async (t) => {
  let mode = 'ok';
  const fetchImpl = mockFetch({
    [OPENROUTER_CHAT_URL]: (init) => {
      const payload = JSON.parse(init.body);
      if (mode === 'ok') {
        return {
          body: {
            id: 'gen-1',
            model: payload.model,
            choices: [{ message: { role: 'assistant', content: '# Séquence rédigée\n\nBonjour {{prenom}}, texte généré pour le test.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 300, completion_tokens: 120 }
          }
        };
      }
      if (mode === 'timeout') return new (class extends Error { name = 'AbortError'; })('aborted');
      if (mode === 'empty') return { body: { choices: [{ message: { content: '' } }] } };
      if (mode === 'error200') return { body: { error: { code: 404, message: 'No endpoints found for provider/x' } } };
      return { status: Number(mode), body: { error: { message: `Provider error body ${mode} with token sk-or-leak` } } };
    }
  });
  const app = await startServer(undefined, { fetchImpl });
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'IA Client', contact: 'Sam' });
  const other = await createClient(app.port, { company: 'Autre Client' });
  const campaign = await createCampaign(app.port, client.id, { name: 'Campagne IA' });
  await request(app.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { offer: { proofs: 'Cas client Fictif SAS : +12 RDV (source : rapport interne 2025)' }, target: { exclusions: 'Pas de B2C' } }
  });

  const unconfigured = await request(app.port, '/api/ai/generate', {
    method: 'POST',
    body: { kind: 'cold-email', clientId: client.id, campaignId: campaign.id }
  });
  assert.equal(unconfigured.status, 400);
  assert.equal(fetchImpl.calls.length, 0);

  await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { apiKey: KEY } });
  const noModel = await request(app.port, '/api/ai/generate', { method: 'POST', body: { kind: 'cold-email', clientId: client.id } });
  assert.equal(noModel.status, 400);
  assert.equal(noModel.body.field, 'model');
  await request(app.port, '/api/connections/openrouter', { method: 'PUT', body: { model: 'openai/gpt-4o-mini' } });

  const created = await request(app.port, '/api/ai/generate', {
    method: 'POST',
    body: { kind: 'cold-email', clientId: client.id, campaignId: campaign.id }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.source, 'ai');
  assert.equal(created.body.model, 'openai/gpt-4o-mini');
  assert.ok(created.body.generatedAt);
  assert.equal(created.body.generated, false, 'un texte IA n’est pas un modèle prérempli');
  assert.equal(created.body.clientId, client.id);
  assert.equal(created.body.campaignId, campaign.id);
  assert.equal(created.body.type, 'cold-email');
  assert.match(created.body.title, /\(IA\)/);
  assert.match(created.body.content, /texte généré pour le test/);
  assert.equal(created.body.usage.completionTokens, 120);

  // Requête envoyée : bearer, modèle, max_tokens borné, contexte du seul client demandé.
  assert.equal(fetchImpl.calls.length, 1);
  const sent = fetchImpl.calls[0];
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers.Authorization, `Bearer ${KEY}`);
  const payload = JSON.parse(sent.init.body);
  assert.equal(payload.model, 'openai/gpt-4o-mini');
  assert.ok(payload.max_tokens <= 2000);
  assert.deepEqual(payload.messages.map((m) => m.role), ['system', 'user']);
  const text = payload.messages.map((m) => m.content).join('\n');
  assert.match(text, /IA Client/);
  assert.match(text, /Campagne IA/);
  assert.match(text, /Cas client Fictif SAS/);
  assert.match(text, /Pas de B2C/);
  assert.doesNotMatch(text, /Autre Client/, 'le contexte des autres clients n’est pas envoyé');
  assert.doesNotMatch(text, /secret-de-test/);

  // Échecs : aucun livrable, statut utile, jamais le corps fournisseur.
  const countBefore = (await request(app.port, '/api/state')).body.deliverables.length;
  for (const [m, status, pattern] of [
    ['401', 401, /Clé refusée/],
    ['402', 402, /Crédit insuffisant/],
    ['429', 429, /Trop de requêtes/],
    ['404', 502, /Modèle introuvable.*openai\/gpt-4o-mini/],
    ['timeout', 504, /Délai dépassé/],
    ['empty', 502, /aucun texte/],
    ['error200', 502, /Modèle introuvable/]
  ]) {
    mode = m;
    const res = await request(app.port, '/api/ai/generate', { method: 'POST', body: { kind: 'creative-brief', clientId: client.id } });
    assert.equal(res.status, status, `mode ${m}`);
    assert.match(res.body.error, pattern, `mode ${m}`);
    assert.doesNotMatch(res.text, /Provider error body|sk-or-leak|No endpoints/, `mode ${m} : corps fournisseur masqué`);
  }
  const state = (await request(app.port, '/api/state')).body;
  assert.equal(state.deliverables.length, countBefore, 'aucun livrable créé sur erreur');
  assert.equal(state.deliverables.filter((d) => d.clientId === other.id).length, 0);

  // Contrôles de cohérence avant tout appel facturable.
  const callsBefore = fetchImpl.calls.length;
  mode = 'ok';
  const mismatch = await request(app.port, '/api/ai/generate', {
    method: 'POST',
    body: { kind: 'cold-email', clientId: other.id, campaignId: campaign.id }
  });
  assert.equal(mismatch.status, 400);
  const badKind = await request(app.port, '/api/ai/generate', { method: 'POST', body: { kind: 'video', clientId: client.id } });
  assert.equal(badKind.status, 400);
  assert.equal(fetchImpl.calls.length, callsBefore, 'aucun appel fournisseur sur requête invalide');

  // Le livrable IA survit à l'export/import avec son origine, et l'export Markdown l'annonce.
  const snapshot = JSON.parse((await request(app.port, '/api/export')).text);
  const fresh = await startServer(undefined, { fetchImpl });
  t.after(() => fresh.close());
  assert.equal((await request(fresh.port, '/api/import', { method: 'POST', body: snapshot })).status, 200);
  const restored = (await request(fresh.port, '/api/state')).body.deliverables.find((d) => d.id === created.body.id);
  assert.equal(restored.source, 'ai');
  assert.equal(restored.model, 'openai/gpt-4o-mini');
  const md = await request(fresh.port, `/api/clients/${client.id}/dossier.md`);
  assert.match(md.text, /Rédigé par IA via OpenRouter \(modèle openai\/gpt-4o-mini/);
  assert.equal((await request(fresh.port, '/api/connections')).body.openrouter.configured, false, 'l’import ne transporte aucune connexion');
});

test('un livrable importé avec source=ai exige un modèle ; un ancien livrable généré devient template', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const base = { version: 1, clients: [{ id: 'c1', company: 'Legacy' }], campaigns: [], tasks: [] };

  const legacy = await request(app.port, '/api/import', {
    method: 'POST',
    body: { ...base, deliverables: [{ id: 'd1', clientId: 'c1', type: 'brief', title: 'Ancien', generated: true }] }
  });
  assert.equal(legacy.status, 200);
  const state = (await request(app.port, '/api/state')).body;
  assert.equal(state.deliverables[0].source, 'template');
  assert.equal(state.deliverables[0].model, null);

  const aiNoModel = await request(app.port, '/api/import', {
    method: 'POST',
    body: { ...base, deliverables: [{ id: 'd2', clientId: 'c1', type: 'brief', title: 'IA', source: 'ai' }] }
  });
  assert.equal(aiNoModel.status, 400);
  assert.equal(aiNoModel.body.field, 'model');
});
