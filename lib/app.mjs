// Serveur HTTP + API REST. Outil local mono-utilisateur : pas d'auth, pas de rôles.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chatCompletion, testApiKey } from './ai.mjs';
import { Connections, apiKeyInput, modelInput } from './connections.mjs';
import { demoPayload } from './demo.mjs';
import { GENERATORS, ONBOARDING_CHECKLIST, buildAiMessages, onboardingBrief } from './generate.mjs';
import {
  MAX_IMPORT_BYTES,
  checkHost,
  checkWriteRequest,
  readJsonBody,
  sendError,
  sendJson,
  sendText,
  serveStatic
} from './http.mjs';
import { clientDossier } from './markdown.mjs';
import {
  ONBOARDING_SCHEMA,
  assertSubmittable,
  emptyOnboarding,
  onboardingContentChanged,
  onboardingDraft,
  onboardingProgress
} from './onboarding.mjs';
import { MAX_DB_BYTES, Store, newId, validateDatabase } from './store.mjs';
import {
  HttpError,
  LIMITS,
  agencyInput,
  assertCampaignBelongsTo,
  assertClientExists,
  campaignInput,
  clientInput,
  deliverableInput,
  taskInput
} from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function now() {
  return new Date().toISOString();
}

function find(collection, id, label) {
  const item = collection.find((x) => x.id === id);
  if (!item) throw new HttpError(404, `${label} introuvable.`);
  return item;
}

function fillIfEmpty(target, key, value, max) {
  if (typeof value !== 'string' || value.trim() === '') return;
  if (typeof target[key] === 'string' && target[key].trim() !== '') return;
  target[key] = value.trim().slice(0, max);
}

/** Crée les tâches de checklist manquantes pour un client (idempotent par clé). */
function ensureChecklist(db, clientId) {
  const existing = new Set(db.tasks.filter((t) => t.clientId === clientId).map((t) => t.onboardingKey));
  const created = [];
  for (const item of ONBOARDING_CHECKLIST) {
    if (existing.has(item.key)) continue;
    const task = {
      id: newId(),
      clientId,
      campaignId: null,
      title: item.title,
      done: false,
      onboardingKey: item.key,
      createdAt: now(),
      updatedAt: now()
    };
    db.tasks.push(task);
    created.push(task);
  }
  return { created, skipped: ONBOARDING_CHECKLIST.length - created.length };
}

export async function createApp({
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  fetchImpl = globalThis.fetch
} = {}) {
  const store = new Store(dataDir);
  await store.load();
  const connections = new Connections(dataDir);
  try {
    await connections.load();
  } catch (err) {
    await store.close();
    throw err;
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
      return serveStatic(res, publicDir, url.pathname);
    }

    if (WRITE_METHODS.has(req.method)) checkWriteRequest(req);
    return api(req, res, segments.slice(1), url);
  }

  async function api(req, res, seg, url) {
    const method = req.method;
    const [resource, id, action, sub] = seg;

    // --- Lecture globale ---
    if (resource === 'state' && method === 'GET') {
      return sendJson(res, 200, store.read());
    }
    if (resource === 'export' && method === 'GET') {
      // JSON canonique (sans indentation) : reste sous la capacité et donc réimportable.
      return sendText(res, 200, JSON.stringify(store.read()), 'application/json; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="leadfactory-export.json"'
      });
    }
    if (resource === 'limits' && method === 'GET') {
      return sendJson(res, 200, { maxDbBytes: MAX_DB_BYTES, maxImportBytes: MAX_IMPORT_BYTES, contentMax: LIMITS.content });
    }

    // --- Profil d'agence ---
    if (resource === 'agency') {
      if (method === 'GET') return sendJson(res, 200, store.read().agency);
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          db.agency = { ...agencyInput(body, db.agency), updatedAt: now() };
          return db.agency;
        });
        return sendJson(res, 200, updated);
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    // --- Schéma du questionnaire ---
    if (resource === 'onboarding' && id === 'schema' && method === 'GET') {
      return sendJson(res, 200, ONBOARDING_SCHEMA);
    }

    // --- Clients ---
    if (resource === 'clients') {
      if (method === 'GET' && !id) return sendJson(res, 200, store.read().clients);
      if (method === 'POST' && !id) {
        const body = await readJsonBody(req);
        const created = await store.update((db) => {
          const record = { id: newId(), ...clientInput(body), onboarding: null, createdAt: now(), updatedAt: now() };
          db.clients.push(record);
          return record;
        });
        return sendJson(res, 201, created);
      }
      if (!id) throw new HttpError(405, 'Méthode non autorisée.');

      if (method === 'GET' && !action) {
        const db = store.read();
        const client = find(db.clients, id, 'Client');
        return sendJson(res, 200, {
          client,
          campaigns: db.campaigns.filter((c) => c.clientId === id),
          tasks: db.tasks.filter((t) => t.clientId === id),
          deliverables: db.deliverables.filter((d) => d.clientId === id)
        });
      }
      if (method === 'GET' && action === 'dossier.md') {
        const md = clientDossier(store.read(), id);
        if (md === null) throw new HttpError(404, 'Client introuvable.');
        return sendText(res, 200, md, 'text/markdown; charset=utf-8', {
          'Content-Disposition': `attachment; filename="dossier-${id}.md"`
        });
      }
      if (action === 'onboarding') return onboardingRoutes(req, res, id, sub);
      if (method === 'PATCH' && !action) {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          const client = find(db.clients, id, 'Client');
          Object.assign(client, clientInput(body, client), { updatedAt: now() });
          return client;
        });
        return sendJson(res, 200, updated);
      }
      if (method === 'DELETE' && !action) {
        const removed = await store.update((db) => {
          find(db.clients, id, 'Client');
          db.clients = db.clients.filter((c) => c.id !== id);
          db.campaigns = db.campaigns.filter((c) => c.clientId !== id);
          db.tasks = db.tasks.filter((t) => t.clientId !== id);
          db.deliverables = db.deliverables.filter((d) => d.clientId !== id);
          return true;
        });
        return sendJson(res, 200, { deleted: removed });
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    // --- Campagnes ---
    if (resource === 'campaigns') {
      if (method === 'GET' && !id) return sendJson(res, 200, store.read().campaigns);
      if (method === 'POST' && !id) {
        const body = await readJsonBody(req);
        const created = await store.update((db) => {
          const record = { id: newId(), ...campaignInput(body), createdAt: now(), updatedAt: now() };
          assertClientExists(db, record.clientId);
          db.campaigns.push(record);
          return record;
        });
        return sendJson(res, 201, created);
      }
      if (!id) throw new HttpError(405, 'Méthode non autorisée.');
      if (method === 'GET') return sendJson(res, 200, find(store.read().campaigns, id, 'Campagne'));
      if (method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          const campaign = find(db.campaigns, id, 'Campagne');
          const next = campaignInput(body, campaign);
          assertClientExists(db, next.clientId);
          if (next.clientId !== campaign.clientId) {
            throw new HttpError(400, 'Impossible de déplacer une campagne vers un autre client.', 'clientId');
          }
          Object.assign(campaign, next, { updatedAt: now() });
          return campaign;
        });
        return sendJson(res, 200, updated);
      }
      if (method === 'DELETE') {
        await store.update((db) => {
          find(db.campaigns, id, 'Campagne');
          db.campaigns = db.campaigns.filter((c) => c.id !== id);
          // Les tâches et livrables sont conservés, simplement détachés.
          for (const t of db.tasks) if (t.campaignId === id) t.campaignId = null;
          for (const d of db.deliverables) if (d.campaignId === id) d.campaignId = null;
          for (const c of db.clients) if (c.onboarding?.campaignId === id) {
            Object.assign(c.onboarding, { campaignId: null, status: 'draft', submittedAt: null, reviewedAt: null });
          }
        });
        return sendJson(res, 200, { deleted: true });
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    // --- Tâches ---
    if (resource === 'tasks') {
      if (method === 'GET' && !id) return sendJson(res, 200, store.read().tasks);
      if (method === 'POST' && !id) {
        const body = await readJsonBody(req);
        const created = await store.update((db) => {
          const record = { id: newId(), ...taskInput(body), createdAt: now(), updatedAt: now() };
          assertClientExists(db, record.clientId);
          assertCampaignBelongsTo(db, record.campaignId, record.clientId);
          db.tasks.push(record);
          return record;
        });
        return sendJson(res, 201, created);
      }
      if (!id) throw new HttpError(405, 'Méthode non autorisée.');
      if (method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          const task = find(db.tasks, id, 'Tâche');
          const next = taskInput(body, task);
          assertClientExists(db, next.clientId);
          assertCampaignBelongsTo(db, next.campaignId, next.clientId);
          Object.assign(task, next, { updatedAt: now() });
          return task;
        });
        return sendJson(res, 200, updated);
      }
      if (method === 'DELETE') {
        await store.update((db) => {
          find(db.tasks, id, 'Tâche');
          db.tasks = db.tasks.filter((t) => t.id !== id);
        });
        return sendJson(res, 200, { deleted: true });
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    // --- Livrables ---
    if (resource === 'deliverables') {
      if (method === 'GET' && !id) return sendJson(res, 200, store.read().deliverables);
      if (method === 'POST' && !id) {
        const body = await readJsonBody(req);
        const created = await store.update((db) => {
          const record = { id: newId(), ...deliverableInput(body), createdAt: now(), updatedAt: now() };
          assertClientExists(db, record.clientId);
          assertCampaignBelongsTo(db, record.campaignId, record.clientId);
          db.deliverables.push(record);
          return record;
        });
        return sendJson(res, 201, created);
      }
      if (!id) throw new HttpError(405, 'Méthode non autorisée.');
      if (method === 'GET') return sendJson(res, 200, find(store.read().deliverables, id, 'Livrable'));
      if (method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = await store.update((db) => {
          const item = find(db.deliverables, id, 'Livrable');
          const next = deliverableInput(body, item);
          assertClientExists(db, next.clientId);
          assertCampaignBelongsTo(db, next.campaignId, next.clientId);
          Object.assign(item, next, { updatedAt: now() });
          return item;
        });
        return sendJson(res, 200, updated);
      }
      if (method === 'DELETE') {
        await store.update((db) => {
          find(db.deliverables, id, 'Livrable');
          db.deliverables = db.deliverables.filter((d) => d.id !== id);
          for (const c of db.clients) if (c.onboarding?.briefId === id) {
            Object.assign(c.onboarding, { briefId: null, status: 'draft', submittedAt: null, reviewedAt: null });
          }
        });
        return sendJson(res, 200, { deleted: true });
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    // --- Génération déterministe ---
    if (resource === 'generate' && method === 'POST') {
      const body = await readJsonBody(req);
      const generator = requireGenerator(body?.kind);
      const created = await store.update((db) => {
        const { client, campaign } = resolveTarget(db, body);
        const record = {
          id: newId(),
          clientId: client.id,
          campaignId: campaign?.id ?? null,
          type: generator.deliverableType,
          title: generator.title,
          content: generator.build(client, campaign),
          generated: true,
          source: 'template',
          model: null,
          generatedAt: null,
          createdAt: now(),
          updatedAt: now()
        };
        db.deliverables.push(record);
        return record;
      });
      return sendJson(res, 201, created);
    }

    // --- Rédaction par IA (OpenRouter), sur clic explicite uniquement ---
    if (resource === 'ai' && id === 'generate' && method === 'POST') {
      const body = await readJsonBody(req);
      const generator = requireGenerator(body?.kind);
      const { apiKey, model } = connections.credentials();
      if (!apiKey) throw new HttpError(400, 'Aucune connexion IA : enregistrez une clé OpenRouter dans Start Here.');
      if (!model) throw new HttpError(400, 'Aucun modèle choisi : indiquez l\'identifiant du modèle dans Start Here.', 'model');
      const snapshot = store.read();
      const { client, campaign } = resolveTarget(snapshot, body);
      const messages = buildAiMessages(body.kind, client, campaign, snapshot.agency);
      // Appel réseau hors de la file d'écriture : une seule requête, pas de retry.
      const result = await chatCompletion({ apiKey, model, messages, fetchImpl });
      let content = result.content;
      if (content.length > LIMITS.content) {
        content = `${content.slice(0, LIMITS.content - 60)}\n\n[Texte tronqué à ${LIMITS.content} caractères]`;
      }
      const created = await store.update((db) => {
        const target = resolveTarget(db, body); // le client peut avoir disparu entre-temps
        const record = {
          id: newId(),
          clientId: target.client.id,
          campaignId: target.campaign?.id ?? null,
          type: generator.deliverableType,
          title: `${generator.label} (IA)`,
          content,
          generated: false,
          source: 'ai',
          model: result.model,
          generatedAt: now(),
          createdAt: now(),
          updatedAt: now()
        };
        db.deliverables.push(record);
        return record;
      });
      return sendJson(res, 201, { ...created, usage: result.usage, finishReason: result.finishReason });
    }

    // --- Connexions (clé jamais renvoyée) ---
    if (resource === 'connections') {
      if (method === 'GET' && !id) return sendJson(res, 200, connections.publicView());
      if (id !== 'openrouter') throw new HttpError(404, 'Connexion inconnue.');
      if (method === 'PUT' && !action) {
        const body = await readJsonBody(req);
        if (body === null || typeof body !== 'object') throw new HttpError(400, 'Corps JSON attendu.');
        await connections.update((or) => {
          if ('apiKey' in body && body.apiKey !== '' && body.apiKey !== null && body.apiKey !== undefined) {
            or.apiKey = apiKeyInput(body.apiKey);
            or.status = 'configured';
            or.verifiedAt = null;
            or.lastError = null;
          }
          if ('model' in body) or.model = modelInput(body.model);
          if (!or.apiKey) throw new HttpError(400, 'Enregistrez d\'abord une clé OpenRouter.', 'apiKey');
        });
        return sendJson(res, 200, connections.publicView());
      }
      if (method === 'POST' && action === 'test') {
        const { apiKey } = connections.credentials();
        if (!apiKey) throw new HttpError(400, 'Aucune clé enregistrée : rien à tester.', 'apiKey');
        try {
          await testApiKey({ apiKey, fetchImpl });
        } catch (err) {
          const message = err instanceof HttpError ? err.message : 'Test impossible (erreur interne).';
          await connections.update((or) => {
            if (or.apiKey !== apiKey) throw new HttpError(409, 'Connexion modifiée pendant le test : testez la clé actuelle.');
            or.status = 'error';
            or.verifiedAt = null;
            or.lastError = message;
          });
          throw err instanceof HttpError ? err : new HttpError(502, message);
        }
        await connections.update((or) => {
          if (or.apiKey !== apiKey) throw new HttpError(409, 'Connexion modifiée pendant le test : testez la clé actuelle.');
          or.status = 'verified';
          or.verifiedAt = now();
          or.lastError = null;
        });
        return sendJson(res, 200, connections.publicView());
      }
      if (method === 'DELETE' && !action) {
        await connections.update((or) => {
          or.apiKey = '';
          or.model = '';
          or.status = 'unconfigured';
          or.verifiedAt = null;
          or.lastError = null;
        });
        return sendJson(res, 200, connections.publicView());
      }
      throw new HttpError(405, 'Méthode non autorisée.');
    }

    // --- Import (remplace tout) ---
    if (resource === 'import' && method === 'POST') {
      const body = await readJsonBody(req, MAX_IMPORT_BYTES);
      const next = validateDatabase(body, { strict: true });
      const keepAgency = body.agency === undefined;
      const summary = await store.update((db) => {
        db.version = next.version;
        db.agency = keepAgency ? db.agency : next.agency;
        db.clients = next.clients;
        db.campaigns = next.campaigns;
        db.tasks = next.tasks;
        db.deliverables = next.deliverables;
        return {
          clients: next.clients.length,
          campaigns: next.campaigns.length,
          tasks: next.tasks.length,
          deliverables: next.deliverables.length,
          agency: !keepAgency
        };
      });
      return sendJson(res, 200, { imported: summary });
    }

    // --- Demo (uniquement si base vide) ---
    if (resource === 'demo' && method === 'POST') {
      const result = await store.update((db) => {
        const empty =
          db.clients.length === 0 &&
          db.campaigns.length === 0 &&
          db.tasks.length === 0 &&
          db.deliverables.length === 0;
        if (!empty) {
          throw new HttpError(409, 'La démo ne peut être chargée que sur une base vide.');
        }
        const payload = demoPayload(newId);
        db.clients.push({ ...payload.client, onboarding: null, createdAt: now(), updatedAt: now() });
        db.campaigns.push({ ...payload.campaign, createdAt: now(), updatedAt: now() });
        for (const task of payload.tasks) {
          db.tasks.push({ ...task, createdAt: now(), updatedAt: now() });
        }
        return { clientId: payload.client.id };
      });
      return sendJson(res, 201, result);
    }

    throw new HttpError(404, 'Route inconnue.');
  }

  function requireGenerator(kind) {
    const generator = GENERATORS[kind];
    if (!generator) {
      throw new HttpError(400, `Type de modèle inconnu (attendu : ${Object.keys(GENERATORS).join(', ')}).`, 'kind');
    }
    return generator;
  }

  function resolveTarget(db, body) {
    const client = find(db.clients, String(body?.clientId ?? ''), 'Client');
    let campaign = null;
    if (body?.campaignId) {
      campaign = find(db.campaigns, String(body.campaignId), 'Campagne');
      if (campaign.clientId !== client.id) {
        throw new HttpError(400, 'La campagne appartient à un autre client.', 'campaignId');
      }
    }
    return { client, campaign };
  }

  // --- Questionnaire d'onboarding -----------------------------------------
  async function onboardingRoutes(req, res, clientId, sub) {
    const method = req.method;

    if (method === 'GET' && !sub) {
      const client = find(store.read().clients, clientId, 'Client');
      const onboarding = client.onboarding ?? emptyOnboarding();
      return sendJson(res, 200, { onboarding, progress: onboardingProgress(onboarding), started: client.onboarding !== null });
    }

    if (method === 'PUT' && !sub) {
      const body = await readJsonBody(req);
      const result = await store.update((db) => {
        const client = find(db.clients, clientId, 'Client');
        const previous = client.onboarding;
        const next = onboardingDraft(body, previous);
        let statusReset = false;
        if (previous && previous.status !== 'draft' && onboardingContentChanged(previous, next)) {
          next.status = 'draft';
          next.reviewedAt = null;
          statusReset = true;
        }
        next.updatedAt = now();
        client.onboarding = next;
        client.updatedAt = now();
        return { onboarding: next, progress: onboardingProgress(next), statusReset };
      });
      return sendJson(res, 200, result);
    }

    // Compatibilité : POST /onboarding = checklist seule (idempotente).
    if (method === 'POST' && !sub) {
      const result = await store.update((db) => {
        find(db.clients, clientId, 'Client');
        return ensureChecklist(db, clientId);
      });
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && sub === 'submit') {
      const result = await store.update((db) => {
        const client = find(db.clients, clientId, 'Client');
        if (!client.onboarding) throw new HttpError(400, 'Questionnaire non commencé : enregistrez d\'abord un brouillon.');
        const ob = client.onboarding;
        const progress = assertSubmittable(ob);

        // Réutilisation des champs client existants (sans écraser une saisie).
        fillIfEmpty(client, 'offer', ob.offer.service, LIMITS.medium);
        fillIfEmpty(client, 'audience', ob.target.profile, LIMITS.medium);
        fillIfEmpty(client, 'goal', ob.campaign.objective, LIMITS.medium);
        fillIfEmpty(client, 'contact', ob.company.contactName, LIMITS.short);
        fillIfEmpty(client, 'email', ob.company.contactEmail, LIMITS.short);
        if (!client.budget) client.budget = ob.campaign.budget;
        if (client.status === 'prospect') client.status = 'onboarding';

        // LA campagne brouillon liée : créée une seule fois, puis réutilisée.
        let campaign = ob.campaignId ? db.campaigns.find((c) => c.id === ob.campaignId && c.clientId === client.id) : null;
        if (!campaign) {
          campaign = {
            id: newId(),
            clientId: client.id,
            name: `Onboarding - ${client.company}`.slice(0, LIMITS.short),
            channel: ob.campaign.channel,
            goal: ob.campaign.objective.slice(0, LIMITS.medium),
            budget: ob.campaign.budget,
            status: 'draft',
            createdAt: now(),
            updatedAt: now()
          };
          db.campaigns.push(campaign);
          ob.campaignId = campaign.id;
        } else if (campaign.status === 'draft') {
          campaign.channel = ob.campaign.channel;
          campaign.goal = ob.campaign.objective.slice(0, LIMITS.medium);
          campaign.budget = ob.campaign.budget;
          campaign.updatedAt = now();
        }

        const tasks = ensureChecklist(db, client.id);

        ob.status = 'submitted';
        ob.submittedAt = now();
        ob.reviewedAt = null;
        ob.updatedAt = now();

        // Brief local (modèle déterministe), lié au client et à la campagne.
        const content = onboardingBrief(client);
        let brief = ob.briefId ? db.deliverables.find((d) => d.id === ob.briefId && d.clientId === client.id) : null;
        if (!brief) {
          brief = {
            id: newId(),
            clientId: client.id,
            campaignId: campaign.id,
            type: 'brief',
            title: 'Brief onboarding (questionnaire)',
            content,
            generated: true,
            source: 'template',
            model: null,
            generatedAt: null,
            createdAt: now(),
            updatedAt: now()
          };
          db.deliverables.push(brief);
          ob.briefId = brief.id;
        } else {
          brief.content = content;
          brief.updatedAt = now();
        }
        client.updatedAt = now();
        return { onboarding: ob, progress, campaign, brief, tasks, client };
      });
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && sub === 'review') {
      const result = await store.update((db) => {
        const client = find(db.clients, clientId, 'Client');
        const ob = client.onboarding;
        if (!ob || ob.status !== 'submitted') {
          throw new HttpError(409, 'Seul un questionnaire soumis peut être marqué comme revu.');
        }
        ob.status = 'reviewed';
        ob.reviewedAt = now();
        ob.updatedAt = now();
        client.updatedAt = now();
        return { onboarding: ob, progress: onboardingProgress(ob) };
      });
      return sendJson(res, 200, result);
    }

    throw new HttpError(405, 'Méthode non autorisée.');
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }

  return { server, store, connections, dataDir, publicDir, close };
}
