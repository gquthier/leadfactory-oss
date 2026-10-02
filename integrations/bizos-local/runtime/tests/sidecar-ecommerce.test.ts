// The second pack on the same desktop contract, against a REAL sidecar
// process: `node dist/sidecar.js serve` on a temporary state root, with a
// temporary HOME so no profile of this Mac is read, and no CLI on PATH.
// Skipped when `dist/` is not built (`npm run build` first).
//
// What is proved here and not in `sidecar-agency.test.ts`: the routes are the
// pack's, not the agency's; the workspace binds ONE template and the other
// pack is refused behind it; the store cockpit runs in the bound vault and
// its records reach the person's notes.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarScript = join(runtimeRoot, "dist", "sidecar.js");
const built = existsSync(sidecarScript) && existsSync(join(runtimeRoot, "dist", "agency-kit", "ecommerce", "lib", "app.mjs"));

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

describe.skipIf(!built)("the e-commerce routes of a running sidecar", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-commerce-"));
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

  it("installs the store pack, binds the workspace to it alone, and closes with the sidecar", async () => {
    // Auth guard untouched: no bearer, no answer.
    expect((await api("GET", "/api/local/ecommerce", undefined, "")).status).toBe(401);

    const before = await api("GET", "/api/local/ecommerce");
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      installed: false,
      status: "not-installed",
      template: { id: "ecommerce", name: "E-commerce", version: 1 },
      dashboardUrl: null,
      bots: [],
      teamThreadId: null,
      rootId: null,
      vaultPath: null,
      boundTemplateId: null,
    });
    expect(before.body.skillsCount).toBeGreaterThan(0);
    expect((await api("POST", "/api/local/ecommerce/open", {})).status).toBe(409);

    const vault = join(temp, "state", "runtime", "vaults", "ecommerce");
    const installed = await api("POST", "/api/local/ecommerce/install", {});
    expect(installed.status).toBe(200);
    expect(installed.body).toMatchObject({
      installed: true,
      status: "ready",
      rootId: "vault:ecommerce",
      vaultPath: vault,
      boundTemplateId: null,
      skillsCount: before.body.skillsCount,
    });
    expect(installed.body.dashboardUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(installed.body.bots).toHaveLength(6);
    const prefix = `local:${descriptor.instanceId}:`;
    for (const bot of installed.body.bots as Array<{ id: string; name: string; slug: string; threadId: string }>) {
      expect(bot.id.startsWith(`${prefix}agent:`)).toBe(true);
      expect(bot.threadId).toBe(`${prefix}thread:bot:${bot.id.slice(`${prefix}agent:`.length)}`);
    }
    expect(installed.body.teamThreadId.startsWith(`${prefix}thread:group:`)).toBe(true);
    expect(JSON.stringify({ ...installed.body, vaultPath: null })).not.toContain(temp);
    // The pack's own vault, with the skills its agents read from there.
    expect(existsSync(join(vault, "AGENTS.md"))).toBe(true);
    expect(readdirSync(join(vault, "skills")).length).toBeGreaterThan(0);
    expect(existsSync(join(temp, "state", "runtime", "vaults", "lead-gen-agency"))).toBe(false);

    // Idempotent, and the same after a GET.
    expect((await api("POST", "/api/local/ecommerce/install", {})).body.bots).toEqual(installed.body.bots);
    expect((await api("GET", "/api/local/ecommerce")).body).toEqual(installed.body);

    // The cockpit is the store's own, hosted: bare HTTP is refused, the
    // ticket `open` mints buys a session cookie, once.
    expect((await fetch(`${installed.body.dashboardUrl}/api/state`)).status).toBe(401);
    const opened = await api("POST", "/api/local/ecommerce/open", {});
    const openUrl = new RegExp(`^${installed.body.dashboardUrl.replace(/[.]/g, "\\.")}/#connect=([0-9a-f]{64})$`);
    expect(opened.body.dashboardUrl).toMatch(openUrl);
    const ticket = openUrl.exec(opened.body.dashboardUrl)![1]!;
    const exchange = await fetch(`${installed.body.dashboardUrl}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }),
    });
    expect(exchange.status).toBe(200);
    const cookie = (exchange.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(exchange.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await fetch(`${installed.body.dashboardUrl}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }),
    })).status).toBe(401);
    const meta = await fetch(`${installed.body.dashboardUrl}/api/meta`, { headers: { cookie } });
    expect(await meta.json()).toMatchObject({ hostedBy: "bizos-local" });

    // A record the person creates in the cockpit becomes a note in their vault.
    const created = await fetch(`${installed.body.dashboardUrl}/api/products`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Pochette Démo" }),
    });
    expect(created.status).toBe(201);
    const product = await created.json() as { id: string };
    const dossier = join(vault, "Products", product.id, "Dossier.md");
    await waitFor(() => existsSync(dossier) || null, 5_000, "the product dossier");
    expect(readFileSync(dossier, "utf8")).toContain("Pochette Démo");

    // One template per workspace: the agency names the binding and installs nothing.
    const agency = await api("GET", "/api/local/agency");
    expect(agency.body).toMatchObject({ installed: false, status: "not-installed", boundTemplateId: "ecommerce", vaultPath: null, bots: [] });
    expect((await api("POST", "/api/local/agency/install", {})).status).toBe(409);
    expect((await api("POST", "/api/local/agency/open", {})).status).toBe(409);

    // Internal tool door: no capability, no answer — for either pack's tools.
    for (const tool of ["commerce_records", "agency_clients"]) {
      const noCapability = await fetch(new URL("/api/internal/local-team/pack", descriptor.origin), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, arguments: { action: "list" } }),
      });
      expect(noCapability.status).toBe(401);
    }

    // Stop: the cockpit port closes, the lock and the descriptor go.
    const dataDir = join(vault, "Apps", "Ecommerce", "data");
    expect(existsSync(join(dataDir, "db.lock"))).toBe(true);
    child!.kill("SIGTERM");
    await new Promise((resolveExit) => child!.once("exit", resolveExit));
    await expect(fetch(`${installed.body.dashboardUrl}/api/state`)).rejects.toThrow();
    expect(existsSync(join(dataDir, "db.lock"))).toBe(false);
    expect(existsSync(join(dataDir, "db.json"))).toBe(true);
    expect(existsSync(join(temp, "desktop", "local-harness.json"))).toBe(false);
  }, 60_000);
});
