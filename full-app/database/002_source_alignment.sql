-- Fields/tables required by source e909784, absent from its committed migrations.
-- Reconstructed from API writes and page SELECTs; not a dump of a running database.
BEGIN;
SET LOCAL search_path = public;
ALTER TABLE profiles ADD COLUMN next_catchup DATE;
-- Legacy compatibility only; secrets must be accessed exclusively on the server.
ALTER TABLE profiles ADD COLUMN meta_access_token TEXT;
ALTER TABLE campaigns ADD COLUMN weekly_report_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_deliverables ADD COLUMN type TEXT GENERATED ALWAYS AS (deliverable_type) STORED;
ALTER TABLE ai_deliverables ADD COLUMN content JSONB;
ALTER TABLE credit_usage DROP CONSTRAINT credit_usage_feature_check;
ALTER TABLE credit_usage ADD CONSTRAINT credit_usage_feature_check CHECK
 (feature IN ('sales_analyze','outbound_chat','personal_brand_chat','cold_call_script','reels_chat','admin_grant','admin_refund'));
ALTER TABLE crm_ad_spend_daily ADD COLUMN client_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX crm_ad_spend_client_date_idx ON crm_ad_spend_daily(client_id, spend_date DESC);

CREATE TABLE client_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 description TEXT,
 is_completed BOOLEAN NOT NULL DEFAULT FALSE,
 completed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX client_tasks_client_idx ON client_tasks(client_id, created_at);

CREATE TABLE linkedin_connections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
 linkedin_user_id TEXT NOT NULL,
 full_name TEXT,
 profile_picture TEXT,
 access_token_encrypted TEXT NOT NULL,
 access_token_iv TEXT NOT NULL,
 access_token_tag TEXT NOT NULL,
 refresh_token_encrypted TEXT,
 refresh_token_iv TEXT,
 refresh_token_tag TEXT,
 expires_at TIMESTAMPTZ,
 refresh_expires_at TIMESTAMPTZ,
 scopes TEXT[] NOT NULL DEFAULT '{}',
 connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_refreshed_at TIMESTAMPTZ,
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE scheduled_posts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 source_type TEXT NOT NULL,
 source_id UUID,
 body_snapshot TEXT NOT NULL,
 scheduled_at TIMESTAMPTZ NOT NULL,
 scheduled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','publishing','published','failed','cancelled')),
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
 next_retry_at TIMESTAMPTZ,
 linkedin_post_urn TEXT,
 error_message TEXT,
 published_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX scheduled_posts_client_idx ON scheduled_posts(client_id, scheduled_at DESC);
CREATE INDEX scheduled_posts_due_idx ON scheduled_posts(status, scheduled_at);
CREATE TABLE post_publish_attempts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 scheduled_post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
 outcome TEXT NOT NULL,
 http_status INTEGER,
 linkedin_error TEXT,
 linkedin_post_urn TEXT,
 duration_ms INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX post_publish_attempts_post_idx ON post_publish_attempts(scheduled_post_id, created_at DESC);
COMMIT;
