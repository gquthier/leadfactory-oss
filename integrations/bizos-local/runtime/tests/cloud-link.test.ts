// The web dashboard link against a fake app.bizos.cc that speaks the contract
// (device-code start/poll, snapshot PUT, DELETE). Temp dirs only.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLOUD_LINK_FILE, CloudLink, snapshotHash, webOrigin } from "../src/cloud-link.js";

type PollAnswer = "pending" | "approved" | "expired";
interface FakeWeb {
  origin: string;
  server: Server;
  requests: Array<{ method: string; path: string; auth: string | null; body: any }>;
  pollAnswers: PollAnswer[];
  revoked: boolean;
  offline: boolean;
  verifyUrl?: string;
  dashboardUrl?: string;
}

const TOKEN = "bzd_test-token-abcdefghijklmnopqrstuvwxyz0123456789";

async function readBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

async function fakeWeb(): Promise<FakeWeb> {
  const web = { requests: [], pollAnswers: [], revoked: false, offline: false } as unknown as FakeWeb;
  web.server = createServer(async (request, response) => {
    const body = await readBody(request);
    const path = new URL(request.url ?? "/", "http://x").pathname;
    web.requests.push({ method: request.method ?? "", path, auth: request.headers.authorization ?? null, body });
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (web.offline) return json(503, { error: "down" });
    if (request.method === "POST" && path === "/api/desktop-link/start") {
      return json(200, {
        code: "ABCD-EFGH",
        pollSecret: "secret-poll",
        verifyUrl: web.verifyUrl ?? `${web.origin}/desktop-link?code=ABCD-EFGH`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    if (request.method === "POST" && path === "/api/desktop-link/poll") {
      if (body?.code !== "ABCD-EFGH" || body?.pollSecret !== "secret-poll") return json(404, { error: "not_found" });
      const answer = web.pollAnswers.shift() ?? "pending";
      if (answer === "approved") {
        return json(200, { status: "approved", token: TOKEN, orgId: "org_1", orgName: "Acme", dashboardUrl: web.dashboardUrl ?? `${web.origin}/desktop` });
      }
      return json(200, { status: answer });
    }
    const authorized = request.headers.authorization === `Bearer ${TOKEN}` && !web.revoked;
    if (request.method === "PUT" && path === "/api/desktop-link/snapshot") {
      if (!authorized) return json(401, { error: "unlinked" });
      response.writeHead(204);
      return response.end();
    }
    if (request.method === "DELETE" && path === "/api/desktop-link") {
      if (!authorized) return json(401, { error: "unlinked" });
      web.revoked = true;
      response.writeHead(204);
      return response.end();
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => web.server.listen(0, "127.0.0.1", () => resolve()));
  const address = web.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  web.origin = `http://127.0.0.1:${address.port}`;
  return web;
}

async function until(probe: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

let root: string;
let web: FakeWeb;
let links: CloudLink[];
let clock: number;
let summary: Record<string, unknown>;
let listeners: Array<() => void>;

function makeLink(overrides: Partial<ConstructorParameters<typeof CloudLink>[0]> = {}): CloudLink {
  const link = new CloudLink({
    root,
    origin: web.origin,
    workspaceId: "local:instance-1:workspace",
    deviceName: "Test Mac",
    summary: async () => ({ ...summary, generatedAt: new Date().toISOString() }),
    subscribe: (listener) => {
      listeners.push(listener);
      return () => { listeners = listeners.filter((row) => row !== listener); };
    },
    now: () => clock,
    pollIntervalMs: 10,
    pushIntervalMs: 60_000,
    debounceMs: 20,
    ...overrides,
  });
  links.push(link);
  return link;
}

const snapshots = () => web.requests.filter((row) => row.path === "/api/desktop-link/snapshot");

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "lbz-cloud-link-"));
  web = await fakeWeb();
  links = [];
  clock = Date.now();
  summary = { version: 1, workspaceId: "local:instance-1:workspace", agents: { total: 1 } };
  listeners = [];
});

afterEach(async () => {
  for (const link of links) link.stop();
  await new Promise<void>((resolve) => web.server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("cloud link", () => {
  it("links through the device code, pushes, skips unchanged snapshots and unlinks on 401", async () => {
    const link = makeLink();
    link.setWorkspaceName("Acme Studio");
    link.begin();
    web.pollAnswers.push("pending", "pending", "approved");

    const started = await link.start();
    expect(started).toEqual({ code: "ABCD-EFGH", verifyUrl: `${web.origin}/desktop-link?code=ABCD-EFGH` });
    expect(web.requests[0]).toMatchObject({ method: "POST", path: "/api/desktop-link/start", body: { deviceName: "Test Mac" }, auth: null });
    expect(link.status()).toMatchObject({ linked: false, pending: { code: "ABCD-EFGH" } });
    // A second click while pending reuses the same code.
    expect(await link.start()).toEqual(started);
    expect(web.requests.filter((row) => row.path === "/api/desktop-link/start")).toHaveLength(1);

    await until(() => snapshots().length === 1, "first push");
    const status = link.status();
    expect(status).toMatchObject({ linked: true, orgName: "Acme", dashboardUrl: `${web.origin}/desktop`, workspaceId: "local:instance-1:workspace", workspaceName: "Acme Studio" });
    expect(status.pending).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain(TOKEN);

    // Token stored 0600 in the harness root, with the origin that issued it.
    const file = join(root, CLOUD_LINK_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, token: TOKEN, origin: web.origin });

    const pushed = snapshots()[0]!;
    expect(pushed.auth).toBe(`Bearer ${TOKEN}`);
    expect(pushed.body).toMatchObject({ workspaceId: "local:instance-1:workspace", workspaceName: "Acme Studio", summary: { agents: { total: 1 } } });
    expect(typeof pushed.body.generatedAt).toBe("string");
    expect(pushed.body.summary.generatedAt).toBe(pushed.body.generatedAt);
    expect(Object.keys(pushed.body).sort()).toEqual(["generatedAt", "summary", "workspaceId", "workspaceName"]);

    // Same content (only generatedAt moved): skipped.
    await link.pushNow();
    expect(snapshots()).toHaveLength(1);
    // Changed content: pushed.
    summary = { ...summary, agents: { total: 2 } };
    await link.pushNow();
    expect(snapshots()).toHaveLength(2);
    // Unchanged but 5 minutes later: forced.
    clock += 5 * 60_000;
    await link.pushNow();
    expect(snapshots()).toHaveLength(3);

    // A local event schedules a debounced push.
    summary = { ...summary, agents: { total: 3 } };
    for (const listener of listeners) listener();
    await until(() => snapshots().length === 4, "debounced push");

    // Revoked on the web: the next push gets 401 and the link is dropped.
    web.revoked = true;
    summary = { ...summary, agents: { total: 4 } };
    await link.pushNow();
    expect(link.status()).toMatchObject({ linked: false, lastError: "unlinked" });
    expect(existsSync(file)).toBe(false);
  });

  it("reloads a saved link and revokes it remotely on unlink", async () => {
    const first = makeLink();
    web.pollAnswers.push("approved");
    await first.start();
    await until(() => snapshots().length === 1, "first push");
    first.stop();

    const second = makeLink();
    expect(second.status()).toMatchObject({ linked: true, orgName: "Acme" });
    second.begin();
    await until(() => snapshots().length === 2, "push after restart");
    await expect(second.start()).rejects.toMatchObject({ status: 409, code: "already_linked" });

    await second.unlink();
    expect(web.requests.at(-1)).toMatchObject({ method: "DELETE", path: "/api/desktop-link", auth: `Bearer ${TOKEN}` });
    expect(second.status().linked).toBe(false);
    expect(existsSync(join(root, CLOUD_LINK_FILE))).toBe(false);
  });

  it("forgets an expired code", async () => {
    const link = makeLink();
    web.pollAnswers.push("pending", "expired");
    await link.start();
    await until(() => link.status().lastError === "expired", "expired");
    expect(link.status()).toMatchObject({ linked: false });
    expect(link.status().pending).toBeUndefined();
    expect(existsSync(join(root, CLOUD_LINK_FILE))).toBe(false);
  });

  it("stops polling when the code's own deadline passes", async () => {
    const link = makeLink({ pollMaxMs: 1_000 });
    await link.start();
    clock += 2_000;
    await until(() => link.status().lastError === "expired", "local expiry");
    expect(link.status().pending).toBeUndefined();
  });

  it("backs off on failures and recovers", async () => {
    const link = makeLink();
    web.pollAnswers.push("approved");
    await link.start();
    await until(() => snapshots().length === 1, "first push");
    web.offline = true;
    summary = { ...summary, agents: { total: 9 } };
    await link.pushNow();
    expect(link.status()).toMatchObject({ linked: true, lastError: "snapshot refused (503)" });
    // While backing off, local activity does not trigger pushes.
    const before = web.requests.length;
    for (const listener of listeners) listener();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(web.requests.length).toBe(before);
    web.offline = false;
    await link.pushNow();
    expect(link.status().lastError).toBeUndefined();
    expect(snapshots().at(-1)!.body.summary.agents.total).toBe(9);
  });

  it("refuses URLs that leave the web origin", async () => {
    web.verifyUrl = "https://evil.example/desktop-link";
    const link = makeLink();
    await expect(link.start()).rejects.toMatchObject({ code: "web_invalid" });

    web.verifyUrl = undefined;
    web.dashboardUrl = "https://evil.example/desktop";
    web.pollAnswers.push("approved");
    await link.start();
    await until(() => link.status().linked, "linked");
    expect(link.status().dashboardUrl).toBe(`${web.origin}/desktop`);
  });

  it("stop() leaves no timer and no request behind", async () => {
    const link = makeLink();
    await link.start();
    link.stop();
    const count = web.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(web.requests.length).toBe(count);
    await expect(link.start()).rejects.toMatchObject({ code: "stopping" });
  });

  it("accepts only https or loopback http origins", () => {
    expect(webOrigin(undefined)).toBe("https://app.bizos.cc");
    expect(webOrigin("http://127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000");
    expect(() => webOrigin("http://app.bizos.cc")).toThrow();
    expect(snapshotHash("a", { generatedAt: "1", x: 1 })).toBe(snapshotHash("a", { generatedAt: "2", x: 1 }));
  });
});
