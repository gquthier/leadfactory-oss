import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lit le token Meta depuis la DB (profil admin) et l'injecte dans process.env.
 * Appelé en début de chaque route/page qui utilise meta-api.
 * Permet de changer le token sans restart serveur via les Settings admin.
 */
export async function initMetaToken(adminClient: SupabaseClient): Promise<void> {
  try {
    const { data } = await adminClient
      .from("profiles")
      .select("meta_access_token")
      .eq("role", "admin")
      .not("meta_access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (data?.meta_access_token) {
      process.env.META_ACCESS_TOKEN = data.meta_access_token as string;
    }
  } catch {
    // Silently fail — fallback to env var
  }
}
