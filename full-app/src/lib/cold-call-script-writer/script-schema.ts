/**
 * Schema Zod du Cold Call Script Writer.
 * Source de vérité unique — utilisé pour valider la sortie LLM et typer l'UI.
 *
 * Le script produit suit la structure consensus issue de la recherche
 * (Farrokh/Cegelski "Cold Calling Sucks", Josh Braun, 30MPC, Voss, Sandler,
 * Sales Odyssey FR, Modjo FR) : Opener context-first → Problem proposition
 * → Mr. Miyagi objection handling → Test-drive close.
 */

import { z } from "zod";

// ─── INPUT : brief d'offre saisi par l'utilisateur ──────────────────────────

export const toneEnum = z.enum([
  "direct_sec",         // direct, no-bullshit, expert
  "consultatif_pro",    // pro, calme, autoritaire, B2B service
  "curiosite_doux",     // curiosity gap, soft start, permission-based
  "referral_chaleureux",// chaleureux, mention référent
]);

export const callGoalEnum = z.enum([
  "book_discovery",     // booker un discovery
  "qualify_then_book",  // qualifier en 90 sec puis booker
  "qualify_only",       // juste qualifier (callback ensuite)
]);

export const offerBriefSchema = z.object({
  /** Nom donné au script par l'utilisateur (pour la library) */
  title: z.string().min(2).max(120),

  /** Description de l'offre vendue (transformation, livrables, durée) */
  offer: z.string().min(20).max(2000),

  /** ICP cible (rôle, secteur, taille boîte, géo) */
  icp: z.string().min(10).max(1000),

  /** Pricing (montant, format : one-shot / récurrent / retainer / % perf) */
  pricing: z.string().min(2).max(400),

  /** Top 3 pains que l'offre résout (texte libre, idéalement 3 bullets) */
  pains: z.string().min(10).max(1500),

  /** Preuves / résultats client à mentionner (case studies, métriques) */
  proof: z.string().max(1500).optional().default(""),

  /** Différenciateurs vs concurrents */
  differentiation: z.string().max(1000).optional().default(""),

  /** Ton souhaité du script */
  tone: toneEnum,

  /** Objectif du call */
  goal: callGoalEnum,

  /** Langue de sortie */
  language: z.enum(["fr", "en"]).default("fr"),

  /** Contexte additionnel libre (extras à injecter dans le prompt) */
  extras: z.string().max(2000).optional().default(""),
});

export type OfferBrief = z.infer<typeof offerBriefSchema>;

// ─── OUTPUT : script structuré généré par le LLM ────────────────────────────

const variantSchema = z.object({
  label: z.string().min(2).max(60),     // "Permission-based" / "Trigger" / "Referral"
  text: z.string().min(20),             // verbatim du commercial
  delivery_notes: z.string().max(500),  // tonalité, pacing, pauses
});

const objectionHandlerSchema = z.object({
  /** Objection telle qu'elle est formulée par le prospect (verbatim type) */
  objection: z.string().min(5).max(300),

  /** Ce que ça veut vraiment dire (lecture sous-jacente) */
  reading: z.string().min(5).max(400),

  /** Erreur naturelle à NE PAS commettre */
  avoid: z.string().min(5).max(400),

  /** Réponse experte (verbatim, court) */
  response: z.string().min(10).max(800),

  /** Framework / source qui inspire la réponse (Voss / Braun / Sandler / 30MPC...) */
  framework: z.string().max(120),
});

const discoveryQuestionSchema = z.object({
  question: z.string().min(8).max(400),
  why: z.string().min(8).max(400),
  ideal_answer_signal: z.string().min(5).max(400),
});

const voicemailSchema = z.object({
  duration_seconds: z.number().int().min(5).max(60),
  text: z.string().min(20).max(1000),
  notes: z.string().max(400),
});

const closeVariantSchema = z.object({
  label: z.string().min(2).max(60),
  text: z.string().min(20).max(800),
  delivery_notes: z.string().max(400),
});

export const coldCallScriptSchema = z.object({
  /** Méta du script généré */
  meta: z.object({
    headline: z.string().max(200),             // 1-liner du positionnement choisi
    framework_used: z.string().max(200),       // ex: "PVC + Mr. Miyagi (30MPC)"
    target_call_duration_seconds: z.number().int().min(60).max(600),
    language: z.enum(["fr", "en"]),
  }),

  /** Openers : 3 variantes pour A/B testing */
  openers: z.array(variantSchema).min(2).max(4),

  /** Pitch : 3 longueurs */
  pitch: z.object({
    seven_seconds: z.string().min(10).max(400),
    fifteen_seconds: z.string().min(20).max(600),
    thirty_seconds: z.string().min(40).max(1200),
  }),

  /** Discovery questions adaptées cold call mode (90 sec) */
  discovery_questions: z.array(discoveryQuestionSchema).min(2).max(5),

  /** Matrice d'objections (8-12 objections couvertes) */
  objection_matrix: z.array(objectionHandlerSchema).min(6).max(15),

  /** Closes — 2 variantes pour booker le discovery */
  closes: z.array(closeVariantSchema).min(2).max(4),

  /** Voicemails — 3 longueurs */
  voicemails: z.array(voicemailSchema).min(2).max(4),

  /** Gatekeeper bypass (1-3 phrases) */
  gatekeeper_bypass: z.array(z.string().min(10).max(500)).min(1).max(5),

  /** Tonalité & posture vocale */
  tonality: z.object({
    pace: z.string().max(300),
    energy: z.string().max(300),
    pause_points: z.array(z.string().max(200)).max(8),
    posture: z.string().max(400),
  }),

  /** Top 3 erreurs à ne pas commettre sur CE script précisément */
  pitfalls: z.array(z.string().min(8).max(400)).min(2).max(6),

  /** Coaching pré-session : ce que le sales doit se dire avant de dialer */
  pre_call_mindset: z.string().min(20).max(800),
});

export type ColdCallScript = z.infer<typeof coldCallScriptSchema>;

// ─── Labels UI ──────────────────────────────────────────────────────────────

export const TONE_LABELS: Record<z.infer<typeof toneEnum>, string> = {
  direct_sec: "Direct & sec",
  consultatif_pro: "Consultatif pro",
  curiosite_doux: "Curiosité douce (permission-based)",
  referral_chaleureux: "Référent chaleureux",
};

export const TONE_DESCRIPTIONS: Record<z.infer<typeof toneEnum>, string> = {
  direct_sec: "Pas de chichi, droit au but. Marche bien avec founders pressés.",
  consultatif_pro: "Posé, expert, calme. Idéal pour vendre du conseil high-ticket.",
  curiosite_doux: "Ouverture désarmante type Josh Braun. Réduit la réactance.",
  referral_chaleureux: "Mention d'un nom commun / d'un peer. Crée du warm immédiat.",
};

export const GOAL_LABELS: Record<z.infer<typeof callGoalEnum>, string> = {
  book_discovery: "Booker un discovery (30-45 min)",
  qualify_then_book: "Qualifier en 90 sec puis booker",
  qualify_only: "Qualifier seulement (rappel ensuite)",
};
