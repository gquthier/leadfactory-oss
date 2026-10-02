-- LeadFactory / empty bootstrap, reviewed 2026-10-01.
-- Requires a NEW Supabase project (auth.users/auth.uid and service_role exist).
-- No business rows, user identities, credentials or historical backfills.
-- NOT an upgrade migration. Apply 001, 002, 003 in order before exposing the app.
BEGIN;
SET LOCAL search_path = public;
-- Source structure: 001_initial_schema.sql

CREATE TYPE user_role AS ENUM ('admin', 'client');

CREATE TYPE campaign_status AS ENUM ('brief_received','campaign_proposal','ad_creative','meta_account_setup','live_optimizing','reworks','paused','completed_project','onboarding','setup','creative_review','live','optimizing','completed');

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  company       TEXT,
  phone         TEXT,
  role          user_role NOT NULL DEFAULT 'client',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE TABLE onboarding_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID,
  client_id           UUID REFERENCES profiles(id),
  questionnaire_type  TEXT NOT NULL DEFAULT 'leadfactory',
  responses           JSONB NOT NULL,
  submitted_at        TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by         UUID REFERENCES profiles(id),
  reviewed_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE campaigns (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES profiles(id),
  onboarding_response_id  UUID REFERENCES onboarding_responses(id),
  name                    TEXT NOT NULL,
  status                  campaign_status NOT NULL DEFAULT 'brief_received',
  budget_monthly          DECIMAL(10,2),
  platform                TEXT DEFAULT 'meta',
  ad_account_id           TEXT,
  pixel_id                TEXT,
  business_manager_id     TEXT,
  objective               TEXT,
  ai_creative_prompt      TEXT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE onboarding_responses
  ADD CONSTRAINT fk_campaign
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, auth;

CREATE INDEX idx_onboarding_client_id ON onboarding_responses(client_id);

CREATE INDEX idx_onboarding_submitted_at ON onboarding_responses(submitted_at DESC);

CREATE INDEX idx_campaigns_client_id ON campaigns(client_id);

CREATE INDEX idx_campaigns_status ON campaigns(status);

-- Source structure: 002_meta_pages.sql

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS facebook_page_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_page_name TEXT,
  ADD COLUMN IF NOT EXISTS instagram_account_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_account_name TEXT;

CREATE INDEX IF NOT EXISTS idx_campaigns_facebook_page_id ON campaigns(facebook_page_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_instagram_account_id ON campaigns(instagram_account_id);

-- Source structure: 003_gemini_key.sql

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;

-- Source structure: 004_leads.sql

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  client_id UUID REFERENCES profiles(id) ON DELETE SET NULL,


  meta_lead_id TEXT UNIQUE,
  meta_form_id TEXT,
  meta_form_name TEXT,
  meta_ad_id TEXT,
  meta_campaign_name TEXT,


  full_name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  field_data JSONB,


  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','qualified','converted','lost')),
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 5),
  notes TEXT,

  meta_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE INDEX leads_campaign_id_idx ON leads(campaign_id);

CREATE INDEX leads_client_id_idx ON leads(client_id);

CREATE INDEX leads_status_idx ON leads(status);

CREATE INDEX leads_meta_lead_id_idx ON leads(meta_lead_id);

-- Source structure: 005_meta_campaign_id.sql

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_campaign_id TEXT;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_status TEXT;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_daily_budget NUMERIC;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_lifetime_budget NUMERIC;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_start_time TIMESTAMPTZ;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS campaigns_meta_campaign_id_idx ON campaigns(meta_campaign_id);

-- Source structure: 005_meta_tokens.sql

CREATE TABLE IF NOT EXISTS meta_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  token      TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE meta_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS meta_token_id UUID REFERENCES meta_tokens(id) ON DELETE SET NULL;

-- Source structure: 006_client_notes.sql

CREATE TABLE IF NOT EXISTS client_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES profiles(id)  ON DELETE CASCADE,
  content     TEXT NOT NULL,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS client_notes_campaign_id_idx ON client_notes(campaign_id);

CREATE INDEX IF NOT EXISTS client_notes_client_id_idx   ON client_notes(client_id);

CREATE INDEX IF NOT EXISTS client_notes_is_read_idx     ON client_notes(client_id, is_read);

-- Source structure: 007_team_notifications.sql

CREATE TABLE IF NOT EXISTS team_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  client_name TEXT,
  action      TEXT NOT NULL,
  message     TEXT,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE team_notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS team_notif_created_at_idx ON team_notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS team_notif_is_read_idx    ON team_notifications(is_read);

-- Source structure: 010_leads_cash_collected.sql

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cash_collected NUMERIC(10, 2) DEFAULT NULL;

-- Source structure: 011_multi_admin.sql

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS managed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS managed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE meta_tokens
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_profiles_managed_by ON profiles(managed_by);

CREATE INDEX IF NOT EXISTS idx_campaigns_managed_by ON campaigns(managed_by);

CREATE INDEX IF NOT EXISTS idx_meta_tokens_admin_id ON meta_tokens(admin_id);

-- Source structure: 012_finance_module.sql

CREATE TYPE finance_phase AS ENUM ('trial', 'mrr');

CREATE TYPE finance_entry_type AS ENUM ('revenue', 'expense');

CREATE TABLE IF NOT EXISTS client_finance_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  phase             finance_phase NOT NULL DEFAULT 'trial',
  trial_amount      NUMERIC(10, 2),
  trial_start_date  DATE,
  trial_end_date    DATE,
  mrr_amount        NUMERIC(10, 2),
  next_payment_date DATE,
  last_payment_date DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entry_type  finance_entry_type NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  label       TEXT NOT NULL,
  amount      NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  entry_date  DATE NOT NULL,
  received_by TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE client_finance_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance_entries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_client_finance_profiles_client_id
  ON client_finance_profiles(client_id);

CREATE INDEX IF NOT EXISTS idx_client_finance_profiles_next_payment_date
  ON client_finance_profiles(next_payment_date);

CREATE INDEX IF NOT EXISTS idx_finance_entries_client_id
  ON finance_entries(client_id);

CREATE INDEX IF NOT EXISTS idx_finance_entries_entry_date
  ON finance_entries(entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_finance_entries_type
  ON finance_entries(entry_type);

-- Source structure: 013_finance_team_members.sql

ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS team_member_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_finance_entries_team_member_id
  ON finance_entries(team_member_id);

-- Source structure: 015_team_management.sql

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS team_role TEXT,
  ADD COLUMN IF NOT EXISTS team_status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_team_role_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_team_role_check
      CHECK (
        team_role IS NULL
        OR team_role IN ('super_admin', 'admin', 'designer', 'media_buyer')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_team_status_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_team_status_check
      CHECK (team_status IN ('active', 'invited', 'disabled'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS campaign_team_members (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, team_member_id)
);

CREATE TABLE IF NOT EXISTS team_member_client_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  monthly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_member_id, client_id)
);

ALTER TABLE campaign_team_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE team_member_client_rates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_campaign_team_members_member
  ON campaign_team_members(team_member_id);

CREATE INDEX IF NOT EXISTS idx_campaign_team_members_campaign
  ON campaign_team_members(campaign_id);

CREATE INDEX IF NOT EXISTS idx_team_member_client_rates_member
  ON team_member_client_rates(team_member_id);

CREATE INDEX IF NOT EXISTS idx_team_member_client_rates_client
  ON team_member_client_rates(client_id);

-- Source structure: 017_ai_deliverables.sql

CREATE TABLE IF NOT EXISTS ai_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,


  skill_name TEXT NOT NULL DEFAULT 'leadfactory-onboarding-flow',


  deliverable_type TEXT NOT NULL CHECK (deliverable_type IN (
    'onboarding_form',
    'deep_search_market_awareness',
    'deep_search_competitor_research',
    'deep_search_psychographic',
    'competitor_ads_brief',
    'competitor_ads_data',
    'competitor_ads_analysis',
    'competitor_ads_creative',
    'campaign_proposal',
    'vsl_script',
    'vsl_strategy',
    'vsl_docx',
    'meta_ads_copy',
    'meta_ads_docx',
    'readme_index',
    'other'
  )),


  deliverable_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  file_extension TEXT,


  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'archived', 'error', 'missing')),
  version TEXT DEFAULT '1.0',


  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),


  UNIQUE (client_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_ai_deliverables_client_id ON ai_deliverables(client_id);

CREATE INDEX IF NOT EXISTS idx_ai_deliverables_skill_name ON ai_deliverables(skill_name);

CREATE INDEX IF NOT EXISTS idx_ai_deliverables_type ON ai_deliverables(deliverable_type);

CREATE INDEX IF NOT EXISTS idx_ai_deliverables_status ON ai_deliverables(status);

ALTER TABLE ai_deliverables ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_ai_deliverables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_deliverables_updated_at ON ai_deliverables;

CREATE TRIGGER trg_ai_deliverables_updated_at
  BEFORE UPDATE ON ai_deliverables
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_deliverables_updated_at();

-- Source structure: 018_ai_deliverables_storage.sql

ALTER TABLE ai_deliverables
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_deliverables_storage_path ON ai_deliverables(storage_path);

-- Source structure: 020_add_proposal_markdown.sql

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS proposal_markdown TEXT;

-- Source structure: 021_activity_logs.sql

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ;

CREATE TABLE activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  target_label TEXT,
  metadata    JSONB DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_actor     ON activity_logs (actor_id);

CREATE INDEX idx_activity_logs_action    ON activity_logs (action);

CREATE INDEX idx_activity_logs_target    ON activity_logs (target_type, target_id);

CREATE INDEX idx_activity_logs_created   ON activity_logs (created_at DESC);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_profiles_last_seen ON profiles (last_seen_at DESC NULLS LAST);

CREATE INDEX idx_profiles_first_login ON profiles (first_login_at NULLS LAST);

-- Source structure: 022_formations.sql

CREATE TABLE formations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT,
  slug            TEXT NOT NULL UNIQUE,
  cover_image_url TEXT,
  is_published    BOOLEAN DEFAULT FALSE,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE formation_modules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_id      UUID NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  module_number     INT NOT NULL,
  video_url         TEXT,
  presentation_url  TEXT,
  resources         JSONB DEFAULT '[]'::JSONB,
  notes             TEXT,
  is_published      BOOLEAN DEFAULT TRUE,
  display_order     INT DEFAULT 0,
  duration_minutes  INT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE client_formation_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  formation_id  UUID NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  granted_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, formation_id)
);

CREATE TABLE client_formation_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id     UUID NOT NULL REFERENCES formation_modules(id) ON DELETE CASCADE,
  is_completed  BOOLEAN DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, module_id)
);

CREATE INDEX idx_formation_modules_formation   ON formation_modules (formation_id);

CREATE INDEX idx_formation_modules_order       ON formation_modules (formation_id, display_order);

CREATE INDEX idx_client_formation_access_client ON client_formation_access (client_id);

CREATE INDEX idx_client_formation_access_formation ON client_formation_access (formation_id);

CREATE INDEX idx_client_formation_progress_client ON client_formation_progress (client_id);

CREATE INDEX idx_client_formation_progress_module ON client_formation_progress (module_id);

CREATE INDEX idx_formations_slug               ON formations (slug);

CREATE INDEX idx_formations_order              ON formations (display_order);

ALTER TABLE formations ENABLE ROW LEVEL SECURITY;

ALTER TABLE formation_modules ENABLE ROW LEVEL SECURITY;

ALTER TABLE client_formation_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE client_formation_progress ENABLE ROW LEVEL SECURITY;

-- Source structure: 023_crm_pipeline.sql

CREATE TABLE pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_won BOOLEAN NOT NULL DEFAULT false,
  is_lost BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE INDEX pipeline_stages_client_id_idx ON pipeline_stages(client_id);

CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'note', 'call', 'email', 'meeting', 'stage_change',
    'status_change', 'task', 'whatsapp', 'sms', 'other'
  )),
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

CREATE INDEX lead_activities_lead_id_idx ON lead_activities(lead_id);

CREATE INDEX lead_activities_client_id_idx ON lead_activities(client_id);

CREATE INDEX lead_activities_created_at_idx ON lead_activities(created_at DESC);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'meta_ads'
  CHECK (source IN ('meta_ads', 'google_ads', 'manual', 'website', 'referral',
                     'phone', 'email', 'linkedin', 'salon', 'other'));

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up TIMESTAMPTZ;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_contact TEXT CHECK (preferred_contact IN ('phone', 'email', 'whatsapp', 'sms'));

ALTER TABLE leads ADD COLUMN IF NOT EXISTS city TEXT;

CREATE INDEX leads_source_idx ON leads(source);

CREATE INDEX leads_pipeline_stage_id_idx ON leads(pipeline_stage_id);

CREATE INDEX leads_assigned_to_idx ON leads(assigned_to);

CREATE INDEX leads_next_follow_up_idx ON leads(next_follow_up);

CREATE INDEX leads_tags_idx ON leads USING GIN(tags);

CREATE OR REPLACE FUNCTION seed_default_pipeline_stages(p_client_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Only seed if client has no stages yet
  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE client_id = p_client_id) THEN
    INSERT INTO pipeline_stages (client_id, name, color, display_order, is_default, is_won, is_lost)
    VALUES
      (p_client_id, 'Nouveau',    '#3B82F6', 0, true,  false, false),
      (p_client_id, 'Contacté',   '#FDE047', 1, false, false, false),
      (p_client_id, 'Qualifié',   '#A855F7', 2, false, false, false),
      (p_client_id, 'Proposition', '#F97316', 3, false, false, false),
      (p_client_id, 'Négociation','#EC4899', 4, false, false, false),
      (p_client_id, 'Gagné',      '#58BC82', 5, false, true,  false),
      (p_client_id, 'Perdu',      '#6B7280', 6, false, false, true);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Source structure: 025_admin_leadfactory_crm.sql

CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT,
  company TEXT,
  status TEXT NOT NULL DEFAULT 'new_discovery'
    CHECK (status IN (
      'new_discovery',
      'contacted',
      'qualified',
      'proposal_sent',
      'won',
      'lost',
      'no_show',
      'cancelled'
    )),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  source TEXT NOT NULL DEFAULT 'cal.com',
  event_type_id INTEGER,
  event_type_title TEXT,
  cal_booking_id INTEGER,
  cal_booking_uid TEXT UNIQUE,
  cal_trigger_event TEXT,
  call_start_time TIMESTAMPTZ,
  call_end_time TIMESTAMPTZ,
  meeting_url TEXT,
  notes TEXT,
  qualification JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_leads_status_idx ON crm_leads(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS crm_leads_email_idx ON crm_leads(LOWER(email));

CREATE INDEX IF NOT EXISTS crm_leads_call_start_idx ON crm_leads(call_start_time DESC);

CREATE INDEX IF NOT EXISTS crm_leads_event_type_idx ON crm_leads(event_type_id);

CREATE INDEX IF NOT EXISTS crm_leads_raw_payload_gin ON crm_leads USING GIN(raw_payload);

ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_ad_spend_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'meta'
    CHECK (source IN ('meta', 'manual')),
  spend_date DATE NOT NULL,
  account_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  spend NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  meta_reported_leads INTEGER NOT NULL DEFAULT 0 CHECK (meta_reported_leads >= 0),
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, spend_date, account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS crm_ad_spend_daily_date_idx ON crm_ad_spend_daily(spend_date DESC);

CREATE INDEX IF NOT EXISTS crm_ad_spend_daily_campaign_idx ON crm_ad_spend_daily(campaign_id);

ALTER TABLE crm_ad_spend_daily ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_crm_metrics(
  from_date DATE DEFAULT NULL,
  to_date DATE DEFAULT NULL
)
RETURNS TABLE (
  lead_count INTEGER,
  booked_call_count INTEGER,
  shown_call_count INTEGER,
  no_show_count INTEGER,
  cancelled_count INTEGER,
  won_count INTEGER,
  spend NUMERIC,
  meta_reported_leads INTEGER,
  cost_per_lead NUMERIC,
  cost_per_call NUMERIC,
  show_rate NUMERIC,
  sales_conversion_rate NUMERIC
)
LANGUAGE SQL
STABLE
AS $$
  WITH filtered_leads AS (
    SELECT *
    FROM crm_leads
    WHERE (from_date IS NULL OR created_at::DATE >= from_date)
      AND (to_date IS NULL OR created_at::DATE <= to_date)
  ),
  filtered_spend AS (
    SELECT *
    FROM crm_ad_spend_daily
    WHERE (from_date IS NULL OR spend_date >= from_date)
      AND (to_date IS NULL OR spend_date <= to_date)
  ),
  lead_stats AS (
    SELECT
      COUNT(*)::INTEGER AS lead_count,
      COUNT(*) FILTER (WHERE call_start_time IS NOT NULL)::INTEGER AS booked_call_count,
      COUNT(*) FILTER (WHERE status IN ('qualified', 'proposal_sent', 'won', 'lost'))::INTEGER AS shown_call_count,
      COUNT(*) FILTER (WHERE status = 'no_show')::INTEGER AS no_show_count,
      COUNT(*) FILTER (WHERE status = 'cancelled')::INTEGER AS cancelled_count,
      COUNT(*) FILTER (WHERE status = 'won')::INTEGER AS won_count
    FROM filtered_leads
  ),
  spend_stats AS (
    SELECT
      COALESCE(SUM(spend), 0)::NUMERIC AS spend,
      COALESCE(SUM(meta_reported_leads), 0)::INTEGER AS meta_reported_leads
    FROM filtered_spend
  )
  SELECT
    l.lead_count,
    l.booked_call_count,
    l.shown_call_count,
    l.no_show_count,
    l.cancelled_count,
    l.won_count,
    s.spend,
    s.meta_reported_leads,
    ROUND(s.spend / NULLIF(l.lead_count, 0), 2) AS cost_per_lead,
    ROUND(s.spend / NULLIF(l.booked_call_count, 0), 2) AS cost_per_call,
    ROUND((l.shown_call_count::NUMERIC / NULLIF(l.shown_call_count + l.no_show_count, 0)) * 100, 1) AS show_rate,
    ROUND((l.won_count::NUMERIC / NULLIF(l.shown_call_count, 0)) * 100, 1) AS sales_conversion_rate
  FROM lead_stats l
  CROSS JOIN spend_stats s;
$$;

-- Source structure: 026_outbound_sequence.sql

CREATE TABLE IF NOT EXISTS sequence_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  title            TEXT NOT NULL DEFAULT 'Nouvelle séquence',


  messages         JSONB NOT NULL DEFAULT '[]'::jsonb,


  context_override JSONB,


  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequence_conv_client ON sequence_conversations(client_id);

CREATE INDEX IF NOT EXISTS idx_sequence_conv_updated ON sequence_conversations(client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sequence_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES sequence_conversations(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  order_index     INT NOT NULL DEFAULT 0,
  subject         TEXT,
  body            TEXT NOT NULL DEFAULT '',
  wait_days       INT DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'sent', 'action_needed')),


  ab_variants     JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequence_email_conv ON sequence_emails(conversation_id, order_index);

CREATE INDEX IF NOT EXISTS idx_sequence_email_client ON sequence_emails(client_id);

ALTER TABLE sequence_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE sequence_emails ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_sequence_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sequence_conv_updated_at ON sequence_conversations;

CREATE TRIGGER trg_sequence_conv_updated_at
  BEFORE UPDATE ON sequence_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_sequence_conversations_updated_at();

CREATE OR REPLACE FUNCTION update_sequence_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sequence_email_updated_at ON sequence_emails;

CREATE TRIGGER trg_sequence_email_updated_at
  BEFORE UPDATE ON sequence_emails
  FOR EACH ROW
  EXECUTE FUNCTION update_sequence_emails_updated_at();

-- Source structure: 027_integrations.sql

CREATE TABLE IF NOT EXISTS integration_api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  label          TEXT NOT NULL,
  key_prefix     TEXT NOT NULL,
  key_hash       TEXT NOT NULL UNIQUE,


  provider       TEXT NOT NULL DEFAULT 'generic'
                 CHECK (provider IN ('calcom','typeform','zapier','n8n','make','generic','custom')),


  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS integration_api_keys_client_id_idx ON integration_api_keys(client_id);

CREATE INDEX IF NOT EXISTS integration_api_keys_key_hash_idx ON integration_api_keys(key_hash);

ALTER TABLE integration_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS integration_webhook_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,
  api_key_id     UUID REFERENCES integration_api_keys(id) ON DELETE SET NULL,

  provider       TEXT,
  external_id    TEXT,
  payload_hash   TEXT NOT NULL,
  status         TEXT NOT NULL
                 CHECK (status IN ('accepted','duplicate','rejected','error')),
  http_status    INT NOT NULL,
  error          TEXT,
  raw_payload    JSONB,

  lead_id        UUID REFERENCES leads(id) ON DELETE SET NULL,
  ip             INET,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS iwl_client_created_idx ON integration_webhook_logs(client_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS iwl_dedup_idx
  ON integration_webhook_logs(api_key_id, payload_hash)
  WHERE api_key_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS iwl_external_idx
  ON integration_webhook_logs(api_key_id, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE integration_webhook_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_id    TEXT,
  ADD COLUMN IF NOT EXISTS integration_api_key_id UUID REFERENCES integration_api_keys(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_external_unique_idx
  ON leads(client_id, integration_api_key_id, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (
  source IN (
    'meta_ads','google_ads','manual','website','referral',
    'phone','email','linkedin','salon',
    'calcom','typeform','zapier','n8n','make','webhook',
    'other'
  )
);

-- Source structure: 028_app_settings.sql

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;

CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_app_settings_updated_at();

-- Source structure: 029_scrape_jobs.sql

create table if not exists scrape_jobs (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references auth.users(id) on delete cascade,
  source            text not null default 'google_maps',
  input_url         text not null,
  input_options     jsonb not null default '{}'::jsonb,
  apify_run_id      text,
  apify_dataset_id  text,
  status            text not null default 'queued'
                    check (status in ('queued','running','done','failed','cancelled')),
  progress_pct      int not null default 0,
  results_count     int not null default 0,
  cost_usd          numeric(10,4),
  csv_storage_path  text,
  error_message     text,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

create index if not exists scrape_jobs_client_created_idx
  on scrape_jobs(client_id, created_at desc);

create index if not exists scrape_jobs_active_idx
  on scrape_jobs(status) where status in ('queued','running');

alter table scrape_jobs enable row level security;

-- Source structure: 030_personal_brand_linkedin.sql

CREATE TABLE IF NOT EXISTS linkedin_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  title            TEXT NOT NULL DEFAULT 'Nouveau brief LinkedIn',


  messages         JSONB NOT NULL DEFAULT '[]'::jsonb,


  context_override JSONB,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_conv_client ON linkedin_conversations(client_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_conv_updated ON linkedin_conversations(client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS linkedin_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES linkedin_conversations(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  order_index     INT NOT NULL DEFAULT 0,


  body            TEXT NOT NULL DEFAULT '',


  hook            TEXT,


  framework       TEXT,


  format          TEXT NOT NULL DEFAULT 'text',


  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,

  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_post_conv ON linkedin_posts(conversation_id, order_index);

CREATE INDEX IF NOT EXISTS idx_linkedin_post_client ON linkedin_posts(client_id);

ALTER TABLE linkedin_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE linkedin_posts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_linkedin_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_linkedin_conv_updated_at ON linkedin_conversations;

CREATE TRIGGER trg_linkedin_conv_updated_at
  BEFORE UPDATE ON linkedin_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_linkedin_conversations_updated_at();

CREATE OR REPLACE FUNCTION update_linkedin_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_linkedin_post_updated_at ON linkedin_posts;

CREATE TRIGGER trg_linkedin_post_updated_at
  BEFORE UPDATE ON linkedin_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_linkedin_posts_updated_at();

-- Source structure: 031_client_surprises.sql

CREATE TABLE IF NOT EXISTS client_surprises (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','ready','failed','viewed')),
  progress_pct  INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  viewed_at     TIMESTAMPTZ,
  notified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_surprises_status ON client_surprises(status);

CREATE TABLE IF NOT EXISTS surprise_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surprise_id      UUID NOT NULL REFERENCES client_surprises(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_type       TEXT NOT NULL CHECK (asset_type IN ('linkedin_post','cold_email_sequence','call_script')),
  order_index      INT NOT NULL DEFAULT 0,
  title            TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  hook             TEXT,
  framework        TEXT,
  angle            TEXT,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_used       TEXT,
  generation_cost_usd NUMERIC(10,5),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surprise_assets_surprise ON surprise_assets(surprise_id, asset_type, order_index);

CREATE INDEX IF NOT EXISTS idx_surprise_assets_client ON surprise_assets(client_id);

ALTER TABLE client_surprises ENABLE ROW LEVEL SECURITY;

ALTER TABLE surprise_assets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_client_surprises_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_surprises_updated_at ON client_surprises;

CREATE TRIGGER trg_client_surprises_updated_at BEFORE UPDATE ON client_surprises FOR EACH ROW EXECUTE FUNCTION update_client_surprises_updated_at();

-- Source structure: 031_sales_call_analyzer.sql

CREATE TABLE IF NOT EXISTS client_external_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  provider        TEXT NOT NULL
                  CHECK (provider IN ('fathom')),

  label           TEXT,
  key_encrypted   TEXT NOT NULL,
  key_iv          TEXT NOT NULL,
  key_tag         TEXT NOT NULL,
  key_preview     TEXT NOT NULL,

  last_used_at    TIMESTAMPTZ,
  last_error      TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),


  UNIQUE (client_id, provider)
);

CREATE INDEX IF NOT EXISTS client_external_api_keys_client_idx
  ON client_external_api_keys(client_id);

ALTER TABLE client_external_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS sales_call_analyses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,


  source_type          TEXT NOT NULL
                       CHECK (source_type IN ('fathom_url', 'paste')),
  fathom_url           TEXT,
  fathom_recording_id  TEXT,
  transcript_raw       TEXT NOT NULL,
  meeting_title        TEXT,
  meeting_date         TIMESTAMPTZ,
  duration_minutes     INTEGER,


  analysis_json        JSONB,
  model_used           TEXT,
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,


  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message        TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_call_analyses_client_created_idx
  ON sales_call_analyses(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_call_analyses_status_idx
  ON sales_call_analyses(status);

ALTER TABLE sales_call_analyses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_sales_call_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_call_analyses_updated_at
  BEFORE UPDATE ON sales_call_analyses
  FOR EACH ROW
  EXECUTE FUNCTION update_sales_call_updated_at();

CREATE TRIGGER trg_client_external_api_keys_updated_at
  BEFORE UPDATE ON client_external_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_sales_call_updated_at();

-- Source structure: 032_client_credits.sql

create table if not exists client_credits (
  client_id        uuid primary key references profiles(id) on delete cascade,
  balance          int not null default 0 check (balance >= 0),
  total_granted    int not null default 0,
  total_consumed   int not null default 0,
  last_consumed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists client_credits_balance_idx
  on client_credits(balance);

create table if not exists credit_usage (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references profiles(id) on delete cascade,
  feature     text not null check (feature in (
    'sales_analyze',
    'outbound_chat',
    'personal_brand_chat',
    'admin_grant',
    'admin_refund'
  )),
  amount      int not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists credit_usage_client_created_idx
  on credit_usage(client_id, created_at desc);

create index if not exists credit_usage_feature_idx
  on credit_usage(feature);

alter table client_credits enable row level security;

alter table credit_usage   enable row level security;

CREATE OR REPLACE FUNCTION seed_client_credits_on_new_profile() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.client_credits (client_id, balance, total_granted) VALUES (NEW.id, 0, 0) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

drop trigger if exists trg_seed_client_credits on profiles;

create trigger trg_seed_client_credits
  after insert on profiles
  for each row execute function seed_client_credits_on_new_profile();

create or replace function update_client_credits_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_client_credits_updated_at on client_credits;

create trigger trg_client_credits_updated_at
  before update on client_credits
  for each row execute function update_client_credits_updated_at();

-- Source structure: 032_extend_notetaker_providers.sql

ALTER TABLE client_external_api_keys
  DROP CONSTRAINT IF EXISTS client_external_api_keys_provider_check;

ALTER TABLE client_external_api_keys
  ADD CONSTRAINT client_external_api_keys_provider_check
  CHECK (provider IN ('fathom', 'fireflies', 'granola', 'tldv'));

ALTER TABLE sales_call_analyses
  DROP CONSTRAINT IF EXISTS sales_call_analyses_source_type_check;

ALTER TABLE sales_call_analyses
  ADD CONSTRAINT sales_call_analyses_source_type_check
  CHECK (source_type IN (
    'fathom_url',
    'fireflies_url',
    'granola_url',
    'tldv_url',
    'paste'
  ));

-- Source structure: 033_cold_call_scripts.sql

CREATE TABLE IF NOT EXISTS cold_call_scripts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,


  title                TEXT NOT NULL,
  offer_brief          JSONB NOT NULL,


  script_json          JSONB,
  model_used           TEXT,
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,


  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message        TEXT,


  archived             BOOLEAN NOT NULL DEFAULT FALSE,
  pinned               BOOLEAN NOT NULL DEFAULT FALSE,
  user_notes           TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cold_call_scripts_client_created_idx
  ON cold_call_scripts(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cold_call_scripts_status_idx
  ON cold_call_scripts(status);

ALTER TABLE cold_call_scripts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_cold_call_scripts_updated_at
  BEFORE UPDATE ON cold_call_scripts
  FOR EACH ROW
  EXECUTE FUNCTION update_sales_call_updated_at();

-- Source structure: 034_personal_brand_reels.sql

CREATE TABLE IF NOT EXISTS reels_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Nouveau brief Reels',
  messages         JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_override JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reels_conv_client ON reels_conversations(client_id);

CREATE INDEX IF NOT EXISTS idx_reels_conv_updated ON reels_conversations(client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reels_scripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES reels_conversations(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  order_index     INT NOT NULL DEFAULT 0,

  body            TEXT NOT NULL DEFAULT '',
  hook            TEXT,
  framework       TEXT,

  format          TEXT NOT NULL DEFAULT 'reel'
                  CHECK (format IN ('reel', 'tiktok', 'short')),
  platform        TEXT NOT NULL DEFAULT 'instagram'
                  CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  duration_seconds INT,

  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,

  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reels_script_conv ON reels_scripts(conversation_id, order_index);

CREATE INDEX IF NOT EXISTS idx_reels_script_client ON reels_scripts(client_id);

ALTER TABLE reels_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE reels_scripts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_reels_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reels_conv_updated_at ON reels_conversations;

CREATE TRIGGER trg_reels_conv_updated_at
  BEFORE UPDATE ON reels_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_reels_conversations_updated_at();

CREATE OR REPLACE FUNCTION update_reels_scripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reels_script_updated_at ON reels_scripts;

CREATE TRIGGER trg_reels_script_updated_at
  BEFORE UPDATE ON reels_scripts
  FOR EACH ROW
  EXECUTE FUNCTION update_reels_scripts_updated_at();

-- Source structure: 036_client_notifications_new_lead.sql

CREATE TABLE IF NOT EXISTS client_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('new_lead','follow_up_reminder','weekly_summary','system')),
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  link_path     TEXT,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_notifications_client_unread
  ON client_notifications(client_id, created_at DESC) WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_client_notifications_client_all
  ON client_notifications(client_id, created_at DESC);

ALTER TABLE client_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_new_lead BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_new_lead_email BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION fn_notify_new_lead() RETURNS TRIGGER AS $$
DECLARE
  wants BOOLEAN;
  src TEXT;
  title_text TEXT;
  body_text TEXT;
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  src := COALESCE(LOWER(NEW.source), '');
  IF src IN ('scraping','gmaps','google_maps') THEN
    RETURN NEW;
  END IF;

  SELECT notify_new_lead INTO wants FROM profiles WHERE id = NEW.client_id;
  IF NOT COALESCE(wants, TRUE) THEN
    RETURN NEW;
  END IF;

  title_text := COALESCE(NEW.full_name, NEW.email, 'Nouveau lead');
  body_text := CONCAT(
    'Nouveau lead',
    CASE WHEN NEW.company IS NOT NULL AND NEW.company <> '' THEN ' chez ' || NEW.company ELSE '' END,
    CASE WHEN NEW.source IS NOT NULL AND NEW.source <> '' THEN ' (' || NEW.source || ')' ELSE '' END,
    '.'
  );

  INSERT INTO client_notifications (client_id, kind, lead_id, title, body, link_path, metadata)
  VALUES (
    NEW.client_id,
    'new_lead',
    NEW.id,
    title_text,
    body_text,
    '/client/crm',
    jsonb_build_object(
      'source', NEW.source,
      'campaign_id', NEW.campaign_id,
      'email', NEW.email,
      'phone', NEW.phone
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_new_lead ON leads;

CREATE TRIGGER trg_notify_new_lead
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_new_lead();

-- Source structure: 037_client_calls.sql

CREATE TABLE IF NOT EXISTS client_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  title         TEXT NOT NULL,
  transcript    TEXT,
  link          TEXT,
  order_index   INT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_calls_client ON client_calls(client_id);

CREATE INDEX IF NOT EXISTS idx_client_calls_client_order ON client_calls(client_id, order_index, created_at DESC);

ALTER TABLE client_calls ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_client_calls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_calls_updated_at ON client_calls;

CREATE TRIGGER trg_client_calls_updated_at
  BEFORE UPDATE ON client_calls
  FOR EACH ROW
  EXECUTE FUNCTION update_client_calls_updated_at();

-- Source structure: 038_client_calls_fathom_sync.sql

ALTER TABLE client_calls ADD COLUMN IF NOT EXISTS fathom_recording_id TEXT;

ALTER TABLE client_calls ADD COLUMN IF NOT EXISTS meeting_date TIMESTAMPTZ;

ALTER TABLE client_calls ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE client_calls ADD COLUMN IF NOT EXISTS external_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_calls_fathom
  ON client_calls(client_id, fathom_recording_id)
  WHERE fathom_recording_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_calls_fathom_recording
  ON client_calls(fathom_recording_id)
  WHERE fathom_recording_id IS NOT NULL;

-- Source structure: 039_team_resources.sql

CREATE TABLE IF NOT EXISTS team_resources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,



  kind          TEXT NOT NULL DEFAULT 'resource'
                CHECK (kind IN ('sop', 'resource')),
  title         TEXT NOT NULL,


  loom_url      TEXT,
  document_url  TEXT,
  body_html     TEXT,
  body_text     TEXT,

  is_published  BOOLEAN NOT NULL DEFAULT TRUE,
  order_index   INT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_resources_order
  ON team_resources(order_index, created_at DESC);

CREATE TABLE IF NOT EXISTS team_resource_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id    UUID NOT NULL REFERENCES team_resources(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (resource_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS idx_tra_member ON team_resource_assignments(team_member_id);

CREATE INDEX IF NOT EXISTS idx_tra_resource ON team_resource_assignments(resource_id);

ALTER TABLE team_resources ENABLE ROW LEVEL SECURITY;

ALTER TABLE team_resource_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_team_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_team_resources_updated_at ON team_resources;

CREATE TRIGGER trg_team_resources_updated_at
  BEFORE UPDATE ON team_resources
  FOR EACH ROW
  EXECUTE FUNCTION update_team_resources_updated_at();

-- Source structure: 040_client_results_rating.sql

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS results_rating            TEXT,
  ADD COLUMN IF NOT EXISTS results_rating_note       TEXT,
  ADD COLUMN IF NOT EXISTS results_rating_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS results_rating_updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_results_rating_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_results_rating_check
      CHECK (results_rating IN (
        'very_bad',
        'bad',
        'ok',
        'good',
        'amazing',
        'stopped',
        'payment_terror'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_results_rating
  ON profiles(results_rating)
  WHERE role = 'client';

-- Source structure: 040_meta_connections.sql

CREATE TABLE IF NOT EXISTS meta_connections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,


  meta_user_id             TEXT,
  page_id                  TEXT NOT NULL,
  page_name                TEXT,
  ad_account_id            TEXT,
  instagram_account_id     TEXT,


  user_token_encrypted     TEXT,
  user_token_iv            TEXT,
  user_token_tag           TEXT,
  page_token_encrypted     TEXT,
  page_token_iv            TEXT,
  page_token_tag           TEXT,

  expires_at               TIMESTAMPTZ,
  scopes                   TEXT[],
  subscribed_leadgen       BOOLEAN NOT NULL DEFAULT FALSE,

  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed_at        TIMESTAMPTZ,
  last_error               TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE meta_connections
  ADD COLUMN IF NOT EXISTS meta_user_id          TEXT,
  ADD COLUMN IF NOT EXISTS page_name             TEXT,
  ADD COLUMN IF NOT EXISTS ad_account_id         TEXT,
  ADD COLUMN IF NOT EXISTS instagram_account_id  TEXT,
  ADD COLUMN IF NOT EXISTS user_token_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS user_token_iv         TEXT,
  ADD COLUMN IF NOT EXISTS user_token_tag        TEXT,
  ADD COLUMN IF NOT EXISTS page_token_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS page_token_iv         TEXT,
  ADD COLUMN IF NOT EXISTS page_token_tag        TEXT,
  ADD COLUMN IF NOT EXISTS expires_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scopes                TEXT[],
  ADD COLUMN IF NOT EXISTS subscribed_leadgen    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS connected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_refreshed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error            TEXT,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS meta_connections_page_idx   ON meta_connections(page_id);

CREATE INDEX        IF NOT EXISTS meta_connections_client_idx ON meta_connections(client_id);

ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_meta_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meta_connections_updated_at ON meta_connections;

CREATE TRIGGER trg_meta_connections_updated_at
  BEFORE UPDATE ON meta_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_meta_connections_updated_at();

-- Source structure: add_ai_assets.sql

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS ai_ad_copy_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_video_ad_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_vsl_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_static_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS revenue NUMERIC(10,2);
COMMIT;
