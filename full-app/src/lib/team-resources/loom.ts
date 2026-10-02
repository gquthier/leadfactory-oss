/**
 * Normalisation des liens Loom pour l'embed.
 *
 * Loom accepte plusieurs formes d'URL (partage, embed, avec params de tracking).
 * Pour qu'un iframe s'affiche proprement il faut la forme `/embed/<id>`.
 * On extrait l'id (32 hex) et on reconstruit l'URL d'embed canonique.
 */

const LOOM_ID_RE = /loom\.com\/(?:share|embed|v)\/([0-9a-fA-F]{20,})/;

/**
 * Transforme un lien Loom (partage/embed/v) en URL d'embed canonique.
 * Retourne null si l'entrée n'est pas un lien Loom reconnaissable.
 */
export function toLoomEmbedUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const m = trimmed.match(LOOM_ID_RE);
  if (!m) return null;

  return `https://www.loom.com/embed/${m[1]}`;
}

/** Vrai si l'entrée est un lien Loom exploitable en embed. */
export function isValidLoomUrl(input: string | null | undefined): boolean {
  return toLoomEmbedUrl(input) !== null;
}
