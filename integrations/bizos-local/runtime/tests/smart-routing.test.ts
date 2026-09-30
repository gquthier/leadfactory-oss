// "Smart choice" (lot .54): the classifier, its fallback, the level → model
// mapping on what the owner really has, and the turn it changes.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalBizosHarness, type HarnessOptions } from "../src/harness/harness.js";
import { PlanRegistry } from "../src/harness/plan-registry.js";
import { normalizeSettings, SettingsError, SettingsStore } from "../src/harness/settings.js";
import {
  CLASSIFIER_EXCERPT_MAX,
  chooseCandidate,
  classifierExcerpt,
  classifyTurn,
  heuristicClassification,
  levelForScore,
  modelForLevel,
  TYPESAFE_ENDPOINT,
  type CatalogOption,
} from "../src/harness/smart-routing.js";
import { Storage } from "../src/harness/storage.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach((fn) => fn()));

const SIMPLE = "Résume ce document en trois lignes.";
const MEDIUM = "Rédige un email de relance pour un client qui n'a pas payé sa facture, ton poli mais ferme.";
const HARD = "Analyse notre stratégie de pricing sur 3 marchés, compare 4 concurrents, puis conçois un plan de migration du code de facturation avec les risques.";

const CODEX_LIVE: CatalogOption[] = [
  { id: "gpt-6-astra", label: "GPT-6-Astra", isDefault: true },
  { id: "gpt-6-sol", label: "GPT-6-Sol" },
  { id: "gpt-6-luna", label: "GPT-6-Luna" },
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
];
const CLAUDE_LIVE: CatalogOption[] = [
  { id: "opus", label: "Opus (latest)", isDefault: true },
  { id: "sonnet", label: "Sonnet (latest)" },
  { id: "fable", label: "Fable (latest)" },
  { id: "haiku", label: "Haiku (latest)" },
  { id: "claude-opus-5", label: "Opus 5" },
];

describe("the excerpt that may leave the Mac", () => {
  it("masks secrets before cutting at 600 characters", () => {
    const key = `sk-proj-${"A".repeat(40)}`;
    const text = `${"mot ".repeat(145)}${key} et la suite ${"x".repeat(900)}`;
    const excerpt = classifierExcerpt(text);
    expect(excerpt.length).toBeLessThanOrEqual(CLASSIFIER_EXCERPT_MAX);
    expect(excerpt).not.toContain("AAAAAAAAAAAAAAAA");
    expect(excerpt).toContain("«redacted");
    expect(classifierExcerpt("api_key=abcdefghijklmnop123 merci")).not.toContain("abcdefghijklmnop123");
    expect(classifierExcerpt("  a\n\n  b  ")).toBe("a b");
  });
});

describe("the local heuristic", () => {
  it("reads summarize / write / analyse as simple, medium and hard", () => {
    expect(levelForScore(heuristicClassification({ text: SIMPLE }).score)).toBe("simple");
    expect(levelForScore(heuristicClassification({ text: MEDIUM }).score)).toBe("medium");
    expect(levelForScore(heuristicClassification({ text: HARD }).score)).toBe("hard");
  });

  it("weighs attachments, pasted code, length and expected tools", () => {
    expect(levelForScore(heuristicClassification({ text: "Lis ce fichier", attachments: 1 }).score)).toBe("simple");
    expect(levelForScore(heuristicClassification({ text: "Pourquoi ?\n```\nTypeError: x is undefined\n```" }).score)).not.toBe("simple");
    expect(levelForScore(heuristicClassification({ text: "ok" }).score)).toBe("simple");
    // A tool call is never handed to the smallest model.
    expect(levelForScore(heuristicClassification({ text: "Recrute un designer" }).score)).not.toBe("simple");
    // Word starts only: "barcode" is not "code".
    expect(heuristicClassification({ text: "Résume le barcode" }).reason).not.toContain("code");
    expect(heuristicClassification({ text: SIMPLE }).reason).toContain("résume".normalize("NFD").replace(/[̀-ͯ]/g, ""));
  });

  it("lets the owner's preference move the thresholds", () => {
    expect(levelForScore(1, "balanced")).toBe("medium");
    expect(levelForScore(1, "best")).toBe("hard");
    expect(levelForScore(0.8, "economy")).toBe("simple");
    expect(levelForScore(1.5, "economy")).toBe("medium");
    expect(levelForScore(0.4, "best")).toBe("medium");
    expect(levelForScore(2, "economy")).toBe("hard");
    expect(levelForScore(0, "best")).toBe("simple");
  });
});

describe("level → model, on the owner's own catalog", () => {
  it("maps Codex to the frontier, the workhorse and the fast model of one generation", () => {
    expect(modelForLevel("codex", "hard", CODEX_LIVE)).toEqual({ model: "gpt-6-astra", label: "GPT-6-Astra", effort: "xhigh" });
    expect(modelForLevel("codex", "medium", CODEX_LIVE)).toEqual({ model: "gpt-6-sol", label: "GPT-6-Sol", effort: "medium" });
    expect(modelForLevel("codex", "simple", CODEX_LIVE)).toEqual({ model: "gpt-6-luna", label: "GPT-6-Luna", effort: "low" });
  });

  it("maps Claude to Opus, Sonnet and Haiku through the CLI aliases", () => {
    expect(modelForLevel("claude", "hard", CLAUDE_LIVE)).toMatchObject({ model: "opus", label: "Opus", effort: "high" });
    expect(modelForLevel("claude", "medium", CLAUDE_LIVE)).toMatchObject({ model: "sonnet", label: "Sonnet", effort: "medium" });
    expect(modelForLevel("claude", "simple", CLAUDE_LIVE)).toMatchObject({ model: "haiku", label: "Haiku", effort: "low" });
    expect(modelForLevel("claude", "simple", [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }, { id: "claude-opus-5", label: "Opus 5", isDefault: true }])).toMatchObject({ model: "claude-haiku-4-5" });
  });

  it("falls back to the catalog's default, never to a name the account lacks", () => {
    const only = [{ id: "gpt-6-astra", label: "GPT-6-Astra", isDefault: true }];
    expect(modelForLevel("codex", "simple", only)?.model).toBe("gpt-6-astra");
    expect(modelForLevel("claude", "simple", [{ id: "opus", label: "Opus (latest)", isDefault: true }])?.model).toBe("opus");
    expect(modelForLevel("codex", "hard", [])).toBeNull();
  });

  it("picks the preferred engine, and skips an account whose window is full", () => {
    const codex = { planId: "pln_a_1", family: "codex" as const, priority: 0, usageReached: false, usedPct: 10 };
    const claude = { planId: "pln_b_1", family: "claude" as const, priority: 1, usageReached: false, usedPct: 60 };
    expect(chooseCandidate([codex, claude], "claude")?.planId).toBe("pln_b_1");
    expect(chooseCandidate([codex, claude], null)?.planId).toBe("pln_a_1");
    expect(chooseCandidate([{ ...codex, usageReached: true, usedPct: 100 }, claude], "codex")?.planId).toBe("pln_b_1");
    expect(chooseCandidate([{ ...codex, usageReached: true, usedPct: 100 }], "codex")?.planId).toBe("pln_a_1");
    expect(chooseCandidate([], "codex")).toBeNull();
  });
});

describe("TypeSafe, and the fallback that never blocks a turn", () => {
  const scoreResponse = (score: number) =>
    new Response(JSON.stringify({ model: "jev-1.13.0", answers: { difficulty: { type: "score", score, confidence: 0.9, probabilities: {}, legend: {} } }, usage: { input_tokens: 312, output_tokens: 18 } }));

  it("sends only the excerpt as state, and reads the probability-weighted score", async () => {
    const sent: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
    const result = await classifyTurn({
      text: `${HARD} sk-ant-${"B".repeat(40)}`,
      apiKey: "ts_fixture_key_0123456789",
      fetchImpl: async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: String((init?.headers as Record<string, string>).Authorization) });
        return scoreResponse(1.8);
      },
    });
    expect(result).toMatchObject({ source: "typesafe", score: 1.8, confidence: 0.9, inputTokens: 312, typesafeModel: "jev-1.13.0" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(TYPESAFE_ENDPOINT);
    expect(sent[0]!.auth).toBe("Bearer ts_fixture_key_0123456789");
    expect(Object.keys(sent[0]!.body).sort()).toEqual(["model", "questions", "state"]);
    const state = sent[0]!.body.state as Record<string, string>;
    expect(Object.keys(state)).toEqual(["user_request"]);
    expect(state.user_request!.length).toBeLessThanOrEqual(600);
    expect(state.user_request).not.toContain("BBBBBBBBBBBB");
  });

  it("answers with the heuristic on no key, 402, 401, timeout, network error and a malformed body", async () => {
    expect(await classifyTurn({ text: SIMPLE })).toMatchObject({ source: "heuristic", fallback: "no_key" });
    const cases: Array<[typeof fetch, string]> = [
      [async () => new Response('{"detail":{"error_type":"billing_error"}}', { status: 402 }), "typesafe_no_credits"],
      [async () => new Response("{}", { status: 401 }), "typesafe_unauthorized"],
      [async () => new Response("{}", { status: 529 }), "typesafe_busy"],
      [async () => { throw new TypeError("fetch failed"); }, "typesafe_unreachable"],
      [async () => new Response(JSON.stringify({ answers: { difficulty: { type: "score", score: 7 } } })), "typesafe_malformed"],
      [async () => new Response("not json"), "typesafe_malformed"],
    ];
    for (const [fetchImpl, code] of cases) {
      const result = await classifyTurn({ text: HARD, apiKey: "ts_fixture_key_0123456789", fetchImpl });
      expect(result, code).toMatchObject({ source: "heuristic", fallback: code });
      expect(levelForScore(result.score)).toBe("hard");
    }
  });

  it("gives up after the time limit instead of holding the turn", async () => {
    const started = Date.now();
    const result = await classifyTurn({
      text: MEDIUM,
      apiKey: "ts_fixture_key_0123456789",
      timeoutMs: 80,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
      }),
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({ source: "heuristic", fallback: "typesafe_timeout" });
  });
});

describe("settings and plans", () => {
  it("reads the mode leniently and refuses a bad write", () => {
    expect(normalizeSettings({ local: { smart: { enabled: true, preference: "best" } } }).local.smart).toEqual({ enabled: true, preference: "best" });
    expect(normalizeSettings({ local: { smart: { enabled: true, preference: "nope" } } }).local.smart).toEqual({ enabled: true, preference: "balanced" });
    expect(normalizeSettings({ local: { smart: "on" } }).local.smart).toBeUndefined();
    const root = mkdtempSync(join(tmpdir(), "smart-settings-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new SettingsStore(new Storage(root));
    expect(() => store.set({ local: { smart: { enabled: "yes" } } })).toThrow(SettingsError);
    expect(store.set({ local: { smart: { enabled: true, preference: "economy" } } }).local.smart).toEqual({ enabled: true, preference: "economy" });
  });

  it("detects each family of this Mac, shows it, and respects a disconnect", () => {
    const root = mkdtempSync(join(tmpdir(), "smart-plans-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const storage = new Storage(root);
    const plans = new PlanRegistry(storage);
    plans.seedFromMachine({ nowIso: "2026-09-30T00:00:00Z", homeDir: join(root, "home"), codexAuthenticated: true });
    // Claude signs in later: the second family is imported too, and shown.
    plans.seedFromMachine({ nowIso: "2026-09-30T00:01:00Z", homeDir: join(root, "home"), codexAuthenticated: true, claudeAuthenticated: true });
    expect(plans.publicList().map((plan) => [plan.provider, plan.settingsVisible])).toEqual([["codex", undefined], ["claude", undefined]]);
    const claude = plans.list().find((plan) => plan.provider === "claude")!;
    plans.remove(claude.id);
    plans.dismissMachine("claude");
    const again = new PlanRegistry(storage);
    again.seedFromMachine({ nowIso: "2026-09-30T00:02:00Z", homeDir: join(root, "home"), codexAuthenticated: true, claudeAuthenticated: true });
    expect(again.publicList().map((plan) => plan.provider)).toEqual(["codex"]);
    again.undismissMachine("claude");
    again.seedFromMachine({ nowIso: "2026-09-30T00:03:00Z", homeDir: join(root, "home"), claudeAuthenticated: true });
    expect(again.publicList().map((plan) => plan.provider)).toEqual(["codex", "claude"]);
    expect(JSON.parse(readFileSync(join(root, "plans.json"), "utf8")).dismissedMachine).toBeUndefined();
  });
});

describe("a turn under Smart choice", () => {
  type Turn = { driver: string; input: Record<string, any> };
  function fixture(fetchImpl: typeof fetch, extra: Partial<HarnessOptions> = {}) {
    const root = mkdtempSync(join(tmpdir(), "smart-turns-"));
    const plans = [
      { id: "pln_codex_one", provider: "codex", codexHome: join(root, "codex-one"), priority: 0 },
      { id: "pln_claude_one", provider: "claude", configDir: join(root, "claude-one"), priority: 1 },
    ].map((plan) => ({ ...plan, label: plan.id, authKind: "oauth", status: "connected", createdAt: "2026-09-30T00:00:00Z" }));
    writeFileSync(join(root, "plans.json"), JSON.stringify({ plans, routing: { pins: {}, defaultPolicy: "priority" } }));
    const turns: Turn[] = [];
    const start = (driver: string) => (input: Record<string, any>) => {
      turns.push({ driver, input });
      return { stop: () => {}, respond: () => "unavailable" as const, sessionId: () => null, settled: () => false };
    };
    const harness = new LocalBizosHarness({
      rootDir: root, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Test",
      execPath: "/missing/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: "/missing/mcp", devices: false,
      environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "fake-codex"), LBZ_CLAUDE_PATH: join(root, "fake-claude") },
      startTurn: start("codex") as never, startClaudeTurn: start("claude") as never, smartFetch: fetchImpl, ...extra,
    });
    cleanup.push(() => { harness.stop(); rmSync(root, { recursive: true, force: true }); });
    return { harness, root, turns };
  }
  const waitForTurns = async (turns: Turn[], count: number) => {
    for (let i = 0; i < 200 && turns.length < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(turns).toHaveLength(count);
  };
  const finish = (turn: Turn) => turn.input.onEvent({ type: "turn.completed", ok: true, stopReason: null });

  it("classifies each owner message and runs it on the matching model of the preferred engine", async () => {
    const bodies: string[] = [];
    const scores = new Map([[SIMPLE, 0.1], [MEDIUM, 1.0], [HARD, 1.9]]);
    const { harness, root, turns } = fixture(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(String(init?.body));
      const score = scores.get(body.state.user_request) ?? 1;
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { difficulty: { type: "score", score, confidence: 0.8 } }, usage: { input_tokens: 300 } }));
    });
    const state = await harness.smartRouting.configure({ enabled: true, preference: "balanced", preferredFamily: "claude", apiKey: "ts_fixture_key_0123456789" });
    expect(state).toMatchObject({ enabled: true, preference: "balanced", preferredFamily: "claude", hasKey: true });
    expect(JSON.stringify(state)).not.toContain("ts_fixture_key");
    const bot = await harness.bots.create({ name: "CEO" });
    const expected = [[SIMPLE, "haiku", "low", "simple"], [MEDIUM, "sonnet", "medium", "medium"], [HARD, "opus", "high", "hard"]] as const;
    for (const [n, [text, model, effort, level]] of expected.entries()) {
      const sent = await harness.threads.send({ botId: bot.id }, { text });
      await waitForTurns(turns, n + 1);
      const turn = turns.at(-1)!;
      expect(turn.driver).toBe("claude");
      expect(turn.input.model).toBe(model);
      expect(turn.input.effort).toBe(effort);
      expect(turn.input.environment.CLAUDE_CONFIG_DIR).toBe(join(root, "claude-one"));
      expect(harness.smartRouting.noteForRun(sent.runIds[0]!)).toMatchObject({ label: model[0]!.toUpperCase() + model.slice(1), level, family: "claude" });
      finish(turn);
    }
    // What reached TypeSafe: the owner's words only — never the persona or the organisation's instructions.
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      const parsed = JSON.parse(body);
      expect(Object.keys(parsed.state)).toEqual(["user_request"]);
      expect(expected.map(([text]) => text)).toContain(parsed.state.user_request);
    }
    expect(turns[0]!.input.system ?? "").not.toBe("");
    for (const body of bodies) expect(body).not.toContain(String(turns[0]!.input.system).slice(0, 80));
    const decisions = harness.smartRouting.decisions(10);
    expect(decisions.map((row) => [row.level, row.model, row.source])).toEqual([["hard", "opus", "typesafe"], ["medium", "sonnet", "typesafe"], ["simple", "haiku", "typesafe"]]);
    // The key never lands in the record.
    expect(readFileSync(join(root, "smart-routing.json"), "utf8")).not.toContain("ts_fixture_key");
  });

  it("falls back locally when TypeSafe fails, and never blocks the turn", async () => {
    const { harness, turns } = fixture(async () => new Response("{}", { status: 402 }));
    await harness.smartRouting.configure({ enabled: true, preferredFamily: "codex", apiKey: "ts_fixture_key_0123456789" });
    const bot = await harness.bots.create({ name: "CEO" });
    await harness.threads.send({ botId: bot.id }, { text: HARD });
    await waitForTurns(turns, 1);
    // Static catalog here (no CLI): the frontier of the shipped floor, at xhigh.
    expect(turns[0]).toMatchObject({ driver: "codex", input: { effort: "xhigh" } });
    expect(harness.smartRouting.decisions(1)[0]).toMatchObject({ source: "heuristic", fallback: "typesafe_no_credits", level: "hard", family: "codex" });
  });

  it("keeps an explicit /model first, and stays off when the owner picks a concrete default", async () => {
    let calls = 0;
    const { harness, turns } = fixture(async () => { calls += 1; return new Response("{}", { status: 500 }); });
    await harness.smartRouting.configure({ enabled: true, preferredFamily: "claude" });
    const bot = await harness.bots.create({ name: "Pinned" });
    await harness.runtime.selectModel({ scope: { kind: "agent", agentId: bot.id }, selection: { source: "plan", planId: "pln_codex_one", model: "gpt-5.6-sol" } });
    await harness.threads.send({ botId: bot.id }, { text: SIMPLE });
    await waitForTurns(turns, 1);
    expect(turns[0]).toMatchObject({ driver: "codex", input: { model: "gpt-5.6-sol" } });
    expect(harness.smartRouting.decisions(5)).toHaveLength(0);
    finish(turns[0]!);
    await harness.runtime.selectModel({ scope: { kind: "workspace" }, selection: { source: "plan", planId: "pln_claude_one", model: "sonnet" } });
    expect(harness.smartRouting.state().enabled).toBe(false);
    const other = await harness.bots.create({ name: "Default" });
    await harness.threads.send({ botId: other.id }, { text: HARD });
    await waitForTurns(turns, 2);
    expect(turns[1]).toMatchObject({ driver: "claude", input: { model: "sonnet" } });
    expect(calls).toBe(0);
  });

  it("uses the heuristic, not TypeSafe, for text the owner did not type", async () => {
    let calls = 0;
    const { harness } = fixture(async () => { calls += 1; return new Response("{}", { status: 500 }); });
    await harness.smartRouting.configure({ enabled: true, apiKey: "ts_fixture_key_0123456789" });
    const decide = (harness as unknown as { decideSmartRoute: (input: object) => Promise<{ source: string; fallback?: string } | null> }).decideSmartRoute.bind(harness);
    const decision = await decide({ threadId: "bot:x", runId: "run_x", text: HARD, attachments: 0, origin: "system" });
    expect(decision).toMatchObject({ source: "heuristic", fallback: "not_owner_text" });
    expect(calls).toBe(0);
  });

  it("refuses a malformed key and never returns a stored one", async () => {
    const { harness, root } = fixture(async () => new Response("{}"));
    await expect(harness.smartRouting.configure({ apiKey: "short" })).rejects.toThrow("TypeSafe");
    await harness.smartRouting.configure({ apiKey: "ts_fixture_key_0123456789" });
    expect(harness.smartRouting.state().hasKey).toBe(true);
    await harness.smartRouting.configure({ apiKey: "" });
    expect(harness.smartRouting.state().hasKey).toBe(false);
    expect(() => readFileSync(join(root, "smart-routing-key.json"))).toThrow();
  });

  it("names the picked model on the reply the desktop reads, and nowhere else", async () => {
    const { harness, turns } = fixture(async () => new Response(JSON.stringify({ model: "jev-1.13.0", answers: { difficulty: { type: "score", score: 1 } } })));
    const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => {});
    await facade.configureSmartRouting({ enabled: true, preferredFamily: "claude", apiKey: "ts_fixture_key_0123456789" });
    await expect(facade.configureSmartRouting({ enabled: true, extra: 1 })).rejects.toThrow();
    const runtime = await facade.localRuntime() as { smartRouting?: Record<string, unknown> };
    expect(runtime.smartRouting).toMatchObject({ enabled: true, hasKey: true, preferredFamily: "claude" });
    expect(JSON.stringify(runtime)).not.toContain("ts_fixture_key");
    const bot = await harness.bots.create({ name: "Vega" });
    await harness.threads.send({ botId: bot.id }, { text: MEDIUM });
    await waitForTurns(turns, 1);
    turns[0]!.input.onEvent({ type: "item.completed", itemId: "m-1", itemType: "assistant_text", phase: "final_answer", text: "Voici le brouillon." });
    finish(turns[0]!);
    const page = await facade.messagePage(`local:fixture:thread:bot:${bot.id}`, new URL("http://127.0.0.1/x"));
    const reply = page.messages.find((row: { role: string }) => row.role === "assistant") as Record<string, unknown>;
    expect(reply.content).toBe("Voici le brouillon.");
    expect(reply.modelRoute).toEqual({ label: "Sonnet", level: "medium", family: "claude" });
    const user = page.messages.find((row: { role: string }) => row.role === "user") as Record<string, unknown>;
    expect(user.modelRoute).toBeUndefined();
  });
});
