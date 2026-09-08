// Protection d'accès du cockpit embarqué (lib/dashboard-access.mjs).
//
// Mode autonome : aucun changement. Mode embarqué : toutes les routes /api/*
// exigent le jeton de service ou une session ouverte par ticket.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SESSIONS,
  MAX_TICKETS,
  SESSION_TTL_MS,
  TICKET_TTL_MS,
  createDashboardAccess,
  readBearer,
  readCookie
} from '../lib/dashboard-access.mjs';
import { createApp } from '../lib/app.mjs';
import { createClient, request, startServer, tempDir } from './harness.mjs';

// Jeton de service factice : aucun vrai secret ici.
const TOKEN = 'jeton-de-service-de-test-0123456789abcdef';
const bearer = { Authorization: `Bearer ${TOKEN}` };

function setCookie(res) {
  const raw = res.headers['set-cookie'];
  assert.ok(Array.isArray(raw) && raw.length === 1, 'un seul cookie attendu');
  const [pair, ...attrs] = raw[0].split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes: attrs, raw: raw[0] };
}

/** Ouvre une session comme le fera la page : ticket puis échange. */
async function openSession(app) {
  const ticket = app.issueDashboardTicket();
  const res = await request(app.port, '/api/session', { method: 'POST', body: { ticket } });
  assert.equal(res.status, 200, res.text);
  const cookie = setCookie(res);
  return { ticket, cookie, header: { Cookie: `${cookie.name}=${cookie.value}` } };
}

// --- Mode autonome : rien ne change ---------------------------------------

test('sans accessToken, le comportement mono-utilisateur est inchangé', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await request(app.port, '/api/state')).status, 200);
  assert.equal((await request(app.port, '/api/meta')).status, 200);
  const client = await createClient(app.port);
  assert.equal((await request(app.port, `/api/clients/${client.id}`)).status, 200);

  // La route d'échange n'existe pas : elle reste une route inconnue.
  const session = await request(app.port, '/api/session', { method: 'POST', body: { ticket: 'a'.repeat(64) } });
  assert.equal(session.status, 404);
  assert.equal(session.headers['set-cookie'], undefined);
});

test('issueDashboardTicket() sans accessToken lève une erreur explicite', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.throws(() => app.issueDashboardTicket(), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /accessToken/);
    assert.match(err.message, /autonome/);
    return true;
  });
});

// --- Validation du jeton de service ---------------------------------------

test('un jeton de service trop court ou mal typé est refusé sans laisser de verrou', async () => {
  const dir = await tempDir();
  await assert.rejects(() => createApp({ dataDir: dir, accessToken: 'trop-court' }), /32 caractères/);
  await assert.rejects(() => createApp({ dataDir: dir, accessToken: 123 }), TypeError);
  await assert.rejects(() => createApp({ dataDir: dir, accessToken: '' }), /32 caractères/);

  // Le dossier reste utilisable : aucun verrou n'a été pris au passage.
  const app = await createApp({ dataDir: dir, accessToken: TOKEN });
  await app.close();
});

test('un jeton d\'exactement 32 caractères est accepté', async () => {
  const app = await createApp({ dataDir: await tempDir(), accessToken: 'a'.repeat(32) });
  await app.close();
});

// --- Fermeture : lectures et mutations ------------------------------------

test('sans autorisation, toutes les routes /api répondent 401 sans données', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  const routes = ['/api/state', '/api/meta', '/api/clients', '/api/export', '/api/limits', '/api/connections', '/api/onboarding/schema'];
  for (const route of routes) {
    const res = await request(app.port, route);
    assert.equal(res.status, 401, `${route} devrait être fermée`);
    assert.deepEqual(Object.keys(res.body).sort(), ['error', 'field']);
    assert.equal(res.body.field, null);
  }
});

test('une mutation non autorisée est refusée et ne touche pas aux données', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  const created = await request(app.port, '/api/clients', {
    method: 'POST',
    headers: bearer,
    body: { company: 'Client protégé' }
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  for (const attempt of [
    { path: '/api/clients', method: 'POST', body: { company: 'Intrus' } },
    { path: `/api/clients/${id}`, method: 'PATCH', body: { company: 'Renommé' } },
    { path: `/api/clients/${id}`, method: 'DELETE' },
    { path: '/api/import', method: 'POST', body: { version: 1, clients: [], campaigns: [], tasks: [], deliverables: [] } },
    { path: '/api/demo', method: 'POST' },
    { path: '/api/agency', method: 'PUT', body: { name: 'Intrus' } }
  ]) {
    const res = await request(app.port, attempt.path, { method: attempt.method, body: attempt.body });
    assert.equal(res.status, 401, `${attempt.method} ${attempt.path}`);
  }

  const after = await request(app.port, '/api/state', { headers: bearer });
  assert.equal(after.body.clients.length, 1);
  assert.equal(after.body.clients[0].id, id);
  assert.equal(after.body.clients[0].company, 'Client protégé');
  assert.equal(after.body.agency.name, '');
});

// --- Jeton de service (Bearer) --------------------------------------------

test('le Bearer exact ouvre l\'API, toute variante est refusée', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  assert.equal((await request(app.port, '/api/state', { headers: bearer })).status, 200);

  const variantes = {
    'jeton faux de même longueur': `Bearer ${'x'.repeat(TOKEN.length)}`,
    'jeton tronqué': `Bearer ${TOKEN.slice(0, -1)}`,
    'jeton avec suffixe': `Bearer ${TOKEN}x`,
    'schéma en minuscules': `bearer ${TOKEN}`,
    'schéma absent': TOKEN,
    'schéma Basic': `Basic ${TOKEN}`,
    'double espace': `Bearer  ${TOKEN}`,
    'valeur vide': 'Bearer ',
    'espaces internes': `Bearer ${TOKEN} extra`
  };
  for (const [label, value] of Object.entries(variantes)) {
    const res = await request(app.port, '/api/state', { headers: { Authorization: value } });
    assert.equal(res.status, 401, `refus attendu : ${label}`);
  }

  // Le jeton ne doit jamais servir depuis une URL.
  assert.equal((await request(app.port, `/api/state?token=${TOKEN}`)).status, 401);
});

test('le Bearer n\'ouvre aucune capacité hors de l\'API existante', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  assert.equal((await request(app.port, '/api/inconnue', { headers: bearer })).status, 404);
  assert.equal((await request(app.port, '/api/session', { headers: bearer })).status, 404);
  assert.equal((await request(app.port, '/api/state', { method: 'DELETE', headers: bearer })).status, 404);
  // Hôte non autorisé : la garde d'hôte reste prioritaire sur le jeton.
  const forged = await request(app.port, '/api/state', { headers: { ...bearer, Host: 'exemple.test' } });
  assert.equal(forged.status, 403);
});

// --- Ticket d'ouverture et session ----------------------------------------

test('issueDashboardTicket() rend un ticket unique de 64 hexadécimaux', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  const tickets = new Set();
  for (let i = 0; i < 5; i += 1) {
    const ticket = app.issueDashboardTicket();
    assert.match(ticket, /^[0-9a-f]{64}$/);
    assert.ok(!tickets.has(ticket), 'chaque ticket est distinct');
    assert.ok(!ticket.includes(TOKEN));
    tickets.add(ticket);
  }
});

test('ticket échangé : cookie durci, corps sans secret, puis CRUD complet', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  const ticket = app.issueDashboardTicket();
  const res = await request(app.port, '/api/session', { method: 'POST', body: { ticket } });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { authenticated: true });
  assert.ok(!res.text.includes(ticket), 'le ticket n\'est pas renvoyé');
  assert.ok(!res.text.includes(TOKEN), 'le jeton de service n\'est jamais renvoyé');

  const cookie = setCookie(res);
  assert.match(cookie.name, /^lf_dashboard_[0-9a-f]{12}$/);
  assert.match(cookie.value, /^[0-9a-f]{64}$/);
  assert.notEqual(cookie.value, ticket);
  assert.ok(!res.text.includes(cookie.value), 'la valeur du cookie n\'apparaît pas dans le JSON');
  assert.ok(cookie.attributes.includes('HttpOnly'));
  assert.ok(cookie.attributes.includes('SameSite=Strict'));
  assert.ok(cookie.attributes.includes('Path=/'));
  assert.ok(cookie.attributes.includes(`Max-Age=${SESSION_TTL_MS / 1000}`));
  assert.ok(!/domain=/i.test(cookie.raw), 'aucun Domain : le cookie ne déborde pas');

  // La session donne accès à l'API métier complète, lecture et écriture.
  const headers = { Cookie: `${cookie.name}=${cookie.value}` };
  assert.equal((await request(app.port, '/api/state', { headers })).status, 200);

  const created = await request(app.port, '/api/clients', { method: 'POST', headers, body: { company: 'Via session' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  assert.equal((await request(app.port, `/api/clients/${id}`, { headers })).status, 200);
  const patched = await request(app.port, `/api/clients/${id}`, { method: 'PATCH', headers, body: { goal: '12 RDV' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.goal, '12 RDV');
  assert.equal((await request(app.port, `/api/clients/${id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await request(app.port, '/api/state', { headers })).body.clients.length, 0);
});

test('un ticket rejoué, inconnu ou malformé est refusé sans indice', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  const ticket = app.issueDashboardTicket();
  assert.equal((await request(app.port, '/api/session', { method: 'POST', body: { ticket } })).status, 200);

  const replay = await request(app.port, '/api/session', { method: 'POST', body: { ticket } });
  assert.equal(replay.status, 401, 'usage unique');
  assert.equal(replay.headers['set-cookie'], undefined);
  assert.ok(!replay.text.includes(ticket));
  assert.ok(!replay.text.includes(TOKEN));

  const corps = [
    { ticket: 'b'.repeat(64) },
    { ticket: ticket.toUpperCase() },
    { ticket: `${ticket} ` },
    { ticket: '' },
    { ticket: null },
    { ticket: 42 },
    { ticket: [ticket] },
    { ticket, extra: 'non prévu' },
    { Ticket: ticket },
    {},
    [ticket],
    null
  ];
  for (const body of corps) {
    const res = await request(app.port, '/api/session', { method: 'POST', body });
    assert.equal(res.status, 401, `refus attendu pour ${JSON.stringify(body)}`);
    assert.equal(res.headers['set-cookie'], undefined);
  }

  // Corps JSON valide mais scalaire, et corps illisible : refusés eux aussi.
  const scalaire = await request(app.port, '/api/session', { method: 'POST', body: '"ticket"' });
  assert.equal(scalaire.status, 401);
  const illisible = await request(app.port, '/api/session', { method: 'POST', body: '{ticket' });
  assert.equal(illisible.status, 400, 'JSON invalide : refusé par la lecture du corps');
  assert.equal(illisible.headers['set-cookie'], undefined);
  assert.ok(!illisible.text.includes(ticket) && !illisible.text.includes(TOKEN));

  // Même message pour tous les refus : aucun oracle sur la cause.
  const messages = new Set();
  for (const body of [{ ticket: 'c'.repeat(64) }, { ticket: 'pas-un-ticket' }, {}]) {
    messages.add((await request(app.port, '/api/session', { method: 'POST', body })).body.error);
  }
  assert.equal(messages.size, 1);
});

test('GET /api/session n\'est pas un contournement', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  const ticket = app.issueDashboardTicket();
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const res = await request(app.port, '/api/session', { method, body: method === 'GET' ? undefined : { ticket } });
    assert.equal(res.status, 401, `${method} /api/session`);
    assert.equal(res.headers['set-cookie'], undefined);
  }
  assert.equal((await request(app.port, `/api/session?ticket=${ticket}`)).status, 401);

  // Le ticket n'a été consommé par aucune de ces tentatives.
  assert.equal((await request(app.port, '/api/session', { method: 'POST', body: { ticket } })).status, 200);
});

test('un cookie d\'une autre instance est refusé', async (t) => {
  const first = await startServer(undefined, { accessToken: TOKEN });
  const second = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => Promise.all([first.close(), second.close()]));

  const a = await openSession(first);
  const b = await openSession(second);

  assert.notEqual(a.cookie.name, b.cookie.name, 'nom de cookie propre à chaque instance');
  assert.equal((await request(second.port, '/api/state', { headers: a.header })).status, 401);
  assert.equal((await request(first.port, '/api/state', { headers: b.header })).status, 401);

  // Même sous le bon nom de cookie, la valeur de l'autre instance ne vaut rien.
  const usurpation = { Cookie: `${b.cookie.name}=${a.cookie.value}` };
  assert.equal((await request(second.port, '/api/state', { headers: usurpation })).status, 401);

  // Chacune garde la sienne.
  assert.equal((await request(first.port, '/api/state', { headers: a.header })).status, 200);
  assert.equal((await request(second.port, '/api/state', { headers: b.header })).status, 200);
});

test('un cookie forgé ou tronqué ne passe pas', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());
  const { cookie } = await openSession(app);

  const forgeries = [
    `${cookie.name}=${'d'.repeat(64)}`,
    `${cookie.name}=${cookie.value.slice(0, -1)}`,
    `${cookie.name}=${cookie.value.toUpperCase()}`,
    `${cookie.name}=`,
    `lf_dashboard_000000000000=${cookie.value}`,
    `__proto__=${cookie.value}`,
    `constructor=${cookie.value}`,
    `${cookie.name}=${TOKEN}`
  ];
  for (const value of forgeries) {
    const res = await request(app.port, '/api/state', { headers: { Cookie: value } });
    assert.equal(res.status, 401, `refus attendu : ${value.slice(0, 40)}`);
  }

  // Un cookie valide noyé parmi d'autres reste valide.
  const melange = `autre=1; ${cookie.name}=${cookie.value}; encore=2`;
  assert.equal((await request(app.port, '/api/state', { headers: { Cookie: melange } })).status, 200);
});

// --- Gardes conservées avant l'autorisation -------------------------------

test('une écriture d\'origine étrangère est refusée en 403 même avec un cookie valide', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());
  const { header } = await openSession(app);

  const croise = await request(app.port, '/api/clients', {
    method: 'POST',
    headers: { ...header, Origin: 'http://exemple.test' },
    body: { company: 'Site tiers' }
  });
  assert.equal(croise.status, 403, 'checkWriteRequest passe avant l\'autorisation');

  const siteCroise = await request(app.port, '/api/clients', {
    method: 'POST',
    headers: { ...header, 'Sec-Fetch-Site': 'cross-site' },
    body: { company: 'Site tiers' }
  });
  assert.equal(siteCroise.status, 403);

  // Et le ticket lui-même ne s'échange pas depuis une autre origine.
  const ticket = app.issueDashboardTicket();
  const echange = await request(app.port, '/api/session', {
    method: 'POST',
    headers: { Origin: 'http://exemple.test' },
    body: { ticket }
  });
  assert.equal(echange.status, 403);
  assert.equal(echange.headers['set-cookie'], undefined);

  assert.equal((await request(app.port, '/api/state', { headers: header })).body.clients.length, 0);
});

test('les fichiers statiques restent servis : la page peut échanger son ticket', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  t.after(() => app.close());

  for (const route of ['/', '/index.html', '/app.js', '/styles.css', '/live-refresh.js']) {
    assert.equal((await request(app.port, route)).status, 200, route);
  }
  // Ouvrir les statiques n'ouvre pas le disque : la traversée reste bloquée.
  for (const attempt of ['/%2e%2e/server.mjs', '/..%2flib%2fdashboard-access.mjs', '/../lib/app.mjs']) {
    const res = await request(app.port, attempt);
    assert.ok(res.status === 403 || res.status === 404, `${attempt} reçu ${res.status}`);
    assert.doesNotMatch(res.text, /createDashboardAccess|accessToken/);
  }
});

// --- Absence de fuite -----------------------------------------------------

test('ni meta, ni export, ni les erreurs ne contiennent de secret', async (t) => {
  const app = await startServer(undefined, { accessToken: TOKEN, hostedBy: 'bizos-local' });
  t.after(() => app.close());
  const { ticket, cookie, header } = await openSession(app);
  await request(app.port, '/api/clients', { method: 'POST', headers: header, body: { company: 'Confidentiel' } });

  const secrets = [TOKEN, ticket, cookie.value];
  const reponses = [
    await request(app.port, '/api/meta', { headers: header }),
    await request(app.port, '/api/export', { headers: header }),
    await request(app.port, '/api/state', { headers: header }),
    await request(app.port, '/api/connections', { headers: header }),
    await request(app.port, '/api/state'),
    await request(app.port, '/api/state', { headers: { Authorization: `Bearer ${'z'.repeat(40)}` } }),
    await request(app.port, '/api/session', { method: 'POST', body: { ticket: 'e'.repeat(64) } })
  ];
  for (const res of reponses) {
    for (const secret of secrets) {
      assert.ok(!res.text.includes(secret), `secret exposé dans : ${res.text.slice(0, 120)}`);
    }
    assert.equal(res.headers['set-cookie'], undefined);
  }

  // La forme de /api/meta reste celle attendue, hostedBy inclus.
  const meta = (await request(app.port, '/api/meta', { headers: header })).body;
  assert.deepEqual(Object.keys(meta).sort(), ['apiVersion', 'hostedBy', 'instanceId', 'product', 'revision']);
  assert.equal(meta.hostedBy, 'bizos-local');
  const exported = (await request(app.port, '/api/export', { headers: header })).body;
  assert.deepEqual(Object.keys(exported).sort(), ['agency', 'campaigns', 'clients', 'deliverables', 'tasks', 'version']);
});

// --- Cycle de vie ---------------------------------------------------------

test('close() invalide tickets et sessions', async () => {
  const app = await startServer(undefined, { accessToken: TOKEN });
  const ticket = app.issueDashboardTicket();
  const { header } = await openSession(app);
  assert.equal((await request(app.port, '/api/state', { headers: header })).status, 200);

  await app.close();

  assert.throws(() => app.issueDashboardTicket(), /fermée/);
  // Le ticket resté en main ne vaut plus rien : le serveur ne répond plus.
  await assert.rejects(() => request(app.port, '/api/session', { method: 'POST', body: { ticket } }));
});

// --- Module isolé : expirations, bornes, analyseurs -----------------------

/** Horloge manuelle : aucune attente réelle de 60 s ni de 12 h. */
function manualClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    }
  };
}

test('un ticket expire après 60 s, une session après 12 h', () => {
  const clock = manualClock();
  const access = createDashboardAccess({ accessToken: TOKEN, clock: clock.now });

  // Juste avant l'échéance : encore valable.
  const frais = access.issueTicket();
  clock.advance(TICKET_TTL_MS - 1);
  const cookie = access.redeemTicket({ ticket: frais });
  assert.match(cookie, /^lf_dashboard_[0-9a-f]{12}=[0-9a-f]{64};/);
  const sessionId = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));

  // Juste après l'échéance : refusé.
  const perime = access.issueTicket();
  clock.advance(TICKET_TTL_MS);
  assert.throws(() => access.redeemTicket({ ticket: perime }), (err) => err.status === 401);

  const req = (id) => ({ headers: { cookie: `${access.cookieName}=${id}` } });
  assert.equal(access.authorize(req(sessionId)), 'session');
  clock.advance(SESSION_TTL_MS);
  assert.throws(() => access.authorize(req(sessionId)), (err) => err.status === 401);
  // La session expirée a été retirée au passage : rien ne s'accumule.
  assert.equal(access.sizes().sessions, 0);
});

test('les tickets expirés sont balayés sans intervention', () => {
  const clock = manualClock();
  const access = createDashboardAccess({ accessToken: TOKEN, clock: clock.now });
  for (let i = 0; i < 10; i += 1) access.issueTicket();
  assert.equal(access.sizes().tickets, 10);

  clock.advance(TICKET_TTL_MS + 1);
  access.issueTicket(); // le balayage a lieu à l'émission suivante
  assert.equal(access.sizes().tickets, 1);
});

test('les tables de tickets et de sessions sont bornées', () => {
  const clock = manualClock();
  const access = createDashboardAccess({ accessToken: TOKEN, clock: clock.now });

  const tickets = [];
  for (let i = 0; i < MAX_TICKETS + 20; i += 1) tickets.push(access.issueTicket());
  assert.equal(access.sizes().tickets, MAX_TICKETS);
  // Les plus anciens ont été évincés, les plus récents restent utilisables.
  assert.throws(() => access.redeemTicket({ ticket: tickets[0] }), (err) => err.status === 401);
  assert.ok(access.redeemTicket({ ticket: tickets.at(-1) }).startsWith(access.cookieName));

  for (let i = 0; i < MAX_SESSIONS + 20; i += 1) {
    access.redeemTicket({ ticket: access.issueTicket() });
  }
  assert.ok(access.sizes().sessions <= MAX_SESSIONS);
});

test('close() vide les tables et ferme les autorisations', () => {
  const access = createDashboardAccess({ accessToken: TOKEN });
  const cookie = access.redeemTicket({ ticket: access.issueTicket() });
  const sessionId = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
  const req = { headers: { cookie: `${access.cookieName}=${sessionId}` } };
  assert.equal(access.authorize(req), 'session');

  access.close();
  assert.deepEqual(access.sizes(), { tickets: 0, sessions: 0, closed: true });
  assert.throws(() => access.authorize(req), (err) => err.status === 401);
  assert.throws(() => access.authorize({ headers: { authorization: `Bearer ${TOKEN}` } }), (err) => err.status === 401);
  assert.throws(() => access.issueTicket(), /fermée/);
  assert.throws(() => access.redeemTicket({ ticket: 'f'.repeat(64) }), (err) => err.status === 401);
});

test('en mode autonome le module laisse tout passer sans cookie ni ticket', () => {
  const access = createDashboardAccess();
  assert.equal(access.enabled, false);
  assert.equal(access.cookieName, null);
  assert.equal(access.authorize({ headers: {} }), 'standalone');
  assert.equal(access.isTicketExchange(['api', 'session'], 'POST'), false);
  assert.throws(() => access.issueTicket(), /autonome/);
});

test('isTicketExchange ne vise que POST /api/session exactement', () => {
  const access = createDashboardAccess({ accessToken: TOKEN });
  assert.equal(access.isTicketExchange(['api', 'session'], 'POST'), true);
  assert.equal(access.isTicketExchange(['api', 'session'], 'GET'), false);
  assert.equal(access.isTicketExchange(['api', 'session', 'x'], 'POST'), false);
  assert.equal(access.isTicketExchange(['api', 'sessions'], 'POST'), false);
  assert.equal(access.isTicketExchange(['session'], 'POST'), false);
  assert.equal(access.isTicketExchange([], 'POST'), false);
});

test('readBearer et readCookie ignorent les en-têtes hostiles', () => {
  assert.equal(readBearer('Bearer abc'), 'abc');
  assert.equal(readBearer('Bearer  abc'), null);
  assert.equal(readBearer('bearer abc'), null);
  assert.equal(readBearer('Bearer'), null);
  assert.equal(readBearer('Bearer '), null);
  assert.equal(readBearer(`Bearer ${'a'.repeat(513)}`), null);
  assert.equal(readBearer(undefined), null);
  assert.equal(readBearer(['Bearer abc']), null);

  assert.equal(readCookie('a=1; nom=valeur', 'nom'), 'valeur');
  assert.equal(readCookie('nom=valeur', 'nom'), 'valeur');
  assert.equal(readCookie(' nom = valeur ', 'nom'), 'valeur');
  assert.equal(readCookie('nom=premier; nom=second', 'nom'), 'premier');
  assert.equal(readCookie('autre=valeur', 'nom'), null);
  assert.equal(readCookie('nom=', 'nom'), null);
  assert.equal(readCookie('nomsuffixe=valeur', 'nom'), null);
  assert.equal(readCookie('', 'nom'), null);
  assert.equal(readCookie(undefined, 'nom'), null);
  // Aucun héritage de prototype ne peut se faire passer pour un cookie.
  assert.equal(readCookie('a=1', 'toString'), null);
  assert.equal(readCookie('a=1', '__proto__'), null);
  assert.equal(readCookie('a=1', 'constructor'), null);
});
