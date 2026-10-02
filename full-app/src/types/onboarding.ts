export interface OnboardingData {
  // ─── A : INFOS DE BASE ───
  a_entreprise: string;
  a_pays_langues: string;
  a_reseaux: string[];          // ['facebook', 'instagram', 'threads']
  a_type: string;               // 'service'|'saas'|'ecommerce'|'app'|'local'|'autre'
  a_type_autre: string;
  a_prix: string;
  a_cycle_decision: string;
  a_resume_offre: string;
  a_cab: string;                // Caractéristique - Avantage - Bénéfice
  a_problemes: string;
  a_differenciants: string;
  a_benefices: string;
  a_concurrents: string;
  a_differenciation: string;
  a_pitch: string;

  // ─── B : OBJECTIF + CONVERSION ───
  b_objectif: string[];         // ['leads','rdv','ventes','trafic','telechargements','autre']
  b_objectif_autre: string;
  b_conversion: string[];       // ['lead','rdv','purchase','cart','contact','autre']
  b_conversion_autre: string;
  b_event_name: string;
  b_qualite_critere1: string;
  b_qualite_critere2: string;
  b_kpi: string[];              // ['cpl','cout_rdv','cpa','roas','cout_essai','autre']
  b_kpi_autre: string;
  b_objectif_chiffre: string;

  // ─── C : OFFRE + MESSAGE ───
  c_cta_type: string[];         // ['audit','demo','essai','devis','achat','promo','ressource','autre']
  c_cta_autre: string;
  c_promesse: string;
  c_benefice1: string;
  c_benefice2: string;
  c_benefice3: string;
  c_preuve_type: string;        // 'chiffre'|'cas'|'avis'|'logos'|'etude'|'avant_apres'|'autre'
  c_preuve_detail: string;
  c_nogo: string;

  // ─── D : CIBLAGE ───
  d_cible1_description: string;
  d_cible1_secteur: string;
  d_cible1_fonctions: string;
  d_cible1_problemes: string;
  d_cible1_valeur: string;
  d_cible1_freins: string;
  d_cible1_motivations: string;
  d_cible2_description: string;
  d_cible2_secteur: string;
  d_cible2_fonctions: string;
  d_cible2_problemes: string;
  d_cible2_valeur: string;
  d_cible2_freins: string;
  d_cible2_motivations: string;
  d_exclusions: string;

  // ─── E : PARCOURS POST-CLIC ───
  e_destination_principale: string;
  e_destination_principale_autre: string;
  e_destination_testable: string;
  e_destination_testable_autre: string;
  e_url: string;
  e_cta_exact: string;
  e_post_clic_phrase1: string;
  e_post_clic_phrase2: string;
  e_delai_reponse: string;
  e_qui_repond: string;
  e_capacite_rdv: string;

  // ─── F : TRACKING ───
  f_pixel: string;              // 'oui'|'non'|'sais_pas'
  f_capi: string;
  f_ga4: string;
  f_crm: string[];              // ['hubspot','pipedrive','salesforce','shopify','autre','aucun']
  f_crm_autre: string;
  f_source_fiable: string;
  f_validation_lead: string;

  // ─── G : BUDGET + TIMING ───
  g_budget: string;
  g_timing: string;

  // ─── H : ASSETS + VALIDATION + ACCÈS ───
  h_logo: string;
  h_visuels: string;
  h_preuves: string;
  h_pages: string;
  h_drive_creatifs: string;     // lien Drive avec tous les visuels/ressources pour les créatifs (facultatif)
  h_police: string;             // police(s) de caractères utilisée(s) par la marque (facultatif)
  h_qui_valide: string;
  h_delai_validation: string;
  h_bm: string;                 // 'a_donner'|'ok'
  h_compte_pub: string;
  h_pixel_capi: string;         // 'a_donner'|'a_verifier'|'ok'
  h_page_fb_ig: string;
  h_domaine: string;
  h_outil: string;              // 'acces'|'exports'

  // ─── I : ACCÈS ESPACE CLIENT ───
  i_email: string;
  i_password: string;
  i_password_confirm: string;
}

export const defaultOnboardingData: OnboardingData = {
  a_entreprise: "", a_pays_langues: "France / Français", a_reseaux: [],
  a_type: "", a_type_autre: "", a_prix: "", a_cycle_decision: "",
  a_resume_offre: "", a_cab: "", a_problemes: "", a_differenciants: "",
  a_benefices: "", a_concurrents: "", a_differenciation: "", a_pitch: "",

  b_objectif: [], b_objectif_autre: "", b_conversion: [], b_conversion_autre: "",
  b_event_name: "", b_qualite_critere1: "", b_qualite_critere2: "",
  b_kpi: [], b_kpi_autre: "", b_objectif_chiffre: "",

  c_cta_type: [], c_cta_autre: "", c_promesse: "", c_benefice1: "",
  c_benefice2: "", c_benefice3: "", c_preuve_type: "", c_preuve_detail: "",
  c_nogo: "",

  d_cible1_description: "", d_cible1_secteur: "", d_cible1_fonctions: "",
  d_cible1_problemes: "", d_cible1_valeur: "", d_cible1_freins: "",
  d_cible1_motivations: "", d_cible2_description: "", d_cible2_secteur: "",
  d_cible2_fonctions: "", d_cible2_problemes: "", d_cible2_valeur: "",
  d_cible2_freins: "", d_cible2_motivations: "", d_exclusions: "",

  e_destination_principale: "", e_destination_principale_autre: "",
  e_destination_testable: "", e_destination_testable_autre: "",
  e_url: "", e_cta_exact: "", e_post_clic_phrase1: "", e_post_clic_phrase2: "",
  e_delai_reponse: "", e_qui_repond: "", e_capacite_rdv: "",

  f_pixel: "", f_capi: "", f_ga4: "", f_crm: [], f_crm_autre: "",
  f_source_fiable: "", f_validation_lead: "",

  g_budget: "", g_timing: "",

  h_logo: "", h_visuels: "", h_preuves: "", h_pages: "",
  h_drive_creatifs: "", h_police: "",
  h_qui_valide: "", h_delai_validation: "",
  h_bm: "", h_compte_pub: "", h_pixel_capi: "",
  h_page_fb_ig: "", h_domaine: "", h_outil: "",

  i_email: "", i_password: "", i_password_confirm: "",
};
