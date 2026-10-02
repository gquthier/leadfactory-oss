/**
 * Helper pur (sans import server-only) — utilisable depuis le client.
 *
 * Strip le bloc <SCRIPT_JSON>...</SCRIPT_JSON> du content d'un message
 * assistant pour ne pas polluer la bulle de chat avec le JSON brut.
 *
 * Le bloc reste stocké en DB (raw_response) pour traçabilité et re-extraction
 * éventuelle ; il est juste invisible à l'affichage.
 */

const SCRIPT_BLOCK_RE = /<SCRIPT_JSON>([\s\S]*?)<\/SCRIPT_JSON>/i;

export function stripScriptBlock(text: string): string {
  return text.replace(SCRIPT_BLOCK_RE, "").trim();
}
