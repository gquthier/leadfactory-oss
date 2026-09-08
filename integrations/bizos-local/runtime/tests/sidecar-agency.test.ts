// The desktop contract, against a REAL sidecar process: `node dist/sidecar.js
// serve` on a temporary state root, with a temporary HOME so no profile of
// this Mac is read, and no CLI on PATH. Skipped when `dist/` is not built
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

describe.skipIf(!built)("the agency routes of a running sidecar", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-agency-"));
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

  it("serves status, install, open behind the desktop bearer, and closes everything with the sidecar", async () => {
    // Auth guard untouched: no bearer, no answer.
    expect((await api("GET", "/api/local/agency", undefined, "")).status).toBe(401);

    const before = await api("GET", "/api/local/agency");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({
      installed: false,
      status: "not-installed",
      template: { id: "lead-gen-agency", name: "Lead Gen Agency", version: 1 },
      dashboardUrl: null,
      bots: [],
      teamThreadId: null,
      skillsCount: 23,
    });
    expect((await api("POST", "/api/local/agency/open", {})).status).toBe(409);
    expect((await api("POST", "/api/local/agency/install", { force: true })).status).toBe(400);

    const installed = await api("POST", "/api/local/agency/install", {});
    expect(installed.status).toBe(200);
    expect(installed.body).toMatchObject({ installed: true, status: "ready", skillsCount: 23 });
    expect(installed.body.dashboardUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(installed.body.bots).toHaveLength(6);
    const prefix = `local:${descriptor.instanceId}:`;
    for (const bot of installed.body.bots as Array<{ id: string; name: string; slug: string; threadId: string }>) {
      expect(bot.id.startsWith(`${prefix}agent:`)).toBe(true);
      expect(bot.threadId).toBe(`${prefix}thread:bot:${bot.id.slice(`${prefix}agent:`.length)}`);
      expect(bot.name).toBeTruthy();
      expect(bot.slug).toBeTruthy();
    }
    expect(installed.body.teamThreadId.startsWith(`${prefix}thread:group:`)).toBe(true);
    expect(JSON.stringify(installed.body)).not.toContain(temp);

    // Idempotent, and the same after a GET.
    const again = await api("POST", "/api/local/agency/install", {});
    expect(again.body.bots).toEqual(installed.body.bots);
    const status = await api("GET", "/api/local/agency");
    expect(status.body).toEqual(installed.body);
    // `open` is the one route that mints a ticket: a fragment on the base URL,
    // one use, never on the plain status.
    const opened = await api("POST", "/api/local/agency/open", {});
    const openUrl = new RegExp(`^${installed.body.dashboardUrl.replace(/[.]/g, "\\.")}/#connect=([0-9a-f]{64})$`);
    expect(opened.body.dashboardUrl).toMatch(openUrl);
    const ticket = openUrl.exec(opened.body.dashboardUrl)![1]!;
    expect((await api("POST", "/api/local/agency/open", {})).body.dashboardUrl).not.toContain(ticket);
    expect((await api("GET", "/api/local/agency")).body.dashboardUrl).toBe(installed.body.dashboardUrl);

    // The dashboard is the kit's own cockpit, on loopback, on the pack's store —
    // and hosted: bare HTTP is refused, the ticket buys a session cookie.
    expect((await fetch(`${installed.body.dashboardUrl}/api/state`)).status).toBe(401);
    const exchange = await fetch(`${installed.body.dashboardUrl}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }),
    });
    expect(exchange.status).toBe(200);
    const cookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(exchange.headers.get("set-cookie")).toContain("HttpOnly");
    const cockpit = await fetch(`${installed.body.dashboardUrl}/api/state`, { headers: { cookie } });
    expect(cockpit.status).toBe(200);
    expect(await cockpit.json()).toMatchObject({ version: 1, clients: [] });
    const meta = await fetch(`${installed.body.dashboardUrl}/api/meta`, { headers: { cookie } });
    expect(await meta.json()).toMatchObject({ hostedBy: "bizos-local" });
    const replay = await fetch(`${installed.body.dashboardUrl}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }),
    });
    expect(replay.status).toBe(401);
    const page = await fetch(`${installed.body.dashboardUrl}/`);
    expect(page.headers.get("content-type")).toContain("text/html");

    // The agents and their threads are real collaboration objects the desktop already reads.
    const bootstrap = await api("GET", "/api/collaboration/bootstrap");
    const agentIds = (bootstrap.body.agents as Array<{ agentId: string }>).map((agent) => agent.agentId);
    const threadIds = (bootstrap.body.threads as Array<{ id: string }>).map((thread) => thread.id);
    for (const bot of installed.body.bots as Array<{ id: string; threadId: string }>) {
      expect(agentIds).toContain(bot.id);
      expect(threadIds).toContain(bot.threadId);
    }
    expect(threadIds).toContain(installed.body.teamThreadId);
    const director = (bootstrap.body.threads as Array<{ id: string; lastMessage: { content: string } | null }>)
      .find((thread) => thread.id === (installed.body.bots as Array<{ threadId: string }>)[0]!.threadId)!;
    // The pack's own welcome, and an honest one: it claims no work ran.
    expect(director.lastMessage?.content).toContain("No client work has run yet");

    // Internal tool door: no capability, no answer.
    const noCapability = await fetch(new URL("/api/internal/local-team/agency", descriptor.origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "agency_clients", arguments: { action: "list" } }),
    });
    expect(noCapability.status).toBe(401);

    // Stop: the cockpit port closes, the lock and the descriptor go.
    const dataDir = join(temp, "state", "runtime", "agency", "data");
    expect(existsSync(join(dataDir, "db.lock"))).toBe(true);
    child!.kill("SIGTERM");
    await new Promise((resolveExit) => child!.once("exit", resolveExit));
    await expect(fetch(`${installed.body.dashboardUrl}/api/state`)).rejects.toThrow();
    expect(existsSync(join(dataDir, "db.lock"))).toBe(false);
    expect(existsSync(join(dataDir, "db.json"))).toBe(false);
    expect(existsSync(join(temp, "desktop", "local-harness.json"))).toBe(false);
  }, 60_000);
});
