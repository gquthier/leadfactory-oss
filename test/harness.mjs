// Utilitaires partagés par les tests (aucun test ici).

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../lib/app.mjs';

export async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'leadfactory-test-'));
}

export async function startServer(dataDir, options = {}) {
  const dir = dataDir ?? (await tempDir());
  const app = await createApp({ dataDir: dir, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  return {
    ...app,
    dataDir: dir,
    port,
    async close() {
      await app.close();
    }
  };
}

/**
 * Transport OpenRouter simulé : `routes` associe une URL à une fonction
 * (init) => { status, body } ; chaque appel est journalisé dans `calls`.
 */
export function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) throw new Error(`URL inattendue dans le test : ${url}`);
    const result = await handler(init, calls.length);
    if (result instanceof Error) throw result;
    const status = result.status ?? 200;
    const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return JSON.parse(text);
      },
      async text() {
        return text;
      }
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** Client HTTP bas niveau : permet de forger Host, Origin, Content-Type. */
export function request(port, urlPath, { method = 'GET', body, headers = {}, json = true } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const finalHeaders = { ...headers };
    if (payload !== null && json && !Object.keys(finalHeaders).some((h) => h.toLowerCase() === 'content-type')) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    if (payload !== null) finalHeaders['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: finalHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, body: data });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

export async function createClient(port, overrides = {}) {
  const res = await request(port, '/api/clients', {
    method: 'POST',
    body: { company: 'Agence Test', contact: 'Alex', offer: 'Lead gen', audience: 'PME', goal: '10 RDV', budget: 1000, ...overrides }
  });
  if (res.status !== 201) throw new Error(`Création client échouée : ${res.text}`);
  return res.body;
}

export async function createCampaign(port, clientId, overrides = {}) {
  const res = await request(port, '/api/campaigns', {
    method: 'POST',
    body: { clientId, name: 'Campagne test', channel: 'cold-email', goal: 'Tester', budget: 500, ...overrides }
  });
  if (res.status !== 201) throw new Error(`Création campagne échouée : ${res.text}`);
  return res.body;
}
