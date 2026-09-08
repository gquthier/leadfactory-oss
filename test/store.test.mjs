// Persistance : redémarrage, fichier corrompu, écritures concurrentes.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Store } from '../lib/store.mjs';
import { createClient, request, startServer, tempDir } from './harness.mjs';

test('les données survivent à un redémarrage du serveur', async () => {
  const dir = await tempDir();
  const first = await startServer(dir);
  const client = await createClient(first.port, { company: 'Persistance SARL' });
  await createCampaignFor(first.port, client.id);
  await first.close();

  const second = await startServer(dir);
  const state = (await request(second.port, '/api/state')).body;
  await second.close();

  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].company, 'Persistance SARL');
  assert.equal(state.campaigns.length, 1);
  assert.equal(state.campaigns[0].clientId, client.id);
});

async function createCampaignFor(port, clientId) {
  const res = await request(port, '/api/campaigns', {
    method: 'POST',
    body: { clientId, name: 'Campagne persistée', channel: 'meta' }
  });
  assert.equal(res.status, 201);
  return res.body;
}

test('un redémarrage n écrase jamais un fichier existant', async () => {
  const dir = await tempDir();
  const app = await startServer(dir);
  await createClient(app.port, { company: 'Client A' });
  const before = await fs.readFile(path.join(dir, 'db.json'), 'utf8');
  await app.close();

  const again = await startServer(dir);
  const after = await fs.readFile(path.join(dir, 'db.json'), 'utf8');
  await again.close();

  assert.equal(after, before, 'le fichier ne doit pas être réécrit au démarrage');
});

test('un fichier JSON corrompu lève une erreur explicite (pas de réinitialisation)', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'db.json'), '{ "clients": [ ', 'utf8');
  const store = new Store(dir);
  await assert.rejects(() => store.load(), /illisible|JSON invalide/i);
  const stillThere = await fs.readFile(path.join(dir, 'db.json'), 'utf8');
  assert.match(stillThere, /"clients"/);
});

test('un fichier structurellement invalide lève une erreur explicite', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify({ version: 1, clients: { nope: true }, campaigns: [], tasks: [], deliverables: [] }), 'utf8');
  const store = new Store(dir);
  await assert.rejects(() => store.load(), /doit être un tableau/);
});

test('un fichier avec une relation cassée est refusé au chargement', async () => {
  const dir = await tempDir();
  await fs.writeFile(
    path.join(dir, 'db.json'),
    JSON.stringify({ version: 1, clients: [], campaigns: [{ id: 'c1', clientId: 'inconnu', name: 'X', channel: 'meta' }], tasks: [], deliverables: [] }),
    'utf8'
  );
  const store = new Store(dir);
  await assert.rejects(() => store.load(), /Client introuvable/);
});

test('les écritures concurrentes sont sérialisées sans perte', async () => {
  const dir = await tempDir();
  const app = await startServer(dir);
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      request(app.port, '/api/clients', { method: 'POST', body: { company: `Client ${i}` } })
    )
  );
  await app.close();

  const raw = JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(raw.clients.length, 25);
  assert.equal(new Set(raw.clients.map((c) => c.id)).size, 25);

  const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'aucun fichier temporaire ne doit rester');
});

test('une base absente démarre vide sans créer de fichier', async () => {
  const dir = await tempDir();
  const store = new Store(dir);
  const db = await store.load();
  assert.deepEqual(db.clients, []);
  await assert.rejects(() => fs.stat(path.join(dir, 'db.json')));
  await store.close();
});

test('une seconde instance sur le même dossier est refusée tant que la première tourne', async () => {
  const dir = await tempDir();
  const first = await startServer(dir);
  await createClient(first.port, { company: 'Titulaire' });

  const lock = JSON.parse(await fs.readFile(path.join(dir, 'db.lock'), 'utf8'));
  assert.equal(lock.pid, process.pid);

  const second = new Store(dir);
  await assert.rejects(() => second.load(), /déjà utilisé par le processus/);
  // Le verrou actif n'a pas été touché.
  assert.equal((await fs.readFile(path.join(dir, 'db.lock'), 'utf8')).includes(`"pid":${process.pid}`), true);

  await first.close();
  await assert.rejects(() => fs.stat(path.join(dir, 'db.lock')), 'le verrou est relâché à la fermeture');

  const third = await startServer(dir);
  assert.equal((await request(third.port, '/api/state')).body.clients.length, 1);
  await third.close();
});

test('un verrou laissé par un processus mort est récupéré, un verrou illisible ne l’est pas', async () => {
  const dir = await tempDir();
  // PID d'un vrai processus enfant terminé : vérifié mort avant récupération.
  const child = spawn(process.execPath, ['-e', '0']);
  const deadPid = child.pid;
  await new Promise((resolve) => child.on('exit', resolve));
  await fs.writeFile(path.join(dir, 'db.lock'), JSON.stringify({ pid: deadPid }), 'utf8');

  const store = new Store(dir);
  await store.load();
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'db.lock'), 'utf8')).pid, process.pid);
  await store.close();

  await fs.writeFile(path.join(dir, 'db.lock'), 'pas du json', 'utf8');
  const other = new Store(dir);
  await assert.rejects(() => other.load(), /Verrou illisible/);
  assert.equal(await fs.readFile(path.join(dir, 'db.lock'), 'utf8'), 'pas du json');
});

test('un chargement en échec relâche le verrou', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'db.json'), '{ "clients": [ ', 'utf8');
  const store = new Store(dir);
  await assert.rejects(() => store.load());
  await assert.rejects(() => fs.stat(path.join(dir, 'db.lock')));
});
