// The agents' computers as seats on ONE shared cloud computer (Boat), against
// a fake machine that plays the helper's part: every tool call is a helper
// run whose request is decoded and answered the way the real helper answers
// (a marker line of JSON). A real CloudComputer is also driven against a fake
// Boat v1 HTTP server on loopback. Temp dirs only; no real Boat account.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoatComputerBackend, TAKE_CONTROL_UNAVAILABLE, USER_IN_CONTROL_MESSAGE, type BoatMachine } from "../src/computer/boat.js";
import {
  computerHelperSource,
  helperPath,
  HELPER_MARKER,
  HELPER_MISSING,
  toHelperActions,
  type HelperRequest,
  type HelperResponse,
} from "../src/computer/boat-helper.js";
import { handleComputerCall } from "../src/computer/broker.js";
import { CloudComputer, CloudComputerError, type BoatCommandResult } from "../src/computer/cloud.js";
import { ComputerManager, type ComputerApprovals } from "../src/computer/manager.js";
import { clickSelectorScript, pageProbeScript } from "../src/computer/observe.js";
import { COMPUTER_TOOL_SPECS } from "../src/computer/tools.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { Storage } from "../src/harness/storage.js";
import { handleLocalTeamMessage } from "../src/local-team-mcp.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The helper's side of the machine, simulated: one page per agent, cookies
 * per agent, a display per agent handed out in arrival order. */
class FakeSeats {
  displays = new Map<string, string>();
  pages = new Map<string, { url: string; title: string; cookies: Set<string> }>();
  requests: HelperRequest[] = [];
  running = new Map<string, number>();
  maxPerAgent = 0;
  maxOverall = 0;
  overall = 0;
  delayMs = 25;

  async answer(request: HelperRequest): Promise<HelperResponse> {
    this.requests.push(request);
    if (request.op === "shutdown") return { ok: true, closed: [...this.displays.values()] };
    const agent = request.agent;
    this.overall += 1;
    this.running.set(agent, (this.running.get(agent) ?? 0) + 1);
    this.maxOverall = Math.max(this.maxOverall, this.overall);
    this.maxPerAgent = Math.max(this.maxPerAgent, this.running.get(agent)!);
    try {
      await sleep(this.delayMs);
      if (!this.displays.has(agent)) this.displays.set(agent, `:${10 + this.displays.size}`);
      const page = this.pages.get(agent) ?? { url: "about:blank", title: "", cookies: new Set<string>() };
      this.pages.set(agent, page);
      const base = { display: this.displays.get(agent)!, port: 9300 + 10, profile: `/home/user/bizos/agents/${agent}/chrome` };
      if (request.op === "cookies") return { ok: true, ...base, cookieHosts: [...page.cookies] };
      if (request.op === "control") return { ok: true, ...base, control: { port: 9399 }, width: 1280, height: 800, image: "AAAA", thumb: "AAAA" };
      if (request.op === "download") return { ok: true, ...base, download: { path: `/home/user/bizos/agents/${agent}/Downloads/file.pdf`, bytes: 12, name: "file.pdf" } };
      let completed = 0;
      let error: string | undefined;
      if (request.op === "act") {
        for (const action of request.actions) {
          if (action.kind === "eval" && action.script.includes("#missing")) { error = "no element matches that selector"; break; }
          if (action.kind === "navigate") {
            page.url = action.url;
            const host = new URL(action.url).hostname;
            page.title = `Title of ${host}`;
            if (host.startsWith("login.")) page.cookies.add(host);
          }
          completed += 1;
        }
      }
      const shot = Buffer.from(`screen of ${agent} at ${page.url}`).toString("base64");
      return {
        ok: !error, ...(error ? { error } : {}), ...base, completed,
        probe: { url: page.url, title: page.title, text: `text of ${page.url}`, elements: [{ selector: "#go", role: "button", label: "Go", x: 10, y: 20 }] },
        width: 1280, height: 800, image: shot, thumb: shot, cookieHosts: [...page.cookies],
      };
    } finally {
      this.overall -= 1;
      this.running.set(agent, this.running.get(agent)! - 1);
    }
  }
}

function decode(command: string): { path: string; request: HelperRequest } {
  const path = /^H=(\S+);/.exec(command)?.[1] ?? "";
  const payload = /'([A-Za-z0-9+/=]+)'$/.exec(command)?.[1] ?? "";
  return { path, request: JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as HelperRequest };
}

class FakeMachine implements BoatMachine {
  configured = true;
  allowedValue = true;
  refuse: CloudComputerError | null = null;
  files = new Map<string, string>();
  commands: string[] = [];
  beforeSleep: ((sandboxId: string) => Promise<void>) | null = null;
  sleepListeners = new Set<() => void>();
  constructor(readonly seats = new FakeSeats()) {}
  isConfigured() { return this.configured; }
  async allowed() { return this.allowedValue; }
  private async run(command: string): Promise<BoatCommandResult> {
    this.commands.push(command);
    const { path, request } = decode(command);
    if (!this.files.has(path)) return { success: true, exitCode: 0, stdout: `${HELPER_MISSING}\n`, stderr: "", timedOut: false };
    const answer = await this.seats.answer(request);
    return { success: true, exitCode: 0, stdout: `chrome noise\n${HELPER_MARKER}${JSON.stringify(answer)}\n`, stderr: "", timedOut: false };
  }
  async computerExec(command: string) {
    if (this.refuse) throw this.refuse;
    return { result: await this.run(command), wokeFromSleep: false, sandboxId: "bx_fake" };
  }
  async writeFile(path: string, content: string) { this.files.set(path, content); }
  async execAwake(_id: string, command: string) { return this.run(command); }
  setBeforeSleep(hook: ((sandboxId: string) => Promise<void>) | null) { this.beforeSleep = hook; }
  onSleep(listener: () => void) { this.sleepListeners.add(listener); return () => this.sleepListeners.delete(listener); }
  hosted: number[] = [];
  async hostPort(port: number) { this.hosted.push(port); return { url: `https://bx-fake-${port}.on.boat.example/`, sandboxId: "bx_fake" }; }
}

function backend(machine = new FakeMachine()) {
  const changed: string[] = [];
  const frames: string[] = [];
  const boat = new BoatComputerBackend({
    machine,
    nowIso: () => "2026-09-24T10:00:00.000Z",
    onStateChanged: (botId) => changed.push(botId),
    onFrame: (botId) => frames.push(botId),
  });
  return { boat, machine, changed, frames };
}

function approvals(overrides: Partial<ComputerApprovals> = {}) {
  const asked: string[] = [];
  const value: ComputerApprovals = {
    hasActiveTurn: () => true,
    isRemembered: () => false,
    ask: async ({ host }) => { asked.push(host); return true; },
    requestHandoff: async () => "allowed",
    setHandoffWaiting: () => undefined,
    ...overrides,
  };
  return { value, asked };
}

describe("the helper", () => {
  it("is valid ESM for the sandbox's Node and carries the native backend's probe", () => {
    const dir = mkdtempSync(join(tmpdir(), "lbz-helper-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "computer-helper.mjs");
    const source = computerHelperSource();
    writeFileSync(file, source);
    execFileSync(process.execPath, ["--check", file]);
    expect(source).toContain(JSON.stringify(pageProbeScript()));
    expect(source).toContain('session.restore_on_startup');
    expect(source).toContain('restore_on_startup: 1');
    expect(source).toContain('"--restore-last-session"');
    expect(source).not.toMatch(/Max-Age|expires.*cookie|cookie.*expires/i);
    expect(helperPath()).toMatch(/^\/home\/user\/bizos\/computer-helper-[0-9a-f]{16}\.mjs$/);
  });

  it("gets page actions as the same scripts the native backend injects", () => {
    const actions = toHelperActions([
      { kind: "clickSelector", selector: "#go", button: "left" },
      { kind: "type", text: "hello" },
      { kind: "navigate", url: "https://example.com/" },
    ]);
    expect(actions[0]).toEqual({ kind: "eval", script: clickSelectorScript("#go"), settle: true });
    expect(actions[1]).toEqual({ kind: "insertText", text: "hello" });
    expect(actions[2]).toEqual({ kind: "navigate", url: "https://example.com/" });
  });
});

describe("BoatComputerBackend", () => {
  it("installs the helper once, then gives each agent its own display, profile and screen, in parallel", async () => {
    const { boat, machine } = backend();
    const [a, b] = await Promise.all([
      boat.act("bot_a", [{ kind: "navigate", url: "https://example.com/" }], true),
      boat.act("bot_b", [{ kind: "navigate", url: "https://httpbin.org/html" }], true),
    ]);
    expect(machine.files.size).toBe(1);
    expect([...machine.files.keys()][0]).toBe(helperPath());
    expect(a.observation?.title).toBe("Title of example.com");
    expect(b.observation?.title).toBe("Title of httpbin.org");
    expect(Buffer.from(a.observation!.imageBase64, "base64").toString()).toBe("screen of bot_a at https://example.com/");
    expect(Buffer.from(b.observation!.imageBase64, "base64").toString()).toBe("screen of bot_b at https://httpbin.org/html");
    const seatA = boat.seatInfo("bot_a");
    const seatB = boat.seatInfo("bot_b");
    expect(seatA.display).not.toBe(seatB.display);
    expect(seatA.profile).toBe("/home/user/bizos/agents/bot_a/chrome");
    expect(seatB.profile).toBe("/home/user/bizos/agents/bot_b/chrome");
    // The panel shows each agent's OWN latest screen, without a round trip.
    const before = machine.commands.length;
    expect(boat.state("bot_a")).toMatchObject({ backend: "container", status: "ready", openUrl: "https://example.com/" });
    expect(Buffer.from(boat.state("bot_b").screen!.previewDataUrl.split(",")[1]!, "base64").toString()).toContain("bot_b");
    expect((await boat.capture("bot_a"))?.full).toContain(Buffer.from("screen of bot_a").toString("base64").slice(0, 12));
    expect(machine.commands.length).toBe(before);
    expect(machine.seats.maxOverall).toBe(2);
  });

  it("runs one call at a time per agent", async () => {
    const { boat, machine } = backend();
    await boat.start("bot_a");
    await Promise.all([boat.observe("bot_a"), boat.act("bot_a", [{ kind: "wait", ms: 1 }], true), boat.observe("bot_a")]);
    expect(machine.seats.maxPerAgent).toBe(1);
  });

  it("reports a failed action as an error the model reads, and keeps the frame", async () => {
    const { boat } = backend();
    await boat.act("bot_a", [{ kind: "navigate", url: "https://example.com/" }], false);
    await expect(boat.act("bot_a", [{ kind: "clickSelector", selector: "#missing", button: "left" }], true))
      .rejects.toThrow("no element matches that selector");
    expect(boat.state("bot_a").screen).toBeDefined();
    expect(() => boat.forwardInput("bot_a", { type: "mouseMove" })).toThrow(TAKE_CONTROL_UNAVAILABLE);
  });

  it("hands the person a live control session with a fresh secret, and pauses the agent until they give it back", async () => {
    const { boat, machine, changed } = backend();
    await boat.act("bot_a", [{ kind: "navigate", url: "https://example.com/" }], false);
    const session = await boat.controlSession("bot_a");
    // The daemon was told the secret, the port was hosted once, publicly on Boat's side.
    const control = machine.seats.requests.find((request) => request.op === "control")!;
    expect(control).toMatchObject({ op: "control", agent: "bot_a" });
    expect((control as { secret: string }).secret).toMatch(/^[0-9a-f]{48}$/);
    expect(machine.hosted).toEqual([9399]);
    expect(session).toEqual({ url: `wss://bx-fake-9399.on.boat.example/control?k=${(control as { secret: string }).secret}&agent=bot_a`, width: 1280, height: 800 });
    // The panel sees it, and the agent's tools wait it out.
    expect(boat.state("bot_a")).toMatchObject({ status: "ready", userInControl: true });
    expect(boat.userHasControl("bot_a")).toBe(true);
    await expect(boat.act("bot_a", [{ kind: "wait", ms: 1 }], false)).rejects.toThrow(USER_IN_CONTROL_MESSAGE);
    await expect(boat.observe("bot_a")).rejects.toThrow(USER_IN_CONTROL_MESSAGE);
    await expect(boat.download("bot_a", "https://example.com/f.pdf")).rejects.toThrow(USER_IN_CONTROL_MESSAGE);
    // Another agent's seat is untouched.
    await boat.observe("bot_b");
    expect(boat.state("bot_b").userInControl).toBeUndefined();
    // Give back: the agent may act again; a second session gets a new secret.
    boat.giveBack("bot_a");
    expect(boat.state("bot_a").userInControl).toBeUndefined();
    await boat.act("bot_a", [{ kind: "wait", ms: 1 }], false);
    const second = await boat.controlSession("bot_a");
    expect(second.url).not.toBe(session.url);
    expect(changed).toContain("bot_a");
  });

  it("runs the person's session through the manager: wake first, then the session, then the state", async () => {
    const machine = new FakeMachine();
    const { boat } = backend(machine);
    const published: string[] = [];
    const manager = new ComputerManager({
      approvals: approvals().value, workspaceFor: () => "/tmp", nowIso: () => "2026-09-24T10:00:00.000Z",
      publish: (event) => published.push(`${event.kind}:${event.state.status}:${event.state.userInControl ? "user" : "agent"}`),
      backend: boat,
    });
    const { state, session } = await manager.controlSession("bot_a");
    expect(session?.url).toMatch(/^wss:\/\/.*\/control\?k=[0-9a-f]{48}&agent=bot_a$/);
    expect(state).toMatchObject({ backend: "container", status: "ready", userInControl: true });
    expect(published.at(-1)).toBe("computer.status:ready:user");
    expect(manager.giveBack("bot_a").userInControl).toBeUndefined();
  });

  it("closes every agent's Chrome before the machine sleeps, then shows them sleeping", async () => {
    const { boat, machine } = backend();
    await boat.start("bot_a");
    await machine.beforeSleep!("bx_fake");
    expect(machine.seats.requests.at(-1)).toEqual({ op: "shutdown" });
    for (const listener of machine.sleepListeners) listener();
    expect(boat.state("bot_a").status).toBe("sleeping");
    expect(boat.has("bot_a")).toBe(true);
    await boat.observe("bot_a");
    expect(boat.state("bot_a").status).toBe("ready");
  });

  it("stops being chosen when the plan refuses it", async () => {
    const machine = new FakeMachine();
    const { boat } = backend(machine);
    expect(boat.usable()).toBe(true);
    machine.refuse = new CloudComputerError("pro_required", "The cloud computer needs BizOS Pro.");
    await expect(boat.observe("bot_a")).rejects.toThrow("BizOS Pro");
    expect(boat.usable()).toBe(false);
    machine.configured = false;
    expect(boat.usable()).toBe(false);
  });
});

describe("ComputerManager on the cloud computer", () => {
  it("keeps the rules: no action outside a turn, a card for a signed-in host", async () => {
    const { boat } = backend();
    let turn = false;
    const gate = approvals({ hasActiveTurn: () => turn });
    const events: string[] = [];
    const manager = new ComputerManager({
      approvals: gate.value,
      workspaceFor: () => "/unused",
      nowIso: () => "2026-09-24T10:00:00.000Z",
      publish: (event) => events.push(`${event.kind}:${event.botId}`),
      backend: () => boat,
    });
    const refused = await handleComputerCall(manager, "bot_a", { op: "observe" });
    expect(refused.payload).toMatchObject({ ok: false, error: expect.stringContaining("no turn in flight") });

    turn = true;
    const opened = await handleComputerCall(manager, "bot_a", { op: "act", actions: [{ kind: "navigate", url: "https://login.example.com/" }] });
    expect(opened.payload).toMatchObject({ ok: true, title: "Title of login.example.com", image: { mimeType: "image/jpeg" } });
    expect((opened.payload as { text: string }).text).toContain("<<<PAGE_CONTENT");
    expect(gate.asked).toEqual([]);
    // The page now holds a session: acting on it asks first.
    const clicked = await handleComputerCall(manager, "bot_a", { op: "act", actions: [{ kind: "click", selector: "#go" }] });
    expect(clicked.payload).toMatchObject({ ok: true });
    expect(gate.asked).toEqual(["login.example.com"]);
    expect(manager.state("bot_a")).toMatchObject({ backend: "container", status: "ready" });
    expect(events).toContain("computer.screen:bot_a");
  });

  it("stops when the user says no", async () => {
    const { boat } = backend();
    const gate = approvals({ ask: async () => false });
    const manager = new ComputerManager({ approvals: gate.value, workspaceFor: () => "/unused", nowIso: () => "now", publish: () => undefined, backend: boat });
    await manager.act("bot_a", [{ kind: "navigate", url: "https://login.example.com/" }], false);
    await expect(manager.act("bot_a", [{ kind: "scroll", direction: "down", amount: 1 }], false)).rejects.toThrow("did not allow acting on login.example.com");
  });

  it("says where a cloud download landed", async () => {
    const { boat } = backend();
    const manager = new ComputerManager({ approvals: approvals().value, workspaceFor: () => "/unused", nowIso: () => "now", publish: () => undefined, backend: boat });
    const saved = await handleComputerCall(manager, "bot_a", { op: "download", url: "https://example.com/file.pdf" });
    expect((saved.payload as { text: string }).text).toContain("/home/user/bizos/agents/bot_a/Downloads/file.pdf");
    expect((saved.payload as { text: string }).text).toContain("cloud computer");
  });
});

/** Boat v1, just enough: one sandbox that is always ready, files, commands, stop. */
class FakeBoatServer {
  server!: Server;
  url = "";
  calls: Array<{ method: string; path: string; body: any }> = [];
  files = new Map<string, string>();
  state = "ready";
  constructor(readonly seats = new FakeSeats()) {}
  async start() {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", () => resolve()));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}/api/v1`;
  }
  stop() { return new Promise<void>((resolve) => this.server.close(() => resolve())); }
  private send(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const path = (request.url ?? "").replace(/^\/api\/v1/, "");
    const body = raw ? JSON.parse(raw) : undefined;
    this.calls.push({ method: request.method ?? "", path, body });
    if (request.method === "POST" && path === "/sandboxes") return this.send(response, 202, { ok: true, sandbox: { id: "bx_one", state: "provisioning" } });
    if (request.method === "GET" && path === "/sandboxes/bx_one") return this.send(response, 200, { ok: true, sandbox: { id: "bx_one", state: this.state } });
    if (request.method === "PUT" && path === "/sandboxes/bx_one/files") {
      this.files.set(body.path, body.content);
      return this.send(response, 200, { ok: true, type: "file.written", success: true, path: body.path, encoding: "utf8", size: body.content.length });
    }
    if (request.method === "POST" && path === "/sandboxes/bx_one/commands") {
      const { path: helper, request: helperRequest } = decode(body.command);
      const stdout = this.files.has(helper)
        ? `${HELPER_MARKER}${JSON.stringify(await this.seats.answer(helperRequest))}\n`
        : `${HELPER_MISSING}\n`;
      return this.send(response, 200, { ok: true, type: "command.finished", success: true, exitCode: 0, stdout, stderr: "", timedOut: false });
    }
    if (request.method === "POST" && path === "/sandboxes/bx_one/stop") { this.state = "archived"; return this.send(response, 202, { ok: true }); }
    if (request.method === "POST" && path === "/sandboxes/bx_one/resume") { this.state = "ready"; return this.send(response, 202, { ok: true }); }
    return this.send(response, 404, { ok: false, code: "not_found", message: "Not found" });
  }
}

describe("on a real CloudComputer (fake Boat server)", () => {
  it("uploads the helper through the files API, drives two seats, and closes the browsers before stop", async () => {
    const server = new FakeBoatServer();
    await server.start();
    const root = mkdtempSync(join(tmpdir(), "lbz-boat-seat-"));
    cleanup.push(async () => { await server.stop(); rmSync(root, { recursive: true, force: true }); });
    const cloud = new CloudComputer({
      storage: new Storage(root),
      isAllowed: () => true,
      environment: () => ({ BOAT_API_KEY: "test-key" }),
      baseUrl: server.url,
      clock: { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => undefined, delay: async () => undefined },
    });
    const boat = new BoatComputerBackend({ machine: cloud, nowIso: () => "now" });
    const [a, b] = await Promise.all([
      boat.act("bot_a", [{ kind: "navigate", url: "https://example.com/" }], true),
      boat.act("bot_b", [{ kind: "navigate", url: "https://httpbin.org/html" }], true),
    ]);
    expect(a.observation?.title).toBe("Title of example.com");
    expect(b.observation?.title).toBe("Title of httpbin.org");
    expect([...server.files.keys()]).toEqual([helperPath()]);
    expect(server.files.get(helperPath())).toBe(computerHelperSource());
    await cloud.sleep("owner");
    const order = server.calls.map((call) => `${call.method} ${call.path}`);
    const shutdown = server.calls.findIndex((call) => call.path.endsWith("/commands") && decode(call.body.command).request.op === "shutdown");
    expect(shutdown).toBeGreaterThan(-1);
    expect(shutdown).toBeLessThan(order.indexOf("POST /sandboxes/bx_one/stop"));
    expect(boat.state("bot_a").status).toBe("sleeping");
  });
});

describe("the Claude MCP bridge", () => {
  it("lists the computer tools only with the computer toolset, and returns the screenshot as an image", async () => {
    const list = async (toolsets: string[]) =>
      ((await handleLocalTeamMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, undefined, undefined, undefined, undefined, { toolsets: new Set(toolsets) })) as any).result.tools.map((tool: any) => tool.name);
    expect(await list(["team"])).not.toContain("computer_act");
    expect(await list(["team", "computer"])).toEqual(expect.arrayContaining(COMPUTER_TOOL_SPECS.map((tool) => tool.name)));
    const calls: unknown[] = [];
    const reply = await handleLocalTeamMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "computer_observe", arguments: {} } },
      undefined, undefined, undefined, undefined,
      { toolsets: new Set(["team", "computer"]), computer: async (input) => { calls.push(input); return { ok: true, text: "Page: Example", image: { mimeType: "image/jpeg", data: "AAAA" } }; } },
    );
    expect(calls).toEqual([{ tool: "computer_observe", arguments: {} }]);
    expect((reply as any).result.content).toEqual([
      { type: "text", text: "Page: Example" },
      { type: "image", data: "AAAA", mimeType: "image/jpeg" },
    ]);
    const refused = await handleLocalTeamMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "computer_act", arguments: {} } },
      undefined, undefined, undefined, undefined,
      { toolsets: new Set(["team", "computer"]), computer: async () => ({ ok: false, error: "no turn in flight" }) },
    );
    expect((refused as any).result).toMatchObject({ isError: true, content: [{ type: "text", text: "no turn in flight" }] });
  });
});

describe("the harness", () => {
  it("mounts the computer for a configured cloud computer and serves it inside a real turn", async () => {
    const requests: any[] = [];
    const server: Server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "fixture:1" }] }));
      if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "tools"], details: { family: "fixture" } }));
      requests.push(body);
      const answered = body.messages.some((message: any) => message.role === "tool");
      res.end(JSON.stringify(answered
        ? { model: "fixture:1", done: true, message: { role: "assistant", content: "Looked." } }
        : { model: "fixture:1", done: true, message: { role: "assistant", content: "", tool_calls: [{ function: { name: "computer_act", arguments: { actions: [{ kind: "navigate", url: "https://example.com/" }] } } }] } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const root = mkdtempSync(join(tmpdir(), "lbz-boat-harness-"));
    const machine = new FakeMachine();
    let harness!: LocalBizosHarness;
    harness = new LocalBizosHarness({
      rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Fixture",
      execPath: "/missing/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/missing/mcp", devices: false,
      environment: { PATH: "/nowhere", LBZ_CODEX_PATH: "/missing/codex", LBZ_CLAUDE_PATH: "/missing/claude", LBZ_CURSOR_PATH: "/missing/cursor", BIZOS_LOCAL_PLAN: "pro" },
      cloudComputer: machine,
      localTeamTools: ({ bot }) => harness.computerToolsAvailable()
        ? COMPUTER_TOOL_SPECS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as unknown as Record<string, unknown>, call: (args: unknown) => harness.computerTool(bot.id, tool.name, args) }))
        : [],
    });
    cleanup.push(async () => { harness.stop(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
    const provider = await harness.inference.add({ kind: "ollama", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: "fixture:1" });
    await harness.runtime.setInference({ source: "provider", providerId: provider.id });
    expect(harness.computerToolsAvailable()).toBe(true);

    const bot = await harness.bots.create({ name: "Vega" });
    // Outside a turn, the same door refuses.
    await expect(harness.computerTool(bot.id, "computer_observe", {})).rejects.toThrow("no turn in flight");
    const sent = await harness.threads.send({ botId: bot.id }, { text: "Open example.com" });
    for (let n = 0; n < 300; n += 1) {
      const run = await harness.runs.get(sent.runIds[0]!);
      if (run && ["completed", "failed", "cancelled"].includes(run.state)) break;
      await sleep(10);
    }
    expect((await harness.runs.get(sent.runIds[0]!))?.state).toBe("completed");
    expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(expect.arrayContaining(["computer_observe", "computer_act", "computer_download"]));
    const toolMessage = requests[1].messages.at(-1);
    expect(toolMessage.role).toBe("tool");
    expect(toolMessage.content).toContain("Title of example.com");
    // Words only for a driver without image input: no base64 in the text.
    expect(toolMessage.content).not.toContain(Buffer.from("screen of").toString("base64").slice(0, 8));
    const state = await harness.computer.get(bot.id);
    expect(state).toMatchObject({ backend: "container", status: "ready", openUrl: "https://example.com/" });
    expect(state.screen?.previewDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    // The desktop panel reads the same state, and the viewer the full frame.
    const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined);
    expect(await facade.computerState(bot.id, true)).toMatchObject({ backend: "container", fullDataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/) });
    expect(await facade.computerState(`local:fixture:agent:${bot.id}`)).toMatchObject({ backend: "container", status: "ready" });
    // The desktop panel names the agent by its chat's thread id.
    expect(await facade.computerState(`local:fixture:thread:bot:${bot.id}`)).toMatchObject({ backend: "container", status: "ready" });
    // No key: no cloud computer, no tools, and the panel keeps its own browser.
    machine.configured = false;
    expect(harness.computerToolsAvailable()).toBe(false);
    expect(await harness.computer.get(bot.id)).toMatchObject({ backend: "none" });
    await expect(harness.computerTool(bot.id, "computer_observe", {})).rejects.toThrow("not configured");
  });
});
