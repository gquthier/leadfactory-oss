import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
// PGlite is test-only. Pass its absolute entrypoint or install it locally for validation.
const modulePath=process.env.PGLITE_MODULE;
const {PGlite}=await import(modulePath?pathToFileURL(modulePath).href:'@electric-sql/pglite');
const db=new PGlite();
const here=new URL('./',import.meta.url);
const authStub=`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, service_role;`;
await db.exec(authStub);
try {
 for(const file of ['001_schema.sql','002_source_alignment.sql','003_access.sql','004_starter_agents.sql']) {
  await db.exec(await fs.readFile(new URL(file,here),'utf8')); console.log(`PASS ${file}`);
 }
 const tables=(await db.query("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
 assert(tables.every(t=>t.rowsecurity));
 for(const t of tables)assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ${t.tablename}`)).rows[0].n,0);
 // Synthetic identities only, in memory; destroyed when this process exits.
 const a='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002';
 await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'client-a@example.invalid','{}'),($2,'client-b@example.invalid','{}')`,[a,b]);
 await db.query(`INSERT INTO campaigns(client_id,name) VALUES ($1,'Synthetic A'),($2,'Synthetic B')`,[a,b]);
 await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[a]);
 await db.exec('SET ROLE authenticated');
 assert.equal((await db.query('SELECT count(*)::int n FROM campaigns')).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM profiles')).rows[0].n,1);
 const forbidden=["UPDATE profiles SET role='admin'",'SELECT gemini_api_key FROM profiles','SELECT meta_access_token FROM profiles','SELECT * FROM meta_tokens','SELECT * FROM meta_connections','SELECT * FROM linkedin_connections',"SELECT seed_default_pipeline_stages('00000000-0000-0000-0000-000000000002')",'UPDATE client_credits SET balance=10000','SELECT * FROM agency_agents','SELECT * FROM agent_sources','SELECT * FROM agent_runs',"INSERT INTO agency_agents(role_slug,is_recruited) VALUES ('ceo',true)"];
 for(const sql of forbidden)await assert.rejects(()=>db.exec(sql));
 await db.exec('RESET ROLE; SET ROLE anon');
 await assert.rejects(()=>db.exec('SELECT * FROM campaigns'));
 await assert.rejects(()=>db.exec("INSERT INTO onboarding_responses(responses) VALUES ('{}')"));
 await db.exec('RESET ROLE');
 const sourceId='00000000-0000-0000-0000-000000000010';
 await db.exec('SET ROLE service_role');
 await db.query(`INSERT INTO agent_sources(id,name,client_id,content) VALUES ($1,'Synthetic source',$2,'Sample context')`,[sourceId,a]);
 const runPayload=[a,sourceId];
 await db.query(`INSERT INTO agent_runs(client_id,roles,source_ids,task,provider) VALUES ($1,ARRAY['ceo'],ARRAY[$2::uuid],'Synthetic task','codex')`,runPayload);
 await assert.rejects(()=>db.query(`INSERT INTO agent_runs(client_id,roles,task,provider) VALUES ($1,ARRAY['ceo'],'Second concurrent task','codex')`,[a]));
 await db.exec("UPDATE agent_runs SET status='needs_review'");
 await assert.rejects(()=>db.query(`INSERT INTO agent_runs(client_id,roles,source_ids,task,provider) VALUES ($1,ARRAY['ceo'],ARRAY[$2::uuid],'Wrong source owner','codex')`,[b,sourceId]));
 await assert.rejects(()=>db.query(`INSERT INTO agent_runs(client_id,campaign_id,roles,task,provider) SELECT $1,id,ARRAY['ceo'],'Wrong campaign owner','codex' FROM campaigns WHERE client_id=$2`,[a,b]));
 await db.query(`INSERT INTO ai_deliverables(client_id,deliverable_type,deliverable_name,relative_path,content,provider,model,requested_model) VALUES ($1,'campaign_proposal','Synthetic proposal','synthetic/proposal.md','# Plain Markdown','codex','actual-test-model','requested-test-model')`,[a]);
 assert.equal((await db.query('SELECT content FROM ai_deliverables')).rows[0].content,'# Plain Markdown');
 await db.exec('RESET ROLE');
 const bundle=new PGlite();
 try {await bundle.exec(authStub);await bundle.exec(await fs.readFile(new URL('schema.sql',here),'utf8'));assert.equal((await bundle.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,tables.length);console.log('PASS schema.sql bundled transaction');} finally {await bundle.close();}
 const columns=(await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
 const report={testedAt:'2026-10-01',engine:'PGlite PostgreSQL in memory',tableCount:tables.length,columnCount:columns.length,allTablesRLS:true,emptyAfterBootstrap:true,checks:['DDL applied in order','all public tables empty before synthetic tests','client cannot see another client campaign/profile','client cannot promote itself','client cannot read credential tables','client cannot mint credits','client cannot call definer seed RPC','anonymous read and public insert denied','agent tables denied to non-server roles','single active SQL run enforced','cross-client source and campaign assignment denied','plain text deliverable and model receipt persisted','bundled schema.sql applied independently'],columns};
 await fs.writeFile(new URL('validation-report.json',here),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,columns:undefined}));
} finally {await db.close();}
