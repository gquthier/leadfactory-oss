// Persistance fichier JSON : lecture stricte, écritures serialisees et atomiques,
// capacité bornée, verrou exclusif par processus.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { onboardingRecord } from './onboarding.mjs';
import {
  HttpError,
  agencyInput,
  assertCampaignBelongsTo,
  assertClientExists,
  campaignInput,
  clientInput,
  deliverableInput,
  emptyAgency,
  requireObject,
  taskInput
} from './validate.mjs';

export const DB_VERSION = 1;
/** Taille max de la base en JSON canonique (sans indentation). L'export reste réimportable. */
export const MAX_DB_BYTES = 20_000_000;
const COLLECTIONS = ['clients', 'campaigns', 'tasks', 'deliverables'];

export function emptyDatabase() {
  return { version: DB_VERSION, agency: emptyAgency(), clients: [], campaigns: [], tasks: [], deliverables: [] };
}

export function newId() {
  return randomUUID();
}

function stamps(raw, now) {
  const created = typeof raw?.createdAt === 'string' ? raw.createdAt : now;
  const updated = typeof raw?.updatedAt === 'string' ? raw.updatedAt : created;
  return { createdAt: created, updatedAt: updated };
}

export function canonicalSize(db) {
  return Buffer.byteLength(JSON.stringify(db), 'utf8');
}

export function assertCapacity(db) {
  const size = canonicalSize(db);
  if (size > MAX_DB_BYTES) {
    throw new HttpError(
      413,
      `Capacité de stockage dépassée : ${(size / 1_000_000).toFixed(1)} Mo pour un maximum de ${MAX_DB_BYTES / 1_000_000} Mo. ` +
        'Supprimez ou raccourcissez des livrables, ou exportez puis archivez une partie des clients.'
    );
  }
  return size;
}

/**
 * Valide et normalise une base complète (fichier sur disque ou import utilisateur).
 * Lève une HttpError explicite : jamais de réparation silencieuse.
 * `strict` (import) exige la version et les quatre collections : un objet vide
 * ou partiel ne peut pas écraser une base existante.
 */
export function validateDatabase(input, { strict = false } = {}) {
  const src = requireObject(input, 'fichier de données');
  if (strict && src.version === undefined) {
    throw new HttpError(400, 'Fichier d\'import incomplet : le champ "version" est absent. Utilisez un export produit par l\'outil.', 'version');
  }
  if (src.version !== undefined && src.version !== DB_VERSION) {
    throw new HttpError(400, `Version de données non supportée : ${String(src.version)} (attendu ${DB_VERSION}).`, 'version');
  }
  for (const key of COLLECTIONS) {
    if (strict && src[key] === undefined) {
      throw new HttpError(400, `Fichier d'import incomplet : la collection "${key}" est absente.`, key);
    }
    if (src[key] !== undefined && !Array.isArray(src[key])) {
      throw new HttpError(400, `La collection "${key}" doit être un tableau.`, key);
    }
  }

  const now = new Date().toISOString();
  const db = emptyDatabase();
  const seen = new Set();
  db.agency = src.agency === undefined ? emptyAgency() : agencyInput(src.agency);

  const takeId = (raw, label) => {
    const value = typeof raw?.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : newId();
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new HttpError(400, `Identifiant invalide dans "${label}".`, 'id');
    }
    if (seen.has(value)) {
      throw new HttpError(400, `Identifiant dupliqué : ${value}`, 'id');
    }
    seen.add(value);
    return value;
  };

  for (const raw of src.clients ?? []) {
    db.clients.push({
      id: takeId(raw, 'clients'),
      ...clientInput(raw),
      onboarding: onboardingRecord(raw?.onboarding),
      ...stamps(raw, now)
    });
  }
  for (const raw of src.campaigns ?? []) {
    const record = { id: takeId(raw, 'campaigns'), ...campaignInput(raw), ...stamps(raw, now) };
    assertClientExists(db, record.clientId);
    db.campaigns.push(record);
  }
  for (const raw of src.tasks ?? []) {
    const record = { id: takeId(raw, 'tasks'), ...taskInput(raw), ...stamps(raw, now) };
    assertClientExists(db, record.clientId);
    assertCampaignBelongsTo(db, record.campaignId, record.clientId);
    db.tasks.push(record);
  }
  for (const raw of src.deliverables ?? []) {
    const record = { id: takeId(raw, 'deliverables'), ...deliverableInput(raw), ...stamps(raw, now) };
    assertClientExists(db, record.clientId);
    assertCampaignBelongsTo(db, record.campaignId, record.clientId);
    db.deliverables.push(record);
  }
  // Liens internes du questionnaire : campagne et brief doivent appartenir au même client.
  for (const client of db.clients) {
    const ob = client.onboarding;
    if (!ob) continue;
    if (ob.campaignId) assertCampaignBelongsTo(db, ob.campaignId, client.id);
    if (ob.briefId) {
      const brief = db.deliverables.find((d) => d.id === ob.briefId);
      if (!brief || brief.clientId !== client.id) {
        throw new HttpError(400, `Brief d'onboarding introuvable pour le client ${client.id}.`, 'onboarding.briefId');
      }
    }
  }
  return db;
}

// --- Verrou exclusif -------------------------------------------------------

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    // EPERM : le processus existe mais appartient à un autre utilisateur.
    return true;
  }
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.lockFile = path.join(dataDir, 'db.lock');
    this.db = emptyDatabase();
    this.queue = Promise.resolve();
    this.loaded = false;
    this.locked = false;
  }

  /**
   * Prend le verrou `db.lock` (création exclusive, contenu = PID). Un verrou
   * d'un processus mort est récupéré ; un verrou actif fait refuser le démarrage.
   */
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
          `Verrou illisible : ${this.lockFile}\nSi aucune autre instance ne tourne sur ce dossier, supprimez ce fichier puis relancez.`
        );
      }
      if (processAlive(pid)) {
        throw new Error(
          `Dossier de données déjà utilisé par le processus ${pid} (${this.lockFile}).\n` +
            'Fermez cette instance, ou lancez la seconde avec un autre DATA_DIR. Deux instances sur le même dossier perdraient des données.'
        );
      }
      // Processus mort vérifié : on retire le verrou périmé et on réessaie une fois.
      await fs.rm(this.lockFile, { force: true });
    }
    throw new Error(`Impossible de prendre le verrou ${this.lockFile}.`);
  }

  async #releaseLock() {
    if (!this.locked) return;
    this.locked = false;
    try {
      const holder = JSON.parse(await fs.readFile(this.lockFile, 'utf8'));
      if (Number(holder?.pid) !== process.pid) return; // jamais supprimer le verrou d'un autre
      await fs.rm(this.lockFile, { force: true });
    } catch {
      // Verrou déjà absent ou illisible : rien à faire.
    }
  }

  /** Charge le fichier existant. Fichier absent = base vide ; fichier cassé = erreur. */
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
        this.loaded = true;
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
    this.loaded = true;
    return this.db;
  }

  /** Attend la fin des écritures en cours puis relâche le verrou. */
  async close() {
    await this.queue;
    await this.#releaseLock();
  }

  /** Snapshot en lecture seule (copie profonde) pour éviter les mutations accidentelles. */
  read() {
    return structuredClone(this.db);
  }

  /**
   * Mutation sérialisée : `mutator(draft)` travaille sur une copie, le résultat
   * n'est publié qu'après contrôle de capacité et écriture disque réussie.
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
    // La file continue même si une mutation échoue.
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
