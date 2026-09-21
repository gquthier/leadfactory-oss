import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_OS, seedTemplateVault, TEMPLATE_FILE } from "../src/harness/company-os.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import type { CodexTurnInput } from "../src/harness/codex-driver.js";
import type { ClaudeTurnInput } from "../src/harness/claude-driver.js";

const claude = vi.hoisted(() => ({ turns: [] as ClaudeTurnInput[] }));
vi.mock("../src/harness/claude-driver.js", async original => ({
  ...await original<object>(),
  startClaudeTurn: (input: ClaudeTurnInput) => {
    claude.turns.push(input);
    return { stop() {}, respond: () => "unavailable", sessionId: () => null, settled: () => false };
  },
}));
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bound-vault-security-")); claude.turns.length = 0; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const turns: CodexTurnInput[] = [];
  let picked = "";
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "",
    orgName: () => "Test", execPath: "/fake/node", packaged: false, runAsNodeAvailable: false,
    mcpScriptPath: join(root, "disabled.mjs"), devices: false,
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: "/fake/codex", LBZ_CLAUDE_PATH: "/fake/claude" },
    pickFolder: async () => picked, confirmWriteAccess: async () => true,
    startTurn: input => { turns.push(input); return { stop() {}, respond: () => "unavailable", sessionId: () => null, settled: () => false }; },
  });
  return { harness, turns, pick: (path: string) => { picked = path; } };
}

describe("company vault boundary regressions", () => {
  it("does not resurrect the last intentionally removed agent from a bound legacy Company OS", async () => {
    const { harness } = fixture();
    const brain = join(root, "state", "brain");
    seedTemplateVault(brain, COMPANY_OS);
    const ceo = await harness.bots.create({ ...COMPANY_OS.bots[0]!, workspacePath: join(brain, "Agents", "CEO") });
    harness.storage.writeJson(TEMPLATE_FILE, { id: "company-os", version: 2, appliedAt: "2026-09-21T00:00:00Z", vault: "seeded", bots: { ceo: ceo.id }, routineIds: [] });
    await harness.workspaceTemplate.bind({ templateId: "company-os", rootId: "brain" });
    await harness.bots.remove(ceo.id);
    const restarted = fixture().harness;
    await restarted.templates.ensureDefault();
    expect(await restarted.bots.list()).toEqual([]);
    expect((await restarted.workspaceTemplate.get()).binding?.templateId).toBe("company-os");
  });
  it("keeps an explicitly selected external working directory usable", async () => {
    const { harness, turns } = fixture();
    await harness.templates.apply("service-based-business");
    const custom = join(root, "authorized-project"); mkdirSync(custom);
    const bot = await harness.bots.create({ name: "Project agent", workspacePath: custom });
    await harness.threads.send({ botId: bot.id }, { text: "Read this project" });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.cwd).toBe(custom);
  });
  it("refuses a redirected vault even when the bot explicitly uses the vault root as its CWD", async () => {
    const { harness, turns } = fixture();
    await harness.templates.apply("service-based-business");
    const vault = join(root, "state", "vaults", "service-based-business");
    const bot = await harness.bots.create({ name: "Root agent", workspacePath: vault });
    const moved = join(root, "moved"); renameSync(vault, moved); symlinkSync(moved, vault);
    await harness.threads.send({ botId: bot.id }, { text: "Read company files" }).catch(() => undefined);
    expect(turns).toHaveLength(0);
  });
  for (const replaced of ["vault", "vaults", "state", "Agents", "agent"] as const) {
    it(`refuses a provider launch after replacing ${replaced} with a symlink`, async () => {
      const { harness, turns } = fixture();
      const installed = await harness.templates.apply("service-based-business");
      const vault = join(root, "state", "vaults", "service-based-business");
      const targets = { vault, vaults: join(root, "state", "vaults"), state: join(root, "state"), Agents: join(vault, "Agents"), agent: join(vault, "Agents", "Business Director") };
      const target = targets[replaced];
      const moved = join(root, "moved");
      renameSync(target, moved);
      symlinkSync(moved, target);
      // The entire real agent CWD exists behind this link. Dropping extra
      // writableRoots alone would still launch into the redirected directory.
      await harness.threads.send({ botId: installed.bots["business-director"]! }, { text: "Write Company.md" }).catch(() => undefined);
      expect(turns).toHaveLength(0);
    });
  }
  for (const replaced of ["vaults", "state"] as const) {
    it(`refuses Quick Chat after replacing ${replaced}`, async () => {
      const { harness, turns } = fixture();
      await harness.templates.apply("service-based-business");
      const target = replaced === "state" ? join(root, "state") : join(root, "state", "vaults");
      const moved = join(root, "moved");
      renameSync(target, moved); symlinkSync(moved, target);
      await expect(harness.quickChats.create("12345678-1234-4234-8234-123456789abc")).rejects.toThrow();
      expect(turns).toHaveLength(0);
    });
  }
  it("passes only editable shared directories to Claude's edit-permission roots", async () => {
    const { harness, pick } = fixture();
    const installed = await harness.templates.apply("service-based-business");
    const read = join(root, "read-only"); mkdirSync(read);
    const write = join(root, "editable"); mkdirSync(write);
    for (const [path, mode] of [[read, "read"], [write, "read-write"]] as const) {
      pick(path); const ticket = (await harness.access.pickFolder())!;
      await harness.access.grant({ nonce: ticket.nonce, mode });
    }
    await harness.runtime.setSettings({ mode: "local", local: { provider: "claude" } });
    await harness.threads.send({ botId: installed.bots["business-director"]! }, { text: "Read source and update notes" });
    expect(claude.turns).toHaveLength(1);
    expect(claude.turns[0]!.additionalDirectories).toContain(realpathSync(write));
    expect(claude.turns[0]!.additionalDirectories).not.toContain(realpathSync(read));
    expect(claude.turns[0]!.additionalDirectories).toContain(join(root, "state", "vaults", "service-based-business"));
  });
});
