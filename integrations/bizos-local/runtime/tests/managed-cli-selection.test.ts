import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = vi.hoisted(() => ({ codex: "", claude: "" }));
vi.mock("../src/harness/managed-cli.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/harness/managed-cli.js")>();
  return { ...original, installedManagedBinary: (_root: string, provider: "codex" | "claude") => fixture[provider] || null };
});
vi.mock("../src/harness/env-path.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/harness/env-path.js")>();
  return { ...original, findCliCandidates: () => [] };
});
import { requireCodexPath, probeCodexStatus } from "../src/harness/codex-status.js";
import { requireClaudePath, probeClaudeStatus } from "../src/harness/claude-status.js";
import { LocalBizosHarness } from "../src/harness/harness.js";

const roots: string[] = [];
afterEach(() => { fixture.codex = ""; fixture.claude = ""; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function binary(provider: "codex" | "claude") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "managed-selection-"))); roots.push(root);
  const path = join(root, provider);
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${provider === "codex" ? "codex-cli 0.155.1" : "2.1.283 (Claude Code)"}'; exit 0; fi\nexit 1\n`);
  chmodSync(path, 0o700);
  fixture[provider] = path;
  return { root, path };
}

describe("managed canonical selection", () => {
  it("uses the same absolute Codex binary for require, status, login and a turn", async () => {
    const { root, path } = binary("codex");
    const environment = { PATH: "/usr/bin:/bin" };
    expect(requireCodexPath(path, environment, { packaged: true, managedRoot: "/managed" })).toBe(path);
    const calls: string[] = [];
    const status = await probeCodexStatus(path, environment, (cli, args, _options, callback) => {
      calls.push(cli); callback(args[0] === "--version" ? null : new Error("not signed in"), args[0] === "--version" ? "codex-cli 0.155.1" : "", "");
    }, { packaged: true, managedRoot: "/managed" });
    expect(status.path).toBe(path); expect(calls).toEqual([path, path]);
    const launches: string[] = []; const turns: string[] = [];
    const harness = new LocalBizosHarness({ rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture", execPath: "/fake/node", packaged: true, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"), environment, devices: false,
      launchCliLogin: async ({ shellCommand }) => { launches.push(shellCommand); return { started: true }; },
      startTurn: input => { turns.push(input.cli); return { stop: () => undefined, respond: () => "", sessionId: () => null, settled: () => false }; },
    });
    const connected = await harness.plans.connect({ provider: "codex" });
    expect(connected.loginStarted).toBe(true);
    expect(launches[0]).toContain(`'${path}'`);
    await harness.runtime.setSettings({ mode: "local", local: { provider: "codex" } });
    const bot = await harness.bots.create({ name: "Fixture" });
    await harness.threads.send({ botId: bot.id }, { text: "Hello" });
    expect(turns[0]).toBe(path);
  });
  it("uses the same managed Claude path for require and auth probe", async () => {
    const { path } = binary("claude");
    const environment = { PATH: "/usr/bin:/bin" };
    expect(requireClaudePath(path, environment, { packaged: true, managedRoot: "/managed" })).toBe(path);
    const calls: string[] = [];
    const status = await probeClaudeStatus(path, environment, (cli, args, _options, callback) => {
      calls.push(cli); callback(args[0] === "--version" ? null : new Error("not signed in"), args[0] === "--version" ? "2.1.283 (Claude Code)" : "", "");
    }, { packaged: true, managedRoot: "/managed", configDir: "/isolated" });
    expect(status.path).toBe(path); expect(status.found).toBe(true); expect(calls).toEqual([path, path]);
  });
});
