// Questionnaire d'onboarding par client : schéma, brouillon, progression, soumission.
// Le schéma est la source de vérité, servie à l'interface via GET /api/onboarding/schema.

import {
  CAMPAIGN_CHANNELS,
  HttpError,
  LIMITS,
  ONBOARDING_STATUS,
  bool,
  email,
  enumValue,
  integer,
  isoDate,
  money,
  optionalId,
  requireObject,
  text,
  url
} from './validate.mjs';

/**
 * Étapes du questionnaire. `required: true` = indispensable à la soumission.
 * Les types : text, textarea, email, url, number, select(channel), bool.
 */
export const ONBOARDING_STEPS = [
  {
    key: 'company',
    label: 'Entreprise',
    fields: [
      { name: 'website', label: 'Site web', type: 'url', hint: 'Adresse complète, https://…' },
      { name: 'contactName', label: 'Interlocuteur principal', type: 'text' },
      { name: 'contactRole', label: 'Rôle de l’interlocuteur', type: 'text' },
      { name: 'contactEmail', label: 'Email de l’interlocuteur', type: 'email' },
      { name: 'contactPhone', label: 'Téléphone', type: 'text' }
    ]
  },
  {
    key: 'offer',
    label: 'Offre',
    fields: [
      { name: 'service', label: 'Service ou produit vendu', type: 'textarea', required: true },
      { name: 'problem', label: 'Problème résolu pour le client final', type: 'textarea', required: true },
      { name: 'promise', label: 'Promesse principale', type: 'textarea', required: true, hint: 'Ce que le prospect obtient, formulé sans chiffre non vérifié.' },
      { name: 'differentiation', label: 'Différenciation / mécanisme unique', type: 'textarea' },
      { name: 'proofs', label: 'Preuves disponibles', type: 'textarea', hint: 'Témoignages nommés, chiffres sourcés, références. Seules ces preuves seront utilisées dans les livrables.' },
      { name: 'price', label: 'Prix ou fourchette (texte)', type: 'text' }
    ]
  },
  {
    key: 'target',
    label: 'Cible',
    fields: [
      { name: 'profile', label: 'Profil client idéal', type: 'textarea', required: true, hint: 'Secteur, taille, rôle du décideur, signal de besoin.' },
      { name: 'zone', label: 'Zone géographique', type: 'text' },
      { name: 'exclusions', label: 'Exclusions / no-go', type: 'textarea', required: true, hint: 'Secteurs, entreprises ou pratiques à ne jamais cibler.' }
    ]
  },
  {
    key: 'campaign',
    label: 'Campagne',
    fields: [
      { name: 'channel', label: 'Canal principal', type: 'channel', required: true },
      { name: 'objective', label: 'Objectif de la campagne', type: 'textarea', required: true },
      { name: 'qualifiedLead', label: 'Définition d’un lead qualifié', type: 'textarea', required: true },
      { name: 'kpi', label: 'KPI de suivi', type: 'text', required: true, hint: 'Ex. coût par lead qualifié, nombre de RDV tenus.' },
      { name: 'budget', label: 'Budget mensuel (€)', type: 'number', required: true, hint: 'Nombre positif ou zéro pour une campagne sans dépense prévue.' },
      { name: 'timeline', label: 'Échéance ou durée de test', type: 'text' }
    ]
  },
  {
    key: 'delivery',
    label: 'Livraison',
    fields: [
      { name: 'assets', label: 'Assets fournis (logos, visuels, textes)', type: 'textarea' },
      { name: 'links', label: 'Liens utiles (pages, drive, CRM)', type: 'textarea', hint: 'Liens seulement : aucun mot de passe ni identifiant ici.' },
      { name: 'accessGranted', label: 'Accès aux comptes accordés (via invitation plateforme)', type: 'bool' },
      { name: 'accessNotes', label: 'Détail des accès accordés', type: 'textarea', hint: 'Quel compte, quel rôle, qui a invité. Jamais de secret.' },
      { name: 'validator', label: 'Responsable de la validation côté client', type: 'text' },
      { name: 'constraints', label: 'Contraintes (marque, légal, ton)', type: 'textarea' }
    ]
  }
];

const REQUIRED = ONBOARDING_STEPS.flatMap((step, index) =>
  step.fields.filter((f) => f.required).map((f) => ({ step: index, stepKey: step.key, stepLabel: step.label, ...f }))
);

export function emptyOnboarding() {
  const data = {};
  for (const step of ONBOARDING_STEPS) {
    data[step.key] = {};
    for (const field of step.fields) {
      data[step.key][field.name] = field.type === 'bool' ? false : field.type === 'number' ? null : '';
    }
  }
  return {
    status: 'draft',
    step: 0,
    submittedAt: null,
    reviewedAt: null,
    campaignId: null,
    briefId: null,
    updatedAt: null,
    ...data
  };
}

function fieldValue(field, raw, path) {
  switch (field.type) {
    case 'textarea':
      return text(raw, path, { max: LIMITS.long });
    case 'email':
      return email(raw, path);
    case 'url':
      return url(raw, path);
    case 'number':
      if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
      return money(raw, path);
    case 'bool':
      return bool(raw, path, false);
    case 'channel':
      return enumValue(raw, path, CAMPAIGN_CHANNELS, '');
    default:
      return text(raw, path, { max: LIMITS.medium });
  }
}

/**
 * Brouillon : fusionne les sections fournies dans l'existant, valide types et
 * longueurs, sans exiger les champs requis. Les champs internes (statut,
 * dates, liens) ne sont jamais pris depuis le corps utilisateur.
 */
export function onboardingDraft(body, previous = null) {
  const src = requireObject(body, 'questionnaire');
  const base = previous ?? emptyOnboarding();
  const next = structuredClone(base);
  for (const [index, step] of ONBOARDING_STEPS.entries()) {
    if (!(step.key in src)) continue;
    const section = requireObject(src[step.key], `section "${step.key}"`);
    for (const field of step.fields) {
      if (!(field.name in section)) continue;
      next[step.key][field.name] = fieldValue(field, section[field.name], `${step.key}.${field.name}`);
    }
    if (next.step < index) next.step = index;
  }
  if ('step' in src) next.step = integer(src.step, 'step', { min: 0, max: ONBOARDING_STEPS.length - 1, fallback: next.step });
  return next;
}

/** Normalise un enregistrement complet (import ou fichier), champs internes compris. */
export function onboardingRecord(raw) {
  if (raw === undefined || raw === null) return null;
  const src = requireObject(raw, 'champ onboarding');
  const record = onboardingDraft(src, emptyOnboarding());
  record.status = enumValue(src.status, 'onboarding.status', ONBOARDING_STATUS, 'draft');
  record.submittedAt = isoDate(src.submittedAt, 'onboarding.submittedAt');
  record.reviewedAt = isoDate(src.reviewedAt, 'onboarding.reviewedAt');
  record.campaignId = optionalId(src.campaignId, 'onboarding.campaignId');
  record.briefId = optionalId(src.briefId, 'onboarding.briefId');
  record.updatedAt = isoDate(src.updatedAt, 'onboarding.updatedAt');
  if (record.status !== 'draft') {
    assertSubmittable(record);
    if (!record.submittedAt || !record.campaignId || !record.briefId) {
      throw new HttpError(400, 'Un onboarding soumis doit avoir une date, une campagne et un brief liés.', 'onboarding.status');
    }
    if (record.status === 'reviewed' && (!record.reviewedAt || Date.parse(record.reviewedAt) < Date.parse(record.submittedAt))) {
      throw new HttpError(400, 'Un onboarding revu doit avoir une date de revue postérieure ou égale à la soumission.', 'onboarding.reviewedAt');
    }
  }
  if (record.status !== 'reviewed' && record.reviewedAt) {
    throw new HttpError(400, 'La date de revue est réservée aux onboardings revus.', 'onboarding.reviewedAt');
  }
  return record;
}

function isFilled(field, value) {
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (field.type === 'bool') return true;
  return typeof value === 'string' && value.trim() !== '';
}

/** Progression factuelle : uniquement les champs requis. */
export function onboardingProgress(onboarding) {
  const ob = onboarding ?? emptyOnboarding();
  const missing = REQUIRED.filter((f) => !isFilled(f, ob[f.stepKey]?.[f.name])).map((f) => ({
    step: f.step,
    stepLabel: f.stepLabel,
    field: `${f.stepKey}.${f.name}`,
    label: f.label
  }));
  const total = REQUIRED.length;
  return {
    total,
    filled: total - missing.length,
    percent: Math.round(((total - missing.length) / total) * 100),
    missing,
    complete: missing.length === 0
  };
}

/** Soumission : lève une 400 listant les manques. */
export function assertSubmittable(onboarding) {
  const progress = onboardingProgress(onboarding);
  if (!progress.complete) {
    const labels = progress.missing.map((m) => `${m.stepLabel} › ${m.label}`).join(', ');
    const err = new HttpError(400, `Questionnaire incomplet (${progress.filled}/${progress.total}) : ${labels}.`, progress.missing[0].field);
    err.missing = progress.missing;
    throw err;
  }
  return progress;
}

/** Détecte un changement de contenu (hors champs internes) entre deux versions. */
export function onboardingContentChanged(before, after) {
  for (const step of ONBOARDING_STEPS) {
    if (JSON.stringify(before?.[step.key] ?? null) !== JSON.stringify(after?.[step.key] ?? null)) return true;
  }
  return false;
}

/** Résumé texte du questionnaire (briefs, export Markdown, prompts IA). */
export function onboardingSummaryLines(onboarding, { includeEmpty = false } = {}) {
  if (!onboarding) return [];
  const out = [];
  for (const step of ONBOARDING_STEPS) {
    const lines = [];
    for (const field of step.fields) {
      const value = onboarding[step.key]?.[field.name];
      let shown;
      if (field.type === 'bool') shown = value ? 'oui' : 'non';
      else if (field.type === 'number') shown = typeof value === 'number' && value >= 0 ? `${value} EUR` : '';
      else shown = typeof value === 'string' ? value.trim() : '';
      if (shown === '' && !includeEmpty) continue;
      lines.push(`- ${field.label} : ${shown === '' ? 'non renseigné' : shown}`);
    }
    if (lines.length === 0) continue;
    out.push(`### ${step.label}`);
    out.push(...lines);
    out.push('');
  }
  return out;
}

export const ONBOARDING_SCHEMA = {
  steps: ONBOARDING_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    fields: step.fields.map((f) => ({ ...f, required: Boolean(f.required) }))
  })),
  channels: CAMPAIGN_CHANNELS,
  requiredCount: REQUIRED.length
};
