// Validation partagée entre l'API REST et l'import JSON.

export class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

// Valeurs d'enum volontairement ASCII : ce sont des identifiants, pas du texte affiché.
export const CLIENT_STATUS = ['prospect', 'onboarding', 'actif', 'pause', 'termine'];
export const CAMPAIGN_CHANNELS = ['cold-email', 'meta', 'google', 'organic'];
export const CAMPAIGN_STATUS = ['draft', 'ready', 'active', 'paused', 'done'];
export const DELIVERABLE_TYPES = ['brief', 'cold-email', 'creative-brief', 'report'];
export const DELIVERABLE_SOURCES = ['manual', 'template', 'ai'];
export const ONBOARDING_STATUS = ['draft', 'submitted', 'reviewed'];
export const AGENCY_LANGUAGES = ['fr', 'en'];

export const LIMITS = {
  short: 120,
  medium: 400,
  long: 4000,
  content: 40000
};

function fail(message, field) {
  throw new HttpError(400, message, field);
}

export function requireObject(value, label = 'corps de requête') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`Le ${label} doit être un objet JSON.`);
  }
  return value;
}

export function text(value, field, { required = false, max = LIMITS.medium } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`Le champ "${field}" est obligatoire.`, field);
    return '';
  }
  if (typeof value !== 'string') fail(`Le champ "${field}" doit être une chaîne.`, field);
  const trimmed = value.trim();
  if (required && trimmed === '') fail(`Le champ "${field}" est obligatoire.`, field);
  if (trimmed.length > max) {
    fail(`Le champ "${field}" dépasse ${max} caractères.`, field);
  }
  return trimmed;
}

export function email(value, field = 'email') {
  const raw = text(value, field, { max: LIMITS.short });
  if (raw === '') return '';
  // Vérification volontairement simple : un local, un @, un domaine avec point.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    fail('Adresse email invalide.', field);
  }
  return raw;
}

export function money(value, field = 'budget') {
  if (value === undefined || value === null || value === '') return 0;
  const num = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    fail(`Le champ "${field}" doit être un nombre.`, field);
  }
  if (num < 0) fail(`Le champ "${field}" ne peut pas être négatif.`, field);
  if (num > 100_000_000) fail(`Le champ "${field}" est hors limites.`, field);
  return Math.round(num * 100) / 100;
}

export function enumValue(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    fail(`Le champ "${field}" est obligatoire.`, field);
  }
  if (!allowed.includes(value)) {
    fail(`Valeur invalide pour "${field}" (attendu : ${allowed.join(', ')}).`, field);
  }
  return value;
}

export function bool(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(`Le champ "${field}" doit être un booléen.`, field);
  return value;
}

export function id(value, field) {
  const raw = text(value, field, { required: true, max: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) fail(`Identifiant invalide pour "${field}".`, field);
  return raw;
}

export function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return id(value, field);
}

// --- Entités -------------------------------------------------------------

export function clientInput(body, previous = null) {
  const src = requireObject(body);
  const base = previous ?? {};
  const pick = (key) => (key in src ? src[key] : base[key]);
  return {
    company: text(pick('company'), 'company', { required: true, max: LIMITS.short }),
    contact: text(pick('contact'), 'contact', { max: LIMITS.short }),
    email: email(pick('email')),
    offer: text(pick('offer'), 'offer', { max: LIMITS.medium }),
    audience: text(pick('audience'), 'audience', { max: LIMITS.medium }),
    goal: text(pick('goal'), 'goal', { max: LIMITS.medium }),
    budget: money(pick('budget')),
    notes: text(pick('notes'), 'notes', { max: LIMITS.long }),
    status: enumValue(pick('status'), 'status', CLIENT_STATUS, 'prospect')
  };
}

export function campaignInput(body, previous = null) {
  const src = requireObject(body);
  const base = previous ?? {};
  const pick = (key) => (key in src ? src[key] : base[key]);
  return {
    clientId: id(pick('clientId'), 'clientId'),
    name: text(pick('name'), 'name', { required: true, max: LIMITS.short }),
    channel: enumValue(pick('channel'), 'channel', CAMPAIGN_CHANNELS),
    goal: text(pick('goal'), 'goal', { max: LIMITS.medium }),
    budget: money(pick('budget')),
    status: enumValue(pick('status'), 'status', CAMPAIGN_STATUS, 'draft')
  };
}

export function taskInput(body, previous = null) {
  const src = requireObject(body);
  const base = previous ?? {};
  const pick = (key) => (key in src ? src[key] : base[key]);
  return {
    clientId: id(pick('clientId'), 'clientId'),
    campaignId: optionalId(pick('campaignId'), 'campaignId'),
    title: text(pick('title'), 'title', { required: true, max: LIMITS.medium }),
    done: bool(pick('done'), 'done', false),
    onboardingKey: pick('onboardingKey') ? text(pick('onboardingKey'), 'onboardingKey', { max: 64 }) : null
  };
}

export function deliverableInput(body, previous = null) {
  const src = requireObject(body);
  const base = previous ?? {};
  const pick = (key) => (key in src ? src[key] : base[key]);
  return {
    clientId: id(pick('clientId'), 'clientId'),
    campaignId: optionalId(pick('campaignId'), 'campaignId'),
    type: enumValue(pick('type'), 'type', DELIVERABLE_TYPES),
    title: text(pick('title'), 'title', { required: true, max: LIMITS.short }),
    content: text(pick('content'), 'content', { max: LIMITS.content }),
    generated: bool(pick('generated'), 'generated', false),
    ...deliverableOrigin(pick('source'), pick('model'), pick('generated'), pick('generatedAt'))
  };
}

/**
 * Origine d'un livrable. `generated` (booléen historique) reste accepté :
 * un ancien livrable généré sans `source` devient source=template.
 */
function deliverableOrigin(sourceRaw, modelRaw, generatedRaw, generatedAtRaw) {
  const fallback = generatedRaw === true ? 'template' : 'manual';
  const source = enumValue(sourceRaw, 'source', DELIVERABLE_SOURCES, fallback);
  const model = source === 'ai' ? text(modelRaw, 'model', { required: true, max: LIMITS.short }) : null;
  const generatedAt = source === 'ai' ? isoDate(generatedAtRaw, 'generatedAt') : null;
  return { source, model, generatedAt };
}

export function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(`Le champ "${field}" doit être une date ISO.`, field);
  }
  return value;
}

export function url(value, field) {
  const raw = text(value, field, { max: LIMITS.medium });
  if (raw === '') return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`Le champ "${field}" doit être une URL complète (https://…).`, field);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`Le champ "${field}" doit commencer par http:// ou https://.`, field);
  }
  return raw;
}

export function integer(value, field, { min = 0, max = 1000, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(num) || num < min || num > max) {
    fail(`Le champ "${field}" doit être un entier entre ${min} et ${max}.`, field);
  }
  return num;
}

// --- Profil d'agence -------------------------------------------------------

export function emptyAgency() {
  return {
    name: '',
    offer: '',
    audience: '',
    language: 'fr',
    contact: '',
    email: '',
    tools: { assistant: '', skillsInstalled: false },
    updatedAt: null
  };
}

export function agencyInput(body, previous = null) {
  const src = requireObject(body, 'profil d\'agence');
  const base = previous ?? emptyAgency();
  const pick = (key) => (key in src ? src[key] : base[key]);
  const toolsSrc = src.tools === undefined ? base.tools ?? {} : requireObject(src.tools, 'champ tools');
  const toolsBase = base.tools ?? {};
  const pickTool = (key) => (key in toolsSrc ? toolsSrc[key] : toolsBase[key]);
  return {
    name: text(pick('name'), 'name', { max: LIMITS.short }),
    offer: text(pick('offer'), 'offer', { max: LIMITS.medium }),
    audience: text(pick('audience'), 'audience', { max: LIMITS.medium }),
    language: enumValue(pick('language'), 'language', AGENCY_LANGUAGES, 'fr'),
    contact: text(pick('contact'), 'contact', { max: LIMITS.short }),
    email: email(pick('email')),
    tools: {
      assistant: enumValue(pickTool('assistant'), 'tools.assistant', ['', 'codex', 'claude', 'other'], ''),
      skillsInstalled: bool(pickTool('skillsInstalled'), 'tools.skillsInstalled', false)
    },
    updatedAt: isoDate(pick('updatedAt'), 'updatedAt')
  };
}

/** Une agence est "configurée" quand son nom est renseigné : jamais déduit d'un placeholder. */
export function agencyConfigured(agency) {
  return typeof agency?.name === 'string' && agency.name.trim() !== '';
}

// --- Relations -----------------------------------------------------------

export function assertClientExists(db, clientId) {
  if (!db.clients.some((c) => c.id === clientId)) {
    throw new HttpError(400, `Client introuvable : ${clientId}`, 'clientId');
  }
}

export function assertCampaignBelongsTo(db, campaignId, clientId) {
  if (campaignId === null) return;
  const campaign = db.campaigns.find((c) => c.id === campaignId);
  if (!campaign) throw new HttpError(400, `Campagne introuvable : ${campaignId}`, 'campaignId');
  if (campaign.clientId !== clientId) {
    throw new HttpError(400, 'La campagne appartient à un autre client.', 'campaignId');
  }
}
