// The desktop contract, against a REAL sidecar process: `node dist/sidecar.js
// serve` on a temporary state root, with a temporary HOME so no profile of
// this Mac is read, and no CLI on PATH. Skipped when `dist/` is not built
// (`npm run build` first).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarScript = join(runtimeRoot, "dist", "sidecar.js");
const built = existsSync(sidecarScript) && existsSync(join(runtimeRoot, "dist", "agency-kit", "lib", "app.mjs"));

interface Descriptor { origin: string; token: string; instanceId: string; pid: number }

let temp: string;
let child: ChildProcess | null = null;
let descriptor: Descriptor;
let logs = "";

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number, what: string): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = probe();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${logs}`);
}

async function api(method: string, path: string, body?: unknown, token = descriptor.token): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, descriptor.origin), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

describe.skipIf(!built)("Imported context HTTP boundary", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-context-"));
    const home = join(temp, "home");
    mkdirSync(home, { recursive: true });
    const descriptorPath = join(temp, "desktop", "local-harness.json");
    child = spawn(process.execPath, [sidecarScript, "serve"], {
      cwd: runtimeRoot,
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        TMPDIR: temp,
        LOCALBIZOS_SIDECAR_STATE: join(temp, "state"),
        LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    descriptor = await waitFor(() => {
      try {
        return JSON.parse(readFileSync(descriptorPath, "utf8")) as Descriptor;
      } catch {
        return null;
      }
    }, 30_000, "the sidecar descriptor");
    // The facade is prepared before the health route answers 200.
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      const health = await api("GET", "/api/local/health").catch(() => ({ status: 0, body: null }));
      if (health.status === 200) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolveExit) => child!.once("exit", resolveExit));
    }
    await rm(temp, { recursive: true, force: true });
  }, 60_000);

  it("refuses malformed snapshots before binding and keeps ordinary routes at 64 KiB", async () => {
    const bad = await api("POST", "/api/local/brain/templates/apply", { id: "company-os", context: { sourceLabel: "X", files: [{ path: "../x.md", text: "x" }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_payload");
    expect(existsSync(join(temp, "state/runtime/workspace-binding.json"))).toBe(false);
    const large = await api("POST", "/api/local/quick-chats", { requestId: "x".repeat(70 * 1024) });
    expect(large.status).toBe(413);
  });

  it("imports a snapshot larger than the old body cap and preserves owner edits on retry", async () => {
    const content = "Business evidence. ".repeat(6000);
    const request = { id: "company-os", rootId: "new", companyName: "TableStory Films", owner: { name: "Ada" }, language: "en", context: { sourceLabel: "TableStory", files: [{ path: "Company.md", text: content }] } };
    const applied = await api("POST", "/api/local/brain/templates/apply", request);
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ id: "company-os", rootId: "vault:company-os", created: true, bots: { ceo: expect.any(String) } });
    const binding = await api("GET", "/api/local/workspace-template");
    expect(binding.status).toBe(200);
    expect(binding.body.binding).toMatchObject({ templateId: "company-os", rootId: "vault:company-os" });
    const imported = join(temp, "state/runtime/vaults/company-os/Knowledge/Imported Context/files/Company.md");
    expect(readFileSync(imported, "utf8")).toBe(content);
    writeFileSync(imported, "Owner correction");
    const retry = await api("POST", "/api/local/brain/templates/apply", request);
    expect(retry.status).toBe(200);
    expect(retry.body.created).toBe(false);
    expect(readFileSync(imported, "utf8")).toBe("Owner correction");
    const bootstrap = await api("GET", "/api/collaboration/bootstrap");
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.backend.companyName).toBe("TableStory Films");
    expect(bootstrap.body.agents.map((row: { name: string }) => row.name)).toEqual(["CEO"]);
  });
});
