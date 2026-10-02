-- Conservative starter access: writes go through the authenticated server routes.
-- Single agency per project. This is NOT a tenant-isolation layer for a SaaS.
BEGIN;
SET LOCAL search_path = public;
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles
 WHERE id = auth.uid() AND role = 'admin' AND is_active
 AND team_status = 'active');
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Lock all tables first. Service role is a SERVER-ONLY credential, bypassing RLS.
DO $$ DECLARE t RECORD; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t.tablename);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- Authenticated users read their profile to resolve their UI role. No self update:
-- a client cannot turn itself into an administrator or reassign its manager.
DO $$ DECLARE safe_columns TEXT; BEGIN
 SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO safe_columns
 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles'
 AND column_name NOT IN ('gemini_api_key','meta_access_token');
 EXECUTE 'GRANT SELECT (' || safe_columns || ') ON profiles TO authenticated';
END $$;
CREATE POLICY starter_profile_read ON profiles FOR SELECT TO authenticated
 USING (id = auth.uid() OR is_admin());

-- Rows owned by clients are readable only by their owner and active agency admins.
-- No browser writes: server routes must verify user ownership before service_role.
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'onboarding_responses','campaigns','leads','client_notes','client_tasks',
 'client_calls','client_notifications','client_finance_profiles',
 'client_credits','credit_usage','pipeline_stages','lead_activities',
 'client_formation_access','client_formation_progress',
 'sequence_conversations','sequence_emails','linkedin_conversations','linkedin_posts',
 'reels_conversations','reels_scripts','sales_call_analyses','cold_call_scripts',
 'scrape_jobs','client_surprises','surprise_assets','scheduled_posts'
 ] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY starter_read ON public.%I FOR SELECT TO authenticated USING (client_id = auth.uid() OR is_admin())',t);
 END LOOP;
END $$;

-- Internal operational tables never readable by a client.
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'activity_logs','ai_deliverables','app_settings','campaign_team_members',
 'team_member_client_rates','team_notifications','finance_entries',
 'crm_leads','crm_ad_spend_daily','post_publish_attempts'
 ] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY starter_admin_read ON public.%I FOR SELECT TO authenticated USING (is_admin())',t);
 END LOOP;
END $$;
GRANT SELECT ON formations, formation_modules, team_resources, team_resource_assignments TO authenticated;
CREATE POLICY starter_formation_read ON formations FOR SELECT TO authenticated USING (
 is_admin() OR (is_published AND EXISTS (SELECT 1 FROM client_formation_access a WHERE a.formation_id = formations.id AND a.client_id = auth.uid()))
);
CREATE POLICY starter_module_read ON formation_modules FOR SELECT TO authenticated USING (
 is_admin() OR (is_published AND EXISTS (SELECT 1 FROM formations f JOIN client_formation_access a ON a.formation_id=f.id WHERE f.id=formation_modules.formation_id AND f.is_published AND a.client_id=auth.uid()))
);
CREATE POLICY starter_assignment_read ON team_resource_assignments FOR SELECT TO authenticated USING (is_admin() OR team_member_id=auth.uid());
CREATE POLICY starter_resource_read ON team_resources FOR SELECT TO authenticated USING (
 is_admin() OR (is_published AND EXISTS (SELECT 1 FROM team_resource_assignments a WHERE a.resource_id=team_resources.id AND a.team_member_id=auth.uid()))
);

-- No browser grants/policies on meta_tokens, meta_connections, linkedin_connections,
-- client_external_api_keys, integration_api_keys, integration_webhook_logs.
-- Ciphertexts, hashes, raw webhook payloads and legacy tokens remain server-only.
-- No public onboarding INSERT. Public forms must use validated/rate-limited API routes.
-- No automatic storage buckets, webhooks, subscriptions or jobs are provisioned.
COMMIT;
