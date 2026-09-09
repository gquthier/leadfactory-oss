// Schéma métier e-commerce : source unique de vérité.
//
// Les validateurs, l'API REST, `GET /api/schema` et le formulaire du dashboard
// sont tous dérivés de cette description. Ajouter un champ ici suffit : rien
// n'est à répéter ailleurs, donc rien ne peut diverger.

/** Étapes du workflow métier. Un dossier du vault par étape. */
export const STAGES = [
  'research',
  'competitors',
  'sourcing',
  'offer',
  'brand',
  'store',
  'creative',
  'acquisition',
  'retention',
  'operations'
];

/** Libellés français : affichés par le dashboard, jamais stockés. */
export const STAGE_LABELS = {
  research: 'Recherche produit',
  competitors: 'Concurrents et publicités',
  sourcing: 'Sourcing et coûts',
  offer: 'Offre et prix',
  brand: 'Marque et positionnement',
  store: 'Boutique',
  creative: 'Créatives',
  acquisition: 'Acquisition',
  retention: 'Rétention et email',
  operations: 'Opérations et pilotage'
};

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'];

export const LIMITS = {
  short: 120,
  medium: 400,
  long: 4000,
  intro: 2000,
  content: 40000,
  label: 200,
  sections: 12,
  checklistItems: 50,
  columns: 8,
  productIds: 50
};

const t = (name, max, extra = {}) => ({ name, type: 'text', max, ...extra });

/** Description d'une collection : `fields` définit tout (validation + UI). */
export const COLLECTIONS = {
  products: {
    label: 'Produits',
    singular: 'Produit',
    defaultColumns: ['name', 'status', 'price', 'cost', 'audience'],
    fields: [
      t('name', LIMITS.short, { required: true, label: 'Nom' }),
      t('description', LIMITS.long, { label: 'Description', multiline: true }),
      {
        name: 'status',
        type: 'enum',
        choices: ['idea', 'researching', 'validated', 'rejected', 'launched'],
        default: 'idea',
        label: 'Statut'
      },
      t('audience', LIMITS.medium, { label: 'Audience' }),
      t('problem', LIMITS.medium, { label: 'Problème résolu' }),
      { name: 'price', type: 'money', label: 'Prix de vente' },
      { name: 'cost', type: 'money', label: 'Coût produit' },
      { name: 'shippingCost', type: 'money', label: 'Coût logistique' },
      t('evidence', LIMITS.long, { label: 'Preuves et sources', multiline: true }),
      t('notes', LIMITS.long, { label: 'Notes', multiline: true })
    ]
  },
  competitors: {
    label: 'Concurrents',
    singular: 'Concurrent',
    defaultColumns: ['name', 'angle', 'observedAt', 'productId'],
    fields: [
      { name: 'productId', type: 'ref', label: 'Produit lié' },
      t('name', LIMITS.short, { required: true, label: 'Marque' }),
      { name: 'url', type: 'url', label: 'Site' },
      { name: 'adsUrl', type: 'url', label: 'Bibliothèque publicitaire' },
      t('angle', LIMITS.medium, { label: 'Angle observé' }),
      t('evidence', LIMITS.long, { label: 'Observation (source + date)', multiline: true }),
      { name: 'observedAt', type: 'iso', label: 'Observé le' },
      t('notes', LIMITS.long, { label: 'Notes', multiline: true })
    ]
  },
  suppliers: {
    label: 'Fournisseurs',
    singular: 'Fournisseur',
    defaultColumns: ['name', 'unitCost', 'leadTime', 'moq', 'productId'],
    fields: [
      { name: 'productId', type: 'ref', label: 'Produit lié' },
      t('name', LIMITS.short, { required: true, label: 'Nom' }),
      { name: 'url', type: 'url', label: 'Fiche ou site' },
      { name: 'unitCost', type: 'money', label: 'Coût unitaire' },
      { name: 'shippingCost', type: 'money', label: 'Coût d’expédition' },
      { name: 'leadTime', type: 'int', min: 0, max: 365, label: 'Délai (jours)' },
      { name: 'moq', type: 'int', min: 0, max: 1_000_000, label: 'Quantité minimale' },
      t('notes', LIMITS.long, { label: 'Notes', multiline: true })
    ]
  },
  storefronts: {
    label: 'Boutiques',
    singular: 'Boutique',
    defaultColumns: ['name', 'platform', 'status', 'url'],
    fields: [
      t('name', LIMITS.short, { required: true, label: 'Nom' }),
      { name: 'platform', type: 'enum', choices: ['shopify', 'other'], default: 'shopify', label: 'Plateforme' },
      { name: 'url', type: 'url', label: 'URL' },
      {
        name: 'status',
        type: 'enum',
        choices: ['planned', 'building', 'preview', 'live'],
        default: 'planned',
        label: 'État déclaré'
      },
      { name: 'productIds', type: 'idlist', max: LIMITS.productIds, label: 'Produits vendus' },
      t('notes', LIMITS.long, { label: 'Notes', multiline: true })
    ]
  },
  creatives: {
    label: 'Créatives',
    singular: 'Créative',
    defaultColumns: ['title', 'type', 'status', 'productId'],
    fields: [
      { name: 'productId', type: 'ref', label: 'Produit lié' },
      t('title', LIMITS.short, { required: true, label: 'Titre' }),
      {
        name: 'type',
        type: 'enum',
        choices: ['image', 'video', 'ugc', 'copy', 'email', 'landing'],
        default: 'image',
        label: 'Format'
      },
      {
        name: 'status',
        type: 'enum',
        choices: ['idea', 'draft', 'ready', 'published'],
        default: 'idea',
        label: 'Statut'
      },
      t('content', LIMITS.content, { label: 'Contenu / script', multiline: true }),
      { name: 'url', type: 'url', label: 'Fichier ou aperçu' }
    ]
  },
  campaigns: {
    label: 'Campagnes',
    singular: 'Campagne',
    defaultColumns: ['name', 'channel', 'status', 'budget'],
    fields: [
      { name: 'productId', type: 'ref', label: 'Produit lié' },
      t('name', LIMITS.short, { required: true, label: 'Nom' }),
      {
        name: 'channel',
        type: 'enum',
        choices: ['meta', 'google', 'tiktok', 'email', 'seo', 'other'],
        required: true,
        label: 'Canal'
      },
      {
        name: 'status',
        type: 'enum',
        choices: ['draft', 'ready', 'active', 'paused', 'done'],
        default: 'draft',
        label: 'Statut déclaré'
      },
      { name: 'budget', type: 'money', label: 'Budget prévu' },
      t('notes', LIMITS.long, { label: 'Notes', multiline: true })
    ]
  },
  tasks: {
    label: 'Tâches',
    singular: 'Tâche',
    defaultColumns: ['title', 'stage', 'status', 'productId'],
    fields: [
      { name: 'productId', type: 'ref', label: 'Produit lié' },
      t('title', LIMITS.medium, { required: true, label: 'Intitulé' }),
      { name: 'stage', type: 'enum', choices: STAGES, required: true, label: 'Étape' },
      {
        name: 'status',
        type: 'enum',
        choices: ['todo', 'doing', 'done', 'blocked'],
        default: 'todo',
        label: 'Statut'
      }
    ]
  },
  deliverables: {
    label: 'Livrables',
    singular: 'Livrable',
    defaultColumns: ['title', 'stage', 'productId', 'updatedAt'],
    fields: [
      { name: 'productId', type: 'ref', label: 'Produit lié' },
      t('title', LIMITS.short, { required: true, label: 'Titre' }),
      { name: 'stage', type: 'enum', choices: STAGES, required: true, label: 'Étape' },
      t('content', LIMITS.content, { label: 'Contenu', multiline: true })
    ]
  },
  metrics: {
    label: 'Métriques',
    singular: 'Relevé',
    defaultColumns: ['date', 'spend', 'revenue', 'orders', 'returns'],
    // `source` est écrit par le serveur : tout relevé est une saisie humaine.
    serverFields: { source: 'manual' },
    fields: [
      { name: 'date', type: 'date', required: true, label: 'Date' },
      { name: 'spend', type: 'money', label: 'Dépense publicitaire' },
      { name: 'revenue', type: 'money', label: 'Chiffre d’affaires' },
      { name: 'orders', type: 'int', min: 0, max: 1_000_000, label: 'Commandes' },
      { name: 'returns', type: 'int', min: 0, max: 1_000_000, label: 'Retours' },
      t('notes', LIMITS.long, { label: 'Source de la saisie', multiline: true })
    ]
  }
};

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

export const PROFILE_FIELDS = [
  t('storeName', LIMITS.short, { label: 'Nom de la boutique' }),
  t('niche', LIMITS.medium, { label: 'Niche' }),
  t('market', LIMITS.short, { label: 'Marché visé' }),
  { name: 'currency', type: 'enum', choices: CURRENCIES, default: 'EUR', label: 'Devise' },
  { name: 'stage', type: 'enum', choices: STAGES, default: 'research', label: 'Étape courante' },
  { name: 'shopUrl', type: 'url', label: 'URL de la boutique' }
];

/** Champs `enum` d'une collection : seuls candidats à `groupBy` et `filter`. */
export function enumFields(collection) {
  const def = COLLECTIONS[collection];
  if (!def) return [];
  return def.fields.filter((f) => f.type === 'enum').map((f) => f.name);
}

export function fieldNames(collection) {
  const def = COLLECTIONS[collection];
  if (!def) return [];
  return ['id', ...def.fields.map((f) => f.name), ...Object.keys(def.serverFields ?? {}), 'createdAt', 'updatedAt'];
}

export function fieldDef(collection, name) {
  return COLLECTIONS[collection]?.fields.find((f) => f.name === name) ?? null;
}

/** Collections dont les valeurs d'enum se prêtent à un affichage en colonnes. */
export const PIPELINE_COLLECTIONS = ['products', 'storefronts', 'creatives', 'campaigns', 'tasks'];

export const SECTION_TYPES = ['note', 'collection', 'pipeline', 'metrics', 'checklist'];

/** Projection lisible par un agent : exactement ce que valide le serveur. */
export function schemaPayload() {
  const collections = {};
  for (const [name, def] of Object.entries(COLLECTIONS)) {
    collections[name] = {
      label: def.label,
      singular: def.singular,
      defaultColumns: def.defaultColumns,
      serverFields: def.serverFields ?? {},
      fields: def.fields.map((f) => ({ ...f }))
    };
  }
  return {
    apiVersion: 1,
    stages: STAGES,
    stageLabels: STAGE_LABELS,
    currencies: CURRENCIES,
    limits: LIMITS,
    profile: { fields: PROFILE_FIELDS.map((f) => ({ ...f })) },
    collections,
    dashboard: {
      sectionTypes: SECTION_TYPES,
      pipelineCollections: PIPELINE_COLLECTIONS,
      maxSections: LIMITS.sections,
      note: 'Configuration déclarative : aucun HTML ni JavaScript n’est interprété.'
    },
    workflow: STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage] }))
  };
}
