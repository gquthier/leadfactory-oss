import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Récupère la clé Gemini : d'abord depuis le profil admin en DB,
 * sinon fallback sur la variable d'environnement.
 */
export async function getGeminiApiKey(adminClient: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await adminClient
      .from("profiles")
      .select("gemini_api_key")
      .eq("role", "admin")
      .not("gemini_api_key", "is", null)
      .limit(1)
      .maybeSingle();

    if (data?.gemini_api_key) return data.gemini_api_key as string;
  } catch {
    // La colonne n'existe peut-être pas encore — fallback silencieux
  }

  return process.env.GEMINI_API_KEY ?? null;
}
