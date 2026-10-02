// Validation dérivée du schéma. Les primitives viennent du kit commun : une
// seule implémentation de « texte borné », « montant », « URL », etc.

import {
  HttpError,
  enumValue,
  integer,
  isoDate,
  money,
  optionalId,
  requireObject,
  text,
  url
} from '../../lib/validate.mjs';

import {
  COLLECTIONS,
  COLLECTION_NAMES,
  LIMITS,
  PIPELINE_COLLECTIONS,
  PROFILE_FIELDS,
  SECTION_TYPES,
  STAGES,
  enumFields,
  fieldDef
} from './schema.mjs';

export { HttpError };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_ID = /^[a-z0-9-]{1,64}$/;

function fail(message, field) {
  throw new HttpError(400, message, field);
}

/** `YYYY-MM-DD` strict : une date de relevé n'a pas d'heure ni de fuseau. */
export function dateOnly(value, field) {
  const raw = text(value, field, { required: true, max: 10 });
  if (!DATE_ONLY.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    fail(`Le champ "${field}" doit être une date au format AAAA-MM-JJ.`, field);
  }
  // 2026-02-31 passe le parse en le décalant : on refuse une date inexistante.
  const [y, m, d] = raw.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    fail(`Date inexistante pour "${field}" : ${raw}.`, field);
  }
  return raw;
}

function idList(value, field, max) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) fail(`Le champ "${field}" doit être un tableau d'identifiants.`, field);
  if (value.length > max) fail(`Le champ "${field}" dépasse ${max} entrées.`, field);
  const out = [];
  for (const entry of value) {
    const parsed = optionalId(entry, field);
    if (parsed === null) fail(`Identifiant vide dans "${field}".`, field);
    if (out.includes(parsed)) fail(`Identifiant dupliqué dans "${field}" : ${parsed}.`, field);
    out.push(parsed);
  }
  return out;
}

/** Applique un descripteur de champ à une valeur brute. */
function coerce(def, value) {
  const field = def.name;
  switch (def.type) {
    case 'text':
      return text(value, field, { required: def.required === true, max: def.max });
    case 'money':
      return money(value, field);
    case 'int':
      return integer(value, field, { min: def.min ?? 0, max: def.max ?? 1000, fallback: 0 });
    case 'url':
      return url(value, field);
    case 'ref':
      return optionalId(value, field);
    case 'iso':
      return isoDate(value, field);
    case 'date':
      return dateOnly(value, field);
    case 'enum':
      return enumValue(value, field, def.choices, def.required === true ? undefined : def.default);
    case 'idlist':
      return idList(value, field, def.max ?? LIMITS.productIds);
    case 'bool':
      if (value === undefined || value === null) return def.default ?? false;
      if (typeof value !== 'boolean') fail(`Le champ "${field}" doit être un booléen.`, field);
      return value;
    default:
      throw new Error(`Type de champ non géré : ${def.type}`);
  }
}

/**
 * Construit un enregistrement validé. `previous` fourni = mise à jour partielle :
 * les champs absents du corps gardent leur valeur.
 */
export function buildRecord(collection, body, previous = null) {
  const def = COLLECTIONS[collection];
  if (!def) throw new HttpError(404, `Collection inconnue : ${collection}.`);
  const src = requireObject(body);
  const base = previous ?? {};
  const record = {};
  for (const field of def.fields) {
    const raw = field.name in src ? src[field.name] : base[field.name];
    record[field.name] = coerce(field, raw);
  }
  for (const [key, value] of Object.entries(def.serverFields ?? {})) record[key] = value;
  return record;
}

export function emptyProfile() {
  const profile = {};
  for (const field of PROFILE_FIELDS) profile[field.name] = coerce(field, undefined);
  profile.updatedAt = null;
  return profile;
}

export function profileInput(body, previous = null) {
  const src = requireObject(body, 'profil');
  const base = previous ?? emptyProfile();
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    profile[field.name] = coerce(field, field.name in src ? src[field.name] : base[field.name]);
  }
  profile.updatedAt = isoDate(base.updatedAt, 'updatedAt');
  return profile;
}

// --- Configuration du dashboard -------------------------------------------

function sectionInput(raw, index, seen) {
  const src = requireObject(raw, `section ${index + 1}`);
  const id = text(src.id, `sections[${index}].id`, { required: true, max: 64 });
  if (!SECTION_ID.test(id)) {
    fail(`Identifiant de section invalide : "${id}" (minuscules, chiffres et tirets).`, `sections[${index}].id`);
  }
  if (seen.has(id)) fail(`Identifiant de section dupliqué : ${id}.`, `sections[${index}].id`);
  seen.add(id);

  const type = enumValue(src.type, `sections[${index}].type`, SECTION_TYPES);
  const section = {
    id,
    type,
    title: text(src.title, `sections[${index}].title`, { required: true, max: LIMITS.short })
  };

  if (type === 'note') {
    section.text = text(src.text, `sections[${index}].text`, { max: LIMITS.long });
    return section;
  }

  if (type === 'metrics') return section;

  if (type === 'checklist') {
    const items = src.items === undefined || src.items === null ? [] : src.items;
    if (!Array.isArray(items)) fail('Le champ "items" doit être un tableau.', `sections[${index}].items`);
    if (items.length > LIMITS.checklistItems) {
      fail(`Une checklist accepte au maximum ${LIMITS.checklistItems} entrées.`, `sections[${index}].items`);
    }
    section.items = items.map((item, i) => {
      const entry = requireObject(item, `sections[${index}].items[${i}]`);
      return {
        label: text(entry.label, `sections[${index}].items[${i}].label`, { required: true, max: LIMITS.label }),
        done: entry.done === undefined || entry.done === null ? false : coerce({ name: 'done', type: 'bool' }, entry.done)
      };
    });
    return section;
  }

  if (type === 'pipeline') {
    const collection = enumValue(src.collection, `sections[${index}].collection`, PIPELINE_COLLECTIONS);
    const groups = enumFields(collection);
    section.collection = collection;
    section.groupBy = enumValue(src.groupBy, `sections[${index}].groupBy`, groups, groups[0]);
    return section;
  }

  // type === 'collection'
  const collection = enumValue(src.collection, `sections[${index}].collection`, COLLECTION_NAMES);
  section.collection = collection;
  const columnsRaw = src.columns === undefined || src.columns === null ? [] : src.columns;
  if (!Array.isArray(columnsRaw)) fail('Le champ "columns" doit être un tableau.', `sections[${index}].columns`);
  if (columnsRaw.length > LIMITS.columns) {
    fail(`Une section accepte au maximum ${LIMITS.columns} colonnes.`, `sections[${index}].columns`);
  }
  const allowed = [...COLLECTIONS[collection].fields.map((f) => f.name), 'createdAt', 'updatedAt'];
  section.columns = columnsRaw.map((column, i) =>
    enumValue(column, `sections[${index}].columns[${i}]`, allowed)
  );
  section.limit = integer(src.limit, `sections[${index}].limit`, { min: 1, max: 200, fallback: 50 });
  if (src.filter === undefined || src.filter === null) {
    section.filter = null;
  } else {
    const filter = requireObject(src.filter, `sections[${index}].filter`);
    const field = enumValue(filter.field, `sections[${index}].filter.field`, enumFields(collection));
    const choices = fieldDef(collection, field).choices;
    section.filter = { field, value: enumValue(filter.value, `sections[${index}].filter.value`, choices) };
  }
  return section;
}

export function dashboardInput(body, previous = null) {
  const src = requireObject(body, 'dashboard');
  const base = previous ?? emptyDashboard();
  const title = text('title' in src ? src.title : base.title, 'title', { required: true, max: LIMITS.short });
  const intro = text('intro' in src ? src.intro : base.intro, 'intro', { max: LIMITS.intro });
  const rawSections = 'sections' in src ? src.sections : base.sections;
  if (!Array.isArray(rawSections)) fail('Le champ "sections" doit être un tableau.', 'sections');
  if (rawSections.length > LIMITS.sections) {
    fail(`Le dashboard accepte au maximum ${LIMITS.sections} sections.`, 'sections');
  }
  const seen = new Set();
  return { title, intro, sections: rawSections.map((raw, i) => sectionInput(raw, i, seen)) };
}

/**
 * Configuration livrée avec une base vide : elle décrit le travail à faire, sans
 * inventer le moindre chiffre, produit ou témoignage.
 */
export function emptyDashboard() {
  return {
    title: 'Cockpit e-commerce',
    intro:
      'Pilotez votre activité étape par étape : ' +
      'recherche produit, concurrents, sourcing, offre, marque, boutique, créatives, acquisition, rétention, opérations.',
    sections: [
      { id: 'pipeline-produits', type: 'pipeline', title: 'Pipeline produits', collection: 'products', groupBy: 'status' },
      {
        id: 'concurrents',
        type: 'collection',
        title: 'Concurrents observés',
        collection: 'competitors',
        columns: ['name', 'angle', 'observedAt'],
        limit: 20,
        filter: null
      },
      {
        id: 'fournisseurs',
        type: 'collection',
        title: 'Fournisseurs et coûts',
        collection: 'suppliers',
        columns: ['name', 'unitCost', 'shippingCost', 'leadTime', 'moq'],
        limit: 20,
        filter: null
      },
      {
        id: 'boutique-prete',
        type: 'checklist',
        title: 'Boutique prête',
        items: [
          { label: 'Produit GO écrit avec son CPA plafond', done: false },
          { label: 'Fournisseur confirmé (échantillon reçu)', done: false },
          { label: 'Offre et prix arrêtés', done: false },
          { label: 'Pages légales et politique de retour publiées', done: false },
          { label: 'Fiche produit : images bénéfice + objections traitées', done: false },
          { label: 'Parcours d’achat testé de bout en bout', done: false },
          { label: 'Moyens de paiement actifs et vérifiés', done: false },
          { label: 'Emails transactionnels vérifiés', done: false },
          { label: 'Suivi de conversion vérifié par un achat test', done: false },
          { label: 'Délais annoncés et suivi de livraison vérifiés auprès du fournisseur', done: false }
        ]
      },
      { id: 'metriques', type: 'metrics', title: 'Relevés saisis', },
      {
        id: 'etapes',
        type: 'note',
        title: 'Rappel',
        text:
          'Une publicité concurrente active est une observation datée, pas une preuve de rentabilité. ' +
          'Les métriques de ce cockpit sont saisies à la main : citez leur source dans le champ prévu. ' +
          'Aucune boutique, campagne ou séquence email n’est publiée par cet outil.'
      }
    ]
  };
}

export function assertProductExists(db, productId) {
  if (productId === null) return;
  if (!db.products.some((p) => p.id === productId)) {
    throw new HttpError(400, `Produit introuvable : ${productId}`, 'productId');
  }
}

/** Vérifie toutes les références produit d'un enregistrement. */
export function assertReferences(db, collection, record) {
  const def = COLLECTIONS[collection];
  for (const field of def.fields) {
    if (field.type === 'ref') assertProductExists(db, record[field.name]);
    if (field.type === 'idlist') {
      for (const value of record[field.name]) {
        if (!db.products.some((p) => p.id === value)) {
          throw new HttpError(400, `Produit introuvable : ${value}`, field.name);
        }
      }
    }
  }
}

export { STAGES };
