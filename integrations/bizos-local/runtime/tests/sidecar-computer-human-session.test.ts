// POST /api/local/computer/:id/human-session against a REAL sidecar process
// on a temporary state root and HOME. Skipped when `dist/` is not built
// (`npm run build` first).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
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

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

describe.skipIf(!built)("Take control session route", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-human-session-"));
    const home = join(temp, "home");
    mkdirSync(home, { recursive: true });
    const descriptorPath = join(temp, "desktop", "local-harness.json");
    child = spawn(process.execPath, [sidecarScript, "serve"], {
      cwd: runtimeRoot,
      env: {
        HOME: home,
        BIZOS_LOCAL_COMPUTER_ENABLED: "true",
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

  it("records one note per agent under the owner bearer, for every agent id form", async () => {
    const created = await api("POST", "/api/local/bots", { name: "Nina", title: "Marketing" });
    expect(created.status).toBe(201);
    const agentId: string = created.body.agent.agentId;
    const threadId: string = created.body.thread.id;
    const botId = agentId.split(":").at(-1)!;
    const route = (id: string) => `/api/local/computer/${encodeURIComponent(id)}/human-session`;

    expect((await api("POST", route(agentId), { startedAt: ago(5) }, "")).status).toBe(401);
    expect((await api("POST", route(agentId), { startedAt: ago(5) }, "forged-token")).status).toBe(401);
    expect((await api("GET", route(agentId))).status).not.toBe(200);

    expect(await api("POST", route(agentId), { startedAt: ago(10), endedAt: ago(8), url: "https://me:pw@app.metricool.com/planner?t=secret#x" }))
      .toEqual({ status: 200, body: { recorded: true } });
    expect(await api("POST", route(threadId), { startedAt: ago(6), endedAt: ago(5) })).toEqual({ status: 200, body: { recorded: true } });
    expect(await api("POST", route(botId), { startedAt: ago(4), endedAt: ago(2), url: "https://app.metricool.com/" }))
      .toEqual({ status: 200, body: { recorded: true } });

    for (const body of [{}, { startedAt: "yesterday" }, { startedAt: ago(1), endedAt: ago(3) }, { startedAt: ago(1), url: "javascript:alert(1)" }, { startedAt: ago(1), extra: 1 }, { startedAt: ago(-60) }]) {
      expect(await api("POST", route(agentId), body), JSON.stringify(body)).toMatchObject({ status: 400, body: { error: { code: "invalid_payload" } } });
    }
    expect((await api("POST", route("bot_missing"), { startedAt: ago(1) })).status).toBe(404);
    expect((await api("POST", route("local:another:agent:bot_x"), { startedAt: ago(1) })).status).toBe(422);

    const stored = JSON.parse(readFileSync(join(temp, "state", "runtime", "computer-human-sessions.json"), "utf8"));
    expect(Object.keys(stored)).toEqual([botId]);
    // Widened: earliest start, latest end, newest page (cleaned).
    expect(stored[botId].url).toBe("https://app.metricool.com/");
    expect(Date.parse(stored[botId].endedAt) - Date.parse(stored[botId].startedAt)).toBeGreaterThan(7 * 60_000);
    expect(JSON.stringify(stored)).not.toContain("secret");
  });
});
