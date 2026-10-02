/**
 * Schema Zod de la sortie LLM pour le Sales Call Analyzer.
 * Source de vérité unique — utilisé pour valider la réponse OpenRouter
 * et typer le rendu UI.
 */

import { z } from "zod";

export const phaseEnum = z.enum([
  "rapport_opening",
  "discovery",
  "qualification",
  "pitch_offer",
  "objections",
  "closing_next_steps",
]);

export const objectionTypeEnum = z.enum([
  "prix_trop_cher",
  "associe_conjoint",
  "je_vais_reflechir",
  "agence_ratee",
  "trop_petit_mauvais_moment",
  "concurrent_X",
  "envoyez_email",
  "fait_en_interne",
  "autre",
]);

export const dealTemperatureEnum = z.enum(["hot", "warm", "cold", "dead"]);

export const verbatimQuoteSchema = z.object({
  speaker: z.enum(["commercial", "prospect"]),
  quote: z.string().min(3),
  timestamp: z.string().optional().nullable(),
  context: z.string(),
});

export const phaseAnalysisSchema = z.object({
  phase: phaseEnum,
  score: z.number().min(0).max(10),
  what_worked: z.array(z.string()).max(5),
  what_to_improve: z.array(z.string()).max(5),
  framework_violated: z.string().nullable(),
  verbatim_quotes: z.array(verbatimQuoteSchema).max(5),
});

export const detectedObjectionSchema = z.object({
  type: objectionTypeEnum,
  raised_verbatim: z.string(),
  was_isolated: z.boolean(),
  was_treated: z.boolean(),
  was_validated: z.boolean(),
  reco: z.string(),
});

export const recommendationSchema = z.object({
  priority: z.number().min(1).max(3),
  title: z.string().max(120),
  why: z.string(),
  how_next_call: z.string(),
  framework_source: z.string(),
});

// ─── Pain points ────────────────────────────────────────────────────
// Optionnel (rétro-compat avec les analyses passées qui n'ont pas ce champ).

export const painCategoryEnum = z.enum([
  "acquisition_leads",      // pas assez de leads, pipeline vide
  "qualite_leads",          // leads pas qualifiés, perte de temps
  "conversion_closing",     // taux de close bas
  "scaling_delivery",       // bloqué pour grossir, ops surchargées
  "temps_focus",            // founder fait tout, pas le temps
  "marge_pricing",          // marges trop basses, sous-vente
  "differentiation",        // se confond avec les concurrents
  "process_outils",         // CRM bordélique, suivi manuel
  "equipe_recrutement",     // pas de bons commerciaux, turnover
  "tresorerie_cashflow",    // cash tendu, paiements en retard
  "autre",
]);

export const painPointSchema = z.object({
  category: painCategoryEnum,
  raised_verbatim: z.string().describe("Citation exacte du prospect qui exprime le pain"),
  current_state: z.string().describe("Situation actuelle décrite par le prospect"),
  desired_state: z.string().nullable().describe("Ce que le prospect voudrait à la place"),
  cost_of_inaction: z.string().nullable().describe("Coût/conséquence si rien ne change (chiffré si possible)"),
  intensity: z.number().min(1).max(5).describe("Intensité 1-5 : 1 = mention passagère, 5 = pain critique brûlant"),
});

export const salesCallAnalysisSchema = z.object({
  overall_score: z.number().min(0).max(10),
  call_summary_one_liner: z.string().max(280),
  prospect_company: z.string().nullable(),
  prospect_industry: z.string().nullable(),

  talk_ratio_commercial_pct: z.number().min(0).max(100).nullable(),
  talk_ratio_verdict: z
    .enum(["good_under_40", "acceptable_40_55", "too_high_over_55"])
    .nullable(),

  leadfactory_alignment: z.object({
    speed_to_lead_respected: z.boolean().nullable(),
    bnt_qualif_done: z.boolean(),
    next_step_dated: z.boolean(),
    score_aligned_quotes: z.array(z.string()).max(5),
    score_deviant_quotes: z.array(z.string()).max(5),
  }),

  phases: z.array(phaseAnalysisSchema),
  objections: z.array(detectedObjectionSchema),

  top_3_recommendations: z.array(recommendationSchema).min(1).max(3),

  critical_red_flags: z.array(z.string()).max(8),

  next_call_likely: z.boolean(),
  deal_temperature: dealTemperatureEnum,

  // Optionnel — ajouté après le MVP initial. Les analyses passées ne l'ont pas.
  pains: z.array(painPointSchema).max(10).optional().default([]),
});

export type SalesCallAnalysis = z.infer<typeof salesCallAnalysisSchema>;
export type PhaseAnalysis = z.infer<typeof phaseAnalysisSchema>;
export type DetectedObjection = z.infer<typeof detectedObjectionSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type VerbatimQuote = z.infer<typeof verbatimQuoteSchema>;
export type PainPoint = z.infer<typeof painPointSchema>;
export type PainCategory = z.infer<typeof painCategoryEnum>;

export const PHASE_LABELS: Record<z.infer<typeof phaseEnum>, string> = {
  rapport_opening: "Rapport & Ouverture",
  discovery: "Discovery",
  qualification: "Qualification (BNT)",
  pitch_offer: "Pitch & Offre",
  objections: "Objections",
  closing_next_steps: "Closing & Next Steps",
};

export const OBJECTION_LABELS: Record<z.infer<typeof objectionTypeEnum>, string> = {
  prix_trop_cher: "C'est trop cher",
  associe_conjoint: "Je dois en parler à mon associé/conjoint",
  je_vais_reflechir: "Je vais réfléchir",
  agence_ratee: "On a déjà essayé une agence, ça n'a pas marché",
  trop_petit_mauvais_moment: "On est trop petit / pas le bon moment",
  concurrent_X: "Pourquoi vous et pas {concurrent} ?",
  envoyez_email: "Envoyez-moi un email",
  fait_en_interne: "On va faire en interne",
  autre: "Autre",
};

export const TEMP_LABELS: Record<z.infer<typeof dealTemperatureEnum>, string> = {
  hot: "🔥 Chaud",
  warm: "🌤 Tiède",
  cold: "❄️ Froid",
  dead: "⚰️ Mort",
};

export const PAIN_CATEGORY_LABELS: Record<PainCategory, string> = {
  acquisition_leads: "Acquisition de leads",
  qualite_leads: "Qualité des leads",
  conversion_closing: "Conversion / Closing",
  scaling_delivery: "Scaling delivery",
  temps_focus: "Temps & focus founder",
  marge_pricing: "Marges & pricing",
  differentiation: "Différenciation",
  process_outils: "Process & outils",
  equipe_recrutement: "Équipe & recrutement",
  tresorerie_cashflow: "Trésorerie & cashflow",
  autre: "Autre",
};
