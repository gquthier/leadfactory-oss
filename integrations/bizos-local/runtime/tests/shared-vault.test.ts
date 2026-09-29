import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lbz-shared-vault-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setup() {
  const turns: CodexTurnInput[] = [];
  const architectureInputs: Array<{ sharedBrainPath?: string }> = [];
  const cli = join(root, "scripted-codex");
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"),
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Fixture company",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: cli },
    devices: false,
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      return { stop: () => undefined, respond: () => "unavailable", sessionId: () => null, settled: () => false };
    },
    localArchitecture: (input) => {
      architectureInputs.push({ sharedBrainPath: input.sharedBrainPath });
      return {
        mode: "local",
        instanceId: "fixture",
        workspaceId: "local:fixture:workspace",
        agentId: `local:fixture:agent:${input.bot.id}`,
        threadId: `local:fixture:thread:${input.threadId}`,
        workspaceDir: input.workspaceDir,
        sharedBrainPath: input.sharedBrainPath,
        sandbox: input.sandbox,
        supportedProviders: ["codex", "claude", "cursor"],
        peers: input.peers.map((peer) => ({ agentId: peer.id, name: peer.name })),
        recruitment: "autonomous-codex-claude",
      };
    },
  });
  return { harness, turns, architectureInputs };
}

describe("bound company vault provider contract", () => {
  it("adds only the verified bound vault to workspace-write and keeps recruited peers inside it despite a global working directory", async () => {
    const { harness, turns, architectureInputs } = setup();
    const installed = await harness.templates.apply("service-based-business");
    const vault = join(root, "state", "vaults", "service-based-business");
    const globalWorkingDir = join(root, "global-workspaces");
    mkdirSync(globalWorkingDir);
    await harness.runtime.setSettings({ mode: "local", local: { workingDir: globalWorkingDir } });

    // This is the same generic bot-creation path used by recruit_agent.
    const peer = await harness.bots.create({ name: "Research Peer", title: "Research", description: "Verify sources" });
    expect(peer.workspacePath).toBe(join(vault, "Agents", "Research Peer"));

    const director = (await harness.bots.list()).find((bot) => bot.id === installed.bots.ceo)!;
    await harness.threads.send({ botId: director.id }, { text: "Update Company.md with the agreed facts." });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.sandbox).toBe("workspace-write");
    expect(turns[0]!.writableRoots).toEqual([vault]);
    expect(turns[0]!.writableRoots).not.toContain(join(root, "state"));
    expect(turns[0]!.writableRoots).not.toContain(globalWorkingDir);
    expect(turns[0]!.developerInstructions).toContain(`shared second brain: ${vault}`);
    expect(architectureInputs.at(-1)).toEqual({ sharedBrainPath: vault });
  });

  it("does not turn an unavailable or symlink-replaced bound root into a grant", async () => {
    const { harness, turns, architectureInputs } = setup();
    const installed = await harness.templates.apply("service-based-business");
    const vault = join(root, "state", "vaults", "service-based-business");
    const moved = join(root, "moved-vault");
    const outside = join(root, "outside");
    renameSync(vault, moved);
    mkdirSync(outside);
    symlinkSync(outside, vault);

    const director = (await harness.bots.list()).find((bot) => bot.id === installed.bots.ceo)!;
    await harness.threads.send({ botId: director.id }, { text: "Read the company context." }).catch(() => undefined);
    expect(turns).toHaveLength(0);
    expect(architectureInputs).toHaveLength(0);
  });

  it("does not leak a new company's vault to a historical agent outside that workspace", async () => {
    const { harness, turns, architectureInputs } = setup();
    const historical = await harness.bots.create({ name: "Historical" });
    await harness.templates.apply("service-based-business");
    await harness.threads.send({ botId: historical.id }, { text: "Continue the old task." });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.writableRoots ?? []).toEqual([]);
    expect(`${turns[0]!.developerInstructions ?? ""}\n${turns[0]!.system ?? ""}`).not.toContain("shared second brain:");
    expect(architectureInputs.at(-1)).toEqual({ sharedBrainPath: undefined });
  });

  it("does not grant the runtime state root or historical vaults while unbound", async () => {
    const { harness, turns, architectureInputs } = setup();
    const bot = await harness.bots.create({ name: "Unbound" });
    await harness.threads.send({ botId: bot.id }, { text: "Hello" });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.writableRoots ?? []).toEqual([]);
    expect(`${turns[0]!.developerInstructions ?? ""}\n${turns[0]!.system ?? ""}`).not.toContain("shared second brain:");
    expect(architectureInputs.at(-1)).toEqual({ sharedBrainPath: undefined });
  });
});
