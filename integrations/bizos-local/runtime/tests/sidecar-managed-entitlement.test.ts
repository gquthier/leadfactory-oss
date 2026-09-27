// Managed feature authority over real HTTP against
// a REAL sidecar process on a temporary state root and HOME. Skipped when
// `dist/` is not built (`npm run build` first).
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

interface Descriptor {
  origin: string;
  token: string;
  instanceId: string;
  pid: number;
}

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

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = descriptor.token,
): Promise<{ status: number; body: any }> {
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

describe.skipIf(!built)("Desktop-managed entitlement real HTTP boundary", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-plan-"));
    const home = join(temp, "home");
    mkdirSync(home, { recursive: true });
    mkdirSync(join(temp, "state", "runtime"), { recursive: true });
    writeFileSync(join(temp, "state", "runtime", "entitlement.json"), JSON.stringify({ version: 1, tier: "pro" }));
    const descriptorPath = join(temp, "desktop", "local-harness.json");
    child = spawn(process.execPath, [sidecarScript, "serve"], {
      cwd: runtimeRoot,
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        TMPDIR: temp,
        LOCALBIZOS_MANAGED_ENTITLEMENT: "1",
        BIZOS_LOCAL_PLAN: "pro",
        LOCALBIZOS_SIDECAR_STATE: join(temp, "state"),
        LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    descriptor = await waitFor(
      () => {
        try {
          return JSON.parse(readFileSync(descriptorPath, "utf8")) as Descriptor;
        } catch {
          return null;
        }
      },
      30_000,
      "the sidecar descriptor",
    );
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

  it("ignores paid environment/file state and accepts only bounded native owner projections", async () => {
    expect(await api("GET", "/api/local/entitlement")).toMatchObject({
      status: 200,
      body: { tier: "free", source: "managed" },
    });
    expect((await api("PUT", "/api/local/entitlement", { tier: "pro" })).status).toBe(403);
    expect((await api("POST", "/api/local/entitlement/owner-session", {}, "")).status).toBe(401);
    for (const extra of [{ origin: "https://app.bizos.lol" }, { "sec-fetch-site": "none" }]) {
      const response = await fetch(new URL("/api/local/entitlement/owner-session", descriptor.origin), {
        method: "POST",
        headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json", ...extra },
        body: "{}",
      });
      expect(response.status).toBe(403);
    }
    const begin = await api("POST", "/api/local/entitlement/owner-session", {});
    expect(begin.status).toBe(200);
    const sessionId = begin.body.sessionId;
    const issued = Date.now();
    const projection = {
      version: 1,
      subject: "10000000-0000-4000-8000-000000000001",
      orgId: "20000000-0000-4000-8000-000000000001",
      instanceId: descriptor.instanceId,
      features: { customModels: true, customConnectors: false, cloudComputer: false },
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + 1000).toISOString(),
    };
    expect(
      (
        await api("POST", "/api/local/entitlement/projection", {
          sessionId,
          revision: 1,
          projection: { ...projection, instanceId: "foreign" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await api("POST", "/api/local/entitlement/projection", { sessionId, revision: 1, projection })).body,
    ).toMatchObject({ tier: "pro", features: { customModels: true, customConnectors: false, cloudComputer: false } });
    expect(
      (await api("POST", "/api/local/entitlement/projection", { sessionId, revision: 1, projection })).status,
    ).toBe(400);
    const summary = JSON.stringify((await api("GET", "/api/local/entitlement")).body);
    for (const secret of [sessionId, projection.subject, projection.orgId, descriptor.token])
      expect(summary).not.toContain(secret);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1050));
    expect((await api("GET", "/api/local/entitlement")).body.tier).toBe("free");
    const fresh = {
      ...projection,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    expect(
      (await api("POST", "/api/local/entitlement/projection", { sessionId, revision: 2, projection: fresh })).status,
    ).toBe(200);
    const reset = await api("POST", "/api/local/entitlement/owner-session", {});
    expect(reset.body.sessionId).not.toBe(sessionId);
    expect((await api("GET", "/api/local/entitlement")).body.tier).toBe("free");
    expect(
      (await api("POST", "/api/local/entitlement/projection", { sessionId, revision: 3, projection: fresh })).status,
    ).toBe(400);
    expect(
      (
        await api("POST", "/api/local/providers", {
          kind: "openai-compatible",
          baseUrl: "https://example.com/v1",
          apiKey: "synthetic",
          model: "synthetic",
        })
      ).status,
    ).toBe(402);
    expect(JSON.parse(readFileSync(join(temp, "state", "runtime", "entitlement.json"), "utf8"))).toEqual({
      version: 1,
      tier: "pro",
    });
  });
});
