import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalClient, localTransaction, LOCAL_ADMIN_ID } from "../src/lib/starter-local-store";
import { handleLocalApi, handleLocalQuery } from "../src/lib/starter-local-api";

async function fixture(t: any) { const dataDir = await mkdtemp(join(tmpdir(), "leadfactory-local-test-")); t.after(() => rm(dataDir, { recursive: true, force: true })); return { dataDir }; }
function request(path: string, method: string, data?: any) { return new Request(`http://localhost:3000${path}`, { method, ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) }); }
async function api(options: any, path: string, method: string, data?: any) { const res = await handleLocalApi(request(path, method, data), path.split("?")[0], options); return { status: res.status, body: await res.json(), headers: res.headers }; }

test("starts with one fictional local operator and zero customer rows", async t => {
  const options = await fixture(t), client = createLocalClient(options);
  const admin = await client.from("profiles").select("id,email,role").single();
  assert.equal(admin.data.id, LOCAL_ADMIN_ID); assert.equal(admin.data.email, "owner@example.invalid");
  assert.equal((await client.from("campaigns").select("*", { count: "exact" })).count, 0);
  assert.equal((await client.auth.getSession()).data.session.provider, "local-starter");
});

test("parallel mutations persist atomically; reopened client sees data and other directory stays isolated", async t => {
  const options = await fixture(t), other = await fixture(t), client = createLocalClient(options);
  await Promise.all(Array.from({ length: 20 }, (_, i) => client.from("client_notes").insert({ client_id: "fixture", content: `note ${i}` })));
  assert.equal((await createLocalClient(options).from("client_notes").select("*")).data.length, 20);
  assert.equal((await createLocalClient(other).from("client_notes").select("*")).data.length, 0);
  assert.equal((await stat(join(options.dataDir, "db.json"))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(options.dataDir, "db.json"), "utf8")).version, 1);
});

test("client creation is local; onboarding atomically links brief, campaign and client without secrets", async t => {
  const options = await fixture(t);
  const res = await api(options, "/api/onboarding/submit", "POST", { responses: { a_entreprise: "Example Company", i_email: "contact@example.invalid", i_password: "NEVER_PERSIST", i_password_confirm: "NEVER_PERSIST", g_budget: "1250", b_objectif: ["leads"] } });
  assert.equal(res.status, 200); assert.equal(res.body.local_only, true); assert.equal(res.body.automation, "disconnected"); assert.equal(res.body.credentials, undefined);
  const db = await localTransaction(db => db, options, false);
  assert.equal(db.tables.onboarding_responses[0].client_id, res.body.client_id);
  assert.equal(db.tables.campaigns[0].budget_monthly, 1250); assert.equal(db.tables.client_tasks.length, 3);
  assert.ok(!JSON.stringify(db).includes("NEVER_PERSIST")); assert.ok(!JSON.stringify(db).includes("password"));
});

test("query relations, projection, filters, ranges and exact count match original screens", async t => {
  const options = await fixture(t), client = createLocalClient(options);
  const created = await api(options, "/api/admin/create-client", "POST", { full_name: "Example Owner", company: "Example Brand", email: "owner2@example.invalid", ad_account_id: "act_123" });
  assert.equal(created.status, 200);
  const result = await client.from("campaigns").select("id,profiles:profiles!campaigns_client_id_fkey(full_name,company)", { count: "exact" }).eq("client_id", created.body.client_id).order("created_at", { ascending: false }).range(0, 0);
  assert.equal(result.count, 1); assert.deepEqual(result.data[0].profiles, { full_name: "Example Owner", company: "Example Brand" }); assert.equal(result.data[0].client_id, undefined);
  const inverse = await client.from("profiles").select("id,campaigns(id,name)").eq("id", created.body.client_id).single(); assert.equal(inverse.data.campaigns.length, 1);
  assert.equal((await client.from("profiles").select("id").or(`role.eq.client,id.in.(${LOCAL_ADMIN_ID})`)).data.length, 2);
});

test("team assignments and rates update together; invalid campaign leaves previous assignments intact", async t => {
  const options = await fixture(t);
  const created = await api(options, "/api/admin/create-client", "POST", { full_name: "Fixture Client", ad_account_id: "123" });
  const member = await api(options, "/api/admin/team-members", "POST", { full_name: "Fixture Buyer", email: "buyer@example.invalid", password: "DISCARDED", team_role: "media_buyer" });
  assert.equal(member.status, 200);
  const payload = { full_name: "Fixture Buyer", team_role: "media_buyer", team_status: "active", assigned_campaign_ids: [created.body.campaign_id], client_rates: [{ client_id: created.body.client_id, monthly_rate: 450 }] };
  const path = `/api/admin/team-members/${member.body.member.id}`;
  assert.equal((await api(options, path, "PUT", payload)).status, 200);
  assert.equal((await api(options, path, "PUT", { ...payload, assigned_campaign_ids: ["missing"] })).status, 400);
  const db = await localTransaction(db => db, options, false);
  assert.equal(db.tables.campaign_team_members[0].campaign_id, created.body.campaign_id); assert.equal(db.tables.team_member_client_rates[0].monthly_rate, 450);
  assert.ok(!JSON.stringify(db).includes("DISCARDED"));
});

test("secrets, arbitrary methods/tables, broad deletes and local operator mutations are refused", async t => {
  const options = await fixture(t), client = createLocalClient(options);
  assert.ok((await client.from("profiles").insert({ full_name: "x", metadata: { api_key: "NO" } })).error);
  assert.ok((await client.from("meta_tokens").select("*")).error);
  assert.ok((await client.from("profiles").delete()).error);
  assert.ok((await client.from("profiles").update({ email: "bad" }).eq("id", LOCAL_ADMIN_ID)).error);
  const bridge = await handleLocalQuery(request("/api/starter/local-query", "POST", { table: "profiles", operations: [["eval", ["danger"]]] }), options); assert.equal(bridge.status, 400);
  const foreign = await handleLocalQuery(new Request("http://localhost:3000/api/starter/local-query", { method: "POST", headers: { origin: "https://foreign.example", "Content-Type": "application/json" }, body: "{}" }), options); assert.equal(foreign.status, 400);
});

test("unsupported integrations fail explicitly instead of inventing sent or configured results", async t => {
  const options = await fixture(t);
  for (const path of ["/api/admin/save-meta-token", "/api/admin/send-status-update", "/api/admin/generate-ai-assets", "/api/linkedin/auth/start"]) {
    const result = await api(options, path, "POST", {}); assert.equal(result.status, 501); assert.equal(result.body.code, "STARTER_DISCONNECTED"); assert.equal(result.body.success, undefined);
  }
});

test("upsert, update, delete and maybeSingle follow persisted query semantics", async t => {
  const options = await fixture(t), client = createLocalClient(options);
  assert.equal((await client.from("client_notes").select("*").maybeSingle()).data, null);
  const note = await client.from("client_notes").insert({ id: "fixture-note", content: "first" }).select().single(); assert.equal(note.error, null);
  await client.from("client_notes").upsert({ id: "fixture-note", content: "second" }, { onConflict: "id" });
  assert.equal((await client.from("client_notes").select("*").single()).data.content, "second");
  await client.from("client_notes").update({ content: "third" }).eq("id", "fixture-note");
  assert.equal((await client.from("client_notes").select("*").single()).data.content, "third");
  await client.from("client_notes").delete().eq("id", "fixture-note"); assert.deepEqual((await client.from("client_notes").select()).data, []);
});

test("team resources sanitize content and assignments reject unknown members atomically", async t => {
  const options = await fixture(t);
  const created = await api(options, "/api/admin/team-resources", "POST", { title: "Test SOP", kind: "sop", body_html: '<img src=x onerror="alert(1)"><p>Brief & review</p>' });
  assert.equal(created.status, 200); assert.equal(created.body.resource.body_html, "<p>Brief &amp; review</p>");
  const id = created.body.resource.id;
  assert.equal((await api(options, "/api/admin/team-resources/assign", "POST", { resource_id: id, member_ids: [LOCAL_ADMIN_ID] })).status, 200);
  assert.equal((await api(options, "/api/admin/team-resources/assign", "POST", { resource_id: id, member_ids: ["missing"] })).status, 400);
  assert.equal((await api(options, "/api/team/resources", "GET")).body.resources.length, 1);
  assert.equal((await api(options, "/api/admin/team-resources", "PATCH", { id, title: "Revised SOP" })).body.resource.title, "Revised SOP");
  assert.equal((await api(options, `/api/admin/team-resources?id=${id}`, "DELETE")).status, 200);
  assert.equal((await localTransaction(db => db.tables.team_resource_assignments.length, options, false)), 0);
});

test("client preview and notes use validated local client and never send messages", async t => {
  const options = await fixture(t);
  const created = await api(options, "/api/admin/create-client", "POST", { full_name: "Client notes", ad_account_id: "123" });
  const note = await api(options, "/api/admin/client-notes", "POST", { campaign_id: created.body.campaign_id, client_id: created.body.client_id, content: "Local progress note" });
  assert.equal(note.body.email_sent, false);
  const preview = await api(options, "/api/admin/preview-client", "POST", { client_id: created.body.client_id });
  assert.equal(preview.status, 200); assert.match(preview.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  const res = await handleLocalApi(new Request("http://localhost:3000/api/client/notes", { headers: { cookie: preview.headers.get("set-cookie")!.split(";")[0] } }), undefined, options);
  assert.equal((await res.json()).notes.length, 1);
  assert.equal((await api(options, "/api/admin/preview-client", "POST", { client_id: "missing" })).status, 400);
});

test("proposal and creative editors persist their original prefixed fields; deliverables never read paths", async t => {
  const options = await fixture(t), client = createLocalClient(options);
  const created = await api(options, "/api/admin/create-client", "POST", { full_name: "Proposal client", ad_account_id: "123" });
  for (const [path, field, legacy, prefix] of [["campaign-proposal", "proposal_markdown", "ai_vsl_prompt", "PROPOSAL_JSON:"], ["creative-brief", "creative_brief", "ai_static_prompt", "CREATIVE_BRIEF_JSON:"]]) {
    const content = JSON.stringify({ briefHtml: "<p>Draft</p>", campaigns: [] });
    assert.equal((await api(options, `/api/admin/${path}`, "PATCH", { campaign_id: created.body.campaign_id, [field]: content })).status, 200);
    assert.equal((await api(options, `/api/admin/${path}?campaign_id=${created.body.campaign_id}`, "GET")).body.campaign[field], content);
    assert.equal((await client.from("campaigns").select().single()).data[legacy], prefix + content);
  }
  await client.from("ai_deliverables").insert({ id: "text-deliverable", client_id: created.body.client_id, deliverable_name: "Proposition", content: "Local proposal", relative_path: "/etc/passwd" });
  await client.from("ai_deliverables").insert({ id: "path-only", client_id: created.body.client_id, relative_path: "/etc/passwd" });
  const list = await api(options, `/api/admin/ai-deliverables?client_id=${created.body.client_id}`, "GET"); assert.equal(list.body.deliverables.length, 2); assert.equal(list.body.deliverables[0].content, undefined);
  const download = await handleLocalApi(request("/api/admin/ai-deliverables/download?id=text-deliverable", "GET"), undefined, options); assert.equal(await download.text(), "Local proposal");
  assert.equal((await api(options, "/api/admin/ai-deliverables/download?id=path-only", "GET")).status, 404);
});


test("CRM metrics support native single and derive values from local rows", async t => {
  const options = await fixture(t), client=createLocalClient(options);
  const empty=await client.rpc('get_crm_metrics',{}).single();assert.equal(empty.error,null);assert.equal(empty.data.lead_count,0);assert.equal(empty.data.show_rate,null);
  await localTransaction(db=>{db.tables.crm_leads.push({id:'a',status:'won',call_start_time:'2026-10-01',created_at:'2026-10-01'},{id:'b',status:'no_show',call_start_time:'2026-10-01',created_at:'2026-10-01'},{id:'c',status:'new_discovery',created_at:'2026-10-01'});db.tables.crm_ad_spend_daily.push({spend:300,meta_reported_leads:4,spend_date:'2026-10-01'});},options);
  const result=await client.rpc('get_crm_metrics',{}).single();assert.equal(result.data.lead_count,3);assert.equal(result.data.cost_per_lead,100);assert.equal(result.data.show_rate,50);assert.equal(result.data.sales_conversion_rate,100);
  assert.ok((await client.rpc('unknown',{}).single()).error);
});
