// Persistance JSON : écritures sérialisées et atomiques, capacité bornée,
// verrou exclusif par dossier de données.
//
// Le kit commun applique la même discipline pour l'agence, mais son
// `Store` valide la base de l'agence. Le schéma métier étant différent, cette
// implémentation reprend les mêmes invariants pour ce schéma-ci :
//   - un seul processus par `dataDir` (verrou PID, verrou orphelin récupéré) ;
//   - écriture dans un fichier temporaire, `fsync`, puis `rename` atomique ;
//   - un fichier invalide fait échouer le démarrage, il n'est jamais réparé ;
//   - l'état publié n'est jamais muté sur place (identité = clé de révision).

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { COLLECTION_NAMES } from './schema.mjs';
import {
  HttpError,
  assertReferences,
  buildRecord,
  dashboardInput,
  emptyDashboard,
  emptyProfile,
  profileInput
} from './validate.mjs';

export const DB_VERSION = 1;
/** Taille maximale du JSON canonique. L'export reste réimportable. */
export const MAX_DB_BYTES = 20_000_000;

export function newId() {
  return randomUUID();
}

export function emptyDatabase() {
  const db = { version: DB_VERSION, profile: emptyProfile(), dashboard: emptyDashboard() };
  for (const name of COLLECTION_NAMES) db[name] = [];
  return db;
}

function stamps(raw, now) {
  const created = typeof raw?.createdAt === 'string' ? raw.createdAt : now;
  const updated = typeof raw?.updatedAt === 'string' ? raw.updatedAt : created;
  return { createdAt: created, updatedAt: updated };
}

export function assertCapacity(db) {
  const size = Buffer.byteLength(JSON.stringify(db), 'utf8');
  if (size > MAX_DB_BYTES) {
    throw new HttpError(
      413,
      `Capacité de stockage dépassée : ${(size / 1_000_000).toFixed(1)} Mo pour un maximum de ${MAX_DB_BYTES / 1_000_000} Mo. ` +
        'Raccourcissez ou supprimez des livrables et créatives, ou exportez puis archivez une partie des données.'
    );
  }
  return size;
}

/**
 * Valide une base complète (fichier disque ou import utilisateur). Aucune
 * réparation silencieuse : toute anomalie lève une erreur explicite.
 * `strict` exige la version et les neuf collections, pour qu'un objet partiel
 * ne puisse pas écraser une base existante.
 */
export function validateDatabase(input, { strict = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Le fichier de données doit être un objet JSON.');
  }
  if (strict && input.version === undefined) {
    throw new HttpError(400, 'Fichier d\'import incomplet : le champ "version" est absent.', 'version');
  }
  if (input.version !== undefined && input.version !== DB_VERSION) {
    throw new HttpError(400, `Version de données non supportée : ${String(input.version)} (attendu ${DB_VERSION}).`, 'version');
  }
  for (const name of COLLECTION_NAMES) {
    if (strict && input[name] === undefined) {
      throw new HttpError(400, `Fichier d'import incomplet : la collection "${name}" est absente.`, name);
    }
    if (input[name] !== undefined && !Array.isArray(input[name])) {
      throw new HttpError(400, `La collection "${name}" doit être un tableau.`, name);
    }
  }

  const now = new Date().toISOString();
  const db = emptyDatabase();
  db.profile = input.profile === undefined ? emptyProfile() : profileInput(input.profile, input.profile);
  db.dashboard = input.dashboard === undefined ? emptyDashboard() : dashboardInput(input.dashboard);

  const seen = new Set();
  const takeId = (raw, label) => {
    const value = typeof raw?.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : newId();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new HttpError(400, `Identifiant invalide dans "${label}".`, 'id');
    }
    if (seen.has(value)) throw new HttpError(400, `Identifiant dupliqué : ${value}`, 'id');
    seen.add(value);
    return value;
  };

  // Les produits d'abord : toutes les autres collections peuvent les référencer.
  for (const raw of input.products ?? []) {
    db.products.push({ id: takeId(raw, 'products'), ...buildRecord('products', raw), ...stamps(raw, now) });
  }
  for (const name of COLLECTION_NAMES) {
    if (name === 'products') continue;
    for (const raw of input[name] ?? []) {
      const record = { id: takeId(raw, name), ...buildRecord(name, raw), ...stamps(raw, now) };
      assertReferences(db, name, record);
      db[name].push(record);
    }
  }
  return db;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    return true; // EPERM : le processus existe, sous un autre utilisateur.
  }
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.lockFile = path.join(dataDir, 'db.lock');
    this.db = emptyDatabase();
    this.queue = Promise.resolve();
    this.locked = false;
  }

  async #acquireLock() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await fs.writeFile(this.lockFile, payload, { flag: 'wx', mode: 0o600 });
        this.locked = true;
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
      let holder = null;
      try {
        holder = JSON.parse(await fs.readFile(this.lockFile, 'utf8'));
      } catch {
        holder = null;
      }
      const pid = Number(holder?.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error(
          `Verrou illisible : ${this.lockFile}\nSi aucune autre instance n'utilise ce dossier, supprimez ce fichier puis relancez.`
        );
      }
      if (processAlive(pid)) {
        throw new Error(
          `Dossier de données déjà utilisé par le processus ${pid} (${this.lockFile}).\n` +
            'Fermez cette instance, ou lancez la seconde sur un autre dossier. Deux instances sur le même dossier perdraient des données.'
        );
      }
      // Only one contender may recover a stale lock. Re-read under this guard:
      // another process may have acquired a new lock since our first read.
      const recovery = `${this.lockFile}.recovery`;
      try {
        await fs.mkdir(recovery);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        throw new Error(`Récupération du verrou déjà en cours (${recovery}). Si elle a été interrompue, vérifiez qu'aucune instance ne tourne avant de retirer ce dossier vide.`);
      }
      try {
        const current = JSON.parse(await fs.readFile(this.lockFile, 'utf8'));
        const currentPid = Number(current?.pid);
        if (!Number.isInteger(currentPid) || currentPid <= 0 || processAlive(currentPid)) {
          throw new Error(`Le verrou a changé : le dossier est utilisé ou son verrou est illisible (${this.lockFile}).`);
        }
        await fs.rm(this.lockFile);
        await fs.writeFile(this.lockFile, payload, { flag: 'wx', mode: 0o600 });
        this.locked = true;
        return;
      } finally {
        await fs.rmdir(recovery);
      }
    }
    throw new Error(`Impossible de prendre le verrou ${this.lockFile}.`);
  }

  async #releaseLock() {
    if (!this.locked) return;
    this.locked = false;
    try {
      const holder = JSON.parse(await fs.readFile(this.lockFile, 'utf8'));
      if (Number(holder?.pid) !== process.pid) return; // jamais le verrou d'un autre
      await fs.rm(this.lockFile, { force: true });
    } catch {
      // Verrou déjà absent ou illisible : rien à faire.
    }
  }

  async load() {
    await this.#acquireLock();
    try {
      return await this.#read();
    } catch (err) {
      await this.#releaseLock();
      throw err;
    }
  }

  async #read() {
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.db = emptyDatabase();
        return this.db;
      }
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Fichier de données illisible : ${this.file}\nJSON invalide (${err.message}).\n` +
          'Corrigez ou déplacez le fichier, puis relancez. Aucune donnée n\'a été écrasée.'
      );
    }
    try {
      this.db = validateDatabase(parsed, { strict: true });
    } catch (err) {
      throw new Error(
        `Fichier de données invalide : ${this.file}\n${err.message}\n` +
          'Corrigez ou déplacez le fichier, puis relancez. Aucune donnée n\'a été écrasée.'
      );
    }
    return this.db;
  }

  async close() {
    await this.queue;
    await this.#releaseLock();
  }

  /** Instantané en lecture seule : muter le résultat n'affecte pas le serveur. */
  read() {
    return structuredClone(this.db);
  }

  /**
   * Mutation sérialisée. Le brouillon n'est publié qu'après contrôle de
   * capacité et écriture disque réussie : une validation qui échoue laisse
   * l'état et le fichier intacts.
   */
  update(mutator) {
    const run = this.queue.then(async () => {
      if (!this.locked) throw new HttpError(503, 'Base fermée : redémarrez l\'outil.');
      const draft = structuredClone(this.db);
      const result = await mutator(draft);
      assertCapacity(draft);
      await this.#persist(draft);
      this.db = draft;
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async #persist(db) {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = path.join(this.dataDir, `.db.${process.pid}.${Date.now()}.tmp`);
    const payload = JSON.stringify(db, null, 2);
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, this.file);
  }
}
