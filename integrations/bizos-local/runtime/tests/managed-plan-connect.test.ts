import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { resetPathCacheForTests } from "../src/harness/env-path.js";

const installFixture = vi.hoisted(() => ({ path: "", calls: 0, forceMissing: false }));
vi.mock("../src/harness/env-path.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/harness/env-path.js")>();
  return { ...original, findCliCandidates: (...args: Parameters<typeof original.findCliCandidates>) => installFixture.forceMissing ? [] : original.findCliCandidates(...args) };
});
vi.mock("../src/harness/managed-cli.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/harness/managed-cli.js")>();
  return { ...original, installManagedCli: async (...args: Parameters<typeof original.installManagedCli>) => {
    if (!installFixture.path) return original.installManagedCli(...args);
    installFixture.calls++;
    await new Promise(resolve => setTimeout(resolve, 15));
    return installFixture.path;
  } };
});

const roots: string[] = [];
afterEach(() => { resetPathCacheForTests(); installFixture.path = ""; installFixture.calls = 0; installFixture.forceMissing = false; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup(provider: "codex" | "claude", started: boolean, signedIn = false) {
  const root = mkdtempSync(join(tmpdir(), "managed-connect-")); roots.push(root);
  const bin = join(root, "bin"); mkdirSync(bin);
  const path = join(bin, provider);
  const version = provider === "codex" ? "codex-cli 0.155.1" : "2.1.283 (Claude Code)";
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi\n${signedIn ? `echo '${provider === "codex" ? "Logged in" : '{"loggedIn":true}'}'; exit 0` : "exit 1"}\n`);
  chmodSync(path, 0o700);
  const launches: string[] = [];
  const harness = new LocalBizosHarness({ rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
    execPath: "/fake/node", packaged: true, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"), environment: { PATH: bin, OPENAI_API_KEY: "fake", NODE_OPTIONS: "--require /evil" }, devices: false,
    launchCliLogin: async ({ shellCommand }) => { launches.push(shellCommand); return { started }; },
  });
  return { harness, path, launches };
}
function authorize(path: string, provider: "codex" | "claude") {
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${provider === "codex" ? "codex-cli 0.155.1" : "2.1.283 (Claude Code)"}'; exit 0; fi\necho '${provider === "codex" ? "Logged in" : '{"loggedIn":true}'}'\n`);
  chmodSync(path, 0o700);
}

describe("plan connection with an existing canonical CLI", () => {
  it("imports authenticated default Codex home before creating an isolated plan", async () => {
    const { harness, launches, path } = setup("codex", false, true);
    const imported = await harness.plans.connect({ provider: "codex" });
    expect(imported.loginStarted).toBe(false);
    expect(launches).toEqual([]);
    expect((await harness.plans.list()).filter(row => row.provider === "codex")).toHaveLength(1);
    expect(path).toContain("codex");
    const second = await harness.plans.connect({ provider: "codex" });
    expect(second.planId).not.toBe(imported.planId);
    expect((await harness.plans.list()).filter(row => row.provider === "codex")).toHaveLength(2);
    expect(launches).toHaveLength(1);
    expect((await harness.plans.connect({ provider: "codex", importDefault: true })).planId).toBe(imported.planId);
  });
  for (const provider of ["codex", "claude"] as const) {
    it(`${provider} retries the same isolated plan and launches its exact binary`, async () => {
      const { harness, path, launches } = setup(provider, false);
      const first = await harness.plans.connect({ provider });
      const second = await harness.plans.connect({ provider });
      expect(first.loginStarted).toBe(false);
      expect(second.planId).toBe(first.planId);
      expect((await harness.plans.list()).filter(row => row.provider === provider)).toHaveLength(1);
      expect(launches).toHaveLength(2);
      expect(launches[0]).toContain(`'${realpathSync(path)}'`);
      expect(launches[0]).toContain("/usr/bin/env -i PATH=");
      expect(launches[0]).not.toContain("fake");
      expect(launches[0]).not.toContain("NODE_OPTIONS");
      expect(launches[0]).toContain(provider === "codex" ? "CODEX_HOME=" : "CLAUDE_CONFIG_DIR=");
      if (provider === "claude") expect(launches[0]).toContain("DISABLE_AUTOUPDATER=1");
      const checked = await harness.plans.test(first.planId);
      expect(checked.ok).toBe(false);
    });
  }
  it("keeps a connected isolated account and gives a fresh Connect a distinct home", async () => {
    const { harness, path, launches } = setup("codex", true);
    const first = await harness.plans.connect({ provider: "codex" });
    authorize(path, "codex");
    expect((await harness.plans.test(first.planId)).ok).toBe(true);
    const next = await harness.plans.connect({ provider: "codex" });
    expect(next.planId).not.toBe(first.planId);
    expect((await harness.plans.list()).filter(row => row.provider === "codex")).toHaveLength(2);
    expect(launches).toHaveLength(2);
    expect(launches[0]).not.toBe(launches[1]);
  });
  it("retries a pending plan with the requested label without taking another label's home", async () => {
    const { harness } = setup("claude", false);
    const one = await harness.plans.connect({ provider: "claude", label: "One" });
    const two = await harness.plans.connect({ provider: "claude", label: "Two" });
    expect(two.planId).not.toBe(one.planId);
    expect((await harness.plans.connect({ provider: "claude", label: "One" })).planId).toBe(one.planId);
  });
  it("coalesces concurrent duplicate install and Terminal launch", async () => {
    const { harness, path, launches } = setup("codex", true);
    rmSync(path);
    installFixture.forceMissing = true;
    installFixture.path = path + "-installed";
    writeFileSync(installFixture.path, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'codex-cli 0.155.1'; exit 0; fi\nexit 1\n");
    chmodSync(installFixture.path, 0o700);
    const original = harness.plans.connect;
    // The installer delay lets the second caller join the first before launch.
    const first = original({ provider: "codex", label: "Second" });
    const second = original({ provider: "codex", label: "Second" });
    const results = await Promise.all([first, second]);
    expect(results[0].planId).toBe(results[1].planId);
    expect(installFixture.calls).toBe(1);
    expect(launches).toHaveLength(1);
  });
});
