// The desktop contract, against a REAL sidecar process: `node dist/sidecar.js
// serve` on a temporary state root, with a temporary HOME so no profile of
// this Mac is read, and no CLI on PATH. Skipped when `dist/` is not built
// (`npm run build` first).
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
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
const expiredId = `qchat_${"a".repeat(32)}`;

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
    const runtimeState = join(temp, "state", "runtime");
    mkdirSync(join(runtimeState, "threads"), { recursive: true });
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(runtimeState, "quick-chats.json"), JSON.stringify([{ id: expiredId, title: "New chat", createdAt: past, updatedAt: past }]));
    writeFileSync(join(runtimeState, "threads", `chat-${expiredId}.ndjson`), JSON.stringify({ id: "old", threadId: `chat:${expiredId}`, role: "user", seq: 1, blocks: [{ kind: "text", text: "Expired private message" }], createdAt: past }) + "\n");
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

  it("removes expired chats and persisted transcripts before serving bootstrap", async () => {
    const snapshot = await api("GET", "/api/collaboration/bootstrap");
    expect(snapshot.status).toBe(200);
    expect(JSON.stringify(snapshot.body)).not.toContain(expiredId);
    expect((await api("GET", `/api/local/quick-chats/${expiredId}`)).status).not.toBe(200);
    expect(existsSync(join(temp, "state", "runtime", "threads", `chat-${expiredId}.ndjson`))).toBe(false);
    expect(readFileSync(join(temp, "state", "runtime", "expired-quick-chats.json"), "utf8")).toContain(expiredId);
  });

  it("answers 404 to continuity link and attach for an expired QuickChat at the HTTP boundary", async () => {
    // A live QuickChat can be saved like any conversation (lot A); an expired
    // one is gone and must be refused before any continuity state is touched.
    for (const operation of ["link", "attach"]) {
      const result = await api("POST", `/api/local/continuity/${operation}`, {
        threadId: `chat:${expiredId}`, agentId: "agent", audience: "private", title: "QuickChat", conversationId: "conversation",
      });
      expect(result.status).toBe(404);
    }
  });

  it("requires the workspace bearer, creates chats without bots and keeps requests idempotent", async () => {
    expect((await api("GET", "/api/local/quick-chats", undefined, "")).status).toBe(401);
    const before = await api("GET", "/api/collaboration/bootstrap");
    const created = await api("POST", "/api/local/quick-chats", { requestId: "quick-http-create" });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const thread = created.body.thread;
    expect(created.body.title).toBe("QuickChat");
    expect(thread).toMatchObject({ name: "QuickChat", kind: "chat", agentIds: [], canManage: false });
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

  it("keeps a pasted chat message above the old 20k and 64 KiB limits intact", async () => {
    const created = await api("POST", "/api/local/quick-chats", { requestId: "quick-long-message" });
    expect(created.status).toBe(201);
    const path = `/api/collaboration/threads/${encodeURIComponent(created.body.thread.id)}/messages`;
    const content = "Long brief line. ".repeat(5_000);
    const body = { content, clientMessageId: "019a1551-7642-7000-8123-123456789abd" };
    const sent = await api("POST", path, body);
    expect(sent.status).toBe(201);
    const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(sent.body.message.content.length).toBe(content.trim().length);
    expect(sha256(sent.body.message.content)).toBe(sha256(content.trim()));
    expect((await api("GET", path)).body.messages.some((message: any) => sha256(message.content) === sha256(content.trim()))).toBe(true);
    for (const run of sent.body.runs) {
      await api("POST", `/api/collaboration/runs/${encodeURIComponent(run.runId)}/cancel`, {});
    }
  });
});
