// `/api/local/cloud-link` against a REAL sidecar process (temp HOME and state
// root) and a fake web origin. Skipped when `dist/` is not built.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarScript = join(runtimeRoot, "dist", "sidecar.js");
const built = existsSync(sidecarScript) && existsSync(join(runtimeRoot, "dist", "agency-kit", "lib", "app.mjs"));
const TOKEN = "bzd_sidecar-test-token";

let temp: string;
let child: ChildProcess | null = null;
let descriptor: { origin: string; token: string };
let web: Server;
let webOrigin = "";
let logs = "";
const snapshots: any[] = [];
const deletes: string[] = [];

async function api(method: string, path: string, body?: unknown, token = descriptor.token): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, descriptor.origin), {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function waitFor(probe: () => Promise<boolean> | boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${logs}`);
}

describe.skipIf(!built)("Cloud link HTTP boundary", () => {
  beforeAll(async () => {
    web = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      const json = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
      if (request.url === "/api/desktop-link/start") return json(200, { code: "WXYZ-2345", pollSecret: "s", verifyUrl: `${webOrigin}/desktop-link?code=WXYZ-2345`, expiresAt: new Date(Date.now() + 600_000).toISOString() });
      if (request.url === "/api/desktop-link/poll") return json(200, { status: "approved", token: TOKEN, orgId: "org_1", orgName: "Acme", dashboardUrl: `${webOrigin}/desktop` });
      if (request.url === "/api/desktop-link/snapshot" && request.headers.authorization === `Bearer ${TOKEN}`) {
        snapshots.push(body);
        response.writeHead(204);
        return response.end();
      }
      if (request.url === "/api/desktop-link" && request.method === "DELETE") {
        deletes.push(request.headers.authorization ?? "");
        response.writeHead(204);
        return response.end();
      }
      json(404, {});
    });
    await new Promise<void>((resolveListen) => web.listen(0, "127.0.0.1", () => resolveListen()));
    const address = web.address();
    if (!address || typeof address === "string") throw new Error("no port");
    webOrigin = `http://127.0.0.1:${address.port}`;

    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-cloud-link-"));
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
        BIZOS_WEB_ORIGIN: webOrigin,
        LOCALBIZOS_COMPUTER_NAME: "Test Mac",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    await waitFor(() => {
      try { descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")); return true; } catch { return false; }
    }, "the sidecar descriptor", 30_000);
    await waitFor(async () => (await api("GET", "/api/local/health").catch(() => ({ status: 0 }))).status === 200, "health", 30_000);
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolveExit) => child!.once("exit", resolveExit));
    }
    await new Promise<void>((resolveClose) => web.close(() => resolveClose()));
    await rm(temp, { recursive: true, force: true });
  }, 60_000);

  it("links, pushes the dashboard summary under the bootstrap workspace id, and unlinks", async () => {
    expect((await api("GET", "/api/local/cloud-link", undefined, "")).status).toBe(401);
    const bootstrap = (await api("GET", "/api/collaboration/bootstrap")).body;
    expect(bootstrap.capabilities.webDashboard).toBe(true);
    const workspaceId = bootstrap.backend.workspaceId;

    const initial = await api("GET", "/api/local/cloud-link");
    expect(initial).toMatchObject({ status: 200, body: { linked: false, workspaceId } });
    expect((await api("POST", "/api/local/cloud-link/start", { nope: 1 })).status).toBe(400);
    const started = await api("POST", "/api/local/cloud-link/start", { workspaceName: "Acme Studio" });
    expect(started).toEqual({ status: 200, body: { code: "WXYZ-2345", verifyUrl: `${webOrigin}/desktop-link?code=WXYZ-2345` } });

    await waitFor(() => snapshots.length > 0, "first snapshot");
    const linked = (await api("GET", "/api/local/cloud-link")).body;
    expect(linked).toMatchObject({ linked: true, orgName: "Acme", dashboardUrl: `${webOrigin}/desktop`, workspaceName: "Acme Studio" });
    expect(JSON.stringify(linked)).not.toContain(TOKEN);

    const lateCancel = await api("POST", "/api/local/cloud-link/cancel");
    expect(lateCancel).toEqual({ status: 200, body: { cancelled: false } });
    expect((await api("GET", "/api/local/cloud-link")).body.linked).toBe(true);
    expect(deletes).toHaveLength(0);

    const summary = (await api("GET", "/api/local/dashboard-summary")).body;
    const pushed = snapshots[0];
    expect(pushed).toMatchObject({ workspaceId, workspaceName: "Acme Studio" });
    expect(Object.keys(pushed.summary).sort()).toEqual(Object.keys(summary).sort());
    expect(pushed.summary.workspaceId).toBe(workspaceId);

    expect((await api("PATCH", "/api/local/cloud-link", { workspaceName: "Acme Renamed" })).body.workspaceName).toBe("Acme Renamed");
    await waitFor(() => snapshots.at(-1)?.workspaceName === "Acme Renamed", "renamed snapshot");

    const unlinked = await api("DELETE", "/api/local/cloud-link");
    expect(unlinked).toMatchObject({ status: 200, body: { linked: false } });
    expect(deletes).toEqual([`Bearer ${TOKEN}`]);
  }, 60_000);
});
