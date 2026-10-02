import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanVault } from "../src/harness/brain.js";
import { validateTemplate } from "../src/harness/company-os.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { OPS_SCRIPT } from "../src/harness/template-ops-script.js";
import { SERVICE_BASED_BUSINESS } from "../src/harness/template-service-based-business.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lbz-service-business-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function harness(): LocalBizosHarness {
  return new LocalBizosHarness({
    rootDir: join(root, "state"),
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Fixture business",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere" },
    devices: false,
  });
}

describe("Service-based Business company template", () => {
  it("installs a ready-to-run operations helper and one canonical decisions registry", async () => {
    await harness().templates.apply("service-based-business");
    const vault = join(root, "state", "vaults", "service-based-business");
    const check = spawnSync(process.execPath, [join(vault, "scripts/ops.mjs"), "check"], { cwd: root, encoding: "utf8" });
    expect(check.status, check.stderr).toBe(0);
    expect(JSON.parse(check.stdout)).toMatchObject({ ok: true, claims: 0, decisions: 0, runs: 0 });
    expect(existsSync(join(vault, "Decisions.md"))).toBe(false);
    expect(existsSync(join(vault, "bus/DECISIONS.md"))).toBe(true);
    for (const role of SERVICE_BASED_BUSINESS.bots) expect(existsSync(join(vault, `bus/inbox/${role.slug}/done`))).toBe(true);
    expect(readFileSync(join(vault, "scripts/README.md"), "utf8")).toContain("claim take");
  });

  it("is a complete six-role operating system with truthful local capabilities", () => {
    expect(() => validateTemplate(SERVICE_BASED_BUSINESS)).not.toThrow();
    expect(SERVICE_BASED_BUSINESS).toMatchObject({
      id: "service-based-business",
      version: 1,
      name: "Service-based Business",
      team: { name: "Service Business Team" },
      routines: [],
    });
    expect(SERVICE_BASED_BUSINESS.bots.map((bot) => bot.name)).toEqual([
      "Business Director",
      "Sales",
      "Client Success",
      "Delivery",
      "Quality",
      "Operations",
    ]);
    expect(SERVICE_BASED_BUSINESS.bots.filter((bot) => bot.welcome)).toHaveLength(1);
    expect(SERVICE_BASED_BUSINESS.bots[0]!.welcome).toMatch(/What services do you sell.*who buys.*market.*language.*outcome.*tools.*priority.*approval/is);
    expect(SERVICE_BASED_BUSINESS.bots[0]!.welcome).toMatch(/team (chat|thread)/i);

    const folders = new Set(SERVICE_BASED_BUSINESS.folders);
    for (const required of [
      "Clients", "Projects", "Deliverables", "Processes", "reports",
      "knowledge/draft", "knowledge/trusted", "bus", "state", "scripts",
    ]) expect(folders.has(required)).toBe(true);

    const notes = new Map(SERVICE_BASED_BUSINESS.notes.map((note) => [note.path, note.text]));
    for (const required of [
      "AGENTS.md", "CLAUDE.md", "Start here.md", "Mission.md", "Company.md", "Rules.md",
      "Environment.md", "Knowledge map.md", "Team.md", "Clients/Client template.md",
      "Projects/Project template.md", "Deliverables/Deliverable template.md", "reports/Report template.md",
      "Processes/Qualification.md", "Processes/Proposal.md", "Processes/Onboarding.md",
      "Processes/Delivery.md", "Processes/Quality assurance.md", "Processes/Follow-up and billing.md",
      "scripts/ops.mjs",
    ]) expect(notes.has(required), required).toBe(true);
    expect(notes.get("scripts/ops.mjs")).toBe(OPS_SCRIPT);
    expect(notes.get("Environment.md")).toMatch(/no CRM.*no payment.*no contact/i);
    expect(notes.get("Environment.md")).toMatch(/Mac.*awake/i);
    expect(notes.get("Rules.md")).toMatch(/recruit_agent.*manage_agent/is);
    expect(notes.get("Rules.md")).toMatch(/current team (chat|thread)/i);
    expect(notes.get("Rules.md")).toMatch(/4 hops.*12 turns.*no revisit/is);
    expect(notes.get("Rules.md")).toMatch(/45 minutes or 20 turns/i);
    expect(notes.get("Rules.md")).toMatch(/interrupted.*not.*automatic/is);
    expect(notes.get("Rules.md")).not.toMatch(/24\/7|always online/i);

    const vault = join(root, "service-template");
    mkdirSync(vault, { recursive: true });
    for (const note of SERVICE_BASED_BUSINESS.notes) {
      mkdirSync(join(vault, note.path, ".."), { recursive: true });
      writeFileSync(join(vault, note.path), note.text);
    }
    const graph = scanVault({ id: "service", label: "Service", path: vault }).graph;
    expect(graph.nodes.filter((node) => node.ghost)).toEqual([]);
    expect(graph.edges).toContainEqual({ source: "AGENTS.md", target: "Start here.md" });

    for (const bot of SERVICE_BASED_BUSINESS.bots) {
      expect(notes.get(`Agents/${bot.name}/AGENTS.md`)).toContain(`${bot.name}.md`);
      expect(notes.get(`Agents/${bot.name}/CLAUDE.md`)).toBe("@AGENTS.md\n");
      expect(notes.get(`Agents/${bot.name}/${bot.name}.md`)!.length).toBeGreaterThan(300);
      expect(bot.instructions).toContain("../../AGENTS.md");
    }
  });

  it("resumes a pre-change pending full roster and preserves its agents, team and owner notes", async () => {
    const first = harness();
    const brain = join(root, "state", "brain");
    mkdirSync(brain, { recursive: true });
    writeFileSync(join(brain, "Personal.md"), "keep me\n");

    writeFileSync(join(root, "state", "templates.json"), JSON.stringify({ version: 1, installations: {}, pending: { "service-based-business": { id: "service-based-business", version: 1, startedAt: "2026-09-21T00:00:00Z", bots: {}, welcomes: {} } } }));
    const installed = await first.templates.apply("service-based-business");
    const vault = join(root, "state", "vaults", "service-based-business");
    expect(installed).toMatchObject({
      id: "service-based-business",
      rootId: "vault:service-based-business",
      created: true,
      vault: "seeded",
      groupId: expect.any(String),
    });
    expect(readFileSync(join(brain, "Personal.md"), "utf8")).toBe("keep me\n");
    expect(Object.keys(installed.bots)).toEqual(SERVICE_BASED_BUSINESS.bots.map((bot) => bot.slug));

    const roster = await first.bots.list();
    expect(roster).toHaveLength(6);
    for (const row of SERVICE_BASED_BUSINESS.bots) {
      const bot = roster.find((candidate) => candidate.id === installed.bots[row.slug])!;
      expect(bot).toMatchObject({ name: row.name, title: row.title, workspacePath: join(vault, "Agents", row.name) });
      expect(bot.instructions).toBe(row.instructions.trim());
      expect(existsSync(join(bot.workspacePath!, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(bot.workspacePath!, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(bot.workspacePath!, `${row.name}.md`))).toBe(true);
      const messages = (await first.threads.get({ botId: bot.id })).messages;
      expect(messages).toHaveLength(row.welcome ? 1 : 0);
    }
    const group = (await first.groups.list())[0]!;
    expect(group).toMatchObject({ id: installed.groupId, name: "Service Business Team" });
    expect(group.memberIds).toEqual(SERVICE_BASED_BUSINESS.bots.map((bot) => installed.bots[bot.slug]));
    expect(await first.routines.list()).toEqual([]);
    expect(readFileSync(join(vault, "scripts", "ops.mjs"), "utf8")).toBe(OPS_SCRIPT);

    writeFileSync(join(vault, "Company.md"), "# Company\n\nOwner-edited facts stay here.\n");
    expect(await first.templates.apply("service-based-business")).toEqual({ ...installed, created: false });
    expect(await first.bots.list()).toHaveLength(6);
    expect(await first.groups.list()).toHaveLength(1);
    expect((await first.threads.get({ botId: installed.bots["business-director"]! })).messages).toHaveLength(1);

    const qualityId = installed.bots.quality!;
    await first.bots.remove(qualityId);
    const withoutQuality = await first.templates.apply("service-based-business");
    expect(withoutQuality).toMatchObject({
      id: installed.id,
      rootId: installed.rootId,
      groupId: installed.groupId,
      vault: installed.vault,
      created: false,
    });
    expect(withoutQuality.bots.quality).toBeUndefined();
    expect(await first.bots.list()).toHaveLength(5);
    expect((await first.groups.list())[0]!.memberIds).not.toContain(qualityId);
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toBe("# Company\n\nOwner-edited facts stay here.\n");

    const reopened = harness();
    expect(await reopened.templates.apply("service-based-business")).toEqual(withoutQuality);
    expect(await reopened.bots.list()).toHaveLength(5);
    expect(await reopened.groups.list()).toHaveLength(1);
    expect((await reopened.threads.get({ botId: installed.bots["business-director"]! })).messages).toHaveLength(1);
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toBe("# Company\n\nOwner-edited facts stay here.\n");
  });
});
