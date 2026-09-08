// Connexions à des fournisseurs externes (clé OpenRouter). Fichier dédié,
// mode 0600, jamais inclus dans l'export ni renvoyé par l'API.

import fs from 'node:fs/promises';
import path from 'node:path';

import { HttpError, text } from './validate.mjs';

export const CONNECTIONS_VERSION = 1;
export const KEY_STATUS = ['unconfigured', 'configured', 'verified', 'error'];

function emptyOpenRouter() {
  return { apiKey: '', model: '', status: 'unconfigured', verifiedAt: null, lastError: null, updatedAt: null };
}

export function emptyConnections() {
  return { version: CONNECTIONS_VERSION, openrouter: emptyOpenRouter() };
}

function normalize(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const or = src.openrouter && typeof src.openrouter === 'object' ? src.openrouter : {};
  const result = emptyOpenRouter();
  result.apiKey = typeof or.apiKey === 'string' ? or.apiKey : '';
  result.model = typeof or.model === 'string' ? or.model.trim().slice(0, 120) : '';
  result.status = KEY_STATUS.includes(or.status) ? or.status : result.apiKey ? 'configured' : 'unconfigured';
  if (!result.apiKey) result.status = 'unconfigured';
  result.verifiedAt = typeof or.verifiedAt === 'string' ? or.verifiedAt : null;
  result.lastError = typeof or.lastError === 'string' ? or.lastError.slice(0, 300) : null;
  result.updatedAt = typeof or.updatedAt === 'string' ? or.updatedAt : null;
  return { version: CONNECTIONS_VERSION, openrouter: result };
}

export function apiKeyInput(value) {
  const key = text(value, 'apiKey', { required: true, max: 512 });
  if (/\s/.test(key)) throw new HttpError(400, 'La clé ne doit pas contenir d\'espace.', 'apiKey');
  return key;
}

export function modelInput(value) {
  const model = text(value, 'model', { max: 120 });
  if (model !== '' && !/^[A-Za-z0-9][A-Za-z0-9._\/:-]*$/.test(model)) {
    throw new HttpError(400, 'Identifiant de modèle invalide (attendu : fournisseur/modele, ex. openai/gpt-4o-mini).', 'model');
  }
  return model;
}

export class Connections {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'connections.json');
    this.data = emptyConnections();
    this.queue = Promise.resolve();
  }

  /** Fichier absent = aucune connexion. Aucun appel réseau ici. */
  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return this.data;
      throw err;
    }
    try {
      this.data = normalize(JSON.parse(raw));
    } catch {
      throw new Error(`Fichier de connexions illisible : ${this.file}\nSupprimez-le pour reconfigurer la connexion IA.`);
    }
    return this.data;
  }

  /** Vue publique : jamais la clé, jamais un corps de réponse fournisseur. */
  publicView() {
    const or = this.data.openrouter;
    return {
      openrouter: {
        configured: or.apiKey !== '',
        model: or.model,
        status: or.status,
        verifiedAt: or.verifiedAt,
        lastError: or.lastError,
        updatedAt: or.updatedAt
      }
    };
  }

  /** Clé et modèle pour un appel serveur ; jamais exposés au client HTTP. */
  credentials() {
    const or = this.data.openrouter;
    return { apiKey: or.apiKey, model: or.model };
  }

  update(mutator) {
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await mutator(draft.openrouter);
      draft.openrouter.updatedAt = new Date().toISOString();
      if (!draft.openrouter.apiKey) {
        draft.openrouter.status = 'unconfigured';
        draft.openrouter.verifiedAt = null;
      }
      await this.#persist(draft);
      this.data = draft;
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async #persist(data) {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = path.join(this.dataDir, `.connections.${process.pid}.${Date.now()}.tmp`);
    const handle = await fs.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, this.file);
  }
}
