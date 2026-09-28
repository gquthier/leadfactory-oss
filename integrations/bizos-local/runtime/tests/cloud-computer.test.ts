import { beforeEach as beforeReleaseCase, afterEach as afterReleaseCase, vi as releaseEnv } from "vitest";
beforeReleaseCase(() => releaseEnv.stubEnv("BIZOS_LOCAL_COMPUTER_ENABLED", "true"));
afterReleaseCase(() => releaseEnv.unstubAllEnvs());
// The cloud computer against a FAKE Boat v1 HTTP server on loopback: the
// real client, real fetch, a temp state dir, and a manual clock for the
// auto-sleep timer. No real Boat account, no real profile directory.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_COMPUTER_FILE,
  CloudComputer,
  type CloudClock,
  agentCommand,
  browserCommand,
  pageSummary,
} from "../src/computer/cloud.js";
import { Storage } from "../src/harness/storage.js";
import { LOCAL_TEAM_TOOL_SPECS, handleLocalTeamMessage } from "../src/local-team-mcp.js";

interface FakeSandbox { id: string; state: string; type: string; polls: number }
interface Call { method: string; path: string; body: any; headers: IncomingMessage["headers"] }

/** Just enough of Boat v1: create/get/stop/resume/commands/desktop. A new
 * or resumed machine is `provisioning` for two polls, then `ready`; a stop
 * is `archiving` for one poll, then `archived`. */
class FakeBoat {
  server!: Server;
  url = "";
  calls: Call[] = [];
  sandboxes = new Map<string, FakeSandbox>();
  exec: (command: string) => { stdout: string; stderr?: string; exitCode?: number } = () => ({ stdout: "" });
  private next = 0;

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolveListen) => this.server.listen(0, "127.0.0.1", () => resolveListen()));
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    this.url = `http://127.0.0.1:${address.port}/api/v1`;
  }

  stop(): Promise<void> {
    return new Promise((resolveClose) => this.server.close(() => resolveClose()));
  }

  commands(): string[] {
    return this.calls.filter((call) => call.path.endsWith("/commands")).map((call) => call.body.command as string);
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const path = (request.url ?? "").replace(/^\/api\/v1/, "");
    const body = raw ? JSON.parse(raw) : undefined;
    this.calls.push({ method: request.method ?? "", path, body, headers: request.headers });
    if (request.headers.authorization !== "Bearer test-key") {
      return this.send(response, 401, { ok: false, type: "sandbox.error", status: 401, code: "unauthorized", message: "Unauthorized" });
    }
    if (request.method === "POST" && path === "/sandboxes") {
      const id = `bx_fake${String(++this.next).padStart(4, "2")}`;
      const sandbox = { id, state: "provisioning", type: body?.type ?? "default", polls: 0 };
      this.sandboxes.set(id, sandbox);
      return this.send(response, 202, { ok: true, type: "sandbox.created", status: "provisioning", ttlSeconds: body?.ttlSeconds, sandbox: { ...sandbox, desktopAvailable: false, snapshotAvailable: false } });
    }
    const match = /^\/sandboxes\/([^/]+)(?:\/(stop|resume|commands|desktop|host))?$/.exec(path);
    const sandbox = match ? this.sandboxes.get(match[1]!) : undefined;
    if (!match || !sandbox) return this.send(response, 404, { ok: false, code: "not_found", message: "Not found" });
    const action = match[2];
    if (!action && request.method === "GET") {
      sandbox.polls += 1;
      if (sandbox.state === "provisioning" && sandbox.polls >= 2) sandbox.state = "ready";
      if (sandbox.state === "archiving" && sandbox.polls >= 1) sandbox.state = "archived";
      return this.send(response, 200, { ok: true, type: "sandbox.info", sandbox: { id: sandbox.id, name: "fake", state: sandbox.state, type: sandbox.type, desktopAvailable: true, snapshotAvailable: true } });
    }
    if (action === "stop") {
      sandbox.state = "archiving";
      sandbox.polls = 0;
      return this.send(response, 202, { ok: true, type: "sandbox.stopping", id: sandbox.id, status: "archiving" });
    }
    if (action === "resume") {
      if (sandbox.state !== "archived") return this.send(response, 409, { ok: false, code: "not_archived", message: "Not archived" });
      sandbox.state = "provisioning";
      sandbox.polls = 0;
      return this.send(response, 202, { ok: true, type: "sandbox.resuming", id: sandbox.id, status: "resuming" });
    }
    if (action === "commands") {
      if (sandbox.state !== "ready") return this.send(response, 409, { ok: false, code: "boat_starting", message: "Starting" });
      const result = this.exec(body.command);
      return this.send(response, 200, {
        ok: true, type: "command.finished", success: (result.exitCode ?? 0) === 0, exitCode: result.exitCode ?? 0,
        stdout: result.stdout, stderr: result.stderr ?? "", timedOut: false,
      });
    }
    if (action === "desktop") return this.send(response, 200, { ok: true, type: "desktop.url", success: true, desktopUrl: "https://desktop.example/stream?token=secret", mode: "stream" });
    if (action === "host") return this.send(response, 200, { ok: true, type: "port.hosted", success: true, port: body.port, url: `https://${sandbox.id}-${body.port}.on.boat.example`, isProtected: !body.public, access: body.public ? "public" : "private" });
    return this.send(response, 404, { ok: false, code: "not_found", message: "Not found" });
  }
}

/** A manual clock: time moves only when the test says so. */
function manualClock() {
  let now = 1_700_000_000_000;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextId = 0;
  const clock: CloudClock & { advance(ms: number): void; pending(): number } = {
    now: () => now,
    setTimeout: (callback, ms) => { const id = ++nextId; timers.set(id, { at: now + ms, callback }); return id; },
    clearTimeout: (handle) => { timers.delete(handle as number); },
    delay: async () => { /* polls do not wait in tests */ },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
    pending: () => timers.size,
  };
  return clock;
}

let root: string;
let boat: FakeBoat;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "lbz-cloud-"));
  boat = new FakeBoat();
  await boat.start();
});
afterEach(async () => {
  await boat.stop();
  rmSync(root, { recursive: true, force: true });
});

function machine(options: { allowed?: boolean; env?: NodeJS.ProcessEnv; clock?: CloudClock } = {}) {
  const clock = options.clock ?? manualClock();
  return new CloudComputer({
    storage: new Storage(join(root, "state")),
    isAllowed: () => options.allowed ?? true,
    environment: () => options.env ?? { BOAT_API_KEY: "test-key" },
    baseUrl: boat.url,
    clock,
    pollIntervalMs: 0,
  });
}

describe("cloud computer lifecycle", () => {
  it("creates one small noEnv machine with an idempotency key, waits until ready, and persists its id 0600", async () => {
    const computer = machine();
    const woke = await computer.wake();
    expect(woke).toMatchObject({ state: "ready", created: true, wokeFromSleep: false });
    const create = boat.calls.find((call) => call.method === "POST" && call.path === "/sandboxes")!;
    expect(create.body).toMatchObject({ type: "small", noEnv: true, ttlSeconds: 7200 });
    expect(create.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const file = join(root, "state", CLOUD_COMPUTER_FILE);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ sandboxId: woke.sandboxId, pendingCreateKey: null });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // A second wake (another agent) reuses the same machine.
    expect(await computer.wake()).toMatchObject({ sandboxId: woke.sandboxId, created: false, wokeFromSleep: false });
    expect(boat.calls.filter((call) => call.path === "/sandboxes")).toHaveLength(1);
    // A fresh process (sidecar restart) finds it on disk.
    expect(await machine().wake()).toMatchObject({ sandboxId: woke.sandboxId, created: false });
  });

  it("sleeps with stop and resumes the same machine after", async () => {
    const computer = machine();
    const { sandboxId } = await computer.wake();
    const slept = await computer.sleep("owner");
    expect(slept).toMatchObject({ state: "archiving", sandboxId });
    expect(slept.note).toMatch(/cookies/);
    expect(boat.calls.some((call) => call.path === `/sandboxes/${sandboxId}/stop`)).toBe(true);
    const again = await computer.wake();
    expect(again).toMatchObject({ sandboxId, wokeFromSleep: true, created: false, state: "ready" });
    const resume = boat.calls.find((call) => call.path === `/sandboxes/${sandboxId}/resume`)!;
    expect(resume.body).toMatchObject({ type: "small", ttlSeconds: 7200 });
    expect(boat.sandboxes.size).toBe(1);
  });

  it("recreates the machine when Boat no longer knows it", async () => {
    const computer = machine();
    const first = await computer.wake();
    boat.sandboxes.delete(first.sandboxId);
    const second = await computer.wake();
    expect(second.created).toBe(true);
    expect(second.sandboxId).not.toBe(first.sandboxId);
  });
});

describe("cloud computer agent tools", () => {
  it("runs a command in the agent's own folder and returns output and exit code, auto-waking", async () => {
    boat.exec = (command) => command.includes("uname") ? { stdout: "Linux fake 6.1\n", stderr: "warn\n", exitCode: 0 } : { stdout: "", exitCode: 3 };
    const computer = machine();
    const result = await computer.tool("bot_vega", "cloud_computer_run", { command: "uname -a", timeout_seconds: 30 }) as any;
    expect(result).toMatchObject({ exitCode: 0, stdout: "Linux fake 6.1\n", stderr: "warn\n", timedOut: false, cwd: "/home/user/bizos/agents/bot_vega" });
    const sent = boat.calls.find((call) => call.path.endsWith("/commands"))!;
    expect(sent.body.timeoutSeconds).toBe(30);
    expect(sent.body.command).toContain("cd '/home/user/bizos/agents/bot_vega'");
    expect(sent.body.command).toContain("uname -a");
    expect((await computer.tool("bot_vega", "cloud_computer_run", { command: "false" }) as any).exitCode).toBe(3);
  });

  it("truncates huge output", async () => {
    boat.exec = () => ({ stdout: "x".repeat(100_000) });
    const result = await machine().tool("bot_a", "cloud_computer_run", { command: "yes" }) as any;
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(13_000);
  });

  it("browses with each agent's OWN Chrome profile and returns title and text", async () => {
    boat.exec = () => ({ stdout: "<html><head><title>Example Domain</title><style>p{}</style></head><body><h1>Example Domain</h1><p>This domain &amp; more.</p><script>x()</script></body></html>\n__BIZOS_COOKIES__yes\n" });
    const computer = machine();
    const vega = await computer.tool("bot_vega", "cloud_browser_fetch", { url: "https://example.com" }) as any;
    expect(vega).toMatchObject({ ok: true, title: "Example Domain", text: "Example Domain This domain & more.", chromeProfile: "/home/user/bizos/agents/bot_vega/chrome", profileHasCookies: true });
    await computer.tool("bot_orion", "cloud_browser_fetch", { url: "https://example.com" });
    const [first, second] = boat.commands();
    expect(first).toContain("P='/home/user/bizos/agents/bot_vega/chrome'");
    expect(first).toContain(`--user-data-dir="$P"`);
    expect(first).toContain("--headless=new");
    expect(second).toContain("P='/home/user/bizos/agents/bot_orion/chrome'");
    expect(second).not.toContain("bot_vega");
    await expect(computer.tool("bot_vega", "cloud_browser_fetch", { url: "file:///etc/passwd" })).rejects.toThrow(/http/);
  });

  it("refuses on the free tier in one line and never calls Boat", async () => {
    const result = await machine({ allowed: false }).tool("bot_a", "cloud_computer_run", { command: "ls" });
    expect(result).toEqual({ ok: false, error: "pro_required", message: "The cloud computer needs BizOS Pro." });
    expect(boat.calls).toHaveLength(0);
  });

  it("says not configured when there is no Boat key, and a stored key works without leaking", async () => {
    const computer = machine({ env: {} });
    expect(await computer.tool("bot_a", "cloud_computer_wake", {})).toMatchObject({ ok: false, error: "not_configured" });
    expect(boat.calls).toHaveLength(0);
    const status = computer.setApiKey("test-key");
    expect(status).toMatchObject({ configured: true, keySource: "local" });
    expect(JSON.stringify(await computer.status())).not.toContain("test-key");
    expect(statSync(join(root, "state", CLOUD_COMPUTER_FILE)).mode & 0o777).toBe(0o600);
    expect(await computer.tool("bot_a", "cloud_computer_wake", {})).toMatchObject({ state: "ready", created: true });
  });

  it("resolves the key company-first, then the environment, then the machine-level file", async () => {
    const keyFile = join(root, "shared", "boat-api-key");
    const env: NodeJS.ProcessEnv = { BOAT_API_KEY_FILE: keyFile };
    const computer = machine({ env });
    expect(await computer.status()).toMatchObject({ configured: false, keySource: null, machineKeyFile: true });
    // The machine-level file: written 0600 in a 0700 folder, picked up at once.
    expect(computer.setApiKey("test-key", "machine")).toMatchObject({ configured: true, keySource: "machine" });
    expect(readFileSync(keyFile, "utf8")).toBe("test-key\n");
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "shared")).mode & 0o777).toBe(0o700);
    expect(await computer.tool("bot_a", "cloud_computer_wake", {})).toMatchObject({ state: "ready", created: true });
    // Another company's sidecar on the same Mac sees the same file.
    const other = new CloudComputer({ storage: new Storage(join(root, "other")), isAllowed: () => true, environment: () => env, baseUrl: boat.url, clock: manualClock(), pollIntervalMs: 0 });
    expect(await other.status()).toMatchObject({ configured: true, keySource: "machine" });
    // The environment outranks the file; the company's own key outranks both.
    env.BOAT_API_KEY = "env-key";
    expect(await computer.status()).toMatchObject({ keySource: "env" });
    computer.setApiKey("company-key");
    expect(await computer.status()).toMatchObject({ keySource: "local" });
    // A machine-wide save clears the company's own key so the shared one is in use.
    computer.setApiKey("test-key", "machine");
    delete env.BOAT_API_KEY;
    expect(await computer.status()).toMatchObject({ keySource: "machine" });
    expect(JSON.stringify(computer.status())).not.toContain("test-key");
    // Clearing the machine key removes the file; a whitespace-only or huge file is ignored.
    computer.setApiKey("", "machine");
    expect(existsSync(keyFile)).toBe(false);
    expect(await computer.status()).toMatchObject({ configured: false });
    writeFileSync(keyFile, "  \n");
    expect(await computer.status()).toMatchObject({ configured: false });
    // No file configured: a machine-wide save is refused in one sentence.
    expect(() => machine({ env: {} }).setApiKey("x", "machine")).toThrow("no machine-level key file");
    expect(() => computer.setApiKey("x", "everywhere")).toThrow("scope must be company or machine");
  });

  it("hosts the control port once per machine on a public route it caches", async () => {
    const computer = machine();
    const hosted = await computer.hostPort(9399, "BizOS control");
    expect(hosted.url).toMatch(/^https:\/\/bx_fake\d+-9399\.on\.boat\.example$/);
    const again = await computer.hostPort(9399, "BizOS control");
    expect(again.url).toBe(hosted.url);
    const calls = boat.calls.filter((call) => call.path.endsWith("/host"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ port: 9399, title: "BizOS control", public: true });
  });

  it("does not let one agent put the machine to sleep under another agent's running command", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const computer = machine();
    await computer.wake();
    boat.exec = () => ({ stdout: "done" });
    // Hold the command open at the fetch layer, then ask for sleep while busy.
    let commandStarted = false;
    const slowFetch: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/commands")) { commandStarted = true; await gate; }
      return fetch(input, init);
    };
    const shared = new CloudComputer({ storage: new Storage(join(root, "state")), isAllowed: () => true, environment: () => ({ BOAT_API_KEY: "test-key" }), baseUrl: boat.url, clock: manualClock(), pollIntervalMs: 0, fetchImpl: slowFetch });
    const running = shared.tool("bot_a", "cloud_computer_run", { command: "sleep 100" });
    await vi.waitFor(() => expect(commandStarted).toBe(true));
    expect(await shared.tool("bot_b", "cloud_computer_sleep", {})).toMatchObject({ state: "running" });
    release();
    expect(await running).toMatchObject({ stdout: "done" });
  });
});

describe("cloud computer auto-sleep", () => {
  it("stops the machine after the idle minutes with no cloud tool call, and each call pushes it back", async () => {
    const clock = manualClock();
    const computer = machine({ clock });
    computer.setSettings({ idleMinutes: 10 });
    const { sandboxId } = await computer.wake();
    const stopped = () => boat.calls.some((call) => call.path === `/sandboxes/${sandboxId}/stop`);
    clock.advance(9 * 60_000);
    await computer.tool("bot_a", "cloud_computer_run", { command: "true" });
    clock.advance(9 * 60_000);
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
    expect(stopped()).toBe(false);
    clock.advance(2 * 60_000);
    await vi.waitFor(() => expect(stopped()).toBe(true));
    expect(clock.pending()).toBe(0);
  });

  it("re-arms from the persisted last use when the sidecar restarts", async () => {
    const first = manualClock();
    const { sandboxId } = await machine({ clock: first }).wake();
    const clock = manualClock();
    const restarted = machine({ clock });
    restarted.start();
    clock.advance(16 * 60_000);
    await vi.waitFor(() => expect(boat.calls.some((call) => call.path === `/sandboxes/${sandboxId}/stop`)).toBe(true));
  });
});

describe("cloud computer helpers and transport", () => {
  it("keeps agent folders apart and quotes safely", () => {
    expect(agentCommand("bot:x/../y", "echo hi")).toContain("'/home/user/bizos/agents/bot-x-y'");
    expect(browserCommand("bot_a", "https://e.com/?q=it's")).toContain(`'https://e.com/?q=it'\\''s'`);
    expect(pageSummary("<title>A &amp; B</title><body>Hi&nbsp;there</body>")).toEqual({ title: "A & B", text: "Hi there" });
  });

  it("lists the five cloud tools with the shared-machine note and routes them through the cloud endpoint", async () => {
    const names = LOCAL_TEAM_TOOL_SPECS.map((tool) => tool.name).filter((name) => name.startsWith("cloud_"));
    expect(names).toEqual(["cloud_computer_wake", "cloud_computer_sleep", "cloud_computer_status", "cloud_computer_run", "cloud_browser_fetch"]);
    for (const tool of LOCAL_TEAM_TOOL_SPECS.filter((spec) => spec.name.startsWith("cloud_"))) {
      expect(tool.description).toMatch(/shared by the user's agents/);
      expect(tool.description).toMatch(/sleep it when done/);
    }
    const cloud = vi.fn(async (input: Record<string, unknown>) => ({ exitCode: 0, echoed: input }));
    const result = await handleLocalTeamMessage(
      { id: 1, method: "tools/call", params: { name: "cloud_computer_run", arguments: { command: "ls" } } },
      undefined, undefined, undefined, undefined, { cloud, toolsets: new Set(["team", "cloud"]) },
    );
    expect(cloud).toHaveBeenCalledWith({ tool: "cloud_computer_run", arguments: { command: "ls" } });
    expect(JSON.stringify(result)).toContain("exitCode");
  });
});
