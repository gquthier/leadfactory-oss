// The LeadFactory agency pack inside a real harness: install through the
// generic installer, the shared cockpit in the bound vault, and the tools its
// agents get for one run and lose after.
//
// The CLI is a scripted driver (no model, no network beyond loopback), the
// cockpit is the kit's real `createApp` on an ephemeral port, and every
// state lives under a temporary root that is removed after each test.
//
// The installer itself — its journal, its crash points, its resume — is the
// catalogue's and is covered in `templates.test.ts`; what is proved here is
// what the PACK adds on top of it.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENCY_APP_DIR, AGENCY_TEMPLATE_FILE, AgencyService, LEGACY_AGENCY_DIRECTORY, legacyAgencyVaultPath, PackError } from "../src/harness/agency.js";
import { AGENCY_TOOL_SPECS, AGENCY_TOOLS_INSTRUCTIONS } from "../src/harness/agency-tools.js";
import { completeTemplateVault } from "../src/harness/company-os.js";
import { DEFAULT_KIT_ROOT, loadKit } from "../src/harness/pack-kit.js";
import { LEAD_GEN_AGENCY } from "../src/harness/template-lead-gen-agency.js";
import { buildPacks, dashboardSession, json, packHostOf, refused, toolsOf, type PackFixture, type PackFixtureOptions } from "./pack-fixture.js";

let root: string;
const cleanups: Array<() => Promise<void> | void> = [];

/** The pack's kit, as the service loads it. */
const kitOf = (kitRoot = DEFAULT_KIT_ROOT) => loadKit(kitRoot, AGENCY_TEMPLATE_FILE, "agency");

/** The managed vault the pack binds when nothing else is chosen. */
const vaultOf = (rootDir = root) => join(rootDir, "vaults", "lead-gen-agency");
const dataDirOf = (rootDir = root) => join(vaultOf(rootDir), ...AGENCY_APP_DIR.split("/"), "data");

function build(options: Partial<PackFixtureOptions> = {}): PackFixture {
  const built = buildPacks({ rootDir: root, ...options });
  cleanups.push(() => built.close());
  return built;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lbz-agency-"));
});

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  await rm(root, { recursive: true, force: true });
});

describe("the embedded kit", () => {
  it("loads the pack: six roles, twenty-three skills, safe paths", () => {
    const kit = kitOf();
    expect(kit.template).toMatchObject({ id: "lead-gen-agency", version: 1, name: "Lead Gen Agency" });
    expect(kit.template.bots.map((bot) => bot.slug)).toEqual([
      "agency-director", "acquisition", "onboarding", "strategist", "creative", "account-manager",
    ]);
    expect(kit.skills).toHaveLength(23);
    expect(kit.skills.find((skill) => skill.name === "creative-brief")).toEqual({
      name: "creative-brief",
      description: expect.stringContaining("brief créatif"),
      references: ["brief-format.md"],
    });
    expect(kit.template.notes.every((note) => !note.path.includes(".."))).toBe(true);
    // The skills travel with the template: they are seeded into the vault the
    // person binds, which is where the agents then read them.
    expect(kit.template.notes.map((note) => note.path)).toEqual(
      expect.arrayContaining(["skills/creative-brief/SKILL.md", "skills/creative-brief/references/brief-format.md"]),
    );
  });

  it("names every real tool in the instructions of every role", () => {
    for (const tool of AGENCY_TOOL_SPECS) expect(AGENCY_TOOLS_INSTRUCTIONS).toContain(tool.name);
    // No tool claims the human's review, no tool deletes, nothing generic.
    expect(AGENCY_TOOL_SPECS.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([expect.stringMatching(/review|delete|http|fetch/)]));
  });
});

describe("before the install", () => {
  it("reports not-installed with no dashboard, no bots, no vault and the kit's skill count", async () => {
    const { agency } = build();
    expect(await agency.status()).toEqual({
      installed: false,
      status: "not-installed",
      template: { id: "lead-gen-agency", name: "Lead Gen Agency", version: 1 },
      dashboardUrl: null,
      bots: [],
      groupId: null,
      skillsCount: 23,
      rootId: null,
      vaultPath: null,
      boundTemplateId: null,
    });
    expect(existsSync(join(root, "vaults"))).toBe(false);
    await expect(agency.open()).rejects.toMatchObject({ code: "not_installed", status: 409 });
  });

  it("answers an explicit error when the kit is not embedded", async () => {
    const empty = mkdtempSync(join(tmpdir(), "lbz-nokit-"));
    cleanups.push(() => rm(empty, { recursive: true, force: true }));
    const { agency } = build({ kitRoot: empty });
    expect(await agency.status()).toMatchObject({ installed: false, status: "error", error: expect.stringContaining("not embedded") });
    await expect(agency.install()).rejects.toMatchObject({ code: "kit_missing" });
  });

  it("names the template the workspace is bound to, and refuses to install a second one", async () => {
    const { agency, ecommerce } = build();
    await ecommerce.install();
    const state = await agency.status();
    expect(state).toMatchObject({ installed: false, status: "not-installed", boundTemplateId: "ecommerce", vaultPath: null, bots: [] });
    await expect(agency.install()).rejects.toMatchObject({ code: "exists" });
    await expect(agency.open()).rejects.toMatchObject({ code: "not_installed", status: 409 });
  });
});

describe("install", () => {
  it("creates the vault, six agents on their role folders, a team and one cockpit", async () => {
    const { harness, agency } = build();
    const state = await agency.install();
    expect(state).toMatchObject({
      installed: true,
      status: "ready",
      skillsCount: 23,
      rootId: "vault:lead-gen-agency",
      vaultPath: vaultOf(),
      boundTemplateId: null,
    });
    expect(state.dashboardUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(state.bots.map((bot) => bot.name)).toEqual([
      "Agency Director", "Acquisition", "Onboarding", "Strategist", "Creative", "Account Manager",
    ]);

    const vault = vaultOf();
    expect(readFileSync(join(vault, "AGENTS.md"), "utf8")).toContain("How this agency works");
    expect(existsSync(join(vault, "Processes", "Handoffs.md"))).toBe(true);
    const roster = await harness.bots.list();
    expect(roster).toHaveLength(6);
    for (const bot of roster) {
      expect(bot.workspacePath).toBe(join(vault, "Agents", bot.name));
      expect(existsSync(join(bot.workspacePath!, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(bot.workspacePath!, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(bot.workspacePath!, `${bot.name}.md`))).toBe(true);
      expect(bot.instructions).toContain("agency_clients");
      expect(bot.instructions).toContain("agency_read_skill");
    }
    // No Company OS was seeded for these agents: their folders are the pack's.
    expect(existsSync(join(root, "brain", "Agents"))).toBe(false);
    // The skills the agents read are the vault's own copy, not the kit's.
    expect(existsSync(join(vault, "skills", "creative-brief", "SKILL.md"))).toBe(true);

    const director = roster.find((bot) => bot.name === "Agency Director")!;
    expect(director.pinned).toBe(true);
    const chat = await harness.threads.get({ botId: director.id });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ role: "bot", botId: director.id, deliveryState: "complete" });

    const groups = await harness.groups.list();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds).toEqual(roster.map((bot) => bot.id));
    expect(state.groupId).toBe(groups[0]!.id);

    // The cockpit is hosted: bare HTTP gets nothing, a ticketed session reads the same state.
    expect((await json(`${state.dashboardUrl}/api/state`)).status).toBe(401);
    expect((await json(`${state.dashboardUrl}/api/meta`)).status).toBe(401);
    const session = await dashboardSession(agency);
    expect(session.url).toBe(state.dashboardUrl);
    const stateResponse = await json(`${state.dashboardUrl}/api/state`, {}, session.cookie);
    expect(stateResponse.status).toBe(200);
    expect(stateResponse.body).toMatchObject({ version: 1, clients: [] });
    expect((await json(`${state.dashboardUrl}/api/meta`, {}, session.cookie)).body).toMatchObject({ hostedBy: "bizos-local" });
    const page = await fetch(`${state.dashboardUrl}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    // A ticket is one-use, and `open()` mints a fresh one each time; the
    // plain state never carries one.
    const replay = await fetch(`${state.dashboardUrl}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: session.ticket }) });
    expect(replay.status).toBe(401);
    expect((await agency.open()).dashboardUrl).not.toContain(session.ticket);
    expect((await agency.status()).dashboardUrl).toBe(state.dashboardUrl);
    expect(JSON.stringify(await agency.status())).not.toContain("connect=");

    // The store is the vault's — the running cockpit holds its lock there —
    // and the person's brain is untouched by it.
    expect(existsSync(join(dataDirOf(), "db.lock"))).toBe(true);
    expect(readFileSync(join(vaultOf(), ...AGENCY_APP_DIR.split("/"), "README.md"), "utf8")).toContain("do not edit it by hand");
    expect((await harness.brain.roots()).map((brainRoot) => brainRoot.id)).toContain("vault:lead-gen-agency");
  });

  it("is idempotent: a second and a concurrent install answer the same team", async () => {
    const { harness, agency } = build();
    const [first, second] = await Promise.all([agency.install(), agency.install()]);
    expect(second.bots.map((bot) => bot.botId)).toEqual(first.bots.map((bot) => bot.botId));
    const third = await agency.install();
    expect(third.bots.map((bot) => bot.botId)).toEqual(first.bots.map((bot) => bot.botId));
    expect(await harness.bots.list()).toHaveLength(6);
    expect(await harness.groups.list()).toHaveLength(1);
    expect((await harness.threads.get({ botId: first.bots[0]!.botId })).messages).toHaveLength(1);
  });

  it("adopts an older agency installation when its vault is bound: its agents, its store, nothing duplicated", async () => {
    const { harness, agency } = build();
    // What version 0.2 left on this Mac: its own vault under `agency/`, its
    // agents already in the roster on their role folders, and its store.
    mkdirSync(legacyAgencyVaultPath(root), { recursive: true });
    const legacyVault = realpathSync(legacyAgencyVaultPath(root));
    completeTemplateVault(legacyVault, LEAD_GEN_AGENCY);
    writeFileSync(join(legacyVault, "Company.md"), "# My agency\n\nEdited by hand.\n");
    const before: Record<string, string> = {};
    for (const row of LEAD_GEN_AGENCY.bots) {
      const bot = await harness.bots.create({ name: row.name, workspacePath: join(legacyVault, "Agents", row.name) });
      before[row.slug] = bot.id;
    }
    const legacyData = join(root, LEGACY_AGENCY_DIRECTORY, "data");
    mkdirSync(legacyData, { recursive: true });
    writeFileSync(join(legacyData, "db.json"), JSON.stringify({
      version: 1,
      clients: [{ id: "legacy-client", company: "Atelier Ancien", status: "actif" }],
      campaigns: [], tasks: [], deliverables: [],
    }));

    const state = await agency.install("agency");
    expect(state).toMatchObject({ status: "ready", rootId: "agency", vaultPath: legacyVault });
    // The same six agents, adopted where they already work.
    expect(Object.fromEntries(state.bots.map((bot) => [bot.slug, bot.botId]))).toEqual(before);
    expect(await harness.bots.list()).toHaveLength(6);
    // The note the person rewrote is theirs, and the pack's own notes are whole.
    expect(readFileSync(join(legacyVault, "Company.md"), "utf8")).toBe("# My agency\n\nEdited by hand.\n");
    expect(existsSync(join(legacyVault, "Processes", "Handoffs.md"))).toBe(true);
    // The store moved into the vault, whole and once — never copied in two places.
    expect(existsSync(legacyData)).toBe(false);
    const { cookie, url } = await dashboardSession(agency);
    expect((await json(`${url}/api/clients`, {}, cookie)).body).toEqual([expect.objectContaining({ id: "legacy-client", company: "Atelier Ancien" })]);
    expect(existsSync(join(legacyVault, ...AGENCY_APP_DIR.split("/"), "data", "db.json"))).toBe(true);
    expect(existsSync(join(root, LEGACY_AGENCY_DIRECTORY, "data"))).toBe(false);
  });

  it("records a cockpit that cannot start, and lets the next install retry it", async () => {
    const built = build();
    await built.agency.install();
    // The cockpit cannot start when another live process holds the data lock.
    await built.agency.close();
    const dataDir = dataDirOf();
    writeFileSync(join(dataDir, "db.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const agency = new AgencyService({ host: packHostOf(built.harness) });
    cleanups.push(() => agency.close());
    await expect(agency.install()).rejects.toMatchObject({ code: "cockpit_error", message: expect.stringContaining("cockpit could not start") });
    const failed = await agency.status();
    expect(failed).toMatchObject({ status: "error", dashboardUrl: null });
    // The cockpit's own reason, kept as it was given: the lock it found.
    expect(failed.error).toContain("db.lock");
    // The agents the installer made are there; only the cockpit failed.
    expect(failed.bots).toHaveLength(6);
    await expect(agency.open()).rejects.toMatchObject({ code: "cockpit_error" });
    await rm(join(dataDir, "db.lock"));
    const state = await agency.install();
    expect(state.status).toBe("ready");
    expect(state.bots).toHaveLength(6);
    expect(state.dashboardUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe("restart and shutdown", () => {
  it("closes the port and releases the lock, then reopens the same store", async () => {
    const first = build();
    const installed = await first.agency.install();
    const session = await dashboardSession(first.agency);
    const created = await json(`${installed.dashboardUrl}/api/clients`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: "Atelier Nord" }),
    }, session.cookie);
    expect(created.status).toBe(201);
    await first.agency.close();
    await expect(fetch(`${installed.dashboardUrl}/api/state`)).rejects.toThrow();
    expect(existsSync(join(dataDirOf(), "db.lock"))).toBe(false);
    await first.agency.close();

    const second = new AgencyService({ host: packHostOf(first.harness) });
    cleanups.push(() => second.close());
    const state = await second.status();
    expect(state).toMatchObject({ installed: true, status: "ready", vaultPath: vaultOf() });
    expect(state.dashboardUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // The old session died with the old instance; a new ticket opens the new one.
    expect((await json(`${state.dashboardUrl}/api/clients`, {}, session.cookie)).status).toBe(401);
    const clients = await json(`${state.dashboardUrl}/api/clients`, {}, (await dashboardSession(second)).cookie);
    expect(clients.body).toEqual([expect.objectContaining({ company: "Atelier Nord" })]);
    expect(existsSync(join(dataDirOf(), "db.lock"))).toBe(true);
  });
});

describe("the agents' tools", () => {
  it("serve one run of a pack agent, share the dashboard's store, and refuse another client", async () => {
    const { harness, agency, turns } = build();
    const state = await agency.install();
    const url = state.dashboardUrl!;
    const { cookie } = await dashboardSession(agency);
    const acquisition = (await harness.bots.list()).find((bot) => bot.name === "Acquisition")!;
    const { runIds } = await harness.threads.send({ botId: acquisition.id }, { text: "Create the client" });
    const tools = toolsOf(turns[0]);
    expect(Object.keys(tools).sort()).toEqual(AGENCY_TOOL_SPECS.map((tool) => tool.name).sort());
    // Neither the capability nor anything secret is in the turn the CLI sees.
    expect(JSON.stringify(turns[0]!.mcpServers ?? {})).not.toContain("agency");

    const call = (name: string, args: unknown) =>
      tools[name]!.call(args, { callId: "c", threadId: `bot:${acquisition.id}`, turnId: "t" });

    // The agency profile, through the same PUT the dashboard uses.
    const profile = await call("agency_profile_update", { data: { name: "Nord Leads", language: "fr" } }) as { item: { name: string } };
    expect(profile.item.name).toBe("Nord Leads");
    expect(((await json(`${url}/api/agency`, {}, cookie)).body as { name: string }).name).toBe("Nord Leads");
    // The service's credential is nowhere an agent can see it.
    expect(JSON.stringify(profile)).not.toMatch(/[0-9a-f]{64}/);

    // Create through the tool, read through the dashboard.
    const created = await call("agency_clients", { action: "create", data: { company: "Atelier Nord", email: "contact@atelier-nord.example", budget: 1500 } }) as { id: string; item: Record<string, unknown> };
    expect(created.item).toMatchObject({ company: "Atelier Nord", status: "prospect", budget: 1500 });
    const listed = await json(`${url}/api/clients`, {}, cookie);
    expect(listed.body).toEqual([expect.objectContaining({ id: created.id, company: "Atelier Nord" })]);
    // The dossier the person reads in their vault is the record, mirrored.
    expect(readFileSync(join(vaultOf(), "Clients", created.id, "Dossier.md"), "utf8")).toContain("Atelier Nord");

    // Modify through the dashboard (the person's session), read through the tool.
    const patched = await json(`${url}/api/clients/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "actif", goal: "20 RDV par mois" }),
    }, cookie);
    expect(patched.status).toBe(200);
    const fetched = await call("agency_clients", { action: "get", clientId: created.id }) as { item: Record<string, unknown> };
    expect(fetched.item).toMatchObject({ status: "actif", goal: "20 RDV par mois" });

    // The cockpit's own validation stands, and unknown fields are refused.
    expect(await refused(call("agency_clients", { action: "update", clientId: created.id, data: { status: "vip" } }))).toContain("status");
    expect(await refused(call("agency_clients", { action: "update", clientId: created.id, data: { secret: "x" } }))).toContain("unknown field secret");
    expect(await refused(call("agency_clients", { action: "create", data: { contact: "no company" } }))).toContain("company");

    // The onboarding questionnaire: schema, save, submit — no review.
    const schema = await call("agency_onboarding", { action: "schema" }) as { steps: Array<{ key: string }>; requiredCount: number };
    expect(schema.steps.map((step) => step.key)).toEqual(["company", "offer", "target", "campaign", "delivery"]);
    const saved = await call("agency_onboarding", {
      action: "save",
      clientId: created.id,
      data: {
        offer: { service: "Menuiserie sur mesure", problem: "Délais", promise: "Devis sous 48h" },
        target: { profile: "Architectes d'intérieur", exclusions: "Particuliers" },
        campaign: { channel: "cold-email", objective: "RDV qualifiés", qualifiedLead: "Architecte avec projet", kpi: "RDV tenus", budget: 800 },
      },
    }) as { progress: { complete: boolean } };
    expect(saved.progress.complete).toBe(true);
    const submitted = await call("agency_onboarding", { action: "submit", clientId: created.id }) as {
      campaign: { id: string; clientId: string; status: string };
      brief: { id: string; type: string };
      tasks: { created: unknown[] };
    };
    expect(submitted.campaign).toMatchObject({ clientId: created.id, status: "draft" });
    expect(submitted.brief.type).toBe("brief");
    expect(submitted.tasks.created.length).toBeGreaterThan(0);
    expect(await refused(call("agency_onboarding", { action: "review", clientId: created.id }))).toContain("action must be one of");

    // Deliverables: written by the tool, visible in the dashboard, previewed in the dossier.
    const deliverable = await call("agency_deliverables", {
      action: "create",
      clientId: created.id,
      data: { type: "cold-email", title: "Séquence v1", content: "Bonjour,\n\n".repeat(60), campaignId: submitted.campaign.id, source: "ai", model: "local-test-model" },
    }) as { id: string; item: { source: string } };
    expect(deliverable.item.source).toBe("ai");
    const dashboardDeliverable = await json(`${url}/api/deliverables/${deliverable.id}`, {}, cookie);
    expect(dashboardDeliverable.body).toMatchObject({ clientId: created.id, title: "Séquence v1", model: "local-test-model" });
    const dossier = await call("agency_context", { clientId: created.id }) as { deliverables: Array<{ id: string; contentTruncated: boolean }>; campaigns: unknown[]; tasks: unknown[] };
    expect(dossier.deliverables.map((item) => item.id)).toContain(deliverable.id);
    expect(dossier.deliverables.find((item) => item.id === deliverable.id)!.contentTruncated).toBe(true);
    expect(dossier.campaigns).toHaveLength(1);
    const markdown = await call("agency_context", { clientId: created.id, format: "markdown" }) as { markdown: string };
    expect(markdown.markdown).toContain("# Dossier client : Atelier Nord");
    const overview = await call("agency_context", {}) as { agency: { name: string }; clients: Array<{ id: string }> };
    expect(overview.agency.name).toBe("Nord Leads");
    expect(overview.clients.map((client) => client.id)).toEqual([created.id]);

    // Tasks of that client, done through the tool, visible to the dashboard.
    const tasks = await call("agency_tasks", { action: "list", clientId: created.id }) as { items: Array<{ id: string; done: boolean }> };
    const task = tasks.items[0]!;
    const doneTask = await call("agency_tasks", { action: "update", clientId: created.id, taskId: task.id, data: { done: true } }) as { item: { done: boolean } };
    expect(doneTask.item.done).toBe(true);
    expect((await json(`${url}/api/tasks`, {}, cookie)).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id, done: true })]));

    // Another client's records are out of reach, whichever way they are named.
    const other = await call("agency_clients", { action: "create", data: { company: "Autre SAS" } }) as { id: string };
    expect(await refused(call("agency_campaigns", { action: "get", clientId: other.id, campaignId: submitted.campaign.id }))).toContain("does not belong to client");
    expect(await refused(call("agency_tasks", { action: "create", clientId: other.id, data: { title: "x", campaignId: submitted.campaign.id } }))).toContain("does not belong to client");
    expect(await refused(call("agency_deliverables", { action: "get", clientId: other.id, deliverableId: deliverable.id }))).toContain("does not belong to client");
    expect(await refused(call("agency_tasks", { action: "update", clientId: other.id, taskId: task.id, data: { done: false } }))).toContain("does not belong to client");
    expect(await refused(call("agency_campaigns", { action: "list" }))).toContain("clientId is required");
    const otherCampaigns = await call("agency_campaigns", { action: "list", clientId: other.id }) as { count: number };
    expect(otherCampaigns.count).toBe(0);

    // The run ends: the capability is revoked with it.
    turns[0]!.onEvent({ type: "turn.completed", ok: true, stopReason: null });
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    expect((await harness.runs.get(runIds[0]!))?.state).toBe("completed");
    expect(await refused(call("agency_clients", { action: "list" }))).toContain("invalid or expired");
  });

  it("are not offered to agents outside the pack, and refuse them by scope", async () => {
    const { harness, agency, turns } = build();
    await agency.install();
    const ada = await harness.bots.create({ name: "Ada" });
    const { runIds } = await harness.threads.send({ botId: ada.id }, { text: "hi" });
    expect(turns[0]!.dynamicTools ?? []).toEqual([]);
    const error = await refused(agency.callTool({ botId: ada.id, threadId: `bot:${ada.id}`, runId: runIds[0]! }, "agency_clients", { action: "list" }));
    expect(error).toContain("only to the agents of the installed agency pack");
    // A pack agent's id with someone else's run is refused too.
    const director = (await harness.bots.list()).find((bot) => bot.name === "Agency Director")!;
    const scoped = await refused(agency.callTool({ botId: director.id, threadId: `bot:${director.id}`, runId: runIds[0]! }, "agency_clients", { action: "list" }));
    expect(scoped).toContain("active run");
  });

  /** A `fetch` that holds every GET of one client's dossier until released,
   * and records every request it forwarded. The held request is only sent
   * once released, so an abort raised meanwhile reaches it. */
  function gatedFetch(): { fetchImpl: typeof fetch; requests: string[]; hold(pattern: RegExp): Promise<void>; release(): void } {
    const requests: string[] = [];
    let pattern: RegExp | null = null;
    let gate: { promise: Promise<void>; open: () => void; reached: () => void; reachedPromise: Promise<void> } | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      const target = `${method} ${new URL(String(input)).pathname}`;
      if (pattern && gate && pattern.test(target)) {
        gate.reached();
        await gate.promise;
      }
      requests.push(target);
      return fetch(input, init);
    };
    return {
      fetchImpl,
      requests,
      hold(next) {
        pattern = next;
        let open!: () => void;
        let reached!: () => void;
        const promise = new Promise<void>((resolveGate) => { open = resolveGate; });
        const reachedPromise = new Promise<void>((resolveReached) => { reached = resolveReached; });
        gate = { promise, open, reached, reachedPromise };
        return reachedPromise;
      },
      release() {
        gate?.open();
        pattern = null;
      },
    };
  }

  async function raceSetup(abortOnSettle: boolean, delayedStop = false) {
    const gate = gatedFetch();
    const built = build({ fetchImpl: gate.fetchImpl, abortOnSettle, delayedStop });
    await built.agency.install();
    const { url, cookie } = await dashboardSession(built.agency);
    const strategist = (await built.harness.bots.list()).find((bot) => bot.name === "Strategist")!;
    await built.harness.threads.send({ botId: strategist.id }, { text: "plan" });
    const tools = toolsOf(built.turns[0]);
    const call = (name: string, args: unknown) => tools[name]!.call(args, { callId: "c", threadId: "t", turnId: "u" });
    const client = await call("agency_clients", { action: "create", data: { company: "Course SAS" } }) as { id: string };
    const campaign = await call("agency_campaigns", { action: "create", clientId: client.id, data: { name: "Lancement", channel: "meta" } }) as { id: string };
    return { ...built, gate, url, cookie, call, client, campaign };
  }

  it("STOP revokes an in-flight write before the CLI has settled", async () => {
    const { harness, turns, gate, call, client, campaign, url, cookie } = await raceSetup(true, true);
    const reached = gate.hold(new RegExp(`^GET /api/clients/${client.id}$`));
    const update = call("agency_campaigns", { action: "update", clientId: client.id, campaignId: campaign.id, data: { status: "active" } });
    await reached;
    const before = gate.requests.length;
    const bot = (await harness.bots.list()).find(value => value.name === "Strategist")!;
    await harness.threads.stop({ botId: bot.id });
    expect((await harness.runs.list()).some(run => run.state === "working")).toBe(true);
    gate.release();
    expect(await refused(update)).toMatch(/run was stopped|active run|invalid or expired/);
    expect(gate.requests.slice(before).some(request => request.startsWith("PATCH"))).toBe(false);
    expect(((await json(`${url}/api/campaigns/${campaign.id}`, {}, cookie)).body as { status: string }).status).toBe("draft");
    turns[0]!.onEvent({ type: "turn.completed", ok: false, stopReason: "interrupted" });
  });

  it("a STOP between the read and the write of one call leaves no write behind (requests abandoned)", async () => {
    const { turns, gate, url, cookie, call, client, campaign, harness } = await raceSetup(true);
    const requests = gate.requests;
    // The update reads the dossier first, then PATCHes. Hold the read.
    const reached = gate.hold(new RegExp(`^GET /api/clients/${client.id}$`));
    const update = call("agency_campaigns", { action: "update", clientId: client.id, campaignId: campaign.id, data: { status: "active" } });
    await reached;
    const before = requests.length;
    // The run ends while the read is held: capability revoked, requests aborted.
    turns[0]!.onEvent({ type: "turn.completed", ok: true, stopReason: null });
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    gate.release();
    const message = await refused(update);
    expect(message).toMatch(/run was stopped|active run|invalid or expired/);
    expect(requests.slice(before).some((request) => request.startsWith("PATCH"))).toBe(false);
    const unchanged = await json(`${url}/api/campaigns/${campaign.id}`, {}, cookie);
    expect((unchanged.body as { status: string }).status).toBe("draft");
    expect((await harness.runs.list()).some((run) => run.state === "completed")).toBe(true);
  });

  it("a STOP between the read and the write of one call leaves no write behind (re-authorisation alone)", async () => {
    // Even without the abort wiring, the write itself is re-authorised.
    const { turns, gate, url, cookie, call, client, campaign } = await raceSetup(false);
    const requests = gate.requests;
    const reached = gate.hold(new RegExp(`^GET /api/clients/${client.id}$`));
    const update = call("agency_campaigns", { action: "update", clientId: client.id, campaignId: campaign.id, data: { status: "active" } });
    await reached;
    const before = requests.length;
    turns[0]!.onEvent({ type: "turn.completed", ok: true, stopReason: null });
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    gate.release();
    expect(await refused(update)).toContain("active run");
    expect(requests.slice(before)).toEqual([`GET /api/clients/${client.id}`]);
    expect(((await json(`${url}/api/campaigns/${campaign.id}`, {}, cookie)).body as { status: string }).status).toBe("draft");
  });

  it("a read whose run ended before it returned is not handed back", async () => {
    const { turns, gate, call, client } = await raceSetup(true);
    const reached = gate.hold(new RegExp(`^GET /api/clients/${client.id}$`));
    const read = call("agency_clients", { action: "get", clientId: client.id });
    await reached;
    turns[0]!.onEvent({ type: "turn.completed", ok: true, stopReason: null });
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    gate.release();
    expect(await refused(read)).toMatch(/run was stopped|active run/);
  });

  it("stop revokes the capability mid-turn", async () => {
    const { harness, agency, turns } = build();
    await agency.install();
    const strategist = (await harness.bots.list()).find((bot) => bot.name === "Strategist")!;
    await harness.threads.send({ botId: strategist.id }, { text: "research" });
    const tools = toolsOf(turns[0]);
    const skills = await tools.agency_list_skills!.call({}, { callId: "c", threadId: "t", turnId: "u" }) as { count: number };
    expect(skills.count).toBe(23);
    await harness.threads.stop({ botId: strategist.id });
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    expect(await refused(tools.agency_list_skills!.call({}, { callId: "c", threadId: "t", turnId: "u" }))).toContain("invalid or expired");
  });
});

describe("skills and documents", () => {
  async function pack(options: Partial<PackFixtureOptions> = {}) {
    const built = build(options);
    await built.agency.install();
    const strategist = (await built.harness.bots.list()).find((bot) => bot.name === "Strategist")!;
    await built.harness.threads.send({ botId: strategist.id }, { text: "read" });
    const tools = toolsOf(built.turns[0]);
    return { ...built, call: (name: string, args: unknown) => tools[name]!.call(args, { callId: "c", threadId: "t", turnId: "u" }) };
  }

  it("read a skill and its references from the vault, byte for byte, and refuse to leave it", async () => {
    const { call } = await pack();
    const vault = vaultOf();
    const listed = await call("agency_list_skills", {}) as { count: number; skills: Array<{ name: string; references: string[] }> };
    expect(listed.count).toBe(23);
    expect(listed.skills.map((skill) => skill.name)).toContain("outbound-sequence-writer");
    const skill = await call("agency_read_skill", { name: "creative-brief" }) as { text: string; path: string; truncated: boolean };
    expect(skill.path).toBe("skills/creative-brief/SKILL.md");
    expect(skill.text).toBe(readFileSync(join(vault, "skills", "creative-brief", "SKILL.md"), "utf8"));
    expect(skill.text).toBe(readFileSync(join(DEFAULT_KIT_ROOT, "skills", "creative-brief", "SKILL.md"), "utf8"));
    expect(skill.truncated).toBe(false);
    const reference = await call("agency_read_skill", { name: "creative-brief", reference: "brief-format.md" }) as { text: string; path: string };
    expect(reference.path).toBe("skills/creative-brief/references/brief-format.md");
    expect(reference.text).toBe(readFileSync(join(vault, "skills", "creative-brief", "references", "brief-format.md"), "utf8"));

    // The person's own edit of a skill is what the agent then reads.
    const owned = join(vault, "skills", "creative-brief", "SKILL.md");
    writeFileSync(owned, `${readFileSync(owned, "utf8")}\nOwner-specific test instruction.\n`);
    expect(((await call("agency_read_skill", { name: "creative-brief" })) as { text: string }).text).toContain("Owner-specific test instruction.");

    expect(await refused(call("agency_read_skill", { name: "../lib" }))).toContain("skill name");
    expect(await refused(call("agency_read_skill", { name: "creative-brief", reference: "../SKILL.md" }))).toContain("reference must be one of");
    expect(await refused(call("agency_read_skill", { name: "creative-brief", reference: "../../lib/app.mjs" }))).toContain("reference must be one of");
    expect(await refused(call("agency_read_skill", { name: "agency-offer-design", reference: "brief-format.md" }))).toContain("(none)");
    expect(await refused(call("agency_read_skill", { name: "no-such-skill" }))).toContain("unknown skill");
  });

  it("ignore symlinked skills and references in a tampered kit", async () => {
    const tampered = mkdtempSync(join(tmpdir(), "lbz-kit-"));
    cleanups.push(() => rm(tampered, { recursive: true, force: true }));
    cpSync(DEFAULT_KIT_ROOT, tampered, { recursive: true });
    mkdirSync(join(tampered, "skills", "evil", "references"), { recursive: true });
    symlinkSync(join(tampered, "lib", "app.mjs"), join(tampered, "skills", "evil", "SKILL.md"));
    symlinkSync(join(tampered, "lib", "store.mjs"), join(tampered, "skills", "creative-brief", "references", "linked.md"));
    // A symlinked skill is not in the kit, so it is never seeded into the vault.
    expect(kitOf(tampered).skills.map((skill) => skill.name)).not.toContain("evil");
    const { call } = await pack({ kitRoot: tampered });
    const listed = await call("agency_list_skills", {}) as { count: number; skills: Array<{ name: string; references: string[] }> };
    expect(listed.count).toBe(23);
    expect(listed.skills.map((skill) => skill.name)).not.toContain("evil");
    expect(listed.skills.find((skill) => skill.name === "creative-brief")!.references).toEqual(["brief-format.md"]);
    expect(existsSync(join(vaultOf(), "skills", "evil"))).toBe(false);
    expect(await refused(call("agency_read_skill", { name: "evil" }))).toContain("unknown skill");
    expect(await refused(call("agency_read_skill", { name: "creative-brief", reference: "linked.md" }))).toContain("reference must be one of");
  });

  it("read vault notes and list folders, never outside the vault and never the store", async () => {
    const { call } = await pack();
    const kit = kitOf();
    const handoffs = await call("agency_read_document", { path: "Processes/Handoffs.md" }) as { kind: string; text: string };
    expect(handoffs.kind).toBe("file");
    expect(handoffs.text).toBe(kit.template.notes.find((note) => note.path === "Processes/Handoffs.md")!.text);
    const rootListing = await call("agency_read_document", { path: "" }) as { kind: string; entries: Array<{ name: string; kind: string }> };
    expect(rootListing.kind).toBe("folder");
    expect(rootListing.entries).toEqual(expect.arrayContaining([{ name: "Agents", kind: "folder" }, { name: "AGENTS.md", kind: "file" }]));
    const agents = await call("agency_read_document", { path: "Agents" }) as { entries: Array<{ name: string }> };
    expect(agents.entries.map((entry) => entry.name)).toContain("Strategist");
    expect(await refused(call("agency_read_document", { path: "../templates.json" }))).toContain("invalid path");
    expect(await refused(call("agency_read_document", { path: ".trash" }))).toContain("invalid path");
    expect(await refused(call("agency_read_document", { path: "Processes/nope.md" }))).toContain("not found");
    // The dashboard's own store — credentials included — is not a note.
    writeFileSync(join(dataDirOf(), "connections.json"), '{"secret":"fixture"}');
    for (const path of ["Apps/LeadFactory/data/db.json", "apps/leadfactory/data/connections.json", "Apps/LeadFactory/data"]) {
      expect(await refused(call("agency_read_document", { path }))).toContain("data folder is not readable");
    }
    // A link planted in the vault is refused, wherever it points.
    symlinkSync(join(dataDirOf(), "db.json"), join(vaultOf(), "Knowledge", "Draft", "link.md"));
    expect(await refused(call("agency_read_document", { path: "Knowledge/Draft/link.md" }))).toContain("links are not readable");
  });
});

describe("PackError", () => {
  it("carries a code and an HTTP status for the sidecar", () => {
    const error = new PackError("nope", "other_client", 403);
    expect(error).toMatchObject({ code: "other_client", status: 403, name: "PackError" });
    expect(new PackError("x")).toMatchObject({ code: "pack_error", status: 400 });
  });
});
