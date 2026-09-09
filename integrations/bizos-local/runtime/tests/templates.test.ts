// The template catalogue: two built-in packs, each created into a vault of
// its own with its agents in the roster — once, resumably, and never over
// anything the person has. What is refused is refused before anything is
// written; what was half done is finished, not redone.
import { createHash } from "node:crypto";
import fs, {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrainError, scanVault, seedStarterVault } from "../src/harness/brain.js";
import { fixedClock } from "../src/harness/clock.js";
import { COMPANY_OS, seedTemplateVault, TEMPLATE_FILE, validateTemplate, type CompanyTemplate } from "../src/harness/company-os.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { LEAD_GEN_AGENCY } from "../src/harness/template-lead-gen-agency.js";
import {
  templateOf,
  holdsTemplate,
  legacyCompanyOsInstallation,
  readTemplateRegistry,
  TEMPLATE_CATALOG,
  TEMPLATE_IDS,
  TEMPLATES_FILE,
  type TemplateRegistry,
} from "../src/harness/templates.js";
import { Storage } from "../src/harness/storage.js";
import { buildHandlers, runHandler, type IpcEnvelope } from "../src/ipc.js";
import { CollaborationFacade } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "lbz-templates-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const stateOf = () => join(scratch, "state");
const brainOf = () => join(stateOf(), "brain");
const vaultOf = (id: string) => join(stateOf(), "vaults", id);

function harnessFor(): LocalBizosHarness {
  return new LocalBizosHarness({
    rootDir: stateOf(),
    baseUrl: "https://app.bizos.lol",
    readSessionCookie: async () => "",
    orgName: () => "Local workspace",
    execPath: "/fake/electron",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: "/fake/dist/mcp/bizos-mcp.mjs",
    clock: fixedClock(Date.parse("2026-09-08T09:00:00Z")),
    environment: { PATH: "/nowhere" },
    homeDir: scratch,
  });
}

/** Every file under a folder, hashed — the proof that nothing in it moved. */
function fingerprint(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const stats = lstatSync(absolute);
      if (stats.isDirectory()) {
        hash.update(`d:${path}\n`);
        visit(absolute, path);
      } else if (stats.isFile()) {
        hash.update(`f:${path}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}\n`);
      } else {
        hash.update(`o:${path}\n`);
      }
    }
  };
  visit(root, "");
  return hash.digest("hex");
}

function registryOf(): TemplateRegistry {
  return JSON.parse(readFileSync(join(stateOf(), TEMPLATES_FILE), "utf8")) as TemplateRegistry;
}

describe("the Lead Gen Agency pack", () => {
  it("is in the catalogue as shipped: six agents within the roster's limits, one welcome, no routine, no team", () => {
    expect(TEMPLATE_IDS).toEqual(["company-os", "lead-gen-agency", "ecommerce"]);
    expect(TEMPLATE_CATALOG["lead-gen-agency"]).toBe(LEAD_GEN_AGENCY);
    expect(LEAD_GEN_AGENCY).toMatchObject({ id: "lead-gen-agency", version: 1, name: "Lead Gen Agency" });
    expect(LEAD_GEN_AGENCY.bots.map((bot) => bot.slug)).toEqual([
      "agency-director",
      "acquisition",
      "onboarding",
      "strategist",
      "creative",
      "account-manager",
    ]);
    expect(LEAD_GEN_AGENCY.notes).toHaveLength(41);
    expect(LEAD_GEN_AGENCY.folders).toHaveLength(12);
    expect(LEAD_GEN_AGENCY.routines).toEqual([]);
    expect(LEAD_GEN_AGENCY.team).toBeUndefined();
    expect(LEAD_GEN_AGENCY.bots.filter((bot) => bot.welcome)).toHaveLength(1);
    expect(LEAD_GEN_AGENCY.bots[0]).toMatchObject({ name: "Agency Director", pinned: true });
    for (const bot of LEAD_GEN_AGENCY.bots) {
      expect(bot.name.length).toBeLessThanOrEqual(60);
      expect(bot.title.length).toBeLessThanOrEqual(80);
      expect(bot.description.length).toBeLessThanOrEqual(600);
      expect(bot.instructions.length).toBeLessThanOrEqual(6000);
      expect(bot.instructions).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
      const paths = new Set(LEAD_GEN_AGENCY.notes.map((note) => note.path));
      expect(paths.has(`Agents/${bot.name}/${bot.name}.md`)).toBe(true);
      expect(paths.has(`Agents/${bot.name}/AGENTS.md`)).toBe(true);
      // The pack points Claude Code at the folder's AGENTS.md, which names the sheet.
      expect(LEAD_GEN_AGENCY.notes.find((note) => note.path === `Agents/${bot.name}/CLAUDE.md`)!.text).toBe("@AGENTS.md\n");
      expect(LEAD_GEN_AGENCY.notes.find((note) => note.path === `Agents/${bot.name}/AGENTS.md`)!.text).toContain(`${bot.name}.md`);
    }
    expect(() => validateTemplate(LEAD_GEN_AGENCY)).not.toThrow();
    expect(() => validateTemplate(COMPANY_OS)).not.toThrow();
  });

  it("seeds a folder whose graph has no ghost, and names no client and no service", () => {
    const vault = join(scratch, "agency");
    expect(seedTemplateVault(vault, LEAD_GEN_AGENCY)).toBe("seeded");
    for (const folder of LEAD_GEN_AGENCY.folders) expect(lstatSync(join(vault, folder)).isDirectory()).toBe(true);
    const scan = scanVault({ id: "v", label: "Agency", path: vault });
    expect(scan.notes).toHaveLength(41);
    expect(scan.graph.nodes.filter((node) => node.ghost)).toEqual([]);
    expect(readFileSync(join(vault, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    for (const note of LEAD_GEN_AGENCY.notes) {
      expect(note.text).not.toMatch(/api[_-]?key|sk-[a-z0-9]{8}|Bearer /i);
    }
  });

  it("refuses a forged pack before anything is written", () => {
    const forged = (patch: Partial<CompanyTemplate>): CompanyTemplate => ({ ...LEAD_GEN_AGENCY, ...patch });
    const cases: CompanyTemplate[] = [
      forged({ notes: [...LEAD_GEN_AGENCY.notes, { path: "../outside.md", text: "x" }] }),
      forged({ folders: [...LEAD_GEN_AGENCY.folders, ".hidden"] }),
      forged({ notes: [...LEAD_GEN_AGENCY.notes, { path: "AGENTS.md", text: "twice" }] }),
      forged({ bots: [...LEAD_GEN_AGENCY.bots, { ...LEAD_GEN_AGENCY.bots[0]!, slug: "again" }] }),
      forged({ bots: [{ ...LEAD_GEN_AGENCY.bots[0]!, slug: "../x" }] }),
      forged({ bots: [{ ...LEAD_GEN_AGENCY.bots[0]!, name: "Two\nlines" }] }),
      forged({ bots: [{ ...LEAD_GEN_AGENCY.bots[0]!, instructions: "x".repeat(6001) }] }),
      forged({ routines: [{ bot: "nobody", name: "r", prompt: "p", trigger: { kind: "manual" }, enabled: true }] }),
    ];
    for (const pack of cases) {
      const vault = join(scratch, "forged");
      expect(() => seedTemplateVault(vault, pack)).toThrow(BrainError);
      expect(existsSync(vault)).toBe(false);
    }
  });
});

const SHIPPED_AGENCY = templateOf("lead-gen-agency");

describe("harness.templates.list", () => {
  it("lists both templates with their counts and descriptions, neither installed on a fresh state", async () => {
    const harness = harnessFor();
    const { templates } = await harness.templates.list();
    expect(templates.map((row) => row.id)).toEqual(["company-os", "lead-gen-agency", "ecommerce"]);
    expect(templates[1]).toMatchObject({ name: "Lead Gen Agency", version: 1, notes: SHIPPED_AGENCY.notes.length, folders: SHIPPED_AGENCY.folders.length });
    expect(templates[1]!.agents).toHaveLength(6);
    expect(templates[1]!.agents[0]).toEqual({ slug: "agency-director", name: "Agency Director", title: "Agency coordination" });
    expect(templates[0]).toMatchObject({ name: "Company OS", version: 2, notes: 14, folders: 4, agents: [{ slug: "ceo", name: "CEO", title: "The founder's interface" }] });
    expect(templates[1]!.description.length).toBeGreaterThan(20);
    expect(templates[0]!.description.length).toBeGreaterThan(20);
    expect(templates.every((row) => row.installed === undefined)).toBe(true);
    expect(existsSync(join(stateOf(), TEMPLATES_FILE))).toBe(false);
  });

  it("counts the legacy Company OS as installed on `brain` only when it is complete", async () => {
    const harness = harnessFor();
    seedTemplateVault(brainOf(), COMPANY_OS);
    const ceo = await harness.bots.create({ ...COMPANY_OS.bots[0]!, workspacePath: join(brainOf(), "Agents", "CEO") });
    new Storage(stateOf()).writeJson(TEMPLATE_FILE, { id: "company-os", version: 2, appliedAt: "2026-09-08T09:00:00.000Z", vault: "seeded", bots: { ceo: ceo.id }, routineIds: [] });
    const listed = (await harness.templates.list()).templates[0]!;
    expect(listed.installed).toEqual({ rootId: "brain", appliedAt: "2026-09-08T09:00:00.000Z", bots: 1, status: "ready" });
    const applied = await harness.templates.apply("company-os", "brain");
    expect(applied).toMatchObject({ id: "company-os", rootId: "brain", created: false, vault: "seeded", bots: { ceo: ceo.id } });
    expect(existsSync(vaultOf("company-os"))).toBe(false);
    expect(existsSync(join(stateOf(), TEMPLATES_FILE))).toBe(false);

    // The CEO deleted: the promise is no longer on this Mac, the row offers to create it.
    await harness.bots.remove(ceo.id);
    expect((await harness.templates.list()).templates[0]!.installed).toBeUndefined();
    const storage = new Storage(stateOf());
    expect(legacyCompanyOsInstallation(storage, brainOf(), [])).toBeNull();
    // `template.json` itself was never rewritten.
    expect(JSON.parse(readFileSync(join(stateOf(), TEMPLATE_FILE), "utf8")).bots).toEqual({ ceo: ceo.id });
  });

  it("does not take `vault: kept` or an empty bot map for a Company OS", async () => {
    const storage = new Storage(stateOf());
    seedStarterVault(brainOf());
    storage.writeJson(TEMPLATE_FILE, { id: "company-os", version: 2, appliedAt: "x", vault: "kept", bots: {}, routineIds: [] });
    expect(legacyCompanyOsInstallation(storage, brainOf(), [])).toBeNull();
    storage.writeJson(TEMPLATE_FILE, { id: "company-os", version: 2, appliedAt: "x", vault: "seeded", bots: {}, routineIds: [] });
    expect(legacyCompanyOsInstallation(storage, brainOf(), [])).toBeNull();
    storage.writeJson(TEMPLATE_FILE, { id: "company-os", version: 2, appliedAt: "x", vault: "upgraded", bots: { ceo: "bot_gone" }, routineIds: [] });
    expect(legacyCompanyOsInstallation(storage, brainOf(), [])).toBeNull();
    const harness = harnessFor();
    expect((await harness.templates.list()).templates[0]!.installed).toBeUndefined();
  });
});

describe("harness.templates.apply", () => {
  it("creates the Lead Gen Agency in its own vault: notes, six executable agents, one welcome, nothing scheduled", async () => {
    const harness = harnessFor();
    // A populated workspace: a brain with the person's notes and an agent of their own.
    seedStarterVault(brainOf());
    writeFileSync(join(brainOf(), "Journal.md"), "# Mine\n");
    const ada = await harness.bots.create({ name: "Ada" });
    const brainBefore = fingerprint(brainOf());

    const result = await harness.templates.apply("lead-gen-agency");
    expect(result).toMatchObject({ id: "lead-gen-agency", rootId: "vault:lead-gen-agency", created: true, vault: "seeded" });
    expect(result.groupId).toEqual(expect.any(String));
    expect(Object.keys(result.bots)).toEqual(SHIPPED_AGENCY.bots.map((bot) => bot.slug));

    // The vault, whole, with its graph and no staging folder left behind.
    const vault = vaultOf("lead-gen-agency");
    expect(lstatSync(vault).isDirectory()).toBe(true);
    expect(readdirSync(join(stateOf(), "vaults")).filter((name) => name.startsWith("."))).toEqual([]);
    const scan = await harness.brain.scan("vault:lead-gen-agency");
    expect(scan.root).toMatchObject({ id: "vault:lead-gen-agency", label: "Lead Gen Agency", path: vault, writable: true });
    expect(scan.notes.map(note => note.id)).toEqual(expect.arrayContaining(SHIPPED_AGENCY.notes.filter(note => note.path.endsWith(".md")).map(note => note.path)));
    expect(scan.graph.edges.filter(edge => edge.target.startsWith("ghost:") && !edge.source.startsWith("skills/"))).toEqual([]);
    expect(scan.capabilities.write).toBe(true);
    expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["vault:lead-gen-agency"]);

    // Six real bots in the roster, each working from its folder in the vault,
    // with the pack's own sheet — not a stub — and the person's Ada untouched.
    const bots = await harness.bots.list();
    expect(bots.map((bot) => bot.name)).toEqual(["Ada", ...SHIPPED_AGENCY.bots.map((bot) => bot.name)]);
    for (const row of SHIPPED_AGENCY.bots) {
      const bot = bots.find((candidate) => candidate.id === result.bots[row.slug])!;
      expect(bot.workspacePath).toBe(join(vault, "Agents", row.name));
      expect(bot.instructions).toContain(row.instructions);
      expect(bot.title).toBe(row.title);
      expect(bot.pinned).toBe(row.pinned === true);
      expect(readFileSync(join(bot.workspacePath!, `${row.name}.md`), "utf8")).toBe(
        SHIPPED_AGENCY.notes.find((note) => note.path === `Agents/${row.name}/${row.name}.md`)!.text,
      );
      const thread = await harness.threads.get({ botId: bot.id });
      if (row.welcome) {
        expect(thread.messages).toHaveLength(1);
        expect(thread.messages[0]).toMatchObject({ role: "bot", botId: bot.id, deliveryState: "complete" });
        expect((thread.messages[0]!.blocks[0] as { text: string }).text).toBe(row.welcome);
        expect(bot.unread).toBe(true);
        expect(bot.lastMessagePreview).toMatch(/^Welcome\./);
      } else {
        expect(thread.messages).toEqual([]);
        expect(bot.unread).toBe(false);
      }
    }
    expect((await harness.groups.list()).map(group => group.id)).toEqual([result.groupId]);
    expect(await harness.routines.list()).toEqual([]);

    // The person's brain and roster: byte for byte what they were.
    expect(fingerprint(brainOf())).toBe(brainBefore);
    expect((await harness.bots.list()).find((bot) => bot.id === ada.id)).toMatchObject({ name: "Ada", workspacePath: join(brainOf(), "Agents", "Ada") });

    // The registry: the installation, no journal left.
    const registry = registryOf();
    expect(registry.pending).toEqual({});
    expect(registry.installations["lead-gen-agency"]).toMatchObject({
      id: "lead-gen-agency",
      version: 1,
      rootId: "vault:lead-gen-agency",
      vaultPath: "vaults/lead-gen-agency",
      vault: "seeded",
      bots: result.bots,
      routineIds: [],
    });
    const listed = (await harness.templates.list()).templates[1]!;
    expect(listed.installed).toEqual({ rootId: "vault:lead-gen-agency", appliedAt: "2026-09-08T09:00:00.000Z", bots: 6, status: "ready" });
  });

  it("creates the Company OS in a managed vault when the brain is the person's — starter notes included", async () => {
    const harness = harnessFor();
    seedStarterVault(brainOf());
    const before = fingerprint(brainOf());
    // Launch on this workspace: the brain is kept, no agent is made in it.
    expect(await harness.templates.ensureDefault()).toMatchObject({ id: "company-os", vault: "kept", bots: 0, applied: true });
    expect(await harness.bots.list()).toEqual([]);
    expect(fingerprint(brainOf())).toBe(before);
    expect((await harness.templates.list()).templates[0]!.installed).toBeUndefined();

    const result = await harness.templates.apply("company-os");
    expect(result).toMatchObject({ id: "company-os", rootId: "vault:company-os", created: true, vault: "seeded" });
    const ceo = (await harness.bots.list()).find((bot) => bot.id === result.bots.ceo)!;
    expect(ceo).toMatchObject({ name: "CEO", pinned: true, unread: true, workspacePath: join(vaultOf("company-os"), "Agents", "CEO") });
    expect((await harness.threads.get({ botId: ceo.id })).messages).toHaveLength(1);
    expect(fingerprint(brainOf())).toBe(before);
    expect(existsSync(join(brainOf(), "Agents"))).toBe(false);
    const roots = await harness.brain.roots();
    expect(roots.map((root) => root.id)).toEqual(["vault:company-os"]);
    expect(fingerprint(brainOf())).toBe(before);
    expect((await harness.templates.list()).templates[0]!.installed).toEqual({ rootId: "vault:company-os", appliedAt: "2026-09-08T09:00:00.000Z", bots: 1, status: "ready" });
  });

  it("answers the same installation the second time, sequentially and at once, and after a restart", async () => {
    const harness = harnessFor();
    const [a, b] = await Promise.all([harness.templates.apply("lead-gen-agency"), harness.templates.apply("lead-gen-agency")]);
    expect(b).toEqual({ ...a, created: false });
    const again = await harness.templates.apply("lead-gen-agency");
    expect(again).toEqual({ ...a, created: false });
    expect(await harness.bots.list()).toHaveLength(6);
    expect(readdirSync(join(stateOf(), "vaults"))).toEqual(["lead-gen-agency"]);

    const reopened = harnessFor();
    expect(await reopened.templates.apply("lead-gen-agency")).toEqual({ ...a, created: false });
    expect(await reopened.bots.list()).toHaveLength(6);
    const director = (await reopened.bots.list()).find((bot) => bot.id === a.bots["agency-director"])!;
    expect((await reopened.threads.get({ botId: director.id })).messages).toHaveLength(1);
    expect((await reopened.brain.roots()).map((root) => root.id)).toContain("vault:lead-gen-agency");
  });

  it("serializes competing choices: exactly one template wins", async () => {
    const harness = harnessFor();
    const outcomes = await Promise.allSettled([harness.templates.apply("lead-gen-agency"), harness.templates.apply("company-os")]);
    expect(outcomes.map(row => row.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = outcomes.find(row => row.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "exists" });
    const registry = registryOf();
    expect(Object.keys(registry.installations)).toHaveLength(1);
    expect(registry.pending).toEqual({});
    const binding = (await harness.workspaceTemplate.get()).binding!;
    expect(Object.keys(registry.installations)).toEqual([binding.templateId]);
    expect(await harness.bots.list()).toHaveLength(binding.templateId === "company-os" ? 1 : 6);
    expect((await harness.brain.roots()).map(root => root.id)).toEqual([binding.rootId]);
    expect(readdirSync(join(stateOf(), "vaults"))).toEqual([binding.templateId]);
  });

  describe("a crash at every step, then a new harness", () => {
    /**
     * A fault fires ONCE, right AFTER the real effect it names has happened
     * on disk — the effect exists, its journal mark does not. Then a fresh
     * harness (a restart) retries. The parent's independent `verify-crash-
     * recovery.mjs` does the same on the compiled dist; this is the same
     * proof at source level, with more windows.
     */
    type Fault = {
      /** Which write to fail after (or before, for the journal). */
      rename?: (target: string) => boolean;
      writeJson?: (name: string, value: unknown, when: "before" | "after") => boolean;
      appendNdjson?: (entry: unknown) => boolean;
    };
    async function crashDuringApply(fault: Fault, id: "lead-gen-agency" | "company-os" = "lead-gen-agency"): Promise<void> {
      const rename = fs.renameSync;
      const write = Storage.prototype.writeJson;
      const append = Storage.prototype.appendNdjson;
      let injected = false;
      const fail = (): never => {
        injected = true;
        throw new Error("simulated interruption");
      };
      if (fault.rename) {
        fs.renameSync = function (from, to) {
          const out = rename.call(this, from, to);
          if (!injected && fault.rename!(String(to))) fail();
          return out;
        } as typeof fs.renameSync;
        syncBuiltinESMExports();
      }
      if (fault.writeJson) {
        Storage.prototype.writeJson = function (name, value) {
          if (!injected && fault.writeJson!(name, value, "before")) fail();
          write.call(this, name, value);
          if (!injected && fault.writeJson!(name, value, "after")) fail();
        };
      }
      if (fault.appendNdjson) {
        Storage.prototype.appendNdjson = function (path, entry) {
          append.call(this, path, entry);
          if (!injected && fault.appendNdjson!(entry)) fail();
        };
      }
      try {
        await expect(harnessFor().templates.apply(id)).rejects.toThrow(/simulated interruption/);
      } finally {
        fs.renameSync = rename;
        syncBuiltinESMExports();
        Storage.prototype.writeJson = write;
        Storage.prototype.appendNdjson = append;
      }
      expect(injected).toBe(true);
    }

    /** The whole promise, checked after the retry: one vault, six agents, one welcome, the director pinned. */
    async function expectWhole(harness: LocalBizosHarness, result: { bots: Record<string, string> }): Promise<void> {
      expect(Object.keys(result.bots)).toHaveLength(6);
      const bots = await harness.bots.list();
      expect(bots).toHaveLength(6);
      expect(new Set(bots.map((bot) => bot.name)).size).toBe(6);
      const director = bots.find((bot) => bot.id === result.bots["agency-director"])!;
      expect(director).toMatchObject({ pinned: true, unread: true, workspacePath: join(vaultOf("lead-gen-agency"), "Agents", "Agency Director") });
      const messages = (await harness.threads.get({ botId: director.id })).messages;
      expect(messages.filter((message) => message.role === "bot")).toHaveLength(1);
      for (const bot of bots) {
        if (bot.id === director.id) continue;
        expect((await harness.threads.get({ botId: bot.id })).messages).toEqual([]);
      }
      expect(readdirSync(join(stateOf(), "vaults"))).toEqual(["lead-gen-agency"]);
      expect(holdsTemplate(vaultOf("lead-gen-agency"), SHIPPED_AGENCY)).toBe(true);
      expect(registryOf().pending).toEqual({});
      expect(registryOf().installations["lead-gen-agency"]!.bots).toEqual(result.bots);
    }

    it("the journal itself cannot be written: nothing happens, and the next attempt is a first attempt", async () => {
      await crashDuringApply({ writeJson: (name, _value, when) => name === TEMPLATES_FILE && when === "before" });
      expect(existsSync(join(stateOf(), TEMPLATES_FILE))).toBe(false);
      expect(existsSync(join(stateOf(), "vaults"))).toBe(false);
      expect(await harnessFor().bots.list()).toEqual([]);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.created).toBe(true);
      await expectWhole(harness, result);
    });

    it("after the staging folder was journaled but before it was in place: the leftover is removed, one vault results", async () => {
      // The journal write that records the staging name succeeds; the crash
      // is the next journal write — the one that would have marked the vault.
      // Between the two, the staging folder was seeded and renamed.
      await crashDuringApply({
        writeJson: (name, value, when) =>
          name === TEMPLATES_FILE && when === "before" && Boolean((value as TemplateRegistry).pending["lead-gen-agency"]?.vault),
      });
      const journal = registryOf().pending["lead-gen-agency"]!;
      expect(journal.staging).toMatch(/^\.lead-gen-agency\.staging-/);
      expect(journal.vault).toBeUndefined();
      expect(existsSync(vaultOf("lead-gen-agency"))).toBe(true);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.created).toBe(true);
      await expectWhole(harness, result);
    });

    it("after a half-seeded staging folder: it is discarded, never adopted, and the vault is made whole", async () => {
      // Journal says "seeding <staging>"; the staging folder exists with two
      // notes; nothing was renamed. That is the crash inside `seedTemplateVault`.
      const storage = new Storage(stateOf());
      const staging = ".lead-gen-agency.staging-1-deadbeef";
      storage.writeJson(TEMPLATES_FILE, {
        version: 1,
        installations: {},
        pending: { "lead-gen-agency": { id: "lead-gen-agency", version: 1, startedAt: "x", staging, bots: {}, welcomes: {} } },
      });
      mkdirSync(join(stateOf(), "vaults", staging), { recursive: true });
      writeFileSync(join(stateOf(), "vaults", staging, "AGENTS.md"), "half");
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.created).toBe(true);
      await expectWhole(harness, result);
      expect(readFileSync(join(vaultOf("lead-gen-agency"), "AGENTS.md"), "utf8")).toBe(SHIPPED_AGENCY.notes[0]!.text);
    });

    it("after the vault was renamed into place but before the journal marked it", async () => {
      await crashDuringApply({ rename: (target) => target === vaultOf("lead-gen-agency") });
      expect(existsSync(vaultOf("lead-gen-agency"))).toBe(true);
      expect(registryOf().pending["lead-gen-agency"]!.vault).toBeUndefined();
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.created).toBe(true);
      await expectWhole(harness, result);
    });

    it("a folder at the vault's path that only LOOKS like the staging rename is still refused when it is not the pack", async () => {
      const storage = new Storage(stateOf());
      storage.writeJson(TEMPLATES_FILE, {
        version: 1,
        installations: {},
        pending: { "lead-gen-agency": { id: "lead-gen-agency", version: 1, startedAt: "x", staging: ".lead-gen-agency.staging-1-deadbeef", bots: {}, welcomes: {} } },
      });
      mkdirSync(vaultOf("lead-gen-agency"), { recursive: true });
      writeFileSync(join(vaultOf("lead-gen-agency"), "Theirs.md"), "# Not the pack\n");
      const before = fingerprint(vaultOf("lead-gen-agency"));
      await expect(harnessFor().templates.apply("lead-gen-agency")).rejects.toMatchObject({ code: "exists" });
      expect(fingerprint(vaultOf("lead-gen-agency"))).toBe(before);
      expect(await harnessFor().bots.list()).toEqual([]);
    });

    it("after an agent's id was journaled but before the roster had it: the agent is made with that id, once", async () => {
      await crashDuringApply({
        writeJson: (name, value, when) => {
          if (name !== TEMPLATES_FILE || when !== "after") return false;
          const journal = (value as TemplateRegistry).pending["lead-gen-agency"];
          return Boolean(journal && Object.keys(journal.bots).length === 1 && !Object.values(journal.bots)[0]!.created);
        },
      });
      const planned = registryOf().pending["lead-gen-agency"]!.bots["agency-director"]!;
      expect(planned.created).toBe(false);
      expect(await harnessFor().bots.list()).toEqual([]);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.bots["agency-director"]).toBe(planned.id);
      await expectWhole(harness, result);
    });

    it("after the roster persisted an agent but before its mark: found by id, pinned on the retry, not duplicated", async () => {
      await crashDuringApply({ writeJson: (name, value, when) => name === "bots.json" && when === "after" && (value as unknown[]).length === 1 });
      const persisted = await harnessFor().bots.list();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.pinned).toBe(false); // the pin comes after the persist; the crash was between
      const planned = registryOf().pending["lead-gen-agency"]!.bots["agency-director"]!;
      expect(planned).toEqual({ id: persisted[0]!.id, created: false });
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.bots["agency-director"]).toBe(persisted[0]!.id);
      await expectWhole(harness, result);
    });

    it("after the fourth agent persisted: the retry makes exactly the two missing ones", async () => {
      await crashDuringApply({ writeJson: (name, value, when) => name === "bots.json" && when === "after" && (value as unknown[]).length === 4 });
      const persisted = await harnessFor().bots.list();
      expect(persisted.map((bot) => bot.name)).toEqual(["Agency Director", "Acquisition", "Onboarding", "Strategist"]);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      for (const bot of persisted) expect(Object.values(result.bots)).toContain(bot.id);
      await expectWhole(harness, result);
    });

    it("after the welcome was appended but before its mark: one welcome, the bot unread, on the retry", async () => {
      await crashDuringApply({ appendNdjson: (entry) => (entry as { role: string }).role === "bot" });
      const journal = registryOf().pending["lead-gen-agency"]!;
      const welcome = journal.welcomes["agency-director"]!;
      expect(welcome.posted).toBe(false);
      const before = harnessFor();
      const directorId = journal.bots["agency-director"]!.id;
      expect((await before.threads.get({ botId: directorId })).messages.map((message) => message.id)).toEqual([welcome.id]);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      const messages = (await harness.threads.get({ botId: directorId })).messages;
      expect(messages.map((message) => message.id)).toEqual([welcome.id]);
      expect((messages[0]!.blocks[0] as { text: string }).text).toBe(SHIPPED_AGENCY.bots[0]!.welcome);
      await expectWhole(harness, result);
    });

    it("after the welcome's id was journaled but before it was appended: appended once, under that id", async () => {
      await crashDuringApply({
        writeJson: (name, value, when) =>
          name === TEMPLATES_FILE && when === "after" && Object.keys((value as TemplateRegistry).pending["lead-gen-agency"]?.welcomes ?? {}).length === 1,
      });
      const welcome = registryOf().pending["lead-gen-agency"]!.welcomes["agency-director"]!;
      expect(welcome.posted).toBe(false);
      const directorId = registryOf().pending["lead-gen-agency"]!.bots["agency-director"]!.id;
      expect((await harnessFor().threads.get({ botId: directorId })).messages).toEqual([]);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect((await harness.threads.get({ botId: directorId })).messages.map((message) => message.id)).toEqual([welcome.id]);
      await expectWhole(harness, result);
    });

    it("after the installation itself failed to be written: the retry writes it, and makes nothing", async () => {
      await crashDuringApply({
        writeJson: (name, value, when) => name === TEMPLATES_FILE && when === "before" && Boolean((value as TemplateRegistry).installations["lead-gen-agency"]),
      });
      const before = fingerprint(stateOf());
      const bots = await harnessFor().bots.list();
      expect(bots).toHaveLength(6);
      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.created).toBe(true);
      expect(new Set(Object.values(result.bots))).toEqual(new Set(bots.map((bot) => bot.id)));
      await expectWhole(harness, result);
      // Only the registry changed: not a note, not a thread, not the roster.
      const after = fingerprint(stateOf());
      expect(after).not.toBe(before);
      expect(fingerprint(vaultOf("lead-gen-agency"))).toBe(fingerprint(vaultOf("lead-gen-agency")));
      expect(await harness.bots.list()).toEqual(bots);
    });

    it("an agent the person deleted between the crash and the retry is not brought back", async () => {
      await crashDuringApply({ writeJson: (name, value, when) => name === "bots.json" && when === "after" && (value as unknown[]).length === 3 });
      const between = harnessFor();
      const onboarding = (await between.bots.list()).find((bot) => bot.name === "Onboarding")!;
      await between.bots.remove(onboarding.id);
      // Its folder went to the vault's own trash, and the journal knows.
      expect(existsSync(join(vaultOf("lead-gen-agency"), ".trash", "Onboarding", "Onboarding.md"))).toBe(true);
      expect(existsSync(join(brainOf(), ".trash"))).toBe(false);
      expect(registryOf().pending["lead-gen-agency"]!.bots.onboarding).toMatchObject({ id: onboarding.id, removed: true });

      const harness = harnessFor();
      const result = await harness.templates.apply("lead-gen-agency");
      expect(result.created).toBe(true);
      expect(result.bots.onboarding).toBeUndefined();
      expect(Object.keys(result.bots)).toHaveLength(5);
      const names = (await harness.bots.list()).map((bot) => bot.name);
      expect(names).not.toContain("Onboarding");
      expect(names).toHaveLength(5);
      expect((await harness.templates.list()).templates[1]!.installed).toMatchObject({ bots: 5, status: "ready" });
      expect(registryOf().pending).toEqual({});
    });

    it("the Company OS goes through the same journal", async () => {
      seedStarterVault(brainOf());
      const before = fingerprint(brainOf());
      await crashDuringApply({ writeJson: (name, value, when) => name === "bots.json" && when === "after" && (value as unknown[]).length === 1 }, "company-os");
      const harness = harnessFor();
      const result = await harness.templates.apply("company-os");
      expect(result).toMatchObject({ rootId: "vault:company-os", created: true });
      const bots = await harness.bots.list();
      expect(bots).toHaveLength(1);
      expect(bots[0]).toMatchObject({ id: result.bots.ceo, name: "CEO", pinned: true, unread: true });
      expect((await harness.threads.get({ botId: bots[0]!.id })).messages).toHaveLength(1);
      expect(fingerprint(brainOf())).toBe(before);
    });
  });

  it("answers a clear refusal, never another folder, when an installed vault was moved, replaced by a link, or cannot be examined", async () => {
    const harness = harnessFor();
    const installed = await harness.templates.apply("lead-gen-agency");
    const elsewhere = join(scratch, "elsewhere");
    fs.renameSync(vaultOf("lead-gen-agency"), elsewhere);
    expect((await harness.templates.list()).templates[1]!.installed).toMatchObject({ rootId: "vault:lead-gen-agency", bots: 6, status: "missing" });
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringMatching(/no longer at vaults\/lead-gen-agency/),
    });
    expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["vault:lead-gen-agency"]);
    await expect(harness.brain.scan("vault:lead-gen-agency")).rejects.toThrow();
    // Nothing was made to fill the gap: not a vault, not an agent.
    expect(existsSync(vaultOf("lead-gen-agency"))).toBe(false);
    expect(await harness.bots.list()).toHaveLength(6);

    symlinkSync(elsewhere, vaultOf("lead-gen-agency"));
    expect((await harness.templates.list()).templates[1]!.installed).toMatchObject({ status: "unreadable" });
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toMatchObject({ code: "not_found", message: expect.stringMatching(/not the vault/) });
    await expect(harness.brain.scan("vault:lead-gen-agency")).rejects.toThrow();
    await expect(harness.brain.createNote("vault:lead-gen-agency", "")).rejects.toThrow();
    expect(readdirSync(elsewhere)).toContain("AGENTS.md");
    rmSync(vaultOf("lead-gen-agency"));

    // Put back: the same installation, untouched.
    fs.renameSync(elsewhere, vaultOf("lead-gen-agency"));
    expect(await harness.templates.apply("lead-gen-agency")).toEqual({ ...installed, created: false });
    expect((await harness.templates.list()).templates[1]!.installed).toMatchObject({ status: "ready" });

    // A parent that cannot be examined (no search permission): refused, not guessed at.
    if (process.getuid?.() !== 0) {
      const vaults = join(stateOf(), "vaults");
      chmodSync(vaults, 0o000);
      try {
        await expect(harness.templates.apply("lead-gen-agency")).rejects.toMatchObject({ code: "not_found", message: expect.stringMatching(/not the vault/) });
        expect((await harness.templates.list()).templates[1]!.installed).toMatchObject({ status: "unreadable" });
        await expect(harness.templates.apply("company-os")).rejects.toMatchObject({ code: "exists" });
        expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["vault:lead-gen-agency"]);
      } finally {
        chmodSync(vaults, 0o700);
      }
      expect(existsSync(vaultOf("company-os"))).toBe(false);
    }
  });

  it("refuses a registry row that names any folder but its template's own vault", async () => {
    const storage = new Storage(stateOf());
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "Secret.md"), "# theirs\n");
    const row = (patch: Record<string, unknown>) => ({
      id: "lead-gen-agency",
      version: 1,
      rootId: "vault:lead-gen-agency",
      vaultPath: "vaults/lead-gen-agency",
      appliedAt: "x",
      vault: "seeded",
      bots: {},
      routineIds: [],
      ...patch,
    });
    const harness = harnessFor();
    for (const forged of [
      row({ vaultPath: "../elsewhere" }),
      row({ vaultPath: elsewhere }),
      row({ vaultPath: "brain" }),
      row({ rootId: "brain", vaultPath: "brain" }),
      row({ rootId: "acc_123" }),
      row({ rootId: "vault:company-os" }),
      row({ bots: { "../x": "bot_1" } }),
    ]) {
      storage.writeJson(TEMPLATES_FILE, { version: 1, installations: { "lead-gen-agency": forged }, pending: {} });
      await expect(harness.templates.list()).rejects.toThrow(/damaged/);
      await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/damaged/);
      expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["workspaces"]);
      await expect(harness.brain.scan("vault:lead-gen-agency")).rejects.toMatchObject({ code: "not_found" });
    }
    // The legacy pair is allowed for the Company OS alone.
    storage.writeJson(TEMPLATES_FILE, {
      version: 1,
      installations: { "company-os": { ...row({ id: "company-os", version: 2, rootId: "brain", vaultPath: "brain" }) } },
      pending: {},
    });
    expect((await harness.templates.list()).templates[0]!.installed).toMatchObject({ rootId: "brain" });
    expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["workspaces"]);
    // Installed and in progress at once is a contradiction, not a state.
    storage.writeJson(TEMPLATES_FILE, {
      version: 1,
      installations: { "lead-gen-agency": row({}) },
      pending: { "lead-gen-agency": { id: "lead-gen-agency", version: 1, startedAt: "x", bots: {}, welcomes: {} } },
    });
    await expect(harness.templates.list()).rejects.toThrow(/both installed and in progress/);
    // A journal whose staging name is not one this app makes.
    storage.writeJson(TEMPLATES_FILE, {
      version: 1,
      installations: {},
      pending: { "lead-gen-agency": { id: "lead-gen-agency", version: 1, startedAt: "x", staging: "../elsewhere", bots: {}, welcomes: {} } },
    });
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/damaged/);
    expect(readFileSync(join(elsewhere, "Secret.md"), "utf8")).toBe("# theirs\n");
  });

  it("refuses a folder already at vaults/<id> that no journal accounts for, and writes nothing", async () => {
    const harness = harnessFor();
    mkdirSync(vaultOf("lead-gen-agency"), { recursive: true });
    writeFileSync(join(vaultOf("lead-gen-agency"), "Theirs.md"), "# Not ours\n");
    const before = fingerprint(stateOf());
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toMatchObject({ code: "exists" });
    expect(fingerprint(stateOf())).toBe(before);
    expect(await harness.bots.list()).toEqual([]);
    expect(existsSync(join(stateOf(), TEMPLATES_FILE))).toBe(false);

    // A file where the vault should be: the same refusal.
    rmSync(vaultOf("company-os"), { recursive: true, force: true });
    writeFileSync(vaultOf("company-os"), "not a folder");
    await expect(harness.templates.apply("company-os")).rejects.toMatchObject({ code: "exists" });
    expect(await harness.bots.list()).toEqual([]);
  });

  it("refuses a symlink where vaults/<id>, vaults/ or templates.json should be, and nothing is written through it", async () => {
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);

    // The vault's own path.
    const harness = harnessFor();
    mkdirSync(join(stateOf(), "vaults"), { recursive: true });
    symlinkSync(elsewhere, vaultOf("lead-gen-agency"));
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/link/);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(await harness.bots.list()).toEqual([]);
    rmSync(vaultOf("lead-gen-agency"));

    // The parent.
    rmSync(join(stateOf(), "vaults"), { recursive: true });
    symlinkSync(elsewhere, join(stateOf(), "vaults"));
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/link/);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["workspaces"]);
    rmSync(join(stateOf(), "vaults"));

    // The registry.
    const foreign = JSON.stringify({ version: 1, installations: {}, pending: {} });
    writeFileSync(join(elsewhere, "registry.json"), foreign);
    symlinkSync(join(elsewhere, "registry.json"), join(stateOf(), TEMPLATES_FILE));
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/link/);
    await expect(harness.templates.list()).rejects.toThrow(/link/);
    expect(existsSync(vaultOf("lead-gen-agency"))).toBe(false);
    expect(readFileSync(join(elsewhere, "registry.json"), "utf8")).toBe(foreign);
    expect(await harness.bots.list()).toEqual([]);
  });

  it("refuses a damaged registry rather than starting a second copy of everything", async () => {
    const harness = harnessFor();
    const first = await harness.templates.apply("lead-gen-agency");
    writeFileSync(join(stateOf(), TEMPLATES_FILE), "{ not json");
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/damaged/);
    await expect(harness.templates.list()).rejects.toThrow(/damaged/);
    expect(await harness.bots.list()).toHaveLength(6);
    // The brain still opens; the managed vault is simply not offered until the file is repaired.
    expect((await harness.brain.roots()).map((root) => root.id)).toEqual(["vault:lead-gen-agency"]);

    writeFileSync(join(stateOf(), TEMPLATES_FILE), JSON.stringify({ version: 1, installations: { "lead-gen-agency": { id: "lead-gen-agency" } }, pending: {} }));
    await expect(harness.templates.apply("lead-gen-agency")).rejects.toThrow(/damaged/);
    writeFileSync(join(stateOf(), TEMPLATES_FILE), JSON.stringify({ version: 1, installations: { "not-a-template": {} }, pending: {} }));
    await expect(harness.templates.list()).rejects.toThrow(/damaged/);
    expect(await harness.bots.list()).toHaveLength(6);

    // Repaired: the same installation answers again.
    const storage = new Storage(stateOf());
    const registry: TemplateRegistry = { version: 1, installations: {}, pending: {} };
    registry.installations["lead-gen-agency"] = {
      id: "lead-gen-agency",
      version: 1,
      rootId: "vault:lead-gen-agency",
      vaultPath: "vaults/lead-gen-agency",
      appliedAt: "x",
      vault: "seeded",
      bots: first.bots,
      routineIds: [],
    };
    storage.writeJson(TEMPLATES_FILE, registry);
    expect(readTemplateRegistry(storage).installations["lead-gen-agency"]!.bots).toEqual(first.bots);
    expect((await harness.templates.apply("lead-gen-agency")).created).toBe(false);
  });

  it("refuses an id outside the catalogue without touching the disk", async () => {
    const harness = harnessFor();
    await expect(harness.templates.apply("../evil")).rejects.toMatchObject({ code: "not_found" });
    await expect(harness.templates.apply("Lead-Gen-Agency")).rejects.toMatchObject({ code: "not_found" });
    expect(existsSync(join(stateOf(), "vaults"))).toBe(false);
    expect(existsSync(join(stateOf(), TEMPLATES_FILE))).toBe(false);
  });

  it("keeps the chosen vault but refuses access if replaced by a symlink", async () => {
    const harness = harnessFor();
    await harness.templates.apply("lead-gen-agency");
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);
    rmSync(vaultOf("lead-gen-agency"), { recursive: true });
    symlinkSync(elsewhere, vaultOf("lead-gen-agency"));
    expect((await harness.brain.roots()).map(root => root.id)).toEqual(["vault:lead-gen-agency"]);
    await expect(harness.brain.scan("vault:lead-gen-agency")).rejects.toThrow();
    await expect(harness.brain.createNote("vault:lead-gen-agency", "")).rejects.toThrow();
    expect(readdirSync(elsewhere)).toEqual([]);
    await expect(harness.templates.apply("company-os")).rejects.toMatchObject({ code: "exists" });
  });

  it("trashes a deleted agent's folder in the vault it belongs to, and leaves the brain's trash alone", async () => {
    const harness = harnessFor();
    await harness.templates.ensureDefault();
    const result = await harness.templates.apply("lead-gen-agency");
    const strategist = (await harness.bots.list()).find((bot) => bot.id === result.bots.strategist)!;
    writeFileSync(join(strategist.workspacePath!, "Notes.md"), "# Notes\n");
    await harness.bots.remove(strategist.id);
    expect(existsSync(strategist.workspacePath!)).toBe(false);
    expect(readFileSync(join(vaultOf("lead-gen-agency"), ".trash", "Strategist", "Notes.md"), "utf8")).toBe("# Notes\n");
    expect(existsSync(join(brainOf(), ".trash"))).toBe(false);
    // The installation stays: the roster row is gone, the count says so, nothing is recreated.
    expect((await harness.templates.list()).templates[1]!.installed).toMatchObject({ bots: 5 });
    expect((await harness.templates.apply("lead-gen-agency")).created).toBe(false);
    expect((await harness.bots.list()).map((bot) => bot.name)).not.toContain("Strategist");
  });
});

describe("the bridge and the sidecar", () => {
  it("drives the two channels end to end through the IPC handlers", async () => {
    const harness = harnessFor();
    const handlers = buildHandlers(harness);
    const listed = (await runHandler(handlers["lbz:brain:templates"]!, [])) as IpcEnvelope;
    expect(listed.ok).toBe(true);
    if (listed.ok) expect((listed.value as { templates: unknown[] }).templates).toHaveLength(3);
    const applied = (await runHandler(handlers["lbz:brain:applyTemplate"]!, ["lead-gen-agency"])) as IpcEnvelope;
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.value).toMatchObject({ rootId: "vault:lead-gen-agency", created: true });
    const refused = (await runHandler(handlers["lbz:brain:applyTemplate"]!, ["../evil"])) as IpcEnvelope;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("invalid_payload");
    expect(await harness.bots.list()).toHaveLength(6);
  });

  it("answers 404 for an id outside the catalogue and 400 for a payload that is not one, before the harness is asked", async () => {
    const calls: string[] = [];
    const facade = new CollaborationFacade(
      {
        templates: {
          list: async () => {
            calls.push("list");
            return { templates: [] };
          },
          apply: async (id: string) => {
            calls.push(`apply:${id}`);
            return { id, rootId: `vault:${id}`, created: true, vault: "seeded", bots: {} };
          },
        },
      } as unknown as import("../src/harness/harness.js").LocalBizosHarness,
      "test",
      {} as never,
      emptyDurableIndex(),
    );
    await expect(facade.applyBrainTemplate({ id: "growth-studio" })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(facade.applyBrainTemplate({ id: "" })).rejects.toMatchObject({ status: 400 });
    await expect(facade.applyBrainTemplate({ id: "lead-gen-agency", extra: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(facade.applyBrainTemplate("lead-gen-agency")).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
    expect(await facade.applyBrainTemplate({ id: "lead-gen-agency" })).toMatchObject({ rootId: "vault:lead-gen-agency", created: true });
    expect(await facade.brainTemplates()).toEqual({ templates: [] });
    expect(calls).toEqual(["apply:lead-gen-agency", "list"]);
  });
});
