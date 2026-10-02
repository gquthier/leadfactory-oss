// Définition des sections éditables du brief client.
// Sert à la fois pour la vue résumé et pour le formulaire d'édition modale.

export type BriefFieldType =
  | "text"
  | "textarea"
  | "select"
  | "multi-csv" // liste séparée par virgules (rendu en input simple)
  | "number";

export interface BriefField {
  key: string;
  label: string;
  type: BriefFieldType;
  placeholder?: string;
  help?: string;
  options?: string[]; // pour type=select
}

export interface BriefSection {
  id: string;
  title: string;
  subtitle: string;
  fields: BriefField[];
}

export const BRIEF_SECTIONS: BriefSection[] = [
  {
    id: "a",
    title: "Infos de base",
    subtitle: "Entreprise, offre et pitch",
    fields: [
      { key: "a_entreprise", label: "Entreprise", type: "text" },
      { key: "a_pays_langues", label: "Pays / Langues", type: "text", placeholder: "France / Français" },
      { key: "a_reseaux", label: "Réseaux sociaux actifs", type: "multi-csv", help: "Séparés par virgule (facebook, instagram, threads, linkedin…)" },
      { key: "a_type", label: "Type d'offre", type: "select", options: ["service", "saas", "ecommerce", "app", "local", "autre"] },
      { key: "a_type_autre", label: "Type — précisez (si autre)", type: "text" },
      { key: "a_prix", label: "Fourchette de prix", type: "text" },
      { key: "a_cycle_decision", label: "Cycle de décision", type: "text" },
      { key: "a_resume_offre", label: "Résumé de l'offre", type: "textarea" },
      { key: "a_cab", label: "Caractéristique → Avantage → Bénéfice", type: "textarea" },
      { key: "a_problemes", label: "Problèmes résolus", type: "textarea" },
      { key: "a_differenciants", label: "Différenciants", type: "textarea" },
      { key: "a_benefices", label: "Bénéfices clés", type: "textarea" },
      { key: "a_concurrents", label: "Principaux concurrents", type: "textarea" },
      { key: "a_differenciation", label: "Différenciation vs concurrents", type: "textarea" },
      { key: "a_pitch", label: "Pitch one-liner", type: "textarea" },
    ],
  },
  {
    id: "b",
    title: "Objectifs & conversion",
    subtitle: "Ce que la campagne doit produire",
    fields: [
      { key: "b_objectif", label: "Objectifs", type: "multi-csv", help: "leads, rdv, ventes, trafic, telechargements, autre" },
      { key: "b_objectif_autre", label: "Objectif — précisez", type: "text" },
      { key: "b_conversion", label: "Évènements de conversion", type: "multi-csv", help: "lead, rdv, purchase, cart, contact, autre" },
      { key: "b_conversion_autre", label: "Conversion — précisez", type: "text" },
      { key: "b_event_name", label: "Nom de l'évènement (pixel)", type: "text" },
      { key: "b_qualite_critere1", label: "Critère de qualité #1", type: "text" },
      { key: "b_qualite_critere2", label: "Critère de qualité #2", type: "text" },
      { key: "b_kpi", label: "KPIs suivis", type: "multi-csv", help: "cpl, cout_rdv, cpa, roas, cout_essai, autre" },
      { key: "b_kpi_autre", label: "KPI — précisez", type: "text" },
      { key: "b_objectif_chiffre", label: "Objectif chiffré", type: "text" },
    ],
  },
  {
    id: "c",
    title: "Offre & message",
    subtitle: "Promesse, bénéfices, preuves",
    fields: [
      { key: "c_cta_type", label: "Types de CTA", type: "multi-csv", help: "audit, demo, essai, devis, achat, promo, ressource, autre" },
      { key: "c_cta_autre", label: "CTA — précisez", type: "text" },
      { key: "c_promesse", label: "Promesse principale", type: "textarea" },
      { key: "c_benefice1", label: "Bénéfice #1", type: "text" },
      { key: "c_benefice2", label: "Bénéfice #2", type: "text" },
      { key: "c_benefice3", label: "Bénéfice #3", type: "text" },
      { key: "c_preuve_type", label: "Type de preuve", type: "select", options: ["chiffre", "cas", "avis", "logos", "etude", "avant_apres", "autre"] },
      { key: "c_preuve_detail", label: "Détail des preuves", type: "textarea" },
      { key: "c_nogo", label: "Ce qu'on n'écrit JAMAIS", type: "textarea" },
    ],
  },
  {
    id: "d",
    title: "Ciblage",
    subtitle: "Personae prioritaires + exclusions",
    fields: [
      { key: "d_cible1_description", label: "Cible 1 — description", type: "textarea" },
      { key: "d_cible1_secteur", label: "Cible 1 — secteur", type: "text" },
      { key: "d_cible1_fonctions", label: "Cible 1 — fonctions / postes", type: "text" },
      { key: "d_cible1_problemes", label: "Cible 1 — problèmes", type: "textarea" },
      { key: "d_cible1_valeur", label: "Cible 1 — valeur perçue", type: "textarea" },
      { key: "d_cible1_freins", label: "Cible 1 — freins", type: "textarea" },
      { key: "d_cible1_motivations", label: "Cible 1 — motivations", type: "textarea" },
      { key: "d_cible2_description", label: "Cible 2 — description", type: "textarea" },
      { key: "d_cible2_secteur", label: "Cible 2 — secteur", type: "text" },
      { key: "d_cible2_fonctions", label: "Cible 2 — fonctions", type: "text" },
      { key: "d_cible2_problemes", label: "Cible 2 — problèmes", type: "textarea" },
      { key: "d_cible2_valeur", label: "Cible 2 — valeur perçue", type: "textarea" },
      { key: "d_cible2_freins", label: "Cible 2 — freins", type: "textarea" },
      { key: "d_cible2_motivations", label: "Cible 2 — motivations", type: "textarea" },
      { key: "d_exclusions", label: "Exclusions de ciblage", type: "textarea" },
    ],
  },
  {
    id: "e",
    title: "Parcours post-clic",
    subtitle: "Destination, CTA exact, réponse",
    fields: [
      { key: "e_destination_principale", label: "Destination principale", type: "text" },
      { key: "e_destination_principale_autre", label: "Destination — précisez", type: "text" },
      { key: "e_destination_testable", label: "Destination testable (A/B)", type: "text" },
      { key: "e_destination_testable_autre", label: "Destination testable — précisez", type: "text" },
      { key: "e_url", label: "URL de destination", type: "text" },
      { key: "e_cta_exact", label: "Texte exact du CTA", type: "text" },
      { key: "e_post_clic_phrase1", label: "Phrase post-clic #1", type: "textarea" },
      { key: "e_post_clic_phrase2", label: "Phrase post-clic #2", type: "textarea" },
      { key: "e_delai_reponse", label: "Délai de réponse promis", type: "text" },
      { key: "e_qui_repond", label: "Qui répond aux leads", type: "text" },
      { key: "e_capacite_rdv", label: "Capacité de RDV par semaine", type: "text" },
    ],
  },
  {
    id: "f",
    title: "Tracking & CRM",
    subtitle: "Pixel, CAPI, GA4, CRM",
    fields: [
      { key: "f_pixel", label: "Pixel installé", type: "select", options: ["oui", "non", "sais_pas"] },
      { key: "f_capi", label: "Conversions API (CAPI)", type: "select", options: ["oui", "non", "sais_pas"] },
      { key: "f_ga4", label: "Google Analytics 4", type: "select", options: ["oui", "non", "sais_pas"] },
      { key: "f_crm", label: "CRM utilisés", type: "multi-csv", help: "hubspot, pipedrive, salesforce, shopify, autre, aucun" },
      { key: "f_crm_autre", label: "CRM — précisez", type: "text" },
      { key: "f_source_fiable", label: "Source fiable pour le suivi", type: "text" },
      { key: "f_validation_lead", label: "Comment valider qu'un lead est qualifié", type: "textarea" },
    ],
  },
  {
    id: "g",
    title: "Budget & timing",
    subtitle: "Investissement et date de lancement",
    fields: [
      { key: "g_budget", label: "Budget mensuel (€)", type: "number" },
      { key: "g_timing", label: "Timing souhaité", type: "text" },
    ],
  },
  {
    id: "h",
    title: "Assets & accès",
    subtitle: "Visuels, validation, accès comptes pubs",
    fields: [
      { key: "h_logo", label: "Logo (lien / dispo)", type: "text" },
      { key: "h_visuels", label: "Visuels disponibles", type: "textarea" },
      { key: "h_preuves", label: "Preuves sociales / témoignages", type: "textarea" },
      { key: "h_pages", label: "Pages / landing prêtes", type: "textarea" },
      { key: "h_drive_creatifs", label: "Lien Drive créatifs", type: "text" },
      { key: "h_police", label: "Police(s) de la marque", type: "text" },
      { key: "h_qui_valide", label: "Qui valide les créas", type: "text" },
      { key: "h_delai_validation", label: "Délai de validation", type: "text" },
      { key: "h_bm", label: "Business Manager Meta", type: "select", options: ["a_donner", "ok"] },
      { key: "h_compte_pub", label: "Compte publicitaire", type: "text" },
      { key: "h_pixel_capi", label: "Pixel + CAPI", type: "select", options: ["a_donner", "a_verifier", "ok"] },
      { key: "h_page_fb_ig", label: "Page FB / IG", type: "text" },
      { key: "h_domaine", label: "Domaine vérifié", type: "text" },
      { key: "h_outil", label: "Accès outil", type: "select", options: ["acces", "exports"] },
    ],
  },
];

// Convertit une valeur de réponse en string pour affichage résumé
export function summarizeFieldValue(field: BriefField, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return (value as unknown[]).map(String).join(", ");
  return String(value);
}
