import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalBizosHarness, type HarnessOptions } from "../src/harness/harness.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";

const fixtures: Array<{ root: string; harness: LocalBizosHarness }> = [];

function fixture(input: { codex?: boolean; claude?: boolean; claudeBridge?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lbz-local-tools-status-"));
  const bridge = join(root, "local-team-mcp.js");
  if (input.claudeBridge) writeFileSync(bridge, "// fixture bridge\n");
  const options: HarnessOptions & { localTeamMcpScriptPath?: string } = {
    rootDir: root,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Tools status fixture",
    execPath: process.execPath,
    packaged: false,
    runAsNodeAvailable: false,
    // Deliberately absent: this is the disabled cloud MCP path that used to
    // produce the false "missing Node" diagnosis for the local tool surface.
    mcpScriptPath: join(root, "disabled-cloud-mcp.mjs"),
    environment: {
      PATH: "/nowhere",
      LBZ_CODEX_PATH: join(root, "missing-codex"),
      LBZ_CLAUDE_PATH: join(root, "missing-claude"),
      LBZ_CURSOR_PATH: join(root, "missing-cursor"),
    },
    devices: false,
    ...(input.codex ? { localTeamTools: () => [] } : {}),
    ...(input.claude ? {
      localTeamMcpScriptPath: bridge,
      localTeamMcp: () => ({ command: process.execPath, args: [bridge], env: {}, forwarded: {}, preApproved: true }),
    } : {}),
  };
  const harness = new LocalBizosHarness(options);
  fixtures.push({ root, harness });
  return harness;
}

afterEach(() => {
  for (const { root, harness } of fixtures.splice(0)) {
    harness.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

describe("local team-tool status", () => {
  it("reports registered local transports despite the deliberately absent cloud MCP", async () => {
    const harness = fixture({ codex: true, claude: true, claudeBridge: true });
    const status = await harness.runtime.toolsStatus();
    expect(status).toMatchObject({
      scope: "local",
      available: true,
      code: "ready",
      reason: null,
      transports: {
        codex: { available: true, code: "ready", reason: null },
        claude: { available: true, code: "ready", reason: null },
        cursor: { available: true, code: "ready", reason: null },
      },
      contexts: {
        agents: { available: true, code: "ready" },
        quickChats: { available: false, code: "intentionally_excluded" },
      },
    });
    const runtime = await new CollaborationFacade(harness, "status-fixture", new LocalTeamBroker()).localRuntime() as any;
    expect(runtime.tools).toEqual(status);
    expect(runtime.providers.recruitment.cursor).toBe(true);
    expect(runtime.providers.toolSurface).toEqual({
      computer: { codex: true, claude: true, api: true, ollama: true, cursor: true },
    });
    expect(await fixture({ codex: true }).plans.list()).toEqual([]);
  });

  it("degrades a missing Claude bridge without hiding the Codex transport", async () => {
    const status = await fixture({ codex: true, claude: true }).runtime.toolsStatus() as any;
    expect(status.available).toBe(true);
    expect(status.transports.codex).toMatchObject({ available: true, code: "ready" });
    expect(status.transports.claude).toMatchObject({ available: false, code: "bridge_missing" });
    expect(status.transports.claude.reason).toMatch(/bridge/i);
  });

  it("fails closed when no local transport is registered", async () => {
    const status = await fixture().runtime.toolsStatus() as any;
    expect(status).toMatchObject({
      scope: "local",
      available: false,
      code: "no_local_team_transport",
      transports: {
        codex: { available: false, code: "not_registered" },
        claude: { available: false, code: "not_registered" },
        cursor: { available: false, code: "not_registered" },
      },
    });
    expect(status.reason).toMatch(/team-tool transport/i);
  });
});
