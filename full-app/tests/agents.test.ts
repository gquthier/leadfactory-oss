import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// One process, one temporary cwd before importing modules that capture their roots.
// Never points at the developer's .local-data or invokes a real provider.
test("agent orchestration and connections with isolated local state and mocked CLI", async t => {
  const previousCwd = process.cwd();
  const fixture = await mkdtemp(join(tmpdir(), "leadfactory-agent-review-"));
  const cwd = join(fixture, "full-app"); await mkdir(cwd);
  const pack = fileURLToPath(new URL("../../", import.meta.url));
  await symlink(join(pack, "agents"), join(fixture, "agents"));
  await symlink(join(pack, "skills"), join(fixture, "skills"));
  process.chdir(cwd);
  const { starterConnections, createStarterConnections } = await import("../src/lib/starter-connections");
  const agents = await import("../src/lib/starter-agents");
  const { localTransaction } = await import("../src/lib/starter-local-store");
  const { handleLocalApi } = await import("../src/lib/starter-local-api");
  const originalProbe = starterConnections.cli.probe, originalComplete = starterConnections.cli.complete;
  t.after(async () => { starterConnections.cli.probe = originalProbe; starterConnections.cli.complete = originalComplete; process.chdir(previousCwd); await rm(fixture, { recursive: true, force: true }); });
  const calls: any[] = [];
  starterConnections.cli.probe = async () => ({ installed: true, compatible: true, authenticated: true });
  let completion: (args: any) => Promise<any> = async () => ({ content: "Proposition fixture, hypothèses à valider.", finishReason: "stop", model: "fixture-model", usage: { promptTokens: 20, completionTokens: 10 } });
  starterConnections.cli.complete = async (args: any) => { calls.push(args); return completion(args); };
  await starterConnections.connectAI({ provider: "codex", automation: true });
  await localTransaction(db => {
    db.tables.profiles.push({ id: "client-a", full_name: "Fixture A", company: "ALPHA_ONLY", role: "client" }, { id: "client-b", full_name: "Fixture B", company: "BETA_PRIVATE", role: "client" });
    db.tables.campaigns.push({ id: "campaign-a-unrelated", client_id: "client-a", name: "Other Alpha campaign" }, { id: "campaign-a", client_id: "client-a", name: "Alpha" }, { id: "campaign-b", client_id: "client-b", name: "Beta" });
    db.tables.onboarding_responses.push({ id: "brief-a", client_id: "client-a", campaign_id: "campaign-a", responses: { product: "ALPHA_BRIEF" } }, { id: "brief-b", client_id: "client-b", campaign_id: "campaign-b", responses: { product: "BETA_BRIEF_PRIVATE" } });
  });
  async function eventually(check: () => Promise<any>, label: string) { for (let i = 0; i < 250; i++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error(`Timed out: ${label}`); }
  const ended = (id: string) => eventually(async () => (await agents.agentView()).jobs.find((j: any) => j.id === id && !["running", "queued"].includes(j.status)), id);
  const idle = () => eventually(async () => !(globalThis as any).__lfAgentRunning, "queue idle");

  await t.test("connection metadata hides secrets and CLI connection does not call network", async () => {
    let network = 0, probes = 0;
    const connections = createStarterConnections({ dir: join(fixture, "connections-only"), fetchImpl: (async () => { network++; return Response.json({ ok: true }); }) as typeof fetch, cli: { probe: async () => { probes++; return { installed: true, compatible: true, authenticated: true }; } } });
    await connections.save({ service: "slack", token: "FAKE_LOCAL_TEST_TOKEN" });
    await connections.connectAI({ provider: "codex", automation: true });
    assert.equal(network, 0); assert.equal(probes, 1);
    assert.ok(!JSON.stringify(await connections.view()).includes("FAKE_LOCAL_TEST_TOKEN"));
    assert.equal((await stat(join(fixture, "connections-only", "integrations.json"))).mode & 0o777, 0o600);
    await connections.test("slack"); assert.equal(network, 1); assert.equal((await connections.view()).slack.status, "verified");
    await connections.remove("slack"); assert.equal((await connections.view()).slack.configured, false);
  });

  await t.test("recruitment and source access are checked before queuing; client context stays isolated", async () => {
    await assert.rejects(agents.recruit("unknown"));
    await assert.rejects(agents.enqueue({ clientId: "client-a", role: "delivery" }), /Recruter/);
    await agents.recruit("delivery");
    await agents.addSource({ name: "Alpha source", clientId: "client-a", content: "ALPHA_SOURCE" });
    await agents.addSource({ name: "Beta source", clientId: "client-b", content: "BETA_SOURCE_PRIVATE" });
    const view = await agents.agentView(), sourceA = view.sources.find((s: any) => s.clientId === "client-a")!, sourceB = view.sources.find((s: any) => s.clientId === "client-b")!;
    await assert.rejects(agents.enqueue({ clientId: "client-a", role: "delivery", sourceIds: [sourceB.id] }), /périmètre/);
    const job = await agents.enqueue({ clientId: "client-a", role: "delivery", sourceIds: [sourceA.id], task: "Fixture delivery" });
    const result = await ended(job.id); await idle();
    assert.equal(result.status, "needs_review"); assert.equal(result.steps.length, 1); assert.equal(result.steps[0].model, "fixture-model");
    const sent = JSON.stringify(calls.at(-1).messages); assert.ok(sent.includes("ALPHA_SOURCE")); assert.ok(sent.includes("ALPHA_BRIEF")); assert.ok(!sent.includes("BETA_PRIVATE")); assert.ok(!sent.includes("BETA_BRIEF_PRIVATE")); assert.ok(!sent.includes("BETA_SOURCE_PRIVATE"));
    assert.equal(JSON.parse(await readFile(join(cwd, ".local-data", "agents.json"), "utf8")).jobs.at(-1).status, "needs_review");
  });

  await t.test("STOP aborts in-flight work and no generated step or campaign is committed", async () => {
    let entered = false, aborted = false;
    const normal = completion;
    completion = async ({ signal }) => { entered = true; return new Promise((_, reject) => { const abort = () => { aborted = true; reject(new Error("Fixture aborted")); }; if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }); };
    const job = await agents.enqueue({ clientId: "client-a", role: "delivery" });
    await eventually(async () => entered, "CLI called"); await agents.stopJob(job.id); const result = await ended(job.id); await idle();
    completion = normal;
    assert.equal(result.status, "stopped"); assert.equal(aborted, true); assert.equal(result.steps.length, 0);
  });

  await t.test("native onboarding result triggers four roles once and writes the native proposal field", async () => {
    const req = new Request("http://localhost:3000/api/onboarding/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responses: { a_entreprise: "Fixture Signup", i_email: "signup@example.invalid", g_budget: "500" } }) });
    const response = await handleLocalApi(req), result = await response.json(); assert.equal(response.status, 200);
    const before = calls.length;
    const job = await agents.autoOnboarding(result); assert.ok(job, "Native local API onboardingId must trigger automation");
    const finished = await ended(job.id); await idle(); assert.equal(finished.status, "needs_review"); assert.deepEqual(finished.steps.map((step: any) => step.role), ["onboarding", "creative-strategist", "media-buyer", "client-communication"]);
    const repeated = await agents.autoOnboarding(result); await idle(); assert.equal(repeated?.id, job.id); assert.equal(calls.length - before, 4);
    const campaign = await localTransaction(db => db.tables.campaigns.find(c => c.id === result.campaign_id), {}, false);
    assert.ok(campaign?.ai_vsl_prompt?.startsWith("PROPOSAL_JSON:"), "Native campaign editor reads ai_vsl_prompt prefix");
  });

  await t.test("a brief cannot be attached to another client or fabricated", async () => {
    for (const onboardingId of ["brief-b", "fabricated"]) {
      let created: any, error: unknown;
      try { created = await agents.enqueue({ clientId: "client-a", onboardingId }); } catch (err) { error = err; }
      if (created) { await agents.stopJob(created.id).catch(() => {}); await idle(); }
      assert.ok(error instanceof Error && /brief|onboarding|client|périmètre/i.test(error.message), `Must reject ${onboardingId}`);
    }
  });

  await t.test("explicit valid brief runs four persisted steps and repeat is idempotent", async () => {
    const before = calls.length;
    const job = await agents.enqueue({ clientId: "client-a", onboardingId: "brief-a" });
    const finished = await ended(job.id); await idle();
    assert.equal(finished.status, "needs_review"); assert.equal(finished.steps.length, 4);
    assert.equal(finished.campaignId, "campaign-a", "Use the campaign bound to this brief, not another campaign of the same client");
    const same = await agents.enqueue({ clientId: "client-a", onboardingId: "brief-a" }); await idle();
    assert.equal(same.id, job.id); assert.equal(calls.length - before, 4);
    const campaign = await localTransaction(db => db.tables.campaigns.find(c => c.id === "campaign-a"), {}, false);
    assert.ok(campaign?.ai_vsl_prompt?.startsWith("PROPOSAL_JSON:"), "Native proposal editor compatibility");
  });

  await t.test("provider failures and truncated output never become successful deliverables", async () => {
    const normal = completion;
    completion = async () => ({ content: "unfinished", finishReason: "length" });
    const job = await agents.enqueue({ clientId: "client-a", role: "delivery" }); const result = await ended(job.id); await idle(); assert.equal(result.status, "failed"); assert.equal(result.steps.length, 0);
    completion = async () => { throw new Error("Fixture provider unavailable"); };
    const failure = await agents.enqueue({ clientId: "client-a", role: "delivery" }); assert.equal((await ended(failure.id)).status, "failed"); await idle(); completion = normal;
  });

  await t.test("recovery marks unfinished persisted jobs interrupted without replay", async () => {
    await idle();
    const file = join(cwd, ".local-data", "agents.json"), data = JSON.parse(await readFile(file, "utf8"));
    data.jobs.push({ id: "restart-fixture", status: "running", clientId: "client-a", roles: ["delivery"], steps: [] }); await writeFile(file, JSON.stringify(data));
    const before = calls.length; await agents.recoverJobs(); assert.equal((await agents.agentView()).jobs.find((j: any) => j.id === "restart-fixture")?.status, "interrupted"); assert.equal(calls.length, before);
  });
});
