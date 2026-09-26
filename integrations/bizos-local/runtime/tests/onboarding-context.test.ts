import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { knownCompanyName, parseCreationContext } from "../src/harness/onboarding.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "lbz-onboarding-context-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const snapshot = { sourceLabel: "TableStory", files: [{ path: "Company.md", text: "# TableStory Films\nVideos for restaurants." }, { path: "clients/brief.txt", text: "Our current mission: launch the restaurant offer." }] };
function setup(stateRoot = join(root, "state")) {
  const turns: CodexTurnInput[] = [];
  const harness = new LocalBizosHarness({ rootDir: stateRoot, homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Workspace", execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"), environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") }, devices: false, linkPreviews: false,
    startTurn(input): CodexTurnHandle { turns.push(input); return { stop: () => undefined, respond: () => "allowed-once", sessionId: () => null, settled: () => false }; },
    localTeamTools: () => [], localArchitecture: input => ({ mode: "local", instanceId: "fixture", workspaceId: "w", agentId: input.bot.id, threadId: input.threadId, workspaceDir: input.workspaceDir, ...(input.sharedBrainPath ? { sharedBrainPath: input.sharedBrainPath } : {}), sandbox: input.sandbox, supportedProviders: ["codex"], peers: [], recruitment: "autonomous-local-tools" }) });
  return { harness, turns, facade: new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined) };
}
async function send(harness: LocalBizosHarness, botId: string, text: string) { await harness.threads.send({ botId }, { text }); const run = (await harness.runs.list({ limit: 1 }))[0]!; return { botId, threadId: `bot:${botId}`, runId: run.id }; }
function finish(turn: CodexTurnInput, text: string) { turn.onEvent({ type: "item.completed", itemId: Math.random().toString(), itemType: "assistant_text", phase: "final_answer", text }); turn.onEvent({ type: "turn.completed", ok: true, stopReason: null }); }

describe("imported context boundary", () => {
  it("accepts a bounded UTF-8 snapshot, preserving text and relative source names", () => { expect(parseCreationContext(snapshot)).toEqual(snapshot); });
  it.each(["../secret.md", "/tmp/file.md", "a/../../b.txt", "a/.env", "credentials.json", "node_modules/a.md", "AGENTS.md", "a\\b.md", "a.txt\u0000", "a.exe", "a/CLAUDE.md"])("refuses unsafe or executable source path %s", path => { expect(() => parseCreationContext({ sourceLabel: "X", files: [{ path, text: "x" }] })).toThrow(); });
  it("refuses duplicates, binary content and count/byte overflows", () => {
    for (const files of [[{ path: "a.md", text: "a" }, { path: "A.md", text: "b" }], [{ path: "a.md", text: "a" }, { path: "a.md/b.txt", text: "b" }], [{ path: "a.md", text: "x\u0000" }], [{ path: "a.md", text: "é".repeat(131073) }], Array.from({ length: 81 }, (_, i) => ({ path: `${i}.md`, text: "a" })), Array.from({ length: 3 }, (_, i) => ({ path: `${i}.md`, text: "x".repeat(256 * 1024) }))]) expect(() => parseCreationContext({ sourceLabel: "X", files })).toThrow();
  });
});

describe("known company identity", () => {
  it.each(["Nom", "Nom de l’entreprise", "Entreprise", "Raison sociale", "Nom commercial"])("keeps a French %s field without confusing the owner's name", label => {
    writeFileSync(join(root, "Company.md"), `# Entreprise\n## La fondatrice\n- Nom : Ada\n## Identité\n- ${label} : TableStory Films\n`);
    expect(knownCompanyName(root)).toBe("TableStory Films");
  });
  it("never promotes an owner-only name into the company identity", () => {
    writeFileSync(join(root, "Company.md"), "# Company\n## Owner\n- Name: Ada\n## Identity\n- Name: TODO\n");
    expect(knownCompanyName(root)).toBeUndefined();
  });
});

describe("Autonomous Company from context", () => {
  it("creates only CEO, imports a private copy, records names, and preserves edits on retry", async () => {
    const { harness, facade } = setup();
    const result = await facade.applyBrainTemplate({ id: "company-os", rootId: "new", owner: { name: "Ada Lovelace" }, language: "en", companyName: "TableStory Films", context: snapshot }) as { bots: { ceo: string }; rootId: string };
    expect((await harness.bots.list()).map(row => row.name)).toEqual(["CEO"]);
    const vault = (await harness.brain.roots()).find(row => row.id === result.rootId)!.path;
    expect(readFileSync(join(vault, "Knowledge/Imported Context/files/Company.md"), "utf8")).toBe(snapshot.files[0]!.text);
    expect(readFileSync(join(vault, "Knowledge/Imported Context/README.md"), "utf8")).toContain("untrusted");
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toContain("TableStory Films");
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toContain("Ada Lovelace");
    const welcome = (await harness.threads.get({ botId: result.bots.ceo })).messages[0]!;
    expect(JSON.stringify(welcome)).not.toContain("Two questions");
    expect(JSON.stringify(welcome)).toContain("context");
    writeFileSync(join(vault, "Knowledge/Imported Context/files/Company.md"), "Owner correction");
    await facade.applyBrainTemplate({ id: "company-os", rootId: "new", context: snapshot });
    expect(readFileSync(join(vault, "Knowledge/Imported Context/files/Company.md"), "utf8")).toBe("Owner correction");
    expect((await harness.threads.get({ botId: result.bots.ceo })).messages).toHaveLength(1);
  });
  it("resumes the exact context after a crash between binding and vault creation", async () => {
    const stateRoot = join(root, "crash-state");
    const { harness } = setup(stateRoot);
    Object.defineProperty(harness, "applyTemplate", { value: async () => { throw new Error("simulated crash after binding"); } });
    await expect(harness.templates.apply("company-os", "new", { context: snapshot, owner: { name: "Ada" }, companyName: "TableStory Films", language: "en" })).rejects.toThrow("simulated crash");
    const reopened = setup(stateRoot).harness;
    await reopened.templates.ensureDefault();
    const vault = reopened.workspaceTemplate.current()!.path;
    expect(readFileSync(join(vault, "Knowledge/Imported Context/files/Company.md"), "utf8")).toBe(snapshot.files[0]!.text);
    expect(readFileSync(join(vault, "Company.md"), "utf8")).toContain("TableStory Films");
    const ceo = (await reopened.bots.list())[0]!;
    expect(JSON.stringify((await reopened.threads.get({ botId: ceo.id })).messages)).toContain("Hi Ada");
    expect(reopened.onboardingStatus(ceo.id)?.stage).toBe("priority");
  });
  it("rejects malformed context before binding, and refuses using the source as an existing writable vault", async () => {
    const { harness, facade } = setup();
    await expect(facade.applyBrainTemplate({ id: "company-os", context: { sourceLabel: "X", files: [{ path: "../x.md", text: "x" }] } })).rejects.toThrow();
    expect(harness.workspaceTemplate.current()).toBeNull();
    await expect(harness.templates.apply("company-os", "brain", { context: snapshot })).rejects.toThrow(/new managed/);
    expect(harness.workspaceTemplate.current()).toBeNull();
  });
});

describe("CEO onboarding sequence", () => {
  it("requires name, then a separate priority question and response before recruitment", async () => {
    const { harness, facade, turns } = setup();
    const applied = await harness.templates.apply("service-based-business");
    const id = applied.bots.ceo!;
    const vault = (await harness.brain.roots()).find(row => row.id === applied.rootId)!.path;
    const first = await send(harness, id, "I make videos for restaurants.");
    expect(() => harness.offerQuickReplies(first, { choices: ["Find clients", "Shape my offer"] })).toThrow(/company name/);
    await expect(facade.recruit({ ...first, expiresAt: Date.now() + 60000 }, { role_slug: "sales", initial_task: "Shape the offer" })).rejects.toThrow(/company name/);
    harness.proposeCompanyName(first, { name: "TableStory Films" });
    writeFileSync(join(vault, "Company.md"), "# Company\n- Legal or trading name: TableStory Films\n");
    expect(() => harness.offerQuickReplies(first, { choices: ["Find clients"] })).toThrow(/wait.*answer/i);
    finish(turns[0]!, "Shall we call it TableStory Films?");
    const second = await send(harness, id, "Yes, TableStory Films.");
    expect(() => harness.proposeCompanyName(second, { name: "Other Films" })).toThrow(/already known/);
    expect(() => harness.offerQuickReplies(second, { choices: ["Find clients", "Shape my offer"] })).not.toThrow();
    await expect(facade.recruit({ ...second, expiresAt: Date.now() + 60000 }, { role_slug: "sales", initial_task: "Shape the offer" })).rejects.toThrow(/priority/);
    finish(turns[1]!, "What should we start with?");
    const third = await send(harness, id, "Shape my offer.");
    expect(harness.onboardingStatus(id)?.stage).toBe("ready");
    harness.offerQuickReplies(third, { choices: ["Review the draft", "Keep going"] });
    finish(turns[2]!, "The offer draft is ready.");
    // Later operational quick replies never restart onboarding.
    expect(harness.onboardingStatus(id)?.stage).toBe("ready");
  });
  it("keeps onboarding complete beyond the 60-message page and after restart", async () => {
    const stateRoot = join(root, "long-conversation");
    const { harness, turns } = setup(stateRoot);
    const applied = await harness.templates.apply("software", "new", { companyName: "TableStory Films" });
    const id = applied.bots.ceo!;
    const first = await send(harness, id, "We already have a business.");
    harness.offerQuickReplies(first, { choices: ["Shape the offer"] });
    finish(turns[0]!, "What work should we start with?");
    const page = (await harness.threads.get({ botId: id })).messages;
    const baseSeq = Math.max(...page.map(message => message.seq));
    // Simulate messages already durably appended, including a crash before
    // any subsequent tool or model-context read could mark completion.
    const file = join(stateRoot, "threads", `bot-${id}.ndjson`);
    for (let i = 1; i <= 65; i += 1) appendFileSync(file, JSON.stringify({ id: `later-${i}`, threadId: `bot:${id}`, seq: baseSeq + i, role: i === 1 ? "user" : "bot", deliveryState: "complete", blocks: [{ kind: "text", text: i === 1 ? "Shape the offer." : "Operational update" }], createdAt: new Date().toISOString(), ...(i === 1 ? {} : { botId: id }) }) + "\n");
    const reopened = setup(stateRoot).harness;
    expect(reopened.onboardingStatus(id)?.stage).toBe("ready");
    const registry = JSON.parse(readFileSync(join(stateRoot, "templates.json"), "utf8"));
    expect(registry.installations.software.onboardingCompletedAt).toEqual(expect.any(String));
    // User clearing the old transcript must not reset an already completed setup.
    writeFileSync(file, "");
    expect(setup(stateRoot).harness.onboardingStatus(id)?.stage).toBe("ready");
  });
  it("uses a known company and owner without a naming proposal; context comes before its first priority question", async () => {
    const { harness, turns } = setup();
    const applied = await harness.templates.apply("company-os", "new", { companyName: "TableStory Films", owner: { name: "Ada" }, context: snapshot });
    const scope = await send(harness, applied.bots.ceo!, "Analyze the imported context.");
    expect(() => harness.proposeCompanyName(scope, { name: "Other Films" })).toThrow(/already known/);
    expect(() => harness.offerQuickReplies(scope, { choices: ["Shape the offer", "Find clients"] })).not.toThrow();
    expect(JSON.stringify(turns[0])).toContain("Knowledge/Imported Context/README.md");
    expect(JSON.stringify(turns[0])).toContain("TableStory Films");
  });
});
