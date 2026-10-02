/**
 * Génération + vérification des API keys pour les webhooks d'intégration.
 *
 * Format de la clé : `lf_live_<16 chars hex random>` (24 chars total après préfixe).
 * On stocke seulement le SHA-256 en DB pour qu'un dump SQL ne révèle pas la valeur.
 * Le prefix (premiers chars) est stocké en clair pour affichage UI.
 */

import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ApiKeyRecord {
  id: string;
  client_id: string;
  label: string;
  key_prefix: string;
  provider: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface GeneratedKey {
  /** Clé complète à montrer une seule fois au client */
  fullKey: string;
  /** Préfixe à stocker pour affichage */
  prefix: string;
  /** Hash SHA-256 à stocker en DB */
  hash: string;
}

/**
 * Génère une nouvelle API key cryptographiquement sûre.
 * Format : `lf_live_xxxxxxxxxxxxxxxx` (16 chars hex = 64 bits d'entropie).
 */
export function generateApiKey(): GeneratedKey {
  const random = randomBytes(16).toString("hex"); // 32 chars hex = 128 bits
  const fullKey = `lf_live_${random}`;
  const prefix = fullKey.slice(0, 16); // "lf_live_xxxxxxxx" (8 chars de random visibles)
  const hash = hashKey(fullKey);
  return { fullKey, prefix, hash };
}

/**
 * Hash SHA-256 d'une clé API. Constant-time lookup en DB.
 */
export function hashKey(fullKey: string): string {
  return createHash("sha256").update(fullKey).digest("hex");
}

/**
 * Vérifie une clé API et retourne le record correspondant si valide.
 * Renvoie null si :
 *   - la clé n'existe pas
 *   - elle est révoquée
 *   - le format est invalide
 *
 * Met à jour `last_used_at` en best-effort (pas bloquant).
 */
export async function verifyApiKey(
  admin: SupabaseClient,
  token: string
): Promise<ApiKeyRecord | null> {
  // Validation format basique pour éviter des appels DB inutiles
  if (!token || typeof token !== "string") return null;
  if (!/^lf_live_[a-f0-9]{16,64}$/.test(token)) return null;

  const hash = hashKey(token);

  const { data, error } = await admin
    .from("integration_api_keys")
    .select(
      "id, client_id, label, key_prefix, provider, revoked_at, last_used_at, created_at"
    )
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  // Best-effort : update last_used_at (n'attend pas)
  admin
    .from("integration_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  return data as ApiKeyRecord;
}
