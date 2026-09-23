import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgencyService } from "../src/harness/agency.js";
import { parseAvatarDataUrl } from "../src/harness/avatar.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex, type DurableIndex } from "../src/sidecar-contract.js";

const INSTANCE = "ceo-recruitment-fixture";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n8sAAAAASUVORK5CYII=";

interface Fixture {
  root: string;
  harness: LocalBizosHarness;
  facade: CollaborationFacade;
  broker: LocalTeamBroker;
  index: DurableIndex;
  turns: CodexTurnInput[];
  stops: number[];
  ceoId: string;
}

const fixtures: Fixture[] = [];

async function fixture(templateId: "lead-gen-agency" | "service-based-business" | "software" = "lead-gen-agency"): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "lbz-ceo-recruit-"));
  const plan = {
    id: "pln_fixture_primary",
    provider: "codex",
    label: "Fixture",
    authKind: "oauth",
    status: "connected",
    codexHome: join(root, "codex"),
    createdAt: "2026-09-22T00:00:00.000Z",
    priority: 0,
  };
  writeFileSync(join(root, "plans.json"), `${JSON.stringify({ plans: [plan], routing: { pins: {}, defaultPolicy: "priority", activePlanId: plan.id } })}\n`);
  const turns: CodexTurnInput[] = [];
  const stops: number[] = [];
  const harness = new LocalBizosHarness({
    rootDir: root,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Fixture",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: "/fake/none.mjs",
    devices: false,
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") },
    startTurn: (input): CodexTurnHandle => {
      const turn = turns.push(input) - 1;
      return {
        stop: () => {
          stops.push(turn);
          input.onEvent({ type: "turn.completed", ok: false, stopReason: "interrupted" });
        },
        respond: () => "allowed-once",
        sessionId: () => null,
        settled: () => false,
      };
    },
  });
  await harness.runtime.setInference({ source: "plan", planId: plan.id });
  const installed = await harness.templates.apply(templateId);
  const ceoId = installed.bots.ceo!;
  const broker = new LocalTeamBroker();
  const index = emptyDurableIndex();
  const facade = new CollaborationFacade(harness, INSTANCE, broker, index, null, () => undefined);
  const value = { root, harness, facade, broker, index, turns, stops, ceoId };
  fixtures.push(value);
  return value;
}

function finish(turn: CodexTurnInput, text = "done"): void {
  turn.onEvent({ type: "item.completed", itemId: "final", itemType: "assistant_text", phase: "final_answer", text, ok: true });
  turn.onEvent({ type: "turn.completed", ok: true, stopReason: null });
}

async function activeCapability(f: Fixture, botId: string) {
  const threadId = `bot:${botId}`;
  const sent = await f.harness.threads.send({ botId }, { text: "Recruit the specialist needed for this authorized mission." });
  const runId = sent.runIds[0]!;
  const session = f.broker.exchange(f.broker.issue({ botId, threadId, runId }));
  return { capability: f.broker.authorize(session), runId };
}

async function activeCeoCapability(f: Fixture) {
  return activeCapability(f, f.ceoId);
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.harness.stop();
    await rm(f.root, { recursive: true, force: true });
  }
});

describe("CEO on-demand recruitment", () => {
  it("loads a bound role blueprint, creates one persistent peer and dispatches its initial task in the parent chain", async () => {
    const f = await fixture();
    const { capability, runId: parentRunId } = await activeCeoCapability(f);
    const system = readFileSync(join(f.root, "vaults", "lead-gen-agency", "Roles", "acquisition", "system.md"), "utf8");

    const result = await f.facade.recruit(capability, {
      role_slug: "acquisition",
      name: "Marketing",
      context: "Use only the supplied French ICP and cite every source.",
      initial_task: "Prepare the first sourced prospect shortlist.",
    });

    expect(result.agent).toMatchObject({ name: "Marketing", title: "Prospecting and cold email", description: expect.any(String) });
    expect(result.agent).not.toHaveProperty("avatarDataUrl");
    expect(result.dispatch).toMatchObject({ status: "started", runId: expect.any(String), messageId: expect.any(String), parentRunId: `local:${INSTANCE}:run:${parentRunId}` });
    expect(f.turns).toHaveLength(2);
    expect(f.turns[1]!.text).toContain("Prepare the first sourced prospect shortlist.");
    const recruited = (await f.harness.bots.list()).find((bot) => bot.name === "Marketing")!;
    expect(recruited.instructions).toContain(system.trim());
    expect(recruited.instructions).toContain("Use only the supplied French ICP");
    expect(await f.harness.groups.list()).toHaveLength(1);
    expect(f.index.roleBindings["lead-gen-agency:acquisition"]?.botId).toBe(recruited.id);
    expect(f.index.roleAffiliations[recruited.id]).toEqual({ templateId: "lead-gen-agency", roleSlug: "acquisition" });
    const roleSheet = readFileSync(join(recruited.workspacePath!, "Marketing.md"), "utf8");
    expect(roleSheet).toContain("../../Roles/acquisition/system.md");
    expect(roleSheet).not.toContain("TODO: read my sources");

    finish(f.turns[0]!);
    expect((await f.harness.runs.get(parentRunId))?.state).toBe("completed");
    await f.facade.cancel(`local:${INSTANCE}:run:${parentRunId}`);
    expect(f.stops).toContain(1);
    expect((await f.harness.runs.get(result.dispatch.runId!.split(":run:")[1]!))?.state).toBe("cancelled");
  });

  it("reuses the same live template role and CEO team across turns without reactivating archived or deleted roles", async () => {
    const f = await fixture();
    const firstSource = await activeCeoCapability(f);
    const first = await f.facade.recruit(firstSource.capability, {
      role_slug: "strategist",
      name: "Marketing QA",
      title: "Senior QA strategist",
      description: "Owns campaign quality assurance.",
      context: "FIRST assignment context.",
      initial_task: "Draft the campaign hypothesis.",
    });
    finish(f.turns[1]!);
    finish(f.turns[0]!);

    const secondSource = await activeCeoCapability(f);
    const second = await f.facade.recruit(secondSource.capability, {
      role_slug: "strategist",
      context: "SECOND assignment context.",
      initial_task: "Review the revised hypothesis.",
    });
    expect(second.agent.agentId).toBe(first.agent.agentId);
    expect(second.agent).toMatchObject({ name: "Marketing QA", title: "Senior QA strategist", description: "Owns campaign quality assurance." });
    expect(second.teamThreadId).toBe(first.teamThreadId);
    expect(await f.harness.groups.list()).toHaveLength(1);
    expect((await f.harness.bots.list()).filter((bot) => bot.name === "Marketing QA")).toHaveLength(1);
    const refreshed = (await f.harness.bots.list()).find((bot) => bot.name === "Marketing QA")!;
    expect(refreshed.instructions).toContain("SECOND assignment context.");
    expect(refreshed.instructions).not.toContain("FIRST assignment context.");

    const botId = second.agent.agentId.split(":agent:")[1]!;
    await f.harness.bots.update(botId, { archived: true });
    finish(f.turns[3]!);
    finish(f.turns[2]!);
    const thirdSource = await activeCeoCapability(f);
    await expect(f.facade.recruit(thirdSource.capability, { role_slug: "strategist", initial_task: "Do not run." }))
      .rejects.toMatchObject({ code: "role_not_active" });
    expect((await f.harness.bots.list()).find((bot) => bot.id === botId)?.archived).toBe(true);
  });

  it("recovers a planned bot after a group persistence failure without duplicating the role", async () => {
    const f = await fixture();
    const source = await activeCeoCapability(f);
    const createGroup = f.harness.groups.create;
    let failOnce = true;
    Object.defineProperty(f.harness.groups, "create", {
      configurable: true,
      value: async (...args: Parameters<typeof createGroup>) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("fixture group persistence failure");
        }
        return createGroup(...args);
      },
    });
    const request = { role_slug: "acquisition", context: "Reserved recovery context.", initial_task: "Build the shortlist." };
    await expect(f.facade.recruit(source.capability, request)).rejects.toThrow("fixture group persistence failure");
    const planned = f.index.recruitments[source.runId];
    expect(planned?.state).toBe("pending");
    expect(f.index.roleBindings["lead-gen-agency:acquisition"]?.botId).toBe(planned?.plan?.botId);
    expect((await f.harness.bots.list()).filter((bot) => bot.name === "Acquisition")).toHaveLength(1);

    const recovered = await f.facade.recruit(source.capability, request);
    expect(recovered.dispatch.status).toBe("started");
    expect((await f.harness.bots.list()).filter((bot) => bot.name === "Acquisition")).toHaveLength(1);
    expect(await f.harness.groups.list()).toHaveLength(1);
  });

  it("reuses a role reserved by an earlier uncertain turn without recreating its bot", async () => {
    const f = await fixture();
    const firstSource = await activeCeoCapability(f);
    const createGroup = f.harness.groups.create;
    Object.defineProperty(f.harness.groups, "create", {
      configurable: true,
      value: async () => { throw new Error("fixture crash after bot persistence"); },
    });
    await expect(f.facade.recruit(firstSource.capability, {
      role_slug: "acquisition",
      context: "FIRST pending context.",
      initial_task: "First task was not launched.",
    })).rejects.toThrow("fixture crash after bot persistence");
    const reservedBotId = f.index.roleBindings["lead-gen-agency:acquisition"]!.botId;
    finish(f.turns[0]!);

    Object.defineProperty(f.harness.groups, "create", {
      configurable: true,
      value: createGroup,
    });
    const secondSource = await activeCeoCapability(f);
    const recovered = await f.facade.recruit(secondSource.capability, {
      role_slug: "acquisition",
      context: "SECOND active context.",
      initial_task: "Launch only this second task.",
    });
    expect(recovered.agent.agentId).toBe(`local:${INSTANCE}:agent:${reservedBotId}`);
    expect(recovered.dispatch.status).toBe("started");
    expect((await f.harness.bots.list()).filter((bot) => bot.id === reservedBotId)).toHaveLength(1);
    expect((await f.harness.bots.list()).find((bot) => bot.id === reservedBotId)?.instructions).toContain("SECOND active context.");
    expect(f.turns.at(-1)?.text).toContain("Launch only this second task.");
  });

  it.each(["same", "next"] as const)("recovers a reserved identity when bot creation failed before effect on the %s active turn", async retry => {
    const f = await fixture();
    const firstSource = await activeCeoCapability(f);
    const createBot = f.harness.bots.create;
    let failOnce = true;
    Object.defineProperty(f.harness.bots, "create", {
      configurable: true,
      value: async (...args: Parameters<typeof createBot>) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("fixture bot create failed before effect");
        }
        return createBot(...args);
      },
    });
    const request = { role_slug: "creative", context: "Recovered creation context.", initial_task: "Dispatch after recovery." };
    await expect(f.facade.recruit(firstSource.capability, request)).rejects.toThrow("fixture bot create failed before effect");
    const reservedBotId = f.index.roleBindings["lead-gen-agency:creative"]!.botId;
    expect((await f.harness.bots.list()).some((bot) => bot.id === reservedBotId)).toBe(false);
    if (retry === "next") finish(f.turns[0]!);
    const source = retry === "same" ? firstSource : await activeCeoCapability(f);
    const recovered = await f.facade.recruit(source.capability, request);
    expect(recovered.agent.agentId).toBe(`local:${INSTANCE}:agent:${reservedBotId}`);
    expect((await f.harness.bots.list()).filter((bot) => bot.id === reservedBotId)).toHaveLength(1);
    expect(recovered.dispatch.status).toBe("started");
  });

  it("reuses the submitted avatar job when the same recruitment recovers after group creation failed", async () => {
    const f = await fixture();
    await f.harness.bots.setAvatar(f.ceoId, { dataUrl: PNG });
    const source = await activeCeoCapability(f);
    const createGroup = f.harness.groups.create;
    Object.defineProperty(f.harness.groups, "create", {
      configurable: true,
      value: async () => { throw new Error("fixture group creation failed after bot persistence"); },
    });
    const request = {
      role_slug: "creative",
      initial_task: "Dispatch once after recovery.",
      avatar_prompt: "Fictional adult creative director, solid orange background.",
    };
    await expect(f.facade.recruit(source.capability, request)).rejects.toThrow("fixture group creation failed after bot persistence");
    const botId = f.index.roleBindings["lead-gen-agency:creative"]!.botId;
    const claimed = f.harness.avatarGeneration.claim("desktop-main", true).job!;
    expect(claimed).toMatchObject({ botId, state: "submitting", prompt: request.avatar_prompt });
    f.harness.avatarGeneration.report({
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      event: "submitted",
      taskId: "kie-paid-task-once",
    });

    Object.defineProperty(f.harness.groups, "create", { configurable: true, value: createGroup });
    const recovered = await f.facade.recruit(source.capability, request);
    expect(recovered.agent.agentId).toBe(`local:${INSTANCE}:agent:${botId}`);
    const rows = JSON.parse(readFileSync(join(f.root, "bots.json"), "utf8")) as Array<Record<string, any>>;
    expect(rows.find((row) => row.id === botId)?.avatarGenerationInternal).toMatchObject({
      jobId: claimed.id,
      state: "submitted",
      taskId: "kie-paid-task-once",
      prompt: request.avatar_prompt,
    });
  });

  it("reuses a submitted avatar job when a later recruitment run repeats the identical explicit prompt", async () => {
    const f = await fixture();
    await f.harness.bots.setAvatar(f.ceoId, { dataUrl: PNG });
    const avatarPrompt = "Fictional adult creative director, solid orange background.";
    const firstSource = await activeCeoCapability(f);
    const first = await f.facade.recruit(firstSource.capability, {
      role_slug: "creative",
      initial_task: "Draft once.",
      avatar_prompt: avatarPrompt,
    });
    const botId = first.agent.agentId.split(":agent:")[1]!;
    const claimed = f.harness.avatarGeneration.claim("desktop-main", true).job!;
    expect(claimed).toMatchObject({ botId, prompt: avatarPrompt, state: "submitting" });
    f.harness.avatarGeneration.report({
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      event: "submitted",
      taskId: "kie-stable-task",
    });
    finish(f.turns[1]!);
    finish(f.turns[0]!);

    const secondSource = await activeCeoCapability(f);
    const repeated = await f.facade.recruit(secondSource.capability, {
      role_slug: "creative",
      initial_task: "Review once.",
      avatar_prompt: avatarPrompt,
    });
    expect(repeated.agent.agentId).toBe(first.agent.agentId);
    const rows = JSON.parse(readFileSync(join(f.root, "bots.json"), "utf8")) as Array<Record<string, any>>;
    expect(rows.find((row) => row.id === botId)?.avatarGenerationInternal).toMatchObject({
      jobId: claimed.id,
      state: "submitted",
      taskId: "kie-stable-task",
      prompt: avatarPrompt,
    });
  });

  it("copies the recruiter's trusted personal native plan pin to a new role", async () => {
    const f = await fixture();
    await f.harness.bots.update(f.ceoId, { planId: "pln_fixture_primary" });
    const source = await activeCeoCapability(f);
    const recruited = await f.facade.recruit(source.capability, {
      role_slug: "creative",
      initial_task: "Draft the bounded concept.",
    });
    const botId = recruited.agent.agentId.split(":agent:")[1]!;
    expect((await f.harness.bots.list()).find((bot) => bot.id === botId)?.planId).toBe("pln_fixture_primary");
  });

  it("returns the real failed dispatch state and error instead of claiming the initial task started", async () => {
    const f = await fixture();
    const source = await activeCeoCapability(f);
    Object.defineProperty(f.harness.threads, "dispatchChild", {
      configurable: true,
      value: async () => { throw new Error("fixture native dispatch refused"); },
    });
    const recruited = await f.facade.recruit(source.capability, {
      role_slug: "creative",
      initial_task: "This task must not be reported as started.",
    });
    expect(recruited.dispatch).toMatchObject({
      status: "failed",
      parentRunId: `local:${INSTANCE}:run:${source.runId}`,
      runId: null,
      messageId: null,
      error: "fixture native dispatch refused",
    });
    expect(f.turns).toHaveLength(1);
  });

  it("creates a requester-owned team when a reused role's earlier team belongs to another recruiter", async () => {
    const f = await fixture();
    const ceoSource = await activeCeoCapability(f);
    const first = await f.facade.recruit(ceoSource.capability, { role_slug: "creative", initial_task: "Draft the first concept." });
    finish(f.turns[1]!);
    finish(f.turns[0]!);

    const manager = await f.harness.bots.create({ name: "Mission Lead", title: "Mission lead" });
    const managerSource = await activeCapability(f, manager.id);
    const reused = await f.facade.recruit(managerSource.capability, { role_slug: "creative", initial_task: "Review the approved concept." });
    expect(reused.agent.agentId).toBe(first.agent.agentId);
    expect(reused.teamThreadId).not.toBe(first.teamThreadId);
    const groupId = reused.teamThreadId.split(":thread:group:")[1]!;
    const group = (await f.harness.groups.list()).find((candidate) => candidate.id === groupId)!;
    expect(group.memberIds).toEqual(expect.arrayContaining([manager.id, reused.agent.agentId.split(":agent:")[1]!]));
    expect(group.memberIds).not.toContain(f.ceoId);
  });

  it("grants agency pack membership only through the persisted verified role affiliation", async () => {
    const f = await fixture();
    const source = await activeCeoCapability(f);
    const recruited = await f.facade.recruit(source.capability, { role_slug: "creative", initial_task: "Draft one concept." });
    const roleBotId = recruited.agent.agentId.split(":agent:")[1]!;
    const spoof = await f.harness.bots.create({ name: "Creative", title: "Creative strategist" });
    const agency = new AgencyService({
      host: {
        rootDir: f.root,
        binding: () => f.harness.workspaceTemplate.current(),
        installation: (templateId) => f.harness.workspaceTemplate.installation(templateId),
        install: (templateId, rootId) => f.harness.workspaceTemplate.install(templateId, rootId),
        listBots: () => f.harness.bots.list(),
        run: (runId) => f.harness.runs.get(runId),
        roleBots: (templateId) => Object.fromEntries(Object.entries(f.index.roleAffiliations)
          .filter(([, role]) => role.templateId === templateId)
          .map(([botId, role]) => [role.roleSlug, botId])),
      },
    });
    try {
      expect(agency.isPackBot(roleBotId)).toBe(true);
      expect(agency.isPackBot(spoof.id)).toBe(false);
      expect((await agency.state()).bots).toEqual(expect.arrayContaining([
        expect.objectContaining({ slug: "creative", botId: roleBotId }),
      ]));
    } finally {
      await agency.close();
    }
  });

  it("keeps the role blueprint when manage_agent changes bounded mission context", async () => {
    const f = await fixture();
    const source = await activeCeoCapability(f);
    const recruited = await f.facade.recruit(source.capability, { role_slug: "creative", initial_task: "Draft three concepts." });
    const botId = recruited.agent.agentId.split(":agent:")[1]!;
    const before = (await f.harness.bots.list()).find((bot) => bot.id === botId)!.instructions!;
    const managed = await f.facade.manageAgent(source.capability, {
      agent_id: recruited.agent.agentId,
      mission: "Revise only concept two with the approved proof.",
    });
    const after = (await f.harness.bots.list()).find((bot) => bot.id === botId)!.instructions!;
    expect(managed.agent.description).toBeTruthy();
    expect(after).toContain(before.split("\n\nCurrent bounded assignment")[0]!);
    expect(after).toContain("Revise only concept two");
  });

  it("rejects unsafe role paths and symlinked role data before creating an agent", async () => {
    const f = await fixture();
    const source = await activeCeoCapability(f);
    await expect(f.facade.recruit(source.capability, { role_slug: "../acquisition", initial_task: "No." }))
      .rejects.toMatchObject({ code: "invalid_role" });
    const roleDir = join(f.root, "vaults", "lead-gen-agency", "Roles", "acquisition");
    const outside = join(f.root, "outside-role.json");
    writeFileSync(outside, "{}\n");
    await rm(join(roleDir, "role.json"));
    symlinkSync(outside, join(roleDir, "role.json"));
    await expect(f.facade.recruit(source.capability, { role_slug: "acquisition", initial_task: "No." }))
      .rejects.toMatchObject({ code: "invalid_role" });
    expect(await f.harness.bots.list()).toHaveLength(1);
  });
});

describe("team avatar contract", () => {
  it("accepts only small canonical PNG/JPEG/WebP data URLs with matching signatures", () => {
    expect(parseAvatarDataUrl(PNG)).toMatchObject({ dataUrl: PNG, mimeType: "image/png", hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const invalid of [
      "https://example.test/avatar.png",
      "/tmp/avatar.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,AAAA",
      `${PNG}A`,
      `data:image/png;base64,${"A".repeat(32768)}`,
    ]) expect(() => parseAvatarDataUrl(invalid)).toThrow();
  });

  it("persists recruit/manage avatars but exposes bytes only in desktop bootstrap", async () => {
    const f = await fixture();
    const source = await activeCeoCapability(f);
    const recruited = await f.facade.recruit(source.capability, {
      name: "Researcher",
      title: "Research specialist",
      description: "Find and verify sources.",
      instructions: "Use primary sources and label uncertainty.",
      initial_task: "Verify the supplied claim.",
      avatar_data_url: PNG,
    });
    expect(recruited.agent).toMatchObject({ description: "Find and verify sources.", avatarKind: "upload", avatarHash: expect.any(String) });
    expect(recruited.agent).not.toHaveProperty("avatarGeneration");
    expect(recruited.agent).not.toHaveProperty("avatarDataUrl");
    const bootstrap = await f.facade.bootstrap();
    expect(bootstrap.agents.find((agent) => agent.agentId === recruited.agent.agentId)).toMatchObject({ avatarDataUrl: PNG });

    const reset = await f.facade.manageAgent(source.capability, { agent_id: recruited.agent.agentId, avatar_data_url: null });
    expect(reset.agent).toMatchObject({ avatarKind: "procedural", avatarHash: null });
    expect(reset.agent).not.toHaveProperty("avatarDataUrl");
    expect((await f.facade.bootstrap()).agents.find((agent) => agent.agentId === recruited.agent.agentId)).toMatchObject({ avatarDataUrl: null });
  });

  it("uses explicit recruitment avatar prompts once, preserves them when omitted, and regenerates only when explicitly replaced", async () => {
    const f = await fixture();
    const firstSource = await activeCeoCapability(f);
    const first = await f.facade.recruit(firstSource.capability, {
      role_slug: "creative",
      initial_task: "Draft one concept.",
      avatar_prompt: "Fictional adult art director, orange studio background.",
    });
    const botId = first.agent.agentId.split(":agent:")[1]!;
    const persistedJob = () => {
      const rows = JSON.parse(readFileSync(join(f.root, "bots.json"), "utf8")) as Array<Record<string, any>>;
      return rows.find((row) => row.id === botId)?.avatarGenerationInternal as Record<string, unknown>;
    };
    const firstJob = persistedJob();
    expect(firstJob).toMatchObject({ prompt: "Fictional adult art director, orange studio background.", state: "pending" });
    finish(f.turns[1]!);
    finish(f.turns[0]!);

    const secondSource = await activeCeoCapability(f);
    const reused = await f.facade.recruit(secondSource.capability, { role_slug: "creative", initial_task: "Review it." });
    expect(reused.agent.agentId).toBe(first.agent.agentId);
    expect(persistedJob().jobId).toBe(firstJob.jobId);
    finish(f.turns[3]!);
    finish(f.turns[2]!);

    const thirdSource = await activeCeoCapability(f);
    await f.facade.recruit(thirdSource.capability, {
      role_slug: "creative",
      initial_task: "Polish it.",
      avatar_prompt: "Fictional adult creative lead, purple studio background.",
    });
    expect(persistedJob()).toMatchObject({ prompt: "Fictional adult creative lead, purple studio background.", state: "pending" });
    expect(persistedJob().jobId).not.toBe(firstJob.jobId);
  });
});
