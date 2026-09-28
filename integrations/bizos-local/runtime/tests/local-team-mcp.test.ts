import { describe, expect, it, vi } from "vitest";
import { handleLocalTeamMessage, LOCAL_TEAM_TOOL_SPECS, toolsetsFromArgv } from "../src/local-team-mcp.js";

describe("local team MCP", () => {
  it("matches the sidecar's computer seats and never advertises cloud tools on a server seat", async () => {
    const old = process.env.BIZOS_LOCAL_COMPUTER_ENABLED;
    process.env.BIZOS_LOCAL_COMPUTER_ENABLED = "true";
    try {
      const computer = vi.fn(async () => ({ ok: true, text: "screen ready" }));
      const serverSeat = { toolsets: toolsetsFromArgv(["--toolset=team,computer"]), computer };
      const listed = await handleLocalTeamMessage({ id: 1, method: "tools/list" }, undefined, undefined, undefined, undefined, serverSeat);
      expect(JSON.stringify(listed)).toContain("computer_observe");
      expect(JSON.stringify(listed)).not.toContain("cloud_computer_run");
      const called = await handleLocalTeamMessage({ id: 2, method: "tools/call", params: { name: "computer_observe", arguments: {} } }, undefined, undefined, undefined, undefined, serverSeat);
      expect(computer).toHaveBeenCalledWith({ tool: "computer_observe", arguments: {} });
      expect(JSON.stringify(called)).toContain("screen ready");
      const cloudOnly = { toolsets: toolsetsFromArgv(["--toolset=team,cloud"]) };
      const cloudList = await handleLocalTeamMessage({ id: 3, method: "tools/list" }, undefined, undefined, undefined, undefined, cloudOnly);
      expect(JSON.stringify(cloudList)).toContain("cloud_computer_run");
      expect(JSON.stringify(cloudList)).not.toContain("computer_observe");
    } finally {
      if (old === undefined) delete process.env.BIZOS_LOCAL_COMPUTER_ENABLED;
      else process.env.BIZOS_LOCAL_COMPUTER_ENABLED = old;
    }
  });
  it("explains custom recruitment without requiring a prepared role catalog", () => {
    const recruit = LOCAL_TEAM_TOOL_SPECS.find((tool) => tool.name === "recruit_agent")!;
    expect(recruit.description).toContain("name, title, description, context and initial_task");
    expect(recruit.description).toContain("without role_slug");
    expect(recruit.inputSchema.anyOf).toEqual([
      { required: ["role_slug"] }, { required: ["name", "title"] },
    ]);
  });

  it("mounts bounded context tools only for an explicitly scoped local toolset", async () => {
    const ordinary = await handleLocalTeamMessage({ id: 1, method: "tools/list" });
    expect(JSON.stringify(ordinary)).not.toContain("read_context_file");
    const context = vi.fn(async () => ({ bytesRead: 8, text: "example" }));
    const scoped = await handleLocalTeamMessage({ id: 2, method: "tools/list" }, undefined, undefined, undefined, undefined,
      { toolsets: new Set(["team", "context"]), context });
    expect(JSON.stringify(scoped)).toContain("read_context_file");
    const called = await handleLocalTeamMessage({ id: 3, method: "tools/call", params: { name: "read_context_file", arguments: { path: "brief.txt" } } },
      undefined, undefined, undefined, undefined, { toolsets: new Set(["team", "context"]), context });
    expect(context).toHaveBeenCalledWith({ tool: "read_context_file", arguments: { path: "brief.txt" } });
    expect(JSON.stringify(called)).toContain("example");
    const linked = await handleLocalTeamMessage({ id: 4, method: "tools/list" }, undefined, undefined, undefined, undefined,
      { toolsets: new Set(["team", "context", "continuity"]), context });
    expect(JSON.stringify(linked)).not.toContain("read_context_file");
  });
  it("exposes only bounded local team management and returns persistent identifiers", async () => {
    const listed = await handleLocalTeamMessage({
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(JSON.stringify(listed)).toContain("recruit_agent");
    expect(JSON.stringify(listed)).toContain("manage_agent");
    const recruit = vi.fn(async () => ({
      agent: { agentId: "local:i:agent:b" },
      teamThreadId: "local:i:thread:g",
    }));
    const manage = vi.fn(async () => ({
      agent: { agentId: "local:i:agent:b" },
      active: false,
    }));
    const called = await handleLocalTeamMessage(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "recruit_agent",
          arguments: {
            name: "Scout",
            title: "Research",
            mission: "Verify sources",
          },
        },
      },
      recruit,
      manage,
    );
    expect(recruit).toHaveBeenCalledOnce();
    expect(JSON.stringify(called)).toContain("local:i:agent:b");
    await handleLocalTeamMessage(
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "manage_agent",
          arguments: {
            agent_id: "local:i:agent:b",
            name: "Scout 2",
            active: false,
          },
        },
      },
      recruit,
      manage,
    );
    expect(manage).toHaveBeenCalledOnce();
  });
});

describe("task checkpoint transport", () => {
  it("exposes and routes the same checkpoint tool for Claude", async () => {
    const checkpoint = vi.fn(async (input) => input);
    const params = {
      name: "checkpoint_task",
      arguments: {
        objective: "verify",
        status: "completed",
        summary: "read file",
        next_step: "",
        evidence: ["file read back"],
      },
    };
    const listed = await handleLocalTeamMessage({
      id: 1,
      method: "tools/list",
    });
    expect(JSON.stringify(listed)).toContain("checkpoint_task");
    const result = await handleLocalTeamMessage(
      { id: 2, method: "tools/call", params },
      undefined,
      undefined,
      undefined,
      checkpoint,
    );
    expect(checkpoint).toHaveBeenCalledWith(params.arguments);
    expect(JSON.stringify(result)).toContain("file read back");
  });
});

it("reports oversized continuity archive results as an error without returning silently cut JSON", async () => {
  const result: any = await handleLocalTeamMessage(
    {
      id: 1,
      method: "tools/call",
      params: { name: "read_conversation_archive", arguments: { after: 0 } },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    {
      toolsets: new Set(["continuity"]),
      continuity: async () => ({ events: [{ content: "x".repeat(65000) }] }),
    },
  );
  expect(result.result.isError).toBe(true);
  expect(result.result.content[0].text).toContain("was not truncated");
  expect(result.result.content[0].text.length).toBeLessThan(500);
});
