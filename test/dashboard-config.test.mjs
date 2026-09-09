// Configuration du tableau de bord : défauts, validation, persistance,
// export/import, compatibilité des bases écrites avant cette configuration.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { dashboardInput, defaultDashboard } from '../lib/dashboard-config.mjs';
import { createClient, request, startServer, tempDir } from './harness.mjs';

const DEFAULTS = { title: 'Tableau de bord', intro: 'Compteurs calculés à partir de vos saisies uniquement.', sections: ['metrics', 'tasks'] };

async function readDb(dataDir) {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'db.json'), 'utf8'));
}

test('la configuration par défaut décrit le tableau de bord actuel', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.deepEqual(defaultDashboard(), DEFAULTS);

  const res = await request(app.port, '/api/dashboard');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, DEFAULTS);

  // La même configuration est visible dans l'état complet lu par la page.
  assert.deepEqual((await request(app.port, '/api/state')).body.dashboard, DEFAULTS);
});

test('un PUT valide remplace la configuration et survit à un redémarrage', async () => {
  const dir = await tempDir();
  const app = await startServer(dir);

  const wanted = { title: 'Cockpit Acme', intro: 'Vue agence, mise à jour par les agents.', sections: ['tasks', 'metrics'] };
  const put = await request(app.port, '/api/dashboard', { method: 'PUT', body: wanted });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, wanted);
  assert.deepEqual((await request(app.port, '/api/dashboard')).body, wanted);
  await app.close();

  const restarted = await startServer(dir);
  assert.deepEqual((await request(restarted.port, '/api/dashboard')).body, wanted);
  await restarted.close();
});

test('un champ absent reprend sa valeur par défaut : le PUT décrit tout l\'état', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await request(app.port, '/api/dashboard', { method: 'PUT', body: { title: 'Premier', intro: 'Un texte', sections: ['tasks'] } });
  const second = await request(app.port, '/api/dashboard', { method: 'PUT', body: { title: 'Second' } });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { title: 'Second', intro: DEFAULTS.intro, sections: DEFAULTS.sections });

  // Une intro vide est acceptée (pas de sous-titre), un tableau d'une seule section aussi.
  const minimal = await request(app.port, '/api/dashboard', { method: 'PUT', body: { title: 'Titre', intro: '', sections: ['metrics'] } });
  assert.equal(minimal.status, 200);
  assert.deepEqual(minimal.body, { title: 'Titre', intro: '', sections: ['metrics'] });
});

test('une configuration invalide est refusée et n\'écrit rien', async (t) => {
  const dir = await tempDir();
  const app = await startServer(dir);
  t.after(() => app.close());

  const valid = { title: 'Référence', intro: 'Intacte', sections: ['metrics'] };
  assert.equal((await request(app.port, '/api/dashboard', { method: 'PUT', body: valid })).status, 200);
  const before = await readDb(dir);

  const rejected = [
    [{ title: 42 }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(200) }, 'title'],
    [{ intro: 'x'.repeat(500) }, 'intro'],
    [{ intro: { texte: 'objet' } }, 'intro'],
    [{ sections: 'metrics' }, 'sections'],
    [{ sections: [] }, 'sections'],
    [{ sections: ['metrics', 'metrics'] }, 'sections'],
    [{ sections: ['metrics', 'tasks', 'metrics'] }, 'sections'],
    [{ sections: ['facturation'] }, 'sections'],
    [{ sections: [{ name: 'metrics' }] }, 'sections'],
    [{ sections: ['<script>alert(1)</script>'] }, 'sections'],
    [{ title: 'OK', couleur: 'rouge' }, 'couleur'],
    [{ script: 'fetch("http://exemple.test")' }, 'script'],
    [['metrics'], null],
    ['metrics', null],
    [null, null]
  ];
  for (const [body, field] of rejected) {
    const res = await request(app.port, '/api/dashboard', { method: 'PUT', body });
    assert.equal(res.status, 400, `attendu 400 pour ${JSON.stringify(body)} : ${res.text}`);
    if (field) assert.equal(res.body.field, field, `champ signalé pour ${JSON.stringify(body)}`);
  }

  assert.deepEqual((await request(app.port, '/api/dashboard')).body, valid);
  assert.deepEqual(await readDb(dir), before, 'aucune écriture disque après un refus');
});

test('la configuration ne stocke que du texte : aucun HTML n\'est interprété côté données', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const payload = { title: '<b>Titre</b>', intro: '<img src=x onerror=alert(1)>', sections: ['metrics'] };
  const res = await request(app.port, '/api/dashboard', { method: 'PUT', body: payload });
  assert.equal(res.status, 200);
  // Rendu tel quel, comme du texte : la page utilise textContent (voir public/app.js).
  assert.deepEqual(res.body, payload);
});

test('le tableau de bord refuse les autres méthodes et les sous-chemins', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await request(app.port, '/api/dashboard', { method: 'POST', body: {} })).status, 405);
  assert.equal((await request(app.port, '/api/dashboard', { method: 'DELETE' })).status, 405);
  assert.equal((await request(app.port, '/api/dashboard/sections')).status, 404);
});

test('la configuration voyage dans l\'export et revient par l\'import', async (t) => {
  const source = await startServer();
  const client = await createClient(source.port, { company: 'Export SARL' });
  const wanted = { title: 'Cockpit exporté', intro: 'Conservé', sections: ['tasks'] };
  await request(source.port, '/api/dashboard', { method: 'PUT', body: wanted });
  const exported = (await request(source.port, '/api/export')).body;
  await source.close();

  assert.deepEqual(exported.dashboard, wanted);

  const target = await startServer();
  t.after(() => target.close());
  const imported = await request(target.port, '/api/import', { method: 'POST', body: exported });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported.dashboard, true);
  assert.deepEqual((await request(target.port, '/api/dashboard')).body, wanted);
  assert.equal((await request(target.port, '/api/clients')).body[0].id, client.id);
});

test('un import sans configuration conserve celle en place', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const mine = { title: 'Mon cockpit', intro: 'À moi', sections: ['metrics'] };
  await request(app.port, '/api/dashboard', { method: 'PUT', body: mine });

  const legacy = { version: 1, clients: [], campaigns: [], tasks: [], deliverables: [] };
  const imported = await request(app.port, '/api/import', { method: 'POST', body: legacy });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported.dashboard, false);
  assert.deepEqual((await request(app.port, '/api/dashboard')).body, mine);
});

test('une base écrite avant cette configuration démarre sur les valeurs par défaut', async () => {
  const dir = await tempDir();
  const legacy = {
    version: 1,
    agency: { name: 'Agence Historique', offer: '', audience: '', language: 'fr', contact: '', email: '', tools: { assistant: '', skillsInstalled: false }, updatedAt: null },
    clients: [
      {
        id: 'client-legacy',
        company: 'Ancien Client',
        contact: '',
        email: '',
        offer: '',
        audience: '',
        goal: '',
        budget: 0,
        notes: '',
        status: 'actif',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      }
    ],
    campaigns: [],
    tasks: [],
    deliverables: []
  };
  await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify(legacy, null, 2), 'utf8');

  const app = await startServer(dir);
  assert.deepEqual((await request(app.port, '/api/dashboard')).body, DEFAULTS);
  assert.equal((await request(app.port, '/api/clients')).body[0].company, 'Ancien Client');

  // Personnaliser n'efface rien de l'ancienne base.
  const wanted = { title: 'Cockpit migré', intro: '', sections: ['tasks'] };
  assert.equal((await request(app.port, '/api/dashboard', { method: 'PUT', body: wanted })).status, 200);
  const onDisk = await readDb(dir);
  await app.close();

  assert.deepEqual(onDisk.dashboard, wanted);
  assert.equal(onDisk.clients.length, 1);
  assert.equal(onDisk.clients[0].id, 'client-legacy');
  assert.equal(onDisk.agency.name, 'Agence Historique');
});

test('changer la configuration change la révision, la remettre à l\'identique la restaure', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const revision = async () => (await request(app.port, '/api/meta')).body.revision;
  const start = await revision();

  await request(app.port, '/api/dashboard', { method: 'PUT', body: { title: 'Autre cockpit', sections: ['tasks'] } });
  const changed = await revision();
  assert.notEqual(changed, start, 'le sondage doit voir la personnalisation');

  await request(app.port, '/api/dashboard', { method: 'PUT', body: { title: 'Autre cockpit', sections: ['tasks'] } });
  assert.equal(await revision(), changed, 'même configuration = même empreinte');

  await request(app.port, '/api/dashboard', { method: 'PUT', body: DEFAULTS });
  assert.equal(await revision(), start, 'retour aux valeurs par défaut = empreinte initiale');
});

test('dashboardInput valide sans dépendre du serveur', () => {
  assert.deepEqual(dashboardInput({}), DEFAULTS);
  assert.deepEqual(dashboardInput({ title: '  Espacé  ' }).title, 'Espacé');
  assert.deepEqual(dashboardInput({ sections: ['tasks', 'metrics'] }).sections, ['tasks', 'metrics']);

  // Le résultat est une copie : muter l'entrée ne modifie pas la configuration validée.
  const sections = ['metrics'];
  const parsed = dashboardInput({ sections });
  sections.push('tasks');
  assert.deepEqual(parsed.sections, ['metrics']);

  for (const bad of [{ sections: ['inconnue'] }, { extra: 1 }, { title: '' }, null, [], 'x']) {
    assert.throws(() => dashboardInput(bad), { status: 400 }, `attendu un refus pour ${JSON.stringify(bad)}`);
  }
});
