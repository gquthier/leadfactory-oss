// The plan-tier HTTP contract (a local dev/test switch, not billing) against
// a REAL sidecar process on a temporary state root and HOME. Skipped when
// `dist/` is not built (`npm run build` first).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
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

describe.skipIf(!built)("Plan tier HTTP boundary", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-plan-"));
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

  it("serves the tier, answers 402 pro_required on free, and unlocks on PUT pro", async () => {
    expect((await api("GET", "/api/local/entitlement", undefined, "")).status).toBe(401);
    expect(await api("GET", "/api/local/entitlement")).toEqual({
      status: 200,
      body: { tier: "free", source: "default", features: { customModels: false, customConnectors: false, cloudComputer: false } },
    });
    const gemini = { kind: "openai-compatible", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "k", model: "gemini-2.5-flash" };
    const refused = await api("POST", "/api/local/providers", gemini);
    expect(refused).toMatchObject({ status: 402, body: { error: "pro_required", feature: "customModels" } });
    expect(typeof refused.body.message).toBe("string");
    expect(await api("POST", "/api/local/apps", { custom: { name: "Mine", transport: "http", url: "https://example.com/mcp" } }))
      .toMatchObject({ status: 402, body: { error: "pro_required", feature: "customConnectors" } });
    expect(await api("POST", "/api/local/runtime/inference", { source: "provider", providerId: "prv_abc123def456" }))
      .toMatchObject({ status: 402, body: { error: "pro_required" } });
    expect((await api("PUT", "/api/local/entitlement", { tier: "gold" })).status).toBe(400);
    expect(await api("PUT", "/api/local/entitlement", { tier: "pro" })).toEqual({
      status: 200,
      body: { tier: "pro", source: "local", features: { customModels: true, customConnectors: true, cloudComputer: true } },
    });
    const added = await api("POST", "/api/local/providers", gemini);
    expect(added.status).toBe(201);
    expect(added.body.provider).toMatchObject({ kind: "openai-compatible", model: "gemini-2.5-flash", hasKey: true });
    expect((await api("PATCH", `/api/local/providers/${added.body.provider.id}`, { model: "gemini-3.5-flash-lite" })).status).toBe(200);
    expect((await api("PUT", "/api/local/entitlement", { tier: "free" })).body.tier).toBe("free");
    expect((await api("PATCH", `/api/local/providers/${added.body.provider.id}`, { model: "x" })).status).toBe(402);
  });

  it("serves the cloud computer: no secrets in status, key stored 0600, Pro-gated wake, team route needs a capability", async () => {
    expect((await api("GET", "/api/local/cloud-computer", undefined, "")).status).toBe(401);
    expect(await api("GET", "/api/local/cloud-computer")).toMatchObject({
      status: 200,
      body: { configured: false, keySource: null, allowed: false, sandboxId: null, state: "none", machineClass: "small", idleMinutes: 15 },
    });
    expect((await api("POST", "/api/local/cloud-computer/key", { apiKey: "boat_secret_value" })).body).toMatchObject({ configured: true, keySource: "local" });
    const status = await api("GET", "/api/local/cloud-computer");
    expect(JSON.stringify(status.body)).not.toContain("boat_secret_value");
    const file = join(temp, "state", "runtime", "cloud-computer.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await api("PUT", "/api/local/cloud-computer", { machineClass: "huge" })).status).toBe(400);
    expect((await api("PUT", "/api/local/cloud-computer", { idleMinutes: 5 })).body.idleMinutes).toBe(5);
    expect(await api("POST", "/api/local/cloud-computer/wake", {}))
      .toMatchObject({ status: 402, body: { error: "pro_required", feature: "cloudComputer" } });
    expect((await api("POST", "/api/internal/local-team/cloud", { tool: "cloud_computer_status", arguments: {} }, "forged")).status).toBe(401);
  });
});
