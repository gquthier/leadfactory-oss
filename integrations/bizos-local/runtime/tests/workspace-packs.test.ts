import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { AgencyService } from "../src/harness/agency.js";
import { EcommerceService } from "../src/harness/ecommerce.js";
import { completeTemplateVault } from "../src/harness/company-os.js";
import { COMPANY_OS } from "../src/harness/company-os.js";
import type { PackHost, PackScope } from "../src/harness/pack.js";
import type { Run } from "../src/harness/types.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function setup(existingRoot?: string) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), "bizos-packs-"));
  const harness = new LocalBizosHarness({ rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Test", execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"), environment: { PATH: "/nowhere" }, devices: false });
  const runs = new Map<string, Run>();
  const host: PackHost = {
    rootDir: root, binding: () => harness.workspaceTemplate.current(),
    installation: id => harness.workspaceTemplate.installation(id),
    install: (id, vault) => harness.workspaceTemplate.install(id, vault),
    listBots: () => harness.bots.list(), run: async id => runs.get(id),
  };
  const agency = new AgencyService({ host });
  const ecommerce = new EcommerceService({ host });
  async function close() { await Promise.all([agency.close(), ecommerce.close()]); harness.stop(); }
  cleanups.push(async () => { await close(); if (!existingRoot) rmSync(root, { recursive: true, force: true }); });
  function scope(botId: string): PackScope {
    const value = { botId, threadId: `bot:${botId}`, runId: `run-${botId}` };
    runs.set(value.runId, { id: value.runId, botId, threadId: value.threadId, state: "working" } as Run);
    return value;
  }
  return { root, harness, agency, ecommerce, scope, runs, close };
}

async function dashboard(service: AgencyService | EcommerceService) {
  const opened = await service.open();
  const url = new URL(opened.dashboardUrl!);
  const ticket = url.hash.slice("#connect=".length);
  const response = await fetch(`${url.origin}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }) });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(`${url.origin}/api${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
}

describe("one business template per vault", () => {
  it.each(["agency", "ecommerce"] as const)("installs %s once with real team, local skills, shared records and durable binding", async kind => {
    const s = setup();
    const service = s[kind];
    const installed = await service.install();
    expect(installed.status).toBe("ready");
    expect(installed.bots).toHaveLength(6);
    expect(installed.groupId).toBeTruthy();
    const vault = installed.vaultPath!;
    const skill = kind === "agency" ? "client-onboarding" : "shopify-setup";
    const actualSkill = kind === "agency" ? "onboarding-client" : skill;
    const skills = (await service.callTool(s.scope(installed.bots[0]!.botId), kind === "agency" ? "agency_list_skills" : "commerce_list_skills", {})) as { skills: Array<{ name: string }> };
    const name = kind === "agency" ? skills.skills[0]!.name : actualSkill;
    const skillPath = join(vault, "skills", name, "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    writeFileSync(skillPath, readFileSync(skillPath, "utf8") + "\nOwner-specific test instruction.\n");
    const scope = s.scope(installed.bots[0]!.botId);
    const read = await service.callTool(scope, kind === "agency" ? "agency_read_skill" : "commerce_read_skill", { name });
    expect(JSON.stringify(read)).toContain("Owner-specific test instruction.");
    const api = await dashboard(service);
    const collection = kind === "agency" ? "clients" : "products";
    const row = await api(`/${collection}`, "POST", kind === "agency" ? { company: "Studio Démo" } : { name: "Pochette Démo" });
    expect(row.status).toBe(201);
    const dossier = join(vault, kind === "agency" ? "Clients" : "Products", row.body.id, "Dossier.md");
    expect(readFileSync(dossier, "utf8")).toContain("Démo");
    const config = await api("/dashboard");
    await service.callTool(scope, kind === "agency" ? "agency_dashboard" : "commerce_dashboard", { action: "update", config: { ...config.body, title: "Dashboard personnalisé" } });
    expect((await api("/dashboard")).body.title).toBe("Dashboard personnalisé");
    const again = await service.install();
    expect(again.bots).toEqual(installed.bots);
    expect(readFileSync(skillPath, "utf8")).toContain("Owner-specific test instruction.");
    const other = kind === "agency" ? "ecommerce" : "lead-gen-agency";
    await expect(s.harness.workspaceTemplate.bind({ templateId: other, rootId: "new" })).rejects.toThrow();
    await expect(s.harness.templates.apply(other)).rejects.toThrow();
    await expect(s.harness.brain.scan("brain")).rejects.toThrow();
    const humanNote = join(vault, kind === "agency" ? "Clients" : "Products", row.body.id, "Human.md");
    writeFileSync(humanNote, "Keep this personal note");
    expect((await api(`/${collection}/${row.body.id}`, "DELETE")).status).toBe(200);
    expect(existsSync(dossier)).toBe(false);
    expect(readFileSync(humanNote, "utf8")).toBe("Keep this personal note");
    const binding = await s.harness.workspaceTemplate.get();
    await s.close();
    const restarted = setup(s.root);
    expect((await restarted.harness.workspaceTemplate.get()).binding).toEqual(binding.binding);
    expect((await restarted[kind].install()).bots).toEqual(installed.bots);
    expect((await (await dashboard(restarted[kind]))("/dashboard")).body.title).toBe("Dashboard personnalisé");
  });

  it("rejects data aliases and confines skills and tool calls to the bound pack's active run", async () => {
    const s = setup();
    const installed = await s.ecommerce.install();
    const scope = s.scope(installed.bots[0]!.botId);
    const context = await s.ecommerce.callTool(scope, "commerce_context", {}) as { collections: { products: { fields: string[] } } };
    expect(context.collections.products.fields).toContain("name");
    await expect(s.ecommerce.callTool(scope, "commerce_records", { action: "create", collection: "products", data: { name: "Valid", surprise: true } })).rejects.toThrow("unknown field");
    const vault = installed.vaultPath!;
    writeFileSync(join(vault, "Apps", "Ecommerce", "data", "connections.json"), '{"secret":"fixture"}');
    symlinkSync(join(vault, "Apps", "Ecommerce", "data"), join(vault, "Alias"));
    for (const path of ["apps/ecommerce/data/connections.json", "Alias/connections.json"]) {
      await expect(s.ecommerce.callTool(scope, "commerce_read_document", { path })).rejects.toThrow();
    }
    await expect(s.agency.callTool(scope, "agency_clients", { action: "list" })).rejects.toThrow();
    s.runs.set(scope.runId, { ...s.runs.get(scope.runId)!, state: "failed" });
    await expect(s.ecommerce.callTool(scope, "commerce_records", { action: "create", collection: "products", data: { name: "Stopped" } })).rejects.toThrow();
  });

  it("preflights symlinked template folders before writing any notes", () => {
    const root = mkdtempSync(join(tmpdir(), "bizos-template-links-"));
    try {
      const vault = join(root, "vault"); const outside = join(root, "outside");
      mkdirSync(vault); mkdirSync(outside); symlinkSync(outside, join(vault, "Knowledge"));
      expect(() => completeTemplateVault(vault, COMPANY_OS)).toThrow("symbolic link");
      expect(existsSync(join(vault, "AGENTS.md"))).toBe(false);
      expect(existsSync(join(outside, "Draft"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
