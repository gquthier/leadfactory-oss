// Serveur HTTP + API REST du cockpit e-commerce.
//
// Même contrat que le cockpit d'agence du kit : `createApp(...)` renvoie un
// serveur non démarré, une fermeture propre et l'émission de tickets. Les
// garde-fous HTTP et l'authentification viennent du kit commun ; seul le
// modèle métier est propre à ce pack.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDashboardAccess } from '../../lib/dashboard-access.mjs';
import {
  MAX_IMPORT_BYTES,
  checkHost,
  checkWriteRequest,
  readJsonBody,
  sendError,
  sendJson,
  sendText,
  serveStatic
} from '../../lib/http.mjs';

import { COLLECTIONS, COLLECTION_NAMES, LIMITS, schemaPayload } from './schema.mjs';
import { MAX_DB_BYTES, Store, newId, validateDatabase } from './store.mjs';
import {
  HttpError,
  assertReferences,
  buildRecord,
  dashboardInput,
  profileInput
} from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = path.resolve(HERE, '..');
const KIT_ROOT = path.resolve(PACK_ROOT, '..');
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function now() {
  return new Date().toISOString();
}

function find(collection, id, label) {
  const item = collection.find((x) => x.id === id);
  if (!item) throw new HttpError(404, `${label} introuvable.`);
  return item;
}

/** JSON canonique à clés triées : même contenu ⇒ même chaîne. */
function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

export async function createApp({
  dataDir = path.join(PACK_ROOT, 'data'),
  publicDir = path.join(PACK_ROOT, 'public'),
  hostedBy = null,
  accessToken = null,
  fetchImpl = globalThis.fetch, // parité d'interface : ce pack n'émet aucun appel réseau
  onMutation = null,
  liveRefreshPath = path.join(KIT_ROOT, 'public', 'live-refresh.js')
} = {}) {
  if (onMutation !== null && typeof onMutation !== 'function') {
    throw new TypeError('createApp({ onMutation }) attend une fonction, ou null.');
  }
  void fetchImpl;

  // Validé avant toute ouverture de fichier : un jeton refusé ne doit pas
  // laisser un verrou derrière lui.
  const access = createDashboardAccess({ accessToken });
  const store = new Store(dataDir);
  await store.load();

  const instanceId = newId();
  let revisionCache = { source: null, value: null };

  /**
   * Empreinte du contenu métier et de la configuration. `store.db` est remplacé
   * (jamais muté) à chaque publication : son identité sert de cache.
   */
  function stateRevision() {
    const snapshot = store.db;
    if (revisionCache.source === snapshot) return revisionCache.value;
    const value = createHash('sha256').update(canonicalJson(snapshot)).digest('hex').slice(0, 32);
    revisionCache = { source: snapshot, value };
    return value;
  }

  /**
   * Notification post-écriture, attendue avant la réponse HTTP. La mutation est
   * déjà durable : une erreur du miroir est journalisée, jamais propagée, sinon
   * l'appelant croirait à un échec alors que la donnée est enregistrée.
   */
  let notificationQueue = Promise.resolve();
  function notify(action, collection, id) {
    if (onMutation === null) return;
    const event = { state: store.read(), action, collection, id, revision: stateRevision() };
    notificationQueue = notificationQueue.then(async () => {
      try {
        await onMutation(event);
      } catch (err) {
        console.error('[ecommerce] onMutation a échoué (la donnée reste enregistrée) :', err?.message ?? err);
      }
    });
    return notificationQueue;
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => sendError(res, err));
  });

  async function handle(req, res) {
    checkHost(req);
    const url = new URL(req.url, 'http://127.0.0.1');
    const segments = url.pathname.split('/').filter(Boolean);

    if (segments[0] !== 'api') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Méthode non autorisée.');
      }
      // Le module de rafraîchissement du kit commun est servi tel quel : il
      // n'est pas dupliqué dans ce pack, donc il ne peut pas diverger.
      if (url.pathname === '/live-refresh.js') return serveLiveRefresh(res);
      return serveStatic(res, publicDir, url.pathname);
    }

    if (WRITE_METHODS.has(req.method)) checkWriteRequest(req);

    if (access.isTicketExchange(segments, req.method)) {
      const cookie = access.redeemTicket(await readJsonBody(req));
      return sendText(res, 200, JSON.stringify({ authenticated: true }), 'application/json; charset=utf-8', {
        'Set-Cookie': cookie
      });
    }
    access.authorize(req);

    return api(req, res, segments.slice(1));
  }

  async function serveLiveRefresh(res) {
    let data;
    try {
      data = await fs.readFile(liveRefreshPath);
    } catch {
      throw new HttpError(404, 'Module de rafraîchissement introuvable dans cette installation.');
    }
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  }

  async function api(req, res, seg) {
    const method = req.method;
    const [resource, id] = seg;
    if (seg.length > 2) throw new HttpError(404, 'Route inconnue.');

    if (resource === 'state' && method === 'GET' && !id) {
      return sendJson(res, 200, store.read());
    }
    if (resource === 'meta' && method === 'GET' && !id) {
      return sendJson(res, 200, {
        product: 'bizos-ecommerce',
        apiVersion: 1,
        revision: stateRevision(),
        instanceId,
        ...(hostedBy === 'bizos-local' ? { hostedBy } : {})
      });
    }
    if (resource === 'schema' && method === 'GET' && !id) {
      return sendJson(res, 200, schemaPayload());
    }
    if (resource === 'limits' && method === 'GET' && !id) {
      return sendJson(res, 200, { maxDbBytes: MAX_DB_BYTES, maxImportBytes: MAX_IMPORT_BYTES, contentMax: LIMITS.content });
    }

    if (resource === 'profile' && !id) {
      if (method === 'GET') return sendJson(res, 200, store.read().profile);
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          db.profile = { ...profileInput(body, db.profile), updatedAt: now() };
          return db.profile;
        });
        await notify('update', 'profile', null);
        return sendJson(res, 200, updated);
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    if (resource === 'dashboard' && !id) {
      if (method === 'GET') return sendJson(res, 200, store.read().dashboard);
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          db.dashboard = dashboardInput(body, db.dashboard);
          return db.dashboard;
        });
        await notify('update', 'dashboard', null);
        return sendJson(res, 200, updated);
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    if (resource === 'export' && method === 'GET' && !id) {
      return sendText(res, 200, JSON.stringify(store.read()), 'application/json; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="bizos-ecommerce-export.json"'
      });
    }

    if (resource === 'import' && method === 'POST' && !id) {
      const body = await readJsonBody(req, MAX_IMPORT_BYTES);
      const next = validateDatabase(body, { strict: true });
      const keepProfile = body.profile === undefined;
      const keepDashboard = body.dashboard === undefined;
      const summary = await store.update((db) => {
        db.version = next.version;
        if (!keepProfile) db.profile = next.profile;
        if (!keepDashboard) db.dashboard = next.dashboard;
        const counts = {};
        for (const name of COLLECTION_NAMES) {
          db[name] = next[name];
          counts[name] = next[name].length;
        }
        return { ...counts, profile: !keepProfile, dashboard: !keepDashboard };
      });
      await notify('replace', 'import', null);
      return sendJson(res, 200, { imported: summary });
    }

    if (COLLECTION_NAMES.includes(resource)) return collectionRoutes(req, res, resource, id);

    throw new HttpError(404, 'Route inconnue.');
  }

  async function collectionRoutes(req, res, name, id) {
    const method = req.method;
    const label = COLLECTIONS[name].singular;

    if (!id) {
      if (method === 'GET') return sendJson(res, 200, store.read()[name]);
      if (method === 'POST') {
        const body = await readJsonBody(req);
        const created = await store.update((db) => {
          const record = { id: newId(), ...buildRecord(name, body), createdAt: now(), updatedAt: now() };
          assertReferences(db, name, record);
          db[name].push(record);
          return record;
        });
        await notify('create', name, created.id);
        return sendJson(res, 201, created);
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    if (method === 'GET') return sendJson(res, 200, find(store.read()[name], id, label));

    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      const updated = await store.update((db) => {
        const item = find(db[name], id, label);
        const next = buildRecord(name, body, item);
        assertReferences(db, name, next);
        Object.assign(item, next, { updatedAt: now() });
        return item;
      });
      await notify('update', name, id);
      return sendJson(res, 200, updated);
    }

    if (method === 'DELETE') {
      await store.update((db) => {
        find(db[name], id, label);
        db[name] = db[name].filter((x) => x.id !== id);
        // Supprimer un produit ne supprime rien d'autre : les enregistrements
        // liés sont détachés, pour ne jamais perdre un travail en cascade.
        if (name === 'products') detachProduct(db, id);
      });
      await notify('delete', name, id);
      return sendJson(res, 200, { deleted: true });
    }

    throw new HttpError(405, 'Méthode non autorisée.');
  }

  function detachProduct(db, productId) {
    for (const other of COLLECTION_NAMES) {
      if (other === 'products') continue;
      for (const field of COLLECTIONS[other].fields) {
        if (field.type === 'ref') {
          for (const record of db[other]) if (record[field.name] === productId) record[field.name] = null;
        }
        if (field.type === 'idlist') {
          for (const record of db[other]) {
            if (record[field.name].includes(productId)) {
              record[field.name] = record[field.name].filter((value) => value !== productId);
            }
          }
        }
      }
    }
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    access.close();
    await notificationQueue;
    await store.close();
  }

  /** Ticket d'ouverture à usage unique (64 hexadécimaux, 60 s). */
  function issueDashboardTicket() {
    return access.issueTicket();
  }

  return { server, store, dataDir, publicDir, close, issueDashboardTicket };
}
