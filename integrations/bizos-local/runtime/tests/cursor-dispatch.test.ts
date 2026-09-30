import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodexTurnHandle } from "../src/harness/codex-driver.js";
import type { CursorTurnInput } from "../src/harness/cursor-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";

let root: string;
let harness: LocalBizosHarness | null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lbz-cursor-dispatch-"));
  harness = null;
});

afterEach(() => {
  harness?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("Cursor dispatch MCP surface", () => {
  it("issues distinct run-bound mounts to two agents and rebuilds full context instead of crossing profiles", async () => {
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "plans.json"), JSON.stringify({
      plans: [{
        id: "pln_cursor_fixture",
        provider: "cursor",
        label: "Cursor fixture",
        authKind: "oauth",
        status: "connected",
        cursorHome: join(root, ".cursor"),
        createdAt: "2026-09-26T00:00:00.000Z",
        priority: 0,
      }],
      routing: { pins: {}, defaultPolicy: "priority", activePlanId: "pln_cursor_fixture" },
    }));
    const turns: CursorTurnInput[] = [];
    harness = new LocalBizosHarness({
      rootDir: state,
      homeDir: root,
      baseUrl: "",
      readSessionCookie: async () => "",
      orgName: () => "Cursor fixture",
      execPath: process.execPath,
      packaged: false,
      runAsNodeAvailable: false,
      mcpScriptPath: join(root, "missing-cloud-mcp.mjs"),
      localTeamMcpScriptPath: process.execPath,
      localTeamMcp: ({ bot, threadId, runId }) => ({
        command: process.execPath,
        args: ["/fixture/local-team-mcp.mjs"],
        env: { FIXTURE: "cursor" },
        forwarded: { LBZ_LOCAL_TEAM_TICKET: `${bot.id}:${threadId}:${runId}` },
        preApproved: true,
      }),
      environment: { PATH: "/nowhere", LBZ_CURSOR_PATH: join(root, "cursor-agent") },
      devices: false,
      startCursorTurn: input => {
        turns.push(input);
        return {
          stop: () => undefined,
          respond: () => "unavailable",
          sessionId: () => null,
          settled: () => false,
        } satisfies CodexTurnHandle;
      },
      localArchitecture: input => ({
        mode: "local",
        instanceId: "fixture",
        workspaceId: "workspace",
        agentId: input.bot.id,
        threadId: input.threadId,
        workspaceDir: input.workspaceDir,
        sandbox: input.sandbox,
        supportedProviders: ["cursor"],
        peers: input.peers.map(peer => ({ agentId: peer.id, name: peer.name })),
        // The sidecar names the exact tools it mounts; the brief lists only those.
        mcpToolNames: ["checkpoint_task", "recruit_agent", "send_to_chat", "schedule_routine"],
        recruitment: "autonomous-local-tools",
      }),
    });
    await harness.runtime.setSettings({
      mode: "local",
      local: { provider: "cursor", activePlanId: "pln_cursor_fixture" },
    });
    // .54 detects each family of this Mac on its own: a developer machine's
    // Codex or Claude login may add a row here. The Cursor fixture is the one.
    expect((await harness.plans.list()).filter((plan) => plan.provider === "cursor")).toHaveLength(1);
    const first = await harness.bots.create({ name: "Alpha" });
    const second = await harness.bots.create({ name: "Beta" });

    await harness.threads.send({ botId: first.id }, { text: "First task" });
    await harness.threads.send({ botId: second.id }, { text: "Second task" });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(turns).toHaveLength(2);
    const firstServer = turns[0]!.mcpServers?.local_team_actions;
    const secondServer = turns[1]!.mcpServers?.local_team_actions;
    expect(firstServer?.preApproved).toBe(true);
    expect(secondServer?.preApproved).toBe(true);
    expect(firstServer?.forwarded.LBZ_LOCAL_TEAM_TICKET).toContain(first.id);
    expect(secondServer?.forwarded.LBZ_LOCAL_TEAM_TICKET).toContain(second.id);
    expect(firstServer?.forwarded.LBZ_LOCAL_TEAM_TICKET).not.toBe(
      secondServer?.forwarded.LBZ_LOCAL_TEAM_TICKET,
    );
    for (const turn of turns) {
      expect(turn.resumeCursor).toBeNull();
      expect(turn.system).toContain("checkpoint_task");
      expect(turn.system).toContain("recruit_agent");
      expect(turn.system).toContain("browser: none of your own");
    }
  });
});
