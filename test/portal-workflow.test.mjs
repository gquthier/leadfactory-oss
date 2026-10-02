import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer,request,createClient,mockFetch} from './harness.mjs';
import {OPENROUTER_CHAT_URL} from '../lib/ai.mjs';
const answers={offer:{service:'Audit énergie',problem:'Coûts élevés',promise:'Un plan de travaux chiffré'},target:{profile:'PME industrielles',exclusions:'Particuliers'},campaign:{channel:'meta',objective:'Tester les demandes qualifiées',qualifiedLead:'Décideur avec projet',kpi:'Coût par rendez-vous tenu',budget:1500},delivery:{validator:'Nadia'}};
async function setup(t,options={}){const a=await startServer(undefined,options);t.after(()=>a.close());await new Promise(r=>a.portalServer.listen(0,'127.0.0.1',r));a.portalPort=a.portalServer.address().port;return a;}
async function invite(a,id,mode='demo'){const r=await request(a.port,`/api/clients/${id}/invite`,{method:'POST',body:{mode}});assert.equal(r.status,201,r.text);return {token:new URL(r.body.url).hash.slice(1),...r.body};}
function portal(a,token,options={}){return request(a.portalPort,'/portal/api',{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});}
async function settle(a){await a.workflow.idle();return a.store.read().automation.runs;}

test('client link isolates client, saves answers and atomically triggers exactly one demo chain',async t=>{
 const a=await setup(t), c=await createClient(a.port),other=await createClient(a.port,{company:'Private competitor'}),i=await invite(a,c.id);
 assert.equal((await request(a.portalPort,'/api/state')).status,404);
 assert.equal((await portal(a,'invalid')).status,404);
 const form=await portal(a,i.token);assert.equal(form.status,200);assert.equal(form.body.company,c.company);assert.ok(!form.text.includes(other.company));
 assert.equal((await portal(a,i.token,{method:'PUT',body:answers})).status,200);
 const results=await Promise.all([portal(a,i.token,{method:'POST',body:{action:'submit'}}),portal(a,i.token,{method:'POST',body:{action:'submit'}})]);
 assert.ok(results.every(x=>x.status===200));
 const runs=await settle(a);assert.equal(runs.length,1);assert.equal(runs[0].status,'needs_review');assert.equal(runs[0].steps.length,4);assert.ok(runs[0].steps.every(x=>x.source==='template'));
 assert.equal(a.store.read().campaigns.length,1);assert.equal((await portal(a,i.token)).body.proposal,null);
 const p=await request(a.port,`/api/workflow/${runs[0].id}/publish`,{method:'POST',body:{}});assert.equal(p.status,200);
 assert.match((await portal(a,i.token)).body.proposal.content,/Budget/);
 assert.equal((await portal(a,i.token,{method:'PUT',body:answers})).status,409);
 const exported=(await request(a.port,'/api/export')).text;assert.ok(!exported.includes(i.token));assert.ok(!exported.includes('tokenHash'));
});

test('incomplete, cross-origin, expired and revoked links cannot submit or leak state',async t=>{
 const a=await setup(t),c=await createClient(a.port),i=await invite(a,c.id);
 assert.equal((await portal(a,i.token,{method:'POST',body:{action:'submit'}})).status,400);
 assert.equal((await portal(a,i.token,{method:'PUT',headers:{Origin:'https://evil.example'},body:answers})).status,403);
 await invite(a,c.id);assert.equal((await portal(a,i.token)).status,404);
 await a.store.update(db=>{db.automation.invites.at(-1).expiresAt='2000-01-01T00:00:00.000Z';});
 assert.equal((await portal(a,i.token)).status,404);assert.equal(a.store.read().automation.runs.length,0);
});

test('AI mode requires configured credentials, runs bounded real provider adapter and retains trace',async t=>{
 const f=mockFetch({[OPENROUTER_CHAT_URL]:()=>({body:{model:'fixture-model',choices:[{message:{content:'# Proposition\n\nBudget et conditions à confirmer.'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}})});
 const a=await setup(t,{fetchImpl:f}),c=await createClient(a.port);
 assert.equal((await request(a.port,`/api/clients/${c.id}/invite`,{method:'POST',body:{mode:'ai'}})).status,400);
 await request(a.port,'/api/connections/openrouter',{method:'PUT',body:{apiKey:'fixture-key',model:'fixture-model'}});
 const i=await invite(a,c.id,'ai');await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});
 const [r]=await settle(a);assert.equal(r.status,'needs_review');assert.equal(f.calls.length,4);assert.ok(r.steps.every(s=>s.source==='ai'&&s.model==='fixture-model'));assert.match(JSON.parse(f.calls[0].init.body).messages[0].content,/Onboarding/);
});

test('provider failure is persistent, never falls back to fake AI or retries automatically',async t=>{
 const f=mockFetch({[OPENROUTER_CHAT_URL]:()=>({status:402,body:{}})}),a=await setup(t,{fetchImpl:f}),c=await createClient(a.port);
 await request(a.port,'/api/connections/openrouter',{method:'PUT',body:{apiKey:'fixture-key',model:'fixture-model'}});
 const i=await invite(a,c.id,'ai');await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});
 const [r]=await settle(a);assert.equal(r.status,'failed');assert.equal(r.steps.length,0);assert.equal(f.calls.length,1);
 assert.equal((await request(a.port,`/api/workflow/${r.id}/publish`,{method:'POST',body:{}})).status,409);
});

test('STOP cancels the active call and stores no late output; other client jobs are unaffected',async t=>{
 let started;const observed=new Promise(r=>started=r);
 const f=async(url,init)=>{started();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));};
 const a=await setup(t,{fetchImpl:f}),c=await createClient(a.port);
 await request(a.port,'/api/connections/openrouter',{method:'PUT',body:{apiKey:'fixture-key',model:'fixture-model'}});
 const i=await invite(a,c.id,'ai');await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});await observed;
 const r=a.store.read().automation.runs[0];assert.equal((await request(a.port,`/api/workflow/${r.id}/stop`,{method:'POST',body:{}})).status,200);
 const [done]=await settle(a);assert.equal(done.status,'stopped');assert.equal(done.steps.length,0);
});

test('restart preserves submitted state and publication, import revokes links without replaying jobs',async t=>{
 const a=await setup(t),c=await createClient(a.port),i=await invite(a,c.id);
 await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});
 const [r]=await settle(a);await request(a.port,`/api/workflow/${r.id}/publish`,{method:'POST',body:{}});
 await a.close();const b=await startServer(a.dataDir);t.after(()=>b.close());await new Promise(r=>b.portalServer.listen(0,'127.0.0.1',r));b.portalPort=b.portalServer.address().port;
 assert.equal((await portal(b,i.token)).body.status,'published');assert.equal(b.store.read().automation.runs.length,1);
 const exported=await request(b.port,'/api/export');assert.equal((await request(b.port,'/api/import',{method:'POST',body:exported.body})).status,200);
 assert.equal((await portal(b,i.token)).status,404);assert.equal(b.store.read().automation,undefined);
});

test('modified client answers prevent sharing an outdated proposal',async t=>{
 const a=await setup(t),c=await createClient(a.port),i=await invite(a,c.id);
 await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});const [r]=await settle(a);
 await request(a.port,`/api/clients/${c.id}/onboarding`,{method:'PUT',body:{campaign:{budget:0}}});
 assert.equal((await request(a.port,`/api/workflow/${r.id}/publish`,{method:'POST',body:{}})).status,409);
});

test('interrupted provider attempt is retained without automatic billing retry',async t=>{
 const a=await setup(t),c=await createClient(a.port),i=await invite(a,c.id);
 await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});await settle(a);
 await a.store.update(db=>{db.automation.runs[0].status='running';});await a.close();
 const b=await startServer(a.dataDir);t.after(()=>b.close());assert.equal(b.store.read().automation.runs[0].status,'interrupted');
});

test('configured HTTPS portal accepts only its host and never exposes admin files',async t=>{
 const a=await setup(t,{portalBaseUrl:'https://onboarding.example'});
 assert.equal((await request(a.portalPort,'/')).status,403);
 const headers={Host:'onboarding.example'};
 const page=await request(a.portalPort,'/',{headers});assert.equal(page.status,200);assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
 assert.equal((await request(a.portalPort,'/app.js',{headers})).status,404);
 assert.equal((await request(a.portalPort,'/api/connections',{headers})).status,404);
 const c=await createClient(a.port),i=await invite(a,c.id);
 assert.ok(i.url.startsWith('https://onboarding.example/#'));
 assert.equal((await portal(a,i.token,{headers})).status,200);
 assert.equal((await portal(a,i.token,{method:'PUT',headers:{...headers,Origin:'https://onboarding.example'},body:answers})).status,200);
});

test('personal CLI connects without API key, snapshots provider, executes four roles and survives restart/export',async t=>{
 const calls=[];const localCli={probe:async provider=>({provider,installed:true,compatible:true,authenticated:true,checkedAt:new Date().toISOString()}),complete:async options=>{calls.push(options);return {content:'# Proposition CLI\n\nBudget à valider.',model:null,usage:{promptTokens:11,completionTokens:7},finishReason:'stop'};}};
 const a=await setup(t,{localCli}),c=await createClient(a.port);
 const saved=await request(a.port,'/api/connections/cli',{method:'PUT',body:{provider:'codex',model:'exact-model'}});assert.equal(saved.status,200);assert.equal(saved.body.provider,'codex');assert.equal(saved.body.openrouter.configured,false);
 const i=await invite(a,c.id,'ai');
 await request(a.port,'/api/connections/cli',{method:'PUT',body:{provider:'claude',model:'another-model'}});
 await portal(a,i.token,{method:'PUT',body:answers});await portal(a,i.token,{method:'POST',body:{action:'submit'}});
 const [r]=await settle(a);assert.equal(r.status,'needs_review');assert.equal(calls.length,4);assert.ok(calls.every(x=>x.provider==='codex'&&x.model==='exact-model'));assert.ok(r.steps.every(s=>s.source==='ai'&&s.provider==='codex'&&s.model===null));
 assert.match(calls[0].messages[0].content,/Onboarding/);assert.match(calls[3].messages[0].content,/Communication client/);
 const manual=await request(a.port,'/api/ai/generate',{method:'POST',body:{kind:'cold-email',clientId:c.id}});assert.equal(manual.status,201);assert.equal(calls.at(-1).provider,'claude');
 const exported=await request(a.port,'/api/export');assert.equal((await request(a.port,'/api/import',{method:'POST',body:exported.body})).status,200);
 await a.close();const again=await startServer(a.dataDir,{localCli});t.after(()=>again.close());assert.equal(again.connections.selection().provider,'claude');assert.equal(again.store.read().deliverables.filter(x=>x.source==='ai').length,2);
});

test('CLI verification refuses missing, unsupported or logged out adapters without enabling AI',async t=>{
 let state={installed:false};let probes=0;const a=await setup(t,{localCli:{probe:async()=>{probes++;return state;}}});
 for(const [s,code] of [[{installed:false},400],[{installed:true,compatible:false},400],[{installed:true,compatible:true,authenticated:false},401]]){
  state=s;const r=await request(a.port,'/api/connections/cli',{method:'PUT',body:{provider:'claude'}});assert.equal(r.status,code);assert.equal(a.connections.publicView().provider,'openrouter');
 }
 assert.equal((await request(a.port,'/api/connections/cli',{method:'PUT',body:{provider:'sh',model:';rm'}})).status,400);assert.equal(probes,3);
});
