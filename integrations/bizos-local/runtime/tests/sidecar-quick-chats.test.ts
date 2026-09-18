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

describe.skipIf(!built)("Quick chat HTTP boundary", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-sidecar-quick-"));
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

  it("requires the workspace bearer, creates chats without bots and keeps requests idempotent", async () => {
    expect((await api("GET", "/api/local/quick-chats", undefined, "")).status).toBe(401);
    const before = await api("GET", "/api/collaboration/bootstrap");
    const created = await api("POST", "/api/local/quick-chats", { requestId: "quick-http-create" });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const thread = created.body.thread;
    expect(thread).toMatchObject({ kind: "chat", agentIds: [], canManage: false });
    expect((await api("GET", "/api/collaboration/bootstrap")).body.threads).toContainEqual(thread);
    expect((await api("POST", "/api/local/quick-chats", { requestId: "quick-http-create" })).body.id).toBe(id);
    expect((await api("GET", "/api/local/quick-chats")).body.chats).toHaveLength(1);
    expect((await api("GET", `/api/local/quick-chats/${id}/messages`)).body.messages).toEqual([]);
    expect((await api("POST", `/api/local/quick-chats/${id}/messages`, { text: "", requestId: "invalid" })).status).toBe(400);
    expect((await api("POST", `/api/local/quick-chats/${id}/messages`, { text: "Hello", requestId: "x", botId: "injected" })).status).toBe(400);
    const publicRoute = `/api/collaboration/threads/${encodeURIComponent(thread.id)}/messages`;
    const body = { content: "Hello from the test", clientMessageId: "019a1551-7642-7000-8123-123456789abc" };
    const sent = await api("POST", publicRoute, body);
    expect(sent.status).toBe(201);
    expect((await api("POST", publicRoute, body)).body.duplicate).toBe(true);
    expect(sent.body.runs[0].agentId).toBeNull();
    expect((await api("GET", publicRoute)).body.messages.some((message: any) => message.content === body.content)).toBe(true);
    const runPath = `/api/collaboration/runs/${encodeURIComponent(sent.body.runs[0].runId)}`;
    expect((await api("GET", `${runPath}/approval`)).status).toBe(200);
    expect((await api("POST", `${runPath}/cancel`, {})).status).toBe(200);
    const snapshot = await api("GET", `/api/local/quick-chats/${id}`);
    expect(snapshot.body.messages.filter((m: any) => m.role === "user")).toHaveLength(1);
    expect((await api("GET", "/api/collaboration/bootstrap")).body.agents).toEqual(before.body.agents);
    expect((await api("GET", "/api/collaboration/runs")).body.runs.every((run: any) => run.agentId === null)).toBe(true);
    expect((await api("POST", `/api/local/quick-chats/${id}/stop`, {})).status).toBe(200);
    expect((await api("POST", `/api/local/quick-chats/${id}/answer`, { runId: "wrong-run", askId: "wrong-ask", answer: { kind: "allow_once" } })).status).toBe(400);
  });
});
