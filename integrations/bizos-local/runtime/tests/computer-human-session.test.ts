// .54: the agent knows it has a computer, learns once that its person drove
// it (Take control), and reads one clear sentence while they still hold it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleComputerCall } from "../src/computer/broker.js";
import {
  HUMAN_CONTROL_MESSAGE, HUMAN_SESSIONS_FILE, HumanSessionError, HumanSessionNotes,
  humanSessionContextLine, parseHumanSession, sanitizeSessionUrl,
} from "../src/computer/human-session.js";
import { ComputerManager, type ComputerApprovals } from "../src/computer/manager.js";
import { RemoteServerComputerBackend } from "../src/computer/remote-server.js";
import type {
  ComputerActionResult, ComputerDownloadResult, ComputerObservation, ComputerState, ManagedComputerBackend,
} from "../src/computer/types.js";
import { ContinuityBridgeError, desktopContinuityTransport, type ContinuityTransport } from "../src/continuity-bridge.js";
import type { Clock } from "../src/harness/clock.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import {
  buildLocalBrief, buildPersonaPrompt, buildTurnContext, computerDoctrine, COMPUTER_TAKE_CONTROL,
  type LocalArchitectureManifest,
} from "../src/harness/prompt.js";
import type { Bot } from "../src/harness/types.js";

beforeEach(() => vi.stubEnv("BIZOS_LOCAL_COMPUTER_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

const NOW = Date.parse("2026-09-30T15:25:00.000Z");
const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString();
const hhmm = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
/** Provider, product and model names the agent must never be told. */
const INTERNAL_NAMES = /boat|anthropic|openai|claude|codex|gpt|opus|sonnet|fable|gemini|mixture|daytona|e2b|browserbase/i;

const BOT: Bot = { id: "bot_nina", name: "Nina", title: "Marketing" } as Bot;
const MANIFEST: LocalArchitectureManifest = {
  mode: "local", instanceId: "inst_1", workspaceId: "local:inst_1:workspace", agentId: "local:inst_1:agent:bot_nina",
  threadId: "local:inst_1:thread:bot:bot_nina", workspaceDir: "/Users/demo/Acme/Agents/Nina", sandbox: "workspace-write",
  supportedProviders: ["codex", "claude", "cursor"], peers: [], recruitment: "autonomous-local-tools",
  host: { platform: "darwin", home: "/Users/demo", provider: "codex", permissions: "ask", tools: ["tool:computer_observe", "tool:computer_act", "tool:computer_download"] },
};

describe("what the agent is told about its computer", () => {
  const computerLine = (brief: string): string => brief.split("\n").find((line) => /^- (computer|browser):/.test(line)) ?? "";

  it("cloud: a persistent virtual computer the person can Take control of, not their browser", () => {
    const brief = buildLocalBrief({ bot: BOT, orgName: "Acme", manifest: MANIFEST, hasComputer: true, computerKind: "cloud", teamTools: true });
    const line = computerLine(brief);
    expect(line).toContain("- computer: your own virtual computer, a persistent Chrome in the cloud that starts when you use it");
    expect(line).toContain("computer_observe first, then computer_act");
    expect(line).toContain("Your user can Take control of it from the Computer panel to sign you in to a site; those logins then stay yours.");
    expect(line).toContain("If they say they signed you in or mention your computer or browser, computer_observe it first: it is not their personal browser.");
    expect(line).not.toMatch(INTERNAL_NAMES);
    expect(brief).not.toMatch(/isolated|normal browser|separate from the person/i);
    // Nothing in the brief sends the agent to another browser.
    expect(brief).not.toMatch(/playwright|browser automation|WebFetch|web_fetch/i);
  });

  it("local: its own browser on this Mac, never called a cloud machine", () => {
    const brief = buildLocalBrief({ bot: BOT, orgName: "Acme", manifest: MANIFEST, hasComputer: true, computerKind: "local", teamTools: true });
    const line = computerLine(brief);
    expect(line).toContain("- browser: your own browser on this Mac, kept between turns");
    expect(line).toContain(COMPUTER_TAKE_CONTROL);
    expect(line).not.toMatch(/cloud|virtual/i);
    expect(line).not.toMatch(INTERNAL_NAMES);
    // Absent kind keeps the local wording.
    expect(computerLine(buildLocalBrief({ bot: BOT, orgName: "Acme", manifest: MANIFEST, hasComputer: true, teamTools: true }))).toBe(line);
    expect(computerLine(buildLocalBrief({ bot: BOT, orgName: "Acme", manifest: MANIFEST, teamTools: true }))).toBe("- browser: none of your own; use the host tools you have.");
  });

  it("the doctrine says the same thing, per kind, and keeps only the search exception", () => {
    const cloud = computerDoctrine("cloud");
    const local = computerDoctrine("local");
    for (const doctrine of [cloud, local]) {
      expect(doctrine).toContain(`- ${COMPUTER_TAKE_CONTROL}`);
      expect(doctrine).not.toMatch(/isolated|normal browser/i);
      expect(doctrine).toMatch(/native web search .* for search results only/);
    }
    expect(cloud).toContain("- It is your own virtual computer, a persistent Chrome in the cloud that starts when you use it.");
    expect(local).toContain("- It is your own browser on this Mac, kept between turns");
    expect(local).not.toMatch(/cloud computer|virtual computer|in the cloud/);
    const added = [cloud.split("\n")[3]!, COMPUTER_TAKE_CONTROL];
    for (const line of added) expect(line).not.toMatch(INTERNAL_NAMES);
  });

  it("a linked or native persona gets the cloud doctrine and no push to another browser", () => {
    const withComputer = buildPersonaPrompt({
      bot: BOT, orgName: "Acme", since: [], roster: [BOT], hasComputer: true, computerKind: "cloud", localArchitecture: MANIFEST,
      computerNote: "Your user used your virtual computer themselves (Take control) from 17:22 to 17:24.",
    });
    expect(withComputer).toContain(computerDoctrine("cloud"));
    expect(withComputer).toContain("embedded browser: your virtual computer in the cloud");
    expect(withComputer).toContain("for a website, use your own computer (see Your computer), not another browser");
    expect(withComputer).not.toContain("OS/browser automation");
    expect(withComputer).not.toContain("imaginary remote desktop");
    expect(withComputer).toContain("Your user used your virtual computer themselves (Take control) from 17:22 to 17:24.");
    const without = buildPersonaPrompt({
      bot: BOT, orgName: "Acme", since: [], roster: [BOT], localArchitecture: { ...MANIFEST, host: { ...MANIFEST.host!, tools: [] } },
      computerNote: "Your user used your virtual computer themselves (Take control) from 17:22 to 17:24.",
    });
    expect(without).toContain("available OS/browser automation");
    expect(without).not.toContain("Take control) from");
  });
});

describe("a Take control session, reported by the desktop", () => {
  it("validates strictly and cleans the page address", () => {
    const ok = parseHumanSession({ startedAt: at(3), endedAt: at(1), url: "https://me:secret@app.metricool.com/planner?token=abc#frag" }, NOW);
    expect(ok).toEqual({ startedAt: at(3), endedAt: at(1), url: "https://app.metricool.com/planner" });
    expect(parseHumanSession({ startedAt: "2026-09-30T17:22:00+02:00" }, NOW)).toEqual({ startedAt: "2026-09-30T15:22:00.000Z" });
    expect(parseHumanSession({ startedAt: at(3), endedAt: null, url: null }, NOW)).toEqual({ startedAt: at(3) });
    const refused: unknown[] = [
      null, [], "x", {}, { startedAt: "" }, { startedAt: "yesterday" }, { startedAt: "2026-09-30 15:22:00" },
      { startedAt: "2026-09-30T15:22:00" }, { startedAt: "2026-02-31T15:22:00Z" }, { startedAt: 1_700_000_000 },
      { startedAt: at(-10) }, { startedAt: at(8 * 24 * 60) }, { startedAt: at(1), endedAt: at(3) },
      { startedAt: at(3), url: "javascript:alert(1)" }, { startedAt: at(3), url: "file:///etc/passwd" },
      { startedAt: at(3), url: "ftp://example.com/" }, { startedAt: at(3), url: "not a url" }, { startedAt: at(3), url: "" },
      { startedAt: at(3), url: `https://example.com/${"a".repeat(2100)}` }, { startedAt: at(3), extra: true },
    ];
    for (const body of refused) {
      expect(() => parseHumanSession(body, NOW), JSON.stringify(body)).toThrow(HumanSessionError);
    }
    // A path too long to be useful falls back to the site itself.
    expect(sanitizeSessionUrl(`https://app.metricool.com/${"p".repeat(600)}`)).toBe("https://app.metricool.com/");
    expect(sanitizeSessionUrl(`https://app.metricool.com/${"p".repeat(400)}`).length).toBeLessThanOrEqual(500);
  });

  it("keeps one note per agent, widened by a second session, and consumes it once", () => {
    let disk: unknown = {};
    const persistence = { read: () => disk, write: (value: unknown) => { disk = JSON.parse(JSON.stringify(value)); } };
    const notes = new HumanSessionNotes(persistence);
    notes.record("bot_a", { startedAt: at(10), endedAt: at(8), url: "https://a.example/" });
    notes.record("bot_a", { startedAt: at(5), endedAt: at(4) });
    const note = notes.peek("bot_a")!;
    expect(note).toMatchObject({ startedAt: at(10), endedAt: at(4), url: "https://a.example/" });
    // Survives a restart.
    const reloaded = new HumanSessionNotes(persistence);
    expect(reloaded.peek("bot_a")).toEqual(note);
    // A newer report between reading and starting is kept for the next turn.
    reloaded.record("bot_a", { startedAt: at(2), url: "https://b.example/" });
    expect(reloaded.consume("bot_a", note)).toBe(false);
    const newer = reloaded.peek("bot_a")!;
    expect(newer.url).toBe("https://b.example/");
    expect(reloaded.consume("bot_a", newer)).toBe(true);
    expect(reloaded.peek("bot_a")).toBeNull();
    expect(disk).toEqual({});
    // A damaged file is ignored, not fatal.
    disk = { bot_x: { startedAt: "nope" }, bot_y: "x", bot_z: { startedAt: at(1), url: "javascript:1" } };
    expect(new HumanSessionNotes(persistence).peek("bot_x")).toBeNull();
  });

  it("renders one line in local time", () => {
    const line = humanSessionContextLine({ startedAt: at(3), endedAt: at(1), url: "https://app.metricool.com/" }, { kind: "cloud", now: new Date(NOW) });
    expect(line).toBe(
      `Your user used your virtual computer themselves (Take control) from ${hhmm(at(3))} to ${hhmm(at(1))} `
      + `(local time, ${line.match(/UTC[+-]\d{2}:\d{2}/)![0]}); last page: https://app.metricool.com/. `
      + "Anything they signed into there is now available to you: if they mention it, computer_observe your computer first.",
    );
    expect(humanSessionContextLine({ startedAt: at(3) }, { kind: "local", now: new Date(NOW) }))
      .toMatch(/^Your user used your browser themselves \(Take control\) from \d{2}:\d{2} \(local time, UTC[+-]\d{2}:\d{2}\)\. /);
    expect(humanSessionContextLine({ startedAt: at(3 * 24 * 60) }, { kind: "cloud", now: new Date(NOW) }))
      .toMatch(/from \d{4}-\d{2}-\d{2} \d{2}:\d{2} /);
    expect(buildTurnContext({ since: [], roster: [], nowIso: new Date(NOW).toISOString(), fresh: false, computerNote: line }))
      .toBe(`Now: ${new Date(NOW).toISOString()}\n\n${line}`);
  });
});

// ── the next turn gets it, once ─────────────────────────────────────────

class FakeCloudBackend implements ManagedComputerBackend {
  readonly kind = "container" as const;
  has(): boolean { return true; }
  async start(botId: string): Promise<ComputerState> { return this.state(botId); }
  state(): ComputerState { return { backend: "container", status: "ready", apps: [] }; }
  async observe(): Promise<ComputerObservation> { throw new Error("unused"); }
  async act(): Promise<ComputerActionResult> { return { completed: 1 }; }
  async download(): Promise<ComputerDownloadResult> { throw new Error("unused"); }
  async signedInHosts(): Promise<string[]> { return []; }
  currentUrl(): string { return ""; }
  async capture() { return null; }
  takeControl(): void {}
  giveBack(): void {}
  navigateForUser(): void {}
  history() { return { back: false, forward: false }; }
  forwardInput(): void {}
  sleep(): void {}
  dispose(): void {}
  disposeAll(): void {}
}

describe("the agent's next turn", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "lbz-human-session-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function setup() {
    const turns: CodexTurnInput[] = [];
    const clock: Clock = { now: () => new Date(NOW), nowIso: () => new Date(NOW).toISOString(), setTimeout: () => () => undefined };
    const harness = new LocalBizosHarness({
      rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
      environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") }, devices: false, clock,
      computerBackend: new FakeCloudBackend(),
      localTeamTools: () => [{ name: "computer_observe", description: "look", inputSchema: { type: "object" }, call: async () => ({}) }],
      startTurn: (input): CodexTurnHandle => {
        turns.push(input);
        return { stop: () => undefined, respond: () => "unavailable", sessionId: () => null, settled: () => false };
      },
      localArchitecture: (input) => ({
        mode: "local", instanceId: "fixture", workspaceId: "w", agentId: `a:${input.bot.id}`, threadId: `t:${input.threadId}`,
        workspaceDir: input.workspaceDir, sandbox: input.sandbox, supportedProviders: ["codex", "claude", "cursor"],
        peers: [], recruitment: "autonomous-local-tools",
      }),
    });
    return { harness, turns };
  }
  const finish = (turn: CodexTurnInput, text: string): void => {
    turn.onEvent({ type: "item.completed", itemId: `m-${Math.random()}`, itemType: "assistant_text", phase: "final_answer", text, ok: true });
    turn.onEvent({ type: "turn.completed", ok: true, stopReason: null });
  };

  it("tells the agent once that its person used its cloud computer, then forgets it", async () => {
    const { harness, turns } = setup();
    const bot = await harness.bots.create({ name: "Nina" });
    await harness.threads.send({ botId: bot.id }, { text: "Bonjour" });
    expect(turns[0]!.system).not.toContain("Take control) from");
    expect(turns[0]!.developerInstructions).toContain("- computer: your own virtual computer, a persistent Chrome in the cloud");
    finish(turns[0]!, "Salut");

    await expect(harness.computer.recordHumanSession(bot.id, { startedAt: at(3), endedAt: at(1), url: "https://app.metricool.com/?session=secret" }))
      .resolves.toEqual({ recorded: true });
    await expect(harness.computer.recordHumanSession("bot_missing", { startedAt: at(3) })).rejects.toMatchObject({ status: 404 });
    await expect(harness.computer.recordHumanSession(bot.id, { startedAt: at(1), endedAt: at(3) })).rejects.toMatchObject({ status: 400 });
    expect(JSON.parse(readFileSync(join(root, "state", HUMAN_SESSIONS_FILE), "utf8"))[bot.id]).toMatchObject({ url: "https://app.metricool.com/" });

    await harness.threads.send({ botId: bot.id }, { text: "je viens de te connecter sur metricool, dis-moi si c'est bon" });
    const told = turns[1]!.system ?? "";
    expect(told).toContain(`Your user used your virtual computer themselves (Take control) from ${hhmm(at(3))} to ${hhmm(at(1))}`);
    expect(told).toContain("last page: https://app.metricool.com/.");
    expect(told).not.toContain("secret");
    expect(told.match(/Take control\) from/g)).toHaveLength(1);
    // Context, not the person's words: it sits before the transcript.
    expect(told.indexOf("Take control) from")).toBeLessThan(told.indexOf("<<<TRANSCRIPT"));
    expect(JSON.parse(readFileSync(join(root, "state", HUMAN_SESSIONS_FILE), "utf8"))).toEqual({});
    finish(turns[1]!, "Je regarde.");

    await harness.threads.send({ botId: bot.id }, { text: "Alors ?" });
    expect(turns[2]!.system).not.toContain("Take control) from");
  });
});

// ── while the person holds it ───────────────────────────────────────────

function activeGate(): ComputerApprovals {
  return {
    hasActiveTurn: () => true,
    isRemembered: () => true,
    ask: async () => true,
    requestHandoff: async () => "denied",
    setHandoffWaiting: () => undefined,
  };
}

function managerWith(transport: ContinuityTransport): ComputerManager {
  return new ComputerManager({
    approvals: activeGate(),
    workspaceFor: () => "/tmp/unused",
    nowIso: () => new Date(NOW).toISOString(),
    publish: () => undefined,
    backend: new RemoteServerComputerBackend(transport, () => "00000000-0000-4000-8000-000000000000", () => "workspace-a"),
  });
}

describe("an agent action while the person has Take control", () => {
  const act = { op: "act", actions: [{ kind: "navigate", url: "https://app.metricool.com/" }] };
  const requester = { botId: "bot_nina", threadId: "bot:bot_nina", runId: "run_1" };

  it("reads one clear sentence for the server's computer_in_human_control (409)", async () => {
    const transport: ContinuityTransport = async (operation) => {
      if (operation === "computer/wake") return { awake: true } as never;
      if (operation === "computer/signed_in_hosts") return { hosts: [] } as never;
      throw new ContinuityBridgeError(409, "computer_in_human_control", "BizOS continuity computer_in_human_control (409)");
    };
    const manager = managerWith(transport);
    for (const body of [act, { op: "observe" }]) {
      expect(await handleComputerCall(manager, requester, body)).toEqual({ status: 200, payload: { ok: false, error: HUMAN_CONTROL_MESSAGE } });
    }
    expect(HUMAN_CONTROL_MESSAGE).toBe("Your user is using your computer right now (Take control); wait for them to give it back, do not retry.");
  });

  it("through the real desktop bridge transport, and leaves other refusals as they are", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lbz-bridge-"));
    try {
      const descriptor = join(dir, "bridge.json");
      mkdirSync(dir, { recursive: true });
      writeFileSync(descriptor, JSON.stringify({ version: 1, origin: "http://127.0.0.1:9/", workspaceId: "workspace-a", secret: "a".repeat(64) }));
      let refusal = { error: "BizOS continuity computer_in_human_control (409)", code: "computer_in_human_control" };
      const fetchImpl = (async (_url: string, init: { body: string }) => {
        const { operation } = JSON.parse(init.body) as { operation: string };
        if (operation === "computer/wake") return new Response(JSON.stringify({ ok: true, result: { awake: true } }));
        if (operation === "computer/signed_in_hosts") return new Response(JSON.stringify({ ok: true, result: { hosts: [] } }));
        return new Response(JSON.stringify({ ok: false, ...refusal }), { status: 409 });
      }) as unknown as typeof fetch;
      const manager = managerWith(desktopContinuityTransport(descriptor, fetchImpl));
      expect((await handleComputerCall(manager, requester, act)).payload).toEqual({ ok: false, error: HUMAN_CONTROL_MESSAGE });
      refusal = { error: "BizOS continuity computer_lease_lost (409)", code: "computer_lease_lost" };
      expect((await handleComputerCall(manager, requester, act)).payload).toEqual({ ok: false, error: "BizOS continuity computer_lease_lost (409)" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says the same when this runtime already knows the person holds it", async () => {
    const manager = managerWith(async () => ({ awake: true }) as never);
    manager.takeControl("bot_nina");
    expect((await handleComputerCall(manager, requester, act)).payload).toEqual({ ok: false, error: HUMAN_CONTROL_MESSAGE });
  });
});
