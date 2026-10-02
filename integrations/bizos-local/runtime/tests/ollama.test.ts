import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeOllamaUrl, probeOllama, inspectOllamaModel } from "../src/harness/ollama.js";
import { InferenceStore } from "../src/harness/inference.js";
import { Storage } from "../src/harness/storage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server | undefined;
async function fake(handler: (path: string, body: any) => unknown) {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = handler(req.url ?? "", chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });

describe("Ollama local model boundary", () => {
  it("normalizes only loopback origin or legacy /v1", () => {
    expect(normalizeOllamaUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(normalizeOllamaUrl("https://[::1]:11434/")).toBe("https://[::1]:11434");
    for (const address of ["https://example.com:11434", "http://192.168.1.2:11434", "http://u:p@localhost:11434", "http://localhost:11434/foo", "http://localhost:11434/?x=1", "http://localhost:11434/#x", "http://localhost"]) expect(() => normalizeOllamaUrl(address)).toThrow();
  });
  it("lists only verified installed local chat models and retains disabled rows", async () => {
    const url = await fake((path, body) => path === "/api/tags"
      ? { models: ["tool", "chat", "embed", "alias", "unknown"].map(name => ({ name, model: name, size: 10, ...(name === "alias" ? { remote_model: "someone/cloud" } : {}) })) }
      : body.model === "unknown" ? {} : { capabilities: body.model === "tool" ? ["completion", "tools"] : body.model === "chat" ? ["completion"] : ["embedding"], details: { family: "test" } });
    const result = await probeOllama(url);
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(["tool", "chat"]);
    expect(result.modelDetails?.find(m => m.id === "tool")).toMatchObject({ locality: "local", chat: true, tools: true });
    expect(result.modelDetails?.find(m => m.id === "alias")).toMatchObject({ locality: "remote", chat: false });
    expect(result.modelDetails?.find(m => m.id === "unknown")).toMatchObject({ locality: "unknown", chat: false });
    await expect(inspectOllamaModel(url, "alias", true)).rejects.toThrow(/remote/i);
    await expect(inspectOllamaModel(url, "chat", true)).rejects.toThrow(/tool-capable/i);
  });
  it("invalidates cached model discovery only when the Ollama origin changes", () => {
    const root = mkdtempSync(join(tmpdir(), "ollama-store-"));
    try {
      const store = new InferenceStore(new Storage(root));
      const provider = store.add({ kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1" });
      expect(provider.model).toBe("");
      store.recordTest(provider.id, { ok: true, models: ["local:1"], modelDetails: [{ id: "local:1", capabilities: ["completion"], locality: "local", chat: true, tools: false }] });
      expect(store.update(provider.id, { label: "Renamed" }).lastTest?.models).toEqual(["local:1"]);
      expect(store.update(provider.id, { baseUrl: "http://127.0.0.1:11435" }).lastTest).toBeUndefined();
      expect(store.get(provider.id)?.baseUrl).toBe("http://127.0.0.1:11435");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
