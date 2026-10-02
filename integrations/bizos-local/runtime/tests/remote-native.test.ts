import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteNativeComputerBackend } from "../src/computer/remote-native.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture(handler: (request: Request, body: Record<string, unknown>) => Promise<unknown> | unknown) {
  const root = mkdtempSync(join(tmpdir(), "lbz-native-bridge-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const descriptorPath = join(root, "descriptor.json");
  const secret = "a".repeat(64);
  writeFileSync(descriptorPath, JSON.stringify({ version: 1, origin: "http://127.0.0.1:43123", workspaceId: "os_acme", secret }), { mode: 0o600 });
  const requests: Array<{ request: Request; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    requests.push({ request, body });
    try {
      const result = await handler(request, body);
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 409 });
    }
  };
  const backend = new RemoteNativeComputerBackend({ descriptorPath, workspaceFor: botId => join(root, "workspaces", botId), fetchImpl });
  return { backend, requests, secret, root };
}

describe("remote native computer backend", () => {
  it("authenticates every operation to one workspace and bot", async () => {
    const { backend, requests, secret, root } = fixture((_request, body) => {
      if (body.operation === "start") return { backend: "native", status: "ready", apps: [{ id: "browser", open: true }], openUrl: "https://example.test/" };
      return { frameId: "f1", capturedAt: "2026-09-26T00:00:00.000Z", mimeType: "image/png", imageBase64: "AA==", width: 1280, height: 800, url: "https://example.test/", title: "Example", elements: [], text: "hello" };
    });

    await backend.start("agent-a");
    await backend.observe("agent-a");

    expect(requests).toHaveLength(2);
    expect(requests[0]?.request.headers.get("x-bizos-workspace")).toBe("os_acme");
    expect(requests[0]?.request.headers.get("x-bizos-bot")).toBe("agent-a");
    expect(requests[0]?.request.headers.get("authorization")).toBe(`Bearer ${createHmac("sha256", secret).update("os_acme\0agent-a").digest("hex")}`);
    expect(requests[0]?.body).toEqual({ operation: "start", workspaceDir: join(root, "workspaces", "agent-a") });
    expect(backend.state("agent-a").openUrl).toBe("https://example.test/");
  });

  it("serializes operations per bot while allowing different bots concurrently", async () => {
    let activeA = 0;
    let maxA = 0;
    let activeAll = 0;
    let maxAll = 0;
    const { backend } = fixture(async (request, body) => {
      activeAll += 1;
      maxAll = Math.max(maxAll, activeAll);
      if (request.headers.get("x-bizos-bot") === "agent-a") {
        activeA += 1;
        maxA = Math.max(maxA, activeA);
      }
      await new Promise(resolve => setTimeout(resolve, 20));
      if (request.headers.get("x-bizos-bot") === "agent-a") activeA -= 1;
      activeAll -= 1;
      if (body.operation === "signedInHosts") return [];
      return { frameId: "f", capturedAt: new Date().toISOString(), mimeType: "image/png", imageBase64: "AA==", width: 1, height: 1, url: "about:blank", title: "", elements: [], text: "" };
    });

    await Promise.all([
      backend.observe("agent-a"),
      backend.signedInHosts("agent-a"),
      backend.observe("agent-b"),
    ]);
    expect(maxA).toBe(1);
    expect(maxAll).toBeGreaterThan(1);
  });

  it("fails closed for a non-loopback or malformed descriptor", async () => {
    const { backend, requests, root } = fixture(() => ({}));
    writeFileSync(join(root, "descriptor.json"), JSON.stringify({ version: 1, origin: "https://example.com", workspaceId: "os_acme", secret: "a".repeat(64) }));
    await expect(backend.start("agent-a")).rejects.toThrow("descriptor is invalid");
    expect(requests).toHaveLength(0);
  });
});
