import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixedClock } from "../src/harness/clock.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { Storage } from "../src/harness/storage.js";
import type { TemplateRegistry } from "../src/harness/templates.js";

const fixtures: Array<{ root: string; harness: LocalBizosHarness }> = [];

function fixture(root = mkdtempSync(join(tmpdir(), "lbz-onboarding-autonomy-")), at = new Date(2026, 9, 2, 12, 0, 0).getTime()) {
  const turns: CodexTurnInput[] = [];
  const clock = fixedClock(at);
  const harness = new LocalBizosHarness({
    rootDir: root,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Autonomy fixture",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") },
    devices: false,
    linkPreviews: false,
    clock,
    startTurn(input): CodexTurnHandle {
      turns.push(input);
      return { stop: () => undefined, respond: () => "allowed-once", sessionId: () => null, settled: () => false };
    },
    localTeamTools: () => [],
    localArchitecture: input => ({
      mode: "local",
      instanceId: "fixture",
      workspaceId: "workspace",
      agentId: input.bot.id,
      threadId: input.threadId,
      workspaceDir: input.workspaceDir,
      ...(input.sharedBrainPath ? { sharedBrainPath: input.sharedBrainPath } : {}),
      sandbox: input.sandbox,
      supportedProviders: ["codex"],
      peers: [],
      recruitment: "autonomous-local-tools",
    }),
  });
  fixtures.push({ root, harness });
  return { root, harness, turns, clock };
}

afterEach(() => {
  for (const item of fixtures.splice(0)) {
    item.harness.stop();
    rmSync(item.root, { recursive: true, force: true });
  }
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("opt-in onboarding autonomy", () => {
  it("keeps absent and guided creation passive, while full persists one enabled CEO routine for the next local 09:00", async () => {
    const passive = fixture();
    await passive.harness.templates.apply("service-based-business", "new");
    expect(await passive.harness.routines.list()).toEqual([]);
    const passiveRegistry = JSON.parse(readFileSync(join(passive.root, "templates.json"), "utf8")) as TemplateRegistry;
    expect(passiveRegistry.installations["service-based-business"]?.autonomy).toBe("guided");

    const guided = fixture();
    await guided.harness.templates.apply("software", "new", { autonomy: "guided" });
    expect(await guided.harness.routines.list()).toEqual([]);
    const guidedRegistry = JSON.parse(readFileSync(join(guided.root, "templates.json"), "utf8")) as TemplateRegistry;
    expect(guidedRegistry.installations.software?.autonomy).toBe("guided");

    const full = fixture();
    const applied = await full.harness.templates.apply("company-os", "new", { autonomy: "full" });
    const [routine] = await full.harness.routines.list();
    expect(routine).toMatchObject({
      botId: applied.bots.ceo,
      enabled: true,
      running: false,
      trigger: { kind: "schedule", frequency: "daily", time: "09:00" },
    });
    expect(routine?.nextRunAt).toBe(new Date(2026, 9, 3, 9, 0, 0).toISOString());
    expect(await full.harness.runs.list()).toEqual([]);
    const registry = JSON.parse(readFileSync(join(full.root, "templates.json"), "utf8")) as TemplateRegistry;
    expect(registry.installations["company-os"]?.autonomy).toBe("full");
    expect(registry.installations["company-os"]?.routineIds).toEqual([routine?.id]);
  });

  it("journals the routine id before its effect and reuses it after restart", async () => {
    const item = fixture();
    const original = Storage.prototype.writeJson;
    let interrupted = false;
    Storage.prototype.writeJson = function (name, value) {
      original.call(this, name, value);
      if (!interrupted && name === "routines.json" && Array.isArray(value) && value.length === 1) {
        interrupted = true;
        throw new Error("simulated interruption after routine effect");
      }
    };
    try {
      await expect(item.harness.templates.apply("software", "new", { autonomy: "full" })).rejects.toThrow(/simulated interruption/);
    } finally {
      Storage.prototype.writeJson = original;
    }
    expect(interrupted).toBe(true);
    item.harness.stop();
    const pending = JSON.parse(readFileSync(join(item.root, "templates.json"), "utf8")) as TemplateRegistry;
    expect(pending.pending.software?.creationOptions?.autonomy).toBe("full");
    expect(pending.pending.software?.routine).toMatchObject({ created: false });
    const plannedId = pending.pending.software?.routine?.id;
    expect(JSON.parse(readFileSync(join(item.root, "routines.json"), "utf8"))).toHaveLength(1);

    const restarted = fixture(item.root);
    const result = await restarted.harness.templates.apply("software", "new");
    expect((await restarted.harness.routines.list()).map(row => row.id)).toEqual([plannedId]);
    const complete = JSON.parse(readFileSync(join(item.root, "templates.json"), "utf8")) as TemplateRegistry;
    expect(complete.pending).toEqual({});
    expect(complete.installations.software?.routineIds).toEqual([plannedId]);
    expect(result.created).toBe(true);
  });

  it("never retroactivates a completed guided or legacy installation, nor recreates or re-arms a full routine", async () => {
    const guided = fixture();
    await guided.harness.templates.apply("software", "new", { autonomy: "guided" });
    const registryPath = join(guided.root, "templates.json");
    const legacy = JSON.parse(readFileSync(registryPath, "utf8")) as TemplateRegistry;
    delete legacy.installations.software!.autonomy;
    writeFileSync(registryPath, `${JSON.stringify(legacy)}\n`);
    const reopened = fixture(guided.root);
    expect((await reopened.harness.templates.apply("software", "new", { autonomy: "full" })).created).toBe(false);
    expect(await reopened.harness.routines.list()).toEqual([]);

    const full = fixture();
    await full.harness.templates.apply("company-os", "new", { autonomy: "full" });
    const routine = (await full.harness.routines.list())[0]!;
    await full.harness.routines.update(routine.id, { enabled: false });
    await full.harness.templates.apply("company-os", "new", { autonomy: "full" });
    expect((await full.harness.routines.list())[0]).toMatchObject({ id: routine.id, enabled: false });
    await full.harness.routines.remove(routine.id);
    await full.harness.templates.apply("company-os", "new", { autonomy: "full" });
    expect(await full.harness.routines.list()).toEqual([]);
  });

  it("repairs missing full-autonomy notes with the persisted mode", async () => {
    const item = fixture();
    const applied = await item.harness.templates.apply("company-os", "new", { autonomy: "full" });
    const vault = (await item.harness.brain.roots()).find(row => row.id === applied.rootId)!.path;
    const system = join(vault, "Agents", "CEO", "system.md");
    rmSync(system);
    await item.harness.templates.apply("company-os", "new");
    expect(readFileSync(system, "utf8")).toMatch(/Treat the user's message as direction/);
    expect(readFileSync(join(vault, "Team.md"), "utf8")).toContain("one daily CEO routine is active");
    expect(readFileSync(join(vault, "Team.md"), "utf8")).not.toContain("No routine is active on installation");
  });

  it("lets only persisted full autonomy recruit before name or priority, while preserving unknown identity", async () => {
    const guided = fixture();
    const guidedInstall = await guided.harness.templates.apply("company-os", "new", { autonomy: "guided" });
    const guidedSend = await guided.harness.threads.send({ botId: guidedInstall.bots.ceo! }, { text: "Move the company forward." });
    const guidedScope = { botId: guidedInstall.bots.ceo!, threadId: `bot:${guidedInstall.bots.ceo}`, runId: guidedSend.runIds[0]! };
    expect(() => guided.harness.assertOnboardingRecruitment(guidedScope)).toThrow(/company name/);

    const full = fixture();
    const fullInstall = await full.harness.templates.apply("company-os", "new", { autonomy: "full" });
    const sent = await full.harness.threads.send({ botId: fullInstall.bots.ceo! }, { text: "Move the company forward." });
    const scope = { botId: fullInstall.bots.ceo!, threadId: `bot:${fullInstall.bots.ceo}`, runId: sent.runIds[0]! };
    expect(full.harness.onboardingStatus(fullInstall.bots.ceo!)).toMatchObject({ stage: "name", autonomy: "full" });
    expect(() => full.harness.assertOnboardingRecruitment(scope)).not.toThrow();
    expect(() => full.harness.offerQuickReplies(scope, { choices: ["Review the offer", "Find prospects"] })).not.toThrow();
    expect(full.turns[0]?.system).toMatch(/company name.*unknown/i);
    expect(full.turns[0]?.system).toMatch(/user's message.*direction/i);
    expect(full.turns[0]?.system).not.toMatch(/wait for the user's answer before recruiting/i);
  });

  it("fires the installed full-autonomy routine on its real scheduler tick without runNow", async () => {
    const at = new Date(2026, 9, 2, 8, 59, 0).getTime();
    const item = fixture(undefined, at);
    const applied = await item.harness.templates.apply("company-os", "new", { autonomy: "full" });
    expect(item.turns).toEqual([]);
    item.clock.advance(60_000);
    await settle();
    expect(item.turns).toHaveLength(1);
    expect(item.turns[0]?.text).toMatch(/^\[routine /);
    expect(item.turns[0]?.text).toMatch(/advance the company's current objectives/i);
    const [run] = await item.harness.runs.list();
    expect(run).toMatchObject({ botId: applied.bots.ceo, routineId: (await item.harness.routines.list())[0]?.id });
  });
});
