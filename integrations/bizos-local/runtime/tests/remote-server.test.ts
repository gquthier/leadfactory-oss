import { describe, expect, it } from "vitest";
import { RemoteServerComputerBackend, serverActions } from "../src/computer/remote-server.js";
import type { ContinuityTransport } from "../src/continuity-bridge.js";

const shot = Buffer.from("fixture-image").toString("base64");
const observation = { url: "https://example.test/", title: "Example", text: "Page content", elements: [{ id: "e1", tag: "button", label: "Open" }] };

describe("server-owned local agent computer", () => {
  it("maps only supported actions and keeps element ids from observation", () => {
    expect(serverActions([{ kind: "clickSelector", selector: "e1", button: "left" }])).toEqual([{ type: "click", elementId: "e1", button: "left" }]);
    expect(serverActions([{ kind: "clickSelector", selector: "e2", button: "right" }])).toEqual([{ type: "click", elementId: "e2", button: "right" }]);
    expect(serverActions([{ kind: "scroll", direction: "down", amount: 2 }])).toEqual([{ type: "scroll", deltaX: 0, deltaY: 600 }]);
    expect(() => serverActions([{ kind: "clickSelector", selector: "#password", button: "left" }])).toThrow(/Observe/);
    expect(serverActions([{ kind: "pointer", x: 1, y: 2, type: "move", button: "left" }])).toEqual([{ type: "pointer", phase: "move", x: 1, y: 2, button: "left" }]);
    expect(serverActions([{ kind: "key", key: "A", modifiers: ["control"] }])).toEqual([{ type: "key", key: "A", modifiers: ["control"] }]);
  });

  it("routes each bot through the signed main transport without a provider credential", async () => {
    const calls: Array<{ op: string; body: Record<string, unknown> }> = [];
    const transport: ContinuityTransport = async (op, body) => {
      calls.push({ op, body });
      if (op === "computer/observe" || op === "computer/act") {
        return { completed: 1, observation, screenshot: { mimeType: "image/jpeg", imageBase64: shot } } as never;
      }
      if (op === "computer/signed_in_hosts") return { hosts: ["example.test"] } as never;
      if (op === "computer/request_handoff") return { handoff: { id: "handoff-1", status: "pending" } } as never;
      if (op === "computer/download") return { file: { path: "/home/boat/Downloads/a.pdf", name: "a.pdf", bytes: 3 } } as never;
      return { awake: true } as never;
    };
    const backend = new RemoteServerComputerBackend(transport, () => "org-a", () => "workspace-a");
    await backend.start("bot_one");
    const first = await backend.observe("bot_one");
    expect(first.elements[0]?.selector).toBe("e1");
    expect(first.imageBase64).toBe(shot);
    expect((await backend.capture("bot_one"))?.full).toContain(shot);
    expect(await backend.signedInHosts("bot_one")).toEqual(["example.test"]);
    expect(await backend.requestServerHandoff("bot_one", "Login required")).toBe("handoff-1");
    expect((await backend.download("bot_one", "https://example.test/a.pdf")).name).toBe("a.pdf");
    await backend.start("bot_two");
    expect(calls.map(call => call.body.agentId)).toEqual([
      "bot_one", "bot_one", "bot_one", "bot_one", "bot_one", "bot_two",
    ]);
    expect(calls.every(call => call.body.orgId === "org-a" && call.body.workspaceId === "workspace-a")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("BOAT_API_KEY");
  });

  it("refuses to call the server when the workspace loses its signed org binding", async () => {
    let called = false;
    const backend = new RemoteServerComputerBackend(async () => { called = true; return {} as never; }, () => null, () => "workspace-a");
    await expect(backend.start("bot_one")).rejects.toThrow(/Link this workspace/);
    expect(called).toBe(false);
  });
});
