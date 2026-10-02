export type UserRole = "admin" | "client";
export type TeamRole = "super_admin" | "admin" | "designer" | "media_buyer";
export type TeamStatus = "active" | "invited" | "disabled";

export type CanonicalCampaignStatus =
  | "brief_received"
  | "campaign_proposal"
  | "ad_creative"
  | "meta_account_setup"
  | "live_optimizing"
  | "reworks"
  | "paused"
  | "completed_project";

export type LegacyCampaignStatus =
  | "onboarding"
  | "setup"
  | "creative_review"
  | "live"
  | "optimizing"
  | "completed";

export type CampaignStatus = CanonicalCampaignStatus | LegacyCampaignStatus;

type CampaignStatusContext = {
  status: CampaignStatus | string;
  ad_account_id?: string | null;
  ai_creative_prompt?: string | null;
};

export const CANONICAL_CAMPAIGN_STATUSES: CanonicalCampaignStatus[] = [
  "brief_received",
  "campaign_proposal",
  "ad_creative",
  "meta_account_setup",
  "live_optimizing",
  "reworks",
  "paused",
  "completed_project",
];

export const LIVE_CAMPAIGN_STATUSES: CanonicalCampaignStatus[] = [
  "live_optimizing",
];

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  company: string | null;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  team_role?: TeamRole | null;
  team_status?: TeamStatus | null;
  is_super_admin?: boolean;
  results_rating?: ClientResultsRating | null;
  results_rating_note?: string | null;
  results_rating_updated_at?: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  client_id: string;
  onboarding_response_id: string | null;
  name: string;
  status: CampaignStatus;
  budget_monthly: number | null;
  platform: string;
  ad_account_id: string | null;
  pixel_id: string | null;
  business_manager_id: string | null;
  objective: string | null;
  ai_creative_prompt: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // AI assets
  ai_ad_copy_prompt?: string | null;
  ai_video_ad_prompt?: string | null;
  ai_vsl_prompt?: string | null;
  ai_static_prompt?: string | null;
  ai_generated_at?: string | null;
  // Meta attribution
  facebook_page_id?: string | null;
  facebook_page_name?: string | null;
  instagram_account_id?: string | null;
  instagram_account_name?: string | null;
  // joined
  profiles?: Profile;
}

export interface OnboardingResponse {
  id: string;
  campaign_id: string | null;
  client_id: string | null;
  questionnaire_type: string;
  responses: Record<string, unknown>;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
  // joined
  profiles?: Profile;
  campaigns?: Campaign;
}

export function getCanonicalCampaignStatus(
  input: CampaignStatusContext | CampaignStatus | string | null | undefined
): CanonicalCampaignStatus {
  const rawStatus = typeof input === "string" ? input : input?.status;
  if (!rawStatus) return "brief_received";

  switch (rawStatus) {
    case "brief_received":
    case "campaign_proposal":
    case "ad_creative":
    case "meta_account_setup":
    case "live_optimizing":
    case "reworks":
    case "paused":
    case "completed_project":
      return rawStatus;
    case "onboarding":
      return "brief_received";
    case "creative_review":
      return "ad_creative";
    case "live":
    case "optimizing":
      return "live_optimizing";
    case "completed":
      return "completed_project";
    case "setup":
      if (typeof input === "object" && input) {
        if (input.ai_creative_prompt) return "ad_creative";
        if (input.ad_account_id) return "meta_account_setup";
      }
      return "campaign_proposal";
    default:
      return "brief_received";
  }
}

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  brief_received: "Brief reçu",
  campaign_proposal: "Propositions de campagne",
  ad_creative: "Créative publicitaire",
  meta_account_setup: "Mise en place du compte Meta",
  live_optimizing: "En ligne et optimisation",
  reworks: "Reworks",
  paused: "En pause",
  completed_project: "Terminée",
  onboarding: "Brief reçu",
  setup: "Propositions de campagne",
  creative_review: "Créative publicitaire",
  live: "En ligne et optimisation",
  optimizing: "En ligne et optimisation",
  completed: "Terminée",
};

export const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, string> = {
  brief_received: "bg-lf-yellow text-black",
  campaign_proposal: "bg-lf-blue text-white",
  ad_creative: "bg-lf-pink text-black",
  meta_account_setup: "bg-orange-200 text-black",
  live_optimizing: "bg-lf-green text-white",
  reworks: "bg-orange-500 text-white",
  paused: "bg-gray-300 text-black",
  completed_project: "bg-emerald-700 text-white",
  onboarding: "bg-lf-yellow text-black",
  setup: "bg-lf-blue text-white",
  creative_review: "bg-lf-pink text-black",
  live: "bg-lf-green text-white",
  optimizing: "bg-lf-green text-white",
  completed: "bg-emerald-700 text-white",
};

export function getCampaignStatusLabel(
  input: CampaignStatusContext | CampaignStatus | string | null | undefined
): string {
  return CAMPAIGN_STATUS_LABELS[getCanonicalCampaignStatus(input)];
}

export function getCampaignStatusColor(
  input: CampaignStatusContext | CampaignStatus | string | null | undefined
): string {
  return CAMPAIGN_STATUS_COLORS[getCanonicalCampaignStatus(input)];
}

// ─── Notation client par niveau d'urgence de résultats ───────────────
// Permet de prioriser la delivery sur les comptes "qui brûlent" en premier.
// Le débrief delivery se fait du pire au meilleur niveau (very_bad → amazing),
// stopped / payment_terror étant des cas particuliers à traiter à part.

export type ClientResultsRating =
  | "very_bad"
  | "bad"
  | "ok"
  | "good"
  | "amazing"
  | "stopped"
  | "payment_terror";

export const CLIENT_RESULTS_RATINGS: ClientResultsRating[] = [
  "very_bad",
  "bad",
  "ok",
  "good",
  "amazing",
  "stopped",
  "payment_terror",
];

/**
 * Ordre de priorité de delivery : plus la valeur est BASSE, plus le compte
 * "brûle" et doit être traité en premier. Les clients non notés (null) sont
 * placés juste après les comptes en difficulté pour ne pas les oublier.
 */
export const CLIENT_RESULTS_RATING_PRIORITY: Record<ClientResultsRating, number> = {
  payment_terror: 0,
  very_bad: 1,
  bad: 2,
  stopped: 3,
  ok: 4,
  good: 5,
  amazing: 6,
};

export const CLIENT_RESULTS_RATING_LABELS: Record<ClientResultsRating, string> = {
  very_bad: "Très mauvais",
  bad: "Mauvais",
  ok: "Correct",
  good: "Bon",
  amazing: "Excellent",
  stopped: "Stoppée",
  payment_terror: "Problème paiement",
};

export const CLIENT_RESULTS_RATING_COLORS: Record<ClientResultsRating, string> = {
  very_bad: "bg-red-600 text-white",
  bad: "bg-orange-500 text-white",
  ok: "bg-gray-300 text-black",
  good: "bg-lf-yellow text-black",
  amazing: "bg-lf-green text-white",
  stopped: "bg-gray-600 text-white",
  payment_terror: "bg-red-900 text-white",
};

export function getClientResultsRatingLabel(
  rating: ClientResultsRating | string | null | undefined
): string {
  if (rating && rating in CLIENT_RESULTS_RATING_LABELS) {
    return CLIENT_RESULTS_RATING_LABELS[rating as ClientResultsRating];
  }
  return "Non noté";
}

export function getClientResultsRatingColor(
  rating: ClientResultsRating | string | null | undefined
): string {
  if (rating && rating in CLIENT_RESULTS_RATING_COLORS) {
    return CLIENT_RESULTS_RATING_COLORS[rating as ClientResultsRating];
  }
  return "bg-white text-black";
}

/** Clé de tri pour ranger les clients du plus urgent au moins urgent. */
export function getClientResultsRatingPriority(
  rating: ClientResultsRating | string | null | undefined
): number {
  if (rating && rating in CLIENT_RESULTS_RATING_PRIORITY) {
    return CLIENT_RESULTS_RATING_PRIORITY[rating as ClientResultsRating];
  }
  // Non noté : juste après les comptes en difficulté, avant "ok".
  return 3.5;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export type LeadSource = 'meta_ads' | 'google_ads' | 'manual' | 'website' | 'referral' | 'phone' | 'email' | 'linkedin' | 'salon' | 'other';

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  manual: 'Manuel',
  website: 'Site web',
  referral: 'Recommandation',
  phone: 'Téléphone',
  email: 'Email',
  linkedin: 'LinkedIn',
  salon: 'Salon/Événement',
  other: 'Autre',
};

export const LEAD_SOURCE_COLORS: Record<LeadSource, string> = {
  meta_ads: 'bg-blue-100 text-blue-700',
  google_ads: 'bg-red-100 text-red-700',
  manual: 'bg-gray-100 text-gray-700',
  website: 'bg-purple-100 text-purple-700',
  referral: 'bg-green-100 text-green-700',
  phone: 'bg-yellow-100 text-yellow-700',
  email: 'bg-pink-100 text-pink-700',
  linkedin: 'bg-sky-100 text-sky-700',
  salon: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-500',
};

export interface Lead {
  id: string;
  campaign_id: string | null;
  client_id: string | null;
  meta_lead_id: string | null;
  meta_form_id: string | null;
  meta_form_name: string | null;
  meta_ad_id: string | null;
  meta_campaign_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  field_data: Record<string, unknown> | null;
  status: LeadStatus;
  quality_score: number | null;
  notes: string | null;
  revenue: number | null;
  cash_collected: number | null;
  meta_created_at: string | null;
  created_at: string;
  updated_at: string;
  // CRM enrichment
  source: LeadSource | null;
  pipeline_stage_id: string | null;
  assigned_to: string | null;
  last_contacted_at: string | null;
  next_follow_up: string | null;
  tags: string[];
  preferred_contact: string | null;
  city: string | null;
  // Joins
  campaigns?: { name: string; ad_account_id: string | null } | null;
  profiles?: { full_name: string; company: string | null } | null;
}

export interface PipelineStage {
  id: string;
  client_id: string;
  name: string;
  color: string;
  display_order: number;
  is_default: boolean;
  is_won: boolean;
  is_lost: boolean;
  created_at: string;
  updated_at: string;
}

export type LeadActivityType = 'note' | 'call' | 'email' | 'meeting' | 'stage_change' | 'status_change' | 'task' | 'whatsapp' | 'sms' | 'other';

export interface LeadActivity {
  id: string;
  lead_id: string;
  client_id: string;
  activity_type: LeadActivityType;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface LeadAggregate {
  count: number;
  avg_quality: number | null;
  total_revenue: number;
  total_cash: number;
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New Lead',
  contacted: 'Contacté',
  qualified: 'Qualifié',
  converted: 'Converti',
  lost: 'Perdu',
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-lf-blue text-white',
  contacted: 'bg-lf-yellow text-black',
  qualified: 'bg-purple-500 text-white',
  converted: 'bg-lf-green text-white',
  lost: 'bg-gray-400 text-white',
};

export type FinancePhase = "trial" | "mrr";
export type FinanceEntryType = "revenue" | "expense";

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  is_active?: boolean;
  is_super_admin?: boolean;
  team_role?: TeamRole | null;
  team_status?: TeamStatus | null;
  created_at?: string;
}

export interface TeamClient {
  id: string;
  full_name: string;
  company: string | null;
}

export interface TeamCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  client_id: string;
  created_at: string;
  client_name: string;
  client_company: string | null;
}

export interface TeamCampaignAssignment {
  campaign_id: string;
  team_member_id: string;
  created_at: string;
}

export interface TeamMemberClientRate {
  id: string;
  team_member_id: string;
  client_id: string;
  monthly_rate: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client_name: string;
  client_company: string | null;
}

export interface TeamDashboardMember extends TeamMember {
  assigned_campaigns: TeamCampaign[];
  client_rates: TeamMemberClientRate[];
  active_projects_count: number;
  active_clients_count: number;
  pay_due_total: number;
  initial_password?: string | null;
}

export interface TeamDashboardSummary {
  active_members_count: number;
  active_projects_count: number;
  active_clients_count: number;
  pay_due_total: number;
}

export interface ClientFinanceProfile {
  id: string;
  client_id: string;
  phase: FinancePhase;
  trial_amount: number | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  mrr_amount: number | null;
  next_payment_date: string | null;
  last_payment_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceEntry {
  id: string;
  client_id: string | null;
  team_member_id?: string | null;
  entry_type: FinanceEntryType;
  category: string;
  label: string;
  amount: number;
  entry_date: string;
  received_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { full_name: string; company: string | null } | null;
  client?: { full_name: string; company: string | null } | null;
  team_member?: TeamMember | null;
}

export interface FinanceDashboardRow {
  client_id: string;
  client_name: string;
  company: string | null;
  contact_name: string;
  email: string;
  is_active: boolean;
  campaigns: Array<Pick<Campaign, "id" | "name" | "status" | "ad_account_id">>;
  finance_profile: ClientFinanceProfile;
  next_payment_date: string | null;
  payment_entry_id: string | null;
  payment_amount: number | null;
  payment_date: string | null;
  expected_revenue: number;
  recurring_revenue: number;
  manual_revenue: number;
  crm_revenue: number;
  crm_cash: number;
  manual_expenses: number;
  ad_spend: number;
  total_expenses: number;
  margin: number;
  net_profit: number;
  roas: number | null;
  roi: number | null;
}

// ─── Formations ───────────────────────────────────────
export interface Formation {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  cover_image_url: string | null;
  is_published: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface FormationResource {
  label: string;
  url: string;
  type?: string;
}

export interface FormationModule {
  id: string;
  formation_id: string;
  title: string;
  description: string | null;
  module_number: number;
  video_url: string | null;
  presentation_url: string | null;
  resources: FormationResource[];
  notes: string | null;
  is_published: boolean;
  display_order: number;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface ClientFormationAccess {
  id: string;
  client_id: string;
  formation_id: string;
  granted_by: string | null;
  created_at: string;
}

export interface ClientFormationProgress {
  id: string;
  client_id: string;
  module_id: string;
  is_completed: boolean;
  completed_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
}

export interface FormationWithProgress extends Formation {
  modules_count: number;
  completed_count: number;
}

export interface FormationModuleWithProgress extends FormationModule {
  is_completed: boolean;
  completed_at: string | null;
}

export interface FinanceDashboardSummary {
  month: string;
  from: string;
  to: string;
  label: string;
  new_clients_count: number;
  expected_revenue: number;
  recurring_revenue: number;
  manual_revenue: number;
  crm_revenue: number;
  total_expenses: number;
  ad_spend: number;
  manual_expenses: number;
  margin: number;
  net_profit: number;
  roas: number | null;
  roi: number | null;
  unassigned_expenses: number;
}

/* -------------------------------------------------------------------------- */
/*  Team Resources & SOP                                                       */
/* -------------------------------------------------------------------------- */

export type TeamResourceKind = "sop" | "resource";

export interface TeamResource {
  id: string;
  created_by: string | null;
  kind: TeamResourceKind;
  title: string;
  loom_url: string | null;
  document_url: string | null;
  body_html: string | null;
  body_text: string | null;
  is_published: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Ressource enrichie de la liste des membres à qui elle est attribuée (vue admin). */
export interface TeamResourceWithAssignees extends TeamResource {
  assignee_ids: string[];
}

export interface TeamResourceAssignment {
  id: string;
  resource_id: string;
  team_member_id: string;
  assigned_by: string | null;
  assigned_at: string;
}
