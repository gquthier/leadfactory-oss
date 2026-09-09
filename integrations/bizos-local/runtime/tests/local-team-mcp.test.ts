import { describe, expect, it, vi } from "vitest";
import { handleLocalTeamMessage } from "../src/local-team-mcp.js";

describe("local team MCP", () => {
  it("exposes only bounded local team management and returns persistent identifiers", async () => {
    const listed = await handleLocalTeamMessage({ id: 1, method: "tools/list", params: {} });
    expect(JSON.stringify(listed)).toContain("recruit_agent");
    expect(JSON.stringify(listed)).toContain("manage_agent");
    const recruit = vi.fn(async () => ({ agent: { agentId: "local:i:agent:b" }, teamThreadId: "local:i:thread:g" }));
    const manage = vi.fn(async () => ({ agent: { agentId: "local:i:agent:b" }, active: false }));
    const called = await handleLocalTeamMessage({
      id: 2,
      method: "tools/call",
      params: { name: "recruit_agent", arguments: { name: "Scout", title: "Research", mission: "Verify sources" } },
    }, recruit, manage);
    expect(recruit).toHaveBeenCalledOnce();
    expect(JSON.stringify(called)).toContain("local:i:agent:b");
    await handleLocalTeamMessage({
      id: 3,
      method: "tools/call",
      params: { name: "manage_agent", arguments: { agent_id: "local:i:agent:b", name: "Scout 2", active: false } },
    }, recruit, manage);
    expect(manage).toHaveBeenCalledOnce();
  });
});

describe("task checkpoint transport", () => {
  it("exposes and routes the same checkpoint tool for Claude", async () => {
    const checkpoint = vi.fn(async input => input);
    const params = { name: "checkpoint_task", arguments: { objective: "verify", status: "completed", summary: "read file", next_step: "", evidence: ["file read back"] } };
    const listed = await handleLocalTeamMessage({ id: 1, method: "tools/list" });
    expect(JSON.stringify(listed)).toContain("checkpoint_task");
    const result = await handleLocalTeamMessage({ id: 2, method: "tools/call", params }, undefined, undefined, undefined, checkpoint);
    expect(checkpoint).toHaveBeenCalledWith(params.arguments);
    expect(JSON.stringify(result)).toContain("file read back");
  });
});
