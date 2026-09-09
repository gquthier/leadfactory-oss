// Configuration déclarative du tableau de bord Agency.
//
// Un objet plat {title, intro, sections} : du texte et une liste ordonnée de
// sections connues. Jamais de code, jamais de HTML, jamais un ordre d'exécution
// — l'interface choisit quoi dessiner à partir de noms fermés, elle n'interprète
// rien de ce qui est stocké ici. Les écrans Start Here, clients, campagnes,
// tâches, livrables et données restent hors de cette configuration.

import { HttpError, LIMITS, requireObject, text } from './validate.mjs';

/** Sections activables, dans l'ordre du tableau de bord par défaut. */
export const DASHBOARD_SECTIONS = ['metrics', 'tasks'];
/** Champs acceptés par une configuration : tout autre champ est refusé. */
export const DASHBOARD_FIELDS = ['title', 'intro', 'sections'];

/** Valeurs par défaut : exactement le tableau de bord livré avec l'outil. */
export function defaultDashboard() {
  return {
    title: 'Tableau de bord',
    intro: 'Compteurs calculés à partir de vos saisies uniquement.',
    sections: [...DASHBOARD_SECTIONS]
  };
}

function sectionsInput(value) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'Le champ "sections" doit être un tableau.', 'sections');
  }
  if (value.length === 0) {
    throw new HttpError(
      400,
      `Le champ "sections" doit contenir au moins une section (${DASHBOARD_SECTIONS.join(', ')}).`,
      'sections'
    );
  }
  if (value.length > DASHBOARD_SECTIONS.length) {
    throw new HttpError(400, `Le champ "sections" accepte au plus ${DASHBOARD_SECTIONS.length} entrées.`, 'sections');
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !DASHBOARD_SECTIONS.includes(item)) {
      throw new HttpError(
        400,
        `Section inconnue : ${JSON.stringify(item)} (attendu : ${DASHBOARD_SECTIONS.join(', ')}).`,
        'sections'
      );
    }
    if (seen.has(item)) {
      throw new HttpError(400, `Section en double : ${item}.`, 'sections');
    }
    seen.add(item);
  }
  return [...value];
}

/**
 * Valide une configuration complète. Un champ absent reprend sa valeur par
 * défaut : un PUT décrit l'état voulu en entier, il ne fusionne pas avec
 * l'existant. Un champ inconnu est refusé plutôt qu'ignoré, pour qu'une faute
 * de frappe d'un agent soit visible immédiatement.
 */
export function dashboardInput(body) {
  const src = requireObject(body, 'tableau de bord');
  for (const key of Object.keys(src)) {
    if (!DASHBOARD_FIELDS.includes(key)) {
      throw new HttpError(400, `Champ inconnu dans le tableau de bord : "${key}" (attendu : ${DASHBOARD_FIELDS.join(', ')}).`, key);
    }
  }
  const base = defaultDashboard();
  return {
    title:
      src.title === undefined
        ? base.title
        : text(src.title, 'title', { required: true, max: LIMITS.short }),
    intro: src.intro === undefined ? base.intro : text(src.intro, 'intro', { max: LIMITS.medium }),
    sections: src.sections === undefined ? base.sections : sectionsInput(src.sections)
  };
}
