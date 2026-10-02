-- Starter agent persistence contract, 2026-10-01.
-- Maps starter-agents.ts local JSON; this DDL does NOT enable SQL synchronization.
BEGIN;
SET LOCAL search_path = public;

CREATE TABLE agency_agents (
 role_slug TEXT PRIMARY KEY CHECK (length(role_slug) BETWEEN 1 AND 80),
 is_recruited BOOLEAN NOT NULL DEFAULT FALSE,
 recruited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
 recruited_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_sources (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 150),
 client_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
 content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 18000),
 url TEXT NOT NULL DEFAULT '' CHECK (length(url) <= 1000 AND (url = '' OR url ~ '^https://')),
 created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_sources_client_idx ON agent_sources(client_id);

CREATE TABLE agent_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
 onboarding_id UUID REFERENCES onboarding_responses(id) ON DELETE SET NULL,
 roles TEXT[] NOT NULL CHECK (cardinality(roles) BETWEEN 1 AND 8 AND array_position(roles, NULL) IS NULL),
 source_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(source_ids) <= 100 AND array_position(source_ids, NULL) IS NULL),
 task TEXT NOT NULL CHECK (length(task) BETWEEN 1 AND 4000),
 provider TEXT NOT NULL CHECK (provider IN ('claude','codex','openrouter')),
 requested_model TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','needs_review','failed','stopped','interrupted')),
 steps JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 8),
 error TEXT CHECK (length(error) <= 300),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_runs_client_created_idx ON agent_runs(client_id, created_at DESC);
CREATE INDEX agent_runs_status_idx ON agent_runs(status);
CREATE UNIQUE INDEX agent_runs_onboarding_idx ON agent_runs(onboarding_id) WHERE onboarding_id IS NOT NULL;

-- The current local queue permits only one active mission across the agency.
CREATE UNIQUE INDEX agent_runs_one_active_idx ON agent_runs((TRUE)) WHERE status IN ('queued','running');

-- Per-run ownership is checked on initial assignment/change. Historical references
-- may remain after a source is deleted; they are audit identifiers, not live access.
CREATE FUNCTION check_agent_run_scope() RETURNS TRIGGER AS $$
BEGIN
 IF NEW.campaign_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.campaigns WHERE id=NEW.campaign_id AND client_id=NEW.client_id
 ) THEN RAISE EXCEPTION 'Campaign outside client scope'; END IF;
 IF NEW.onboarding_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.onboarding_responses WHERE id=NEW.onboarding_id AND client_id=NEW.client_id
 ) THEN RAISE EXCEPTION 'Onboarding outside client scope'; END IF;
 IF EXISTS (
  SELECT 1 FROM unnest(NEW.source_ids) s(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.agent_sources a WHERE a.id=s.id AND (a.client_id IS NULL OR a.client_id=NEW.client_id))
 ) THEN RAISE EXCEPTION 'Source outside client scope'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER agent_run_scope BEFORE INSERT OR UPDATE OF client_id, campaign_id, onboarding_id, source_ids ON agent_runs
 FOR EACH ROW EXECUTE FUNCTION check_agent_run_scope();

ALTER TABLE ai_deliverables ALTER COLUMN content TYPE TEXT USING content::text;
ALTER TABLE ai_deliverables ADD COLUMN provider TEXT;
ALTER TABLE ai_deliverables ADD COLUMN model TEXT;
ALTER TABLE ai_deliverables ADD COLUMN requested_model TEXT;

-- Deliberate server-only access, including reads. No anon/authenticated grants or
-- policies: the application must authenticate an active agency administrator before
-- using its server credential. Clients cannot recruit agents or execute missions.
ALTER TABLE agency_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agency_agents, agent_sources, agent_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON agency_agents, agent_sources, agent_runs TO service_role;
REVOKE ALL ON FUNCTION check_agent_run_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_agent_run_scope() TO service_role;
COMMIT;
