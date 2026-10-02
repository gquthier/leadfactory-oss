// Onboarding inside the chat (docs/specs/onboarding-chat, v2 of
// 2026-09-26), runtime side: the two reply tools, their place on the next
// message and in the sidecar contract, the personalised CEO welcome, and the
// apply route's optional owner/language.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessAsk } from "../src/harness/ask-impact.js";
import { parseCompanyName, parseQuickReplies } from "../src/harness/chat-outputs.js";
import type { CodexTurnHandle, CodexTurnInput, RuntimeEvent } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { COMPUTER_DOCTRINE } from "../src/harness/prompt.js";
import { approvalTitle, labelForTool } from "../src/harness/style.js";
import { CREATION_TEMPLATE_IDS, creationTemplateOf, creationWelcome, firstNameOf, templateOf } from "../src/harness/templates.js";
import type { Bot } from "../src/harness/types.js";
import { handleLocalTeamMessage, LOCAL_TEAM_TOOL_SPECS } from "../src/local-team-mcp.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "lbz-onboarding-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

// ── Tool arguments ────────────────────────────────────────────────────────

describe("tool arguments", () => {
  it("offer_quick_replies: 1 to 4 short answers, trimmed, deduplicated", () => {
    expect(parseQuickReplies({ choices: [" Oui ", "Autre  nom…", "Oui"] })).toEqual(["Oui", "Autre nom…"]);
    expect(() => parseQuickReplies({})).toThrow(/at least one/);
    expect(() => parseQuickReplies({ choices: [] })).toThrow(/at least one/);
    expect(() => parseQuickReplies({ choices: ["a", "b", "c", "d", "e"] })).toThrow(/at most 4/);
    expect(() => parseQuickReplies({ choices: ["a", "b", "c", "d", "a"] })).not.toThrow();
    expect(() => parseQuickReplies({ choices: ["ok", "  "] })).toThrow(/choices\[1\]/);
    expect(() => parseQuickReplies({ choices: [42] })).toThrow(/choices\[0\]/);
    expect(() => parseQuickReplies({ choices: ["x".repeat(41)] })).toThrow(/40 characters/);
    expect(parseQuickReplies({ choices: ["x".repeat(40)] })).toEqual(["x".repeat(40)]);
    expect(() => parseQuickReplies("Oui")).toThrow();
  });

  it("propose_company_name: one trimmed name, 1..48 characters", () => {
    expect(parseCompanyName({ name: "  Nova   Prospect " })).toBe("Nova Prospect");
    expect(() => parseCompanyName({})).toThrow(/non-empty/);
    expect(() => parseCompanyName({ name: "   " })).toThrow(/non-empty/);
    expect(() => parseCompanyName({ name: 12 })).toThrow(/non-empty/);
    expect(() => parseCompanyName({ name: "n".repeat(49) })).toThrow(/48 characters/);
    expect(parseCompanyName({ name: "n".repeat(48) })).toBe("n".repeat(48));
  });

  it("is listed for Claude with its schema and routed to the sidecar; low-impact, reversible, labelled", async () => {
    const listed = await handleLocalTeamMessage({ id: 1, method: "tools/list" });
    const names = (listed!.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["send_to_chat", "offer_quick_replies", "propose_company_name"]));
    const quick = LOCAL_TEAM_TOOL_SPECS.find((tool) => tool.name === "offer_quick_replies")!;
    expect(quick.inputSchema).toMatchObject({ required: ["choices"], additionalProperties: false });
    const propose = LOCAL_TEAM_TOOL_SPECS.find((tool) => tool.name === "propose_company_name")!;
    expect(propose.inputSchema).toMatchObject({ required: ["name"], additionalProperties: false });

    const quickReplies = vi.fn(async (input: Record<string, unknown>) => ({ choices: input.choices, note: "shown" }));
    const proposeName = vi.fn(async (input: Record<string, unknown>) => ({ name: input.name, note: "shown" }));
    const a = await handleLocalTeamMessage({ id: 2, method: "tools/call", params: { name: "offer_quick_replies", arguments: { choices: ["Oui", "Non"] } } }, undefined, undefined, undefined, undefined, { quickReplies, proposeName });
    expect(quickReplies).toHaveBeenCalledWith({ choices: ["Oui", "Non"] });
    expect(JSON.stringify(a)).toContain("shown");
    const b = await handleLocalTeamMessage({ id: 3, method: "tools/call", params: { name: "propose_company_name", arguments: { name: "Nova" } } }, undefined, undefined, undefined, undefined, { quickReplies, proposeName });
    expect(proposeName).toHaveBeenCalledWith({ name: "Nova" });
    expect(JSON.stringify(b)).toContain("Nova");
    const failed = await handleLocalTeamMessage({ id: 4, method: "tools/call", params: { name: "propose_company_name", arguments: {} } }, undefined, undefined, undefined, undefined, { proposeName: async () => { throw new Error("name must be a non-empty string"); } });
    expect(failed!.result).toMatchObject({ isError: true });

    for (const tool of ["offer_quick_replies", "propose_company_name"]) {
      expect(assessAsk({ tool, summary: tool })).toMatchObject({ impact: "low", reversible: true });
    }
    expect(labelForTool("offer_quick_replies")).toBe("Offering quick replies");
    expect(approvalTitle({ botName: "Vega", tool: "propose_company_name", requestType: "permission" })).toBe("Allow Vega to propose a company name?");
  });
});

// ── Through the harness ──────────────────────────────────────────────────

function harnessAt(stateRoot: string, turns: CodexTurnInput[]): LocalBizosHarness {
  return new LocalBizosHarness({
    rootDir: stateRoot, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") }, devices: false, linkPreviews: false,
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      return { stop: () => undefined, respond: () => "allowed-once", sessionId: () => null, settled: () => false };
    },
    localTeamTools: () => [],
    localArchitecture: (input) => ({
      mode: "local", instanceId: "fixture", workspaceId: "w", agentId: `a:${input.bot.id}`, threadId: `t:${input.threadId}`,
      workspaceDir: input.workspaceDir, ...(input.sharedBrainPath ? { sharedBrainPath: input.sharedBrainPath } : {}),
      sandbox: input.sandbox, supportedProviders: ["codex", "claude", "cursor"],
      peers: [], recruitment: "autonomous-local-tools",
    }),
  });
}

function setup() {
  const turns: CodexTurnInput[] = [];
  const stateRoot = join(root, "state");
  const harness = harnessAt(stateRoot, turns);
  const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined);
  return { harness, facade, turns, stateRoot };
}

const emit = (turn: CodexTurnInput, event: RuntimeEvent): void => turn.onEvent(event);
const say = (turn: CodexTurnInput, text: string): void =>
  emit(turn, { type: "item.completed", itemId: `m-${Math.random()}`, itemType: "assistant_text", phase: "final_answer", text });
const end = (turn: CodexTurnInput): void => emit(turn, { type: "turn.completed", ok: true, stopReason: null });

async function scopeOf(harness: LocalBizosHarness, bot: Bot) {
  const run = (await harness.runs.list({ limit: 1 }))[0]!;
  return { botId: bot.id, threadId: `bot:${bot.id}`, runId: run.id };
}

describe("quick replies and the name proposal on the next reply", () => {
  it("ride on the next reply with the text, the latest call winning, under the matching run only", async () => {
    const { harness, facade, turns } = setup();
    const bot = await harness.bots.create({ name: "CEO" });
    await harness.threads.send({ botId: bot.id }, { text: "Je vends des sites web aux restaurants." });
    const scope = await scopeOf(harness, bot);

    expect(() => harness.offerQuickReplies({ ...scope, runId: "run_other" }, { choices: ["Oui"] })).toThrow(/matching active run/);
    expect(() => harness.proposeCompanyName({ ...scope, botId: "bot_other" }, { name: "Nova" })).toThrow(/matching active run/);
    expect(() => harness.offerQuickReplies(scope, { choices: [] })).toThrow(/at least one/);

    expect(harness.offerQuickReplies(scope, { choices: ["Peut-être"] })).toMatchObject({ choices: ["Peut-être"], note: expect.stringMatching(/under your next message/) });
    expect(harness.proposeCompanyName(scope, { name: "Resto Sites" })).toMatchObject({ name: "Resto Sites", note: expect.stringMatching(/Resto Sites/) });
    expect(harness.proposeCompanyName(scope, { name: "Nova Web" })).toMatchObject({ name: "Nova Web" });
    expect(harness.offerQuickReplies(scope, { choices: ["Oui", "Autre nom…", "Oui"] })).toMatchObject({ choices: ["Oui", "Autre nom…"] });

    say(turns[0]!, "Tu crées des sites web pour les restaurants. Ça te va ?");
    end(turns[0]!);
    const replies = (await harness.threads.get({ botId: bot.id })).messages.filter((row) => row.role === "bot" && row.deliveryState === "complete");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.blocks).toEqual([
      { kind: "text", text: "Tu crées des sites web pour les restaurants. Ça te va ?" },
      { kind: "proposal", proposalKind: "company-name", value: "Nova Web" },
      { kind: "quick_replies", choices: ["Oui", "Autre nom…"] },
    ]);

    // The sidecar contract: the words as before, the two fields beside them.
    const page = await facade.messagePage(`local:fixture:thread:bot:${bot.id}`, new URL("http://127.0.0.1/x"));
    const reply = page.messages.find((row) => row.role === "assistant")!;
    expect(reply.content).toBe("Tu crées des sites web pour les restaurants. Ça te va ?");
    expect(reply.quickReplies).toEqual(["Oui", "Autre nom…"]);
    expect(reply.proposal).toEqual({ kind: "company-name", value: "Nova Web" });
    expect(reply.attachments).toBeUndefined();
    const asked = page.messages.find((row) => row.role === "user")!;
    expect(asked).not.toHaveProperty("quickReplies");
    expect(asked).not.toHaveProperty("proposal");

    // A later reply of the same thread carries nothing staged.
    await harness.threads.send({ botId: bot.id }, { text: "Oui" });
    say(turns[1]!, "Parfait.");
    end(turns[1]!);
    const later = (await facade.messagePage(`local:fixture:thread:bot:${bot.id}`, new URL("http://127.0.0.1/x"))).messages.at(-1)!;
    expect(later.content).toBe("Parfait.");
    expect(later).not.toHaveProperty("quickReplies");
    expect(later).not.toHaveProperty("proposal");
  });

  it("publishes what was staged on a message of its own when the turn ends without text", async () => {
    const { harness, facade, turns } = setup();
    const bot = await harness.bots.create({ name: "CEO" });
    await harness.threads.send({ botId: bot.id }, { text: "Salut" });
    harness.offerQuickReplies(await scopeOf(harness, bot), { choices: ["Une agence", "Des services"] });
    end(turns[0]!);
    const page = await facade.messagePage(`local:fixture:thread:bot:${bot.id}`, new URL("http://127.0.0.1/x"));
    const reply = page.messages.find((row) => row.role === "assistant")!;
    expect(reply.content).toBe("");
    expect(reply.quickReplies).toEqual(["Une agence", "Des services"]);
  });

  it("survives a reload: the blocks are in the transcript, and a fresh sidecar serializes them again", async () => {
    const { harness, turns, stateRoot } = setup();
    const bot = await harness.bots.create({ name: "CEO" });
    await harness.threads.send({ botId: bot.id }, { text: "Un logiciel de devis." });
    const scope = await scopeOf(harness, bot);
    harness.proposeCompanyName(scope, { name: "Devisly" });
    harness.offerQuickReplies(scope, { choices: ["Oui", "Autre nom…"] });
    say(turns[0]!, "Un logiciel de devis, donc.");
    end(turns[0]!);

    const reopened = harnessAt(stateRoot, []);
    const facade = new CollaborationFacade(reopened, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined);
    const stored = (await reopened.threads.get({ botId: bot.id })).messages.filter((row) => row.role === "bot" && row.deliveryState === "complete");
    expect(stored[0]!.blocks.map((block) => block.kind)).toEqual(["text", "proposal", "quick_replies"]);
    const page = await facade.messagePage(`local:fixture:thread:bot:${bot.id}`, new URL("http://127.0.0.1/x"));
    const reply = page.messages.find((row) => row.role === "assistant")!;
    expect(reply).toMatchObject({ content: "Un logiciel de devis, donc.", quickReplies: ["Oui", "Autre nom…"], proposal: { kind: "company-name", value: "Devisly" } });
  });
});

// ── The welcome and the CEO's first reply ─────────────────────────────────

describe("the CEO's welcome in a new company", () => {
  it("is short and localized, with the first name when the app knows it", () => {
    expect(firstNameOf("Alex Exemple")).toBe("Alex");
    expect(firstNameOf("  Marie-Lou  ")).toBe("Marie-Lou");
    expect(firstNameOf("   ")).toBeUndefined();
    expect(firstNameOf(undefined)).toBeUndefined();
    expect(creationWelcome("lead-gen-agency", { owner: { name: "Alex Exemple" }, language: "fr" }))
      .toBe("Salut Alex 👋 Je suis ton CEO. Tu as choisi « Agence de prospection ». Dis-moi en une phrase ce que tu vends et à qui, je m’occupe du reste.");
    expect(creationWelcome("service-based-business"))
      .toBe("Salut 👋 Je suis ton CEO. Tu as choisi « Entreprise de services ». Dis-moi en une phrase ce que tu vends et à qui, je m’occupe du reste.");
    expect(creationWelcome("software", { owner: { name: "Ada Lovelace" }, language: "en" }))
      .toBe("Hi Ada 👋 I'm your CEO. You picked “Software”. Tell me in one sentence what you sell and to whom, I'll take it from there.");
    expect(creationWelcome("lead-gen-agency", { language: "en" }))
      .toBe("Hi 👋 I'm your CEO. You picked “Lead generation agency”. Tell me in one sentence what you sell and to whom, I'll take it from there.");
    for (const id of CREATION_TEMPLATE_IDS) expect(creationWelcome(id).length).toBeLessThan(160);
  });

  it.each(CREATION_TEMPLATE_IDS)("%s: the CEO's instructions carry the first-reply brief and Company.md names the owner", (id) => {
    const source = templateOf(id);
    const before = JSON.stringify(source);
    const plain = creationTemplateOf(source);
    const ceo = plain.bots[0]!;
    expect(ceo.welcome).toBe(creationWelcome(id));
    expect(ceo.instructions.length).toBeLessThan(6000);
    for (const expected of ["propose_company_name", "offer_quick_replies", "recruit_agent", "native web search", "Never invent", "computer_*", "no spending", "one or two lines"]) {
      expect(ceo.instructions).toContain(expected);
    }
    const companyOf = (template: typeof plain) => template.notes.find((note) => note.path === "Company.md")!.text;
    expect(companyOf(plain)).toMatch(/^- (?:Owner[^:\n]*:|\*\*Name, and how to address them:\*\*) TODO$/m);

    const personal = creationTemplateOf(source, { owner: { name: "Alex Exemple" }, language: "en" });
    expect(personal.bots[0]!.welcome).toBe(creationWelcome(id, { owner: { name: "Alex Exemple" }, language: "en" }));
    expect(companyOf(personal)).toMatch(/^- (?:Owner[^:\n]*:|\*\*Name, and how to address them:\*\*) Alex Exemple$/m);
    expect(companyOf(personal)).not.toMatch(/^- (?:Owner[^:\n]*:|\*\*Name, and how to address them:\*\*) TODO$/m);
    expect(companyOf(personal)).toMatch(/^- (?:(?:Working language[^:\n]*|Language and tone|Markets and languages):|\*\*Language they work in:\*\*) English$/m);
    expect(personal.notes.length).toBe(plain.notes.length);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("applies through the harness: the welcome is on the record, Company.md is filled, a retry posts nothing twice", async () => {
    const { harness } = setup();
    const result = await harness.templates.apply("software", undefined, { owner: { name: "Alex Exemple" }, language: "en" });
    expect(result).toMatchObject({ id: "software", created: true });
    const ceoId = result.bots.ceo!;
    const thread = await harness.threads.get({ botId: ceoId });
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.blocks[0]).toEqual({ kind: "text", text: "Hi Alex 👋 I'm your CEO. You picked “Software”. Tell me in one sentence what you sell and to whom, I'll take it from there." });
    const vault = (await harness.brain.roots()).find((row) => row.id === result.rootId)!.path;
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toMatch(/^- Owner and preferred address: Alex Exemple$/m);
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toMatch(/^- Working language and time zone: English$/m);
    const again = await harness.templates.apply("software", undefined, { owner: { name: "Alex Exemple" }, language: "en" });
    expect(again).toMatchObject({ id: "software", created: false });
    expect((await harness.threads.get({ botId: ceoId })).messages).toHaveLength(1);
  });

  it("keeps computer_* as the browser and allows only the CLI's native search for a search the role asks for", () => {
    expect(COMPUTER_DOCTRINE).toContain("`computer_act` and `computer_observe` tools drive the browser");
    expect(COMPUTER_DOCTRINE).toContain("native web search (Claude Code WebSearch, Codex web search)");
    expect(COMPUTER_DOCTRINE).toContain("search results only");
  });
});

// ── The apply route ──────────────────────────────────────────────────────

describe("POST /api/local/brain/templates/apply", () => {
  function facadeWith(calls: unknown[][]) {
    return new CollaborationFacade(
      {
        templates: {
          apply: async (...args: unknown[]) => {
            calls.push(args);
            return { id: args[0], rootId: `vault:${String(args[0])}`, created: true, vault: "seeded", bots: {} };
          },
        },
      } as unknown as LocalBizosHarness,
      "test",
      {} as never,
      emptyDurableIndex(),
    );
  }

  it("passes owner.name and language to the harness, and keeps the old payload's exact call", async () => {
    const calls: unknown[][] = [];
    const facade = facadeWith(calls);
    expect(await facade.applyBrainTemplate({ id: "software" })).toMatchObject({ rootId: "vault:software", created: true });
    await facade.applyBrainTemplate({ id: "software", rootId: "new" });
    await facade.applyBrainTemplate({ id: "software", owner: { name: "  Alex Exemple " }, language: "en" });
    await facade.applyBrainTemplate({ id: "software", rootId: "new", language: "fr" });
    await facade.applyBrainTemplate({ id: "software", owner: { name: "Alex" } });
    expect(calls).toEqual([
      ["software", undefined, {}],
      ["software", "new", {}],
      ["software", undefined, { owner: { name: "Alex Exemple" }, language: "en" }],
      ["software", "new", { language: "fr" }],
      ["software", undefined, { owner: { name: "Alex" } }],
    ]);
  });

  it("ignores a malformed owner or language instead of refusing the install, and still refuses unknown fields", async () => {
    const calls: unknown[][] = [];
    const facade = facadeWith(calls);
    await facade.applyBrainTemplate({ id: "software", owner: "Alex", language: "de" });
    await facade.applyBrainTemplate({ id: "software", owner: { name: "" }, language: 3 });
    await facade.applyBrainTemplate({ id: "software", owner: { name: "x".repeat(81) }, language: null });
    await facade.applyBrainTemplate({ id: "software", owner: null, language: "en" });
    expect(calls).toEqual([
      ["software", undefined, {}],
      ["software", undefined, {}],
      ["software", undefined, {}],
      ["software", undefined, { language: "en" }],
    ]);
    await expect(facade.applyBrainTemplate({ id: "software", ownerName: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(facade.applyBrainTemplate({ id: "growth-studio", language: "fr" })).rejects.toMatchObject({ status: 404 });
  });
});
