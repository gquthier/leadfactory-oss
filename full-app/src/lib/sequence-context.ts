/**
 * SequenceContext — agrégation du contexte client pour Chat Your Sequence.
 *
 * Source de vérité (dans l'ordre de priorité) :
 *   1. context_override (par-conversation, optionnel)
 *   2. onboarding_responses (table existante LeadFactory)
 *   3. profiles (fallback minimal)
 *
 * On ne demande JAMAIS au client de re-remplir un onboarding pour cette feature.
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface SequenceContext {
  // Identification
  entreprise: string;
  resumeOffre: string;
  typeOffre: string;
  prix: string;

  // Promesse & différenciation
  promesse: string;
  benefice1: string;
  benefice2: string;
  benefice3: string;
  differenciants: string;
  preuves: string;

  // Cible principale (cible1 dans onboarding)
  cibleDescription: string;
  cibleSecteur: string;
  cibleFonctions: string;
  cibleProblemes: string;
  cibleValeur: string;
  cibleFreins: string;
  cibleMotivations: string;

  // CTA + parcours
  ctaType: string;
  ctaExact: string;
  conversion: string;
  destination: string;

  // Méta
  langue: string;
  objectif: string;
}

function val(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (Array.isArray(v)) {
    const joined = (v as unknown[]).map(String).filter(Boolean).join(", ");
    return joined || fallback;
  }
  const s = String(v).trim();
  return s || fallback;
}

function detectLanguage(paysLangues: string): string {
  const s = paysLangues.toLowerCase();
  if (s.includes("english") || s.includes("anglais") || s.includes("us") || s.includes("uk")) return "en";
  return "fr";
}

/**
 * Charge le contexte le plus récent disponible pour un client.
 * Retourne null si aucune donnée d'onboarding n'est trouvée (la séquence pourra
 * quand même se générer avec un contexte minimal basé sur le profil).
 */
export async function loadClientSequenceContext(
  clientId: string,
  override?: Record<string, unknown> | null
): Promise<SequenceContext> {
  const adminSupabase = createAdminClient();

  // Profil (toujours présent — c'est le client connecté)
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("full_name, company")
    .eq("id", clientId)
    .single();

  // Onboarding response le plus récent du client
  const { data: onboardingRow } = await adminSupabase
    .from("onboarding_responses")
    .select("responses, submitted_at")
    .eq("client_id", clientId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const responses = (onboardingRow?.responses ?? {}) as Record<string, unknown>;

  // Override est mergé par-dessus
  const r = { ...responses, ...(override ?? {}) } as Record<string, unknown>;

  return {
    entreprise:
      val(r.a_entreprise) ||
      (profile?.company as string | undefined) ||
      (profile?.full_name as string | undefined) ||
      "Client",
    resumeOffre: val(r.a_resume_offre),
    typeOffre: val(r.a_type),
    prix: val(r.a_prix),

    promesse: val(r.c_promesse),
    benefice1: val(r.c_benefice1),
    benefice2: val(r.c_benefice2),
    benefice3: val(r.c_benefice3),
    differenciants: val(r.a_differenciants),
    preuves: val(r.c_preuve_detail),

    cibleDescription: val(r.d_cible1_description),
    cibleSecteur: val(r.d_cible1_secteur),
    cibleFonctions: val(r.d_cible1_fonctions),
    cibleProblemes: val(r.d_cible1_problemes),
    cibleValeur: val(r.d_cible1_valeur),
    cibleFreins: val(r.d_cible1_freins),
    cibleMotivations: val(r.d_cible1_motivations),

    ctaType: val(r.c_cta_type),
    ctaExact: val(r.e_cta_exact),
    conversion: val(r.b_conversion),
    destination: val(r.e_destination_principale),

    langue: detectLanguage(val(r.a_pays_langues, "France / Français")),
    objectif: val(r.b_objectif, "leads"),
  };
}

/**
 * Sérialise le contexte en bloc markdown injectable dans le system prompt.
 */
export function formatContextForPrompt(ctx: SequenceContext): string {
  const fmt = (label: string, value: string) =>
    value ? `**${label}** : ${value}` : null;

  const lines = [
    "## CONTEXTE CLIENT",
    "",
    fmt("Entreprise", ctx.entreprise),
    fmt("Résumé de l'offre", ctx.resumeOffre),
    fmt("Type d'offre", ctx.typeOffre),
    fmt("Prix / Panier moyen", ctx.prix),
    "",
    "### Promesse & différenciation",
    fmt("Promesse principale", ctx.promesse),
    fmt("Bénéfice n°1", ctx.benefice1),
    fmt("Bénéfice n°2", ctx.benefice2),
    fmt("Bénéfice n°3", ctx.benefice3),
    fmt("Éléments différenciants", ctx.differenciants),
    fmt("Preuves / résultats", ctx.preuves),
    "",
    "### Cible principale",
    fmt("Description", ctx.cibleDescription),
    fmt("Secteur", ctx.cibleSecteur),
    fmt("Fonctions / titres", ctx.cibleFonctions),
    fmt("Problèmes qu'ils rencontrent", ctx.cibleProblemes),
    fmt("Ce qu'ils valorisent", ctx.cibleValeur),
    fmt("Freins habituels", ctx.cibleFreins),
    fmt("Motivations profondes", ctx.cibleMotivations),
    "",
    "### Conversion visée",
    fmt("Type de CTA", ctx.ctaType),
    fmt("Wording exact du CTA", ctx.ctaExact),
    fmt("Destination", ctx.destination),
    fmt("Conversion clé", ctx.conversion),
    fmt("Objectif global", ctx.objectif),
    fmt("Langue de la séquence", ctx.langue === "en" ? "English" : "Français"),
  ].filter(Boolean);

  return lines.join("\n");
}

/**
 * Forme allégée du contexte pour exposer au client en UI (sans champs vides).
 */
export function summarizeContextForUI(ctx: SequenceContext): Array<{ label: string; value: string }> {
  const all = [
    { label: "Entreprise", value: ctx.entreprise },
    { label: "Offre", value: ctx.resumeOffre },
    { label: "Promesse", value: ctx.promesse },
    { label: "Cible", value: ctx.cibleDescription || ctx.cibleSecteur },
    { label: "Problèmes cible", value: ctx.cibleProblemes },
    { label: "Motivations cible", value: ctx.cibleMotivations },
    { label: "Différenciants", value: ctx.differenciants },
    { label: "Preuves", value: ctx.preuves },
    { label: "CTA", value: ctx.ctaExact || ctx.ctaType },
    { label: "Langue", value: ctx.langue === "en" ? "English" : "Français" },
  ];
  return all.filter((x) => x.value && x.value.trim().length > 0);
}
