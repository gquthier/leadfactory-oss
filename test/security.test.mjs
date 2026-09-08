// Garde-fous : Host, Origin, Sec-Fetch-Site, type de contenu, taille, traversée de chemin.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient, request, startServer } from './harness.mjs';

test('un en-tête Host étranger est refusé (protection anti DNS rebinding)', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const evil = await request(app.port, '/api/state', { headers: { Host: 'attaquant.example.com' } });
  assert.equal(evil.status, 403);
  assert.match(evil.body.error, /Hôte non autorisé/);

  const ok = await request(app.port, '/api/state', { headers: { Host: `localhost:${app.port}` } });
  assert.equal(ok.status, 200);
});

test('une écriture depuis un autre site est refusée', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const crossOrigin = await request(app.port, '/api/clients', {
    method: 'POST',
    body: { company: 'Injecté' },
    headers: { Origin: 'https://site-tiers.example.com' }
  });
  assert.equal(crossOrigin.status, 403);

  const crossSite = await request(app.port, '/api/clients', {
    method: 'POST',
    body: { company: 'Injecté' },
    headers: { 'Sec-Fetch-Site': 'cross-site' }
  });
  assert.equal(crossSite.status, 403);

  // Origin « null », loopback sur un autre port, ou hôte loopback différent du Host : refusés.
  for (const origin of ['null', `http://127.0.0.1:${app.port + 1}`, `http://localhost:${app.port}`, `https://127.0.0.1:${app.port}`, '']) {
    const res = await request(app.port, '/api/clients', {
      method: 'POST',
      body: { company: 'Injecté' },
      headers: { Origin: origin }
    });
    assert.equal(res.status, 403, `Origin "${origin}" devrait être refusé`);
  }
  const aiRoute = await request(app.port, '/api/connections/openrouter', {
    method: 'PUT',
    body: { apiKey: 'sk-or-test' },
    headers: { Origin: `http://127.0.0.1:${app.port + 1}` }
  });
  assert.equal(aiRoute.status, 403);

  const sameOrigin = await request(app.port, '/api/clients', {
    method: 'POST',
    body: { company: 'Légitime' },
    headers: { Origin: `http://127.0.0.1:${app.port}`, 'Sec-Fetch-Site': 'same-origin' }
  });
  assert.equal(sameOrigin.status, 201);

  // Sans Origin (curl, script local) : accepté.
  const cli = await request(app.port, '/api/clients', { method: 'POST', body: { company: 'CLI' } });
  assert.equal(cli.status, 201);

  assert.equal((await request(app.port, '/api/state')).body.clients.length, 2);
  assert.equal((await request(app.port, '/api/connections')).body.openrouter.configured, false);
});

test('un formulaire HTML cross-site ne peut pas écrire (Content-Type refusé)', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const form = await request(app.port, '/api/clients', {
    method: 'POST',
    body: 'company=Injecte',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(form.status, 415);

  const plain = await request(app.port, '/api/clients', {
    method: 'POST',
    body: JSON.stringify({ company: 'Injecte' }),
    headers: { 'Content-Type': 'text/plain' }
  });
  assert.equal(plain.status, 415);
});

test(`aucun en-tête CORS permissif n'est renvoyé`, async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const res = await request(app.port, '/api/state', { headers: { Origin: 'https://site-tiers.example.com' } });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers['access-control-allow-credentials'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('les corps de requête trop volumineux sont rejetés', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port);

  const huge = await request(app.port, '/api/deliverables', {
    method: 'POST',
    body: JSON.stringify({ clientId: client.id, type: 'brief', title: 'X', content: 'a'.repeat(2_500_000) })
  });
  assert.equal(huge.status, 413);

  const tooLongContent = await request(app.port, '/api/deliverables', {
    method: 'POST',
    body: { clientId: client.id, type: 'brief', title: 'X', content: 'a'.repeat(50_000) }
  });
  assert.equal(tooLongContent.status, 400);
});

test('la traversée de chemin sur les fichiers statiques est bloquée', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (const attempt of ['/%2e%2e/server.mjs', '/..%2fserver.mjs', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/../lib/store.mjs']) {
    const res = await request(app.port, attempt);
    assert.ok(res.status === 403 || res.status === 404, `${attempt} devrait être refusé (reçu ${res.status})`);
    assert.doesNotMatch(res.text, /createApp|randomUUID/);
  }

  const page = await request(app.port, '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
});

test(`les fichiers statiques ne répondent qu'en lecture`, async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const res = await request(app.port, '/index.html', { method: 'POST', body: {} });
  assert.equal(res.status, 405);
});
