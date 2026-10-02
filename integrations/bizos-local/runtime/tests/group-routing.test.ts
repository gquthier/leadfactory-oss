// Group routing, the Grok-bot rule: `@Name` asks that member, `@everyone`
// asks every member, and a message naming nobody goes to ONE lead (the CEO,
// else the first member), who answers for the group and hands over by name.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { groupLeadId, isLeadTurn, mentionsEveryone, resolveGroupTargets } from "../src/harness/mentions.js";
import { GROUP_LEAD_TURN_NOTE, buildLocalBrief, buildPersonaPrompt } from "../src/harness/prompt.js";
import type { Bot } from "../src/harness/types.js";

const bot = (id: string, name: string): Bot => ({ id, name } as Bot);
const OPS = bot("b_ops", "Ops");
const CEO = bot("b_ceo", "CEO");
const DEV = bot("b_dev", "Dév");
const ROSTER = [OPS, CEO, DEV];
const MEMBERS = ROSTER.map((member) => member.id);

describe("resolveGroupTargets", () => {
  it("answers explicit mentions exactly, in mention order", () => {
    expect(resolveGroupTargets({ text: "@Dev then @ops please", memberIds: MEMBERS, roster: ROSTER })).toEqual(["b_dev", "b_ops"]);
    expect(resolveGroupTargets({ text: "hi", memberIds: MEMBERS, roster: ROSTER, explicitMentionIds: ["b_ops"] })).toEqual(["b_ops"]);
  });

  it("sends @everyone and its synonyms to every member in roster order", () => {
    for (const text of ["@everyone status?", "@ALL go", "@tous au rapport", "hey @team", "@équipe ?", "@Equipe!"]) {
      expect(resolveGroupTargets({ text, memberIds: MEMBERS, roster: ROSTER }), text).toEqual(MEMBERS);
    }
  });

  it("does not treat an address or a longer word as @everyone", () => {
    for (const text of ["mail me@all.example.invalid", "@allies", "@teammate", "tous@team.example.invalid"]) {
      expect(mentionsEveryone(text), text).toBe(false);
      expect(resolveGroupTargets({ text, memberIds: MEMBERS, roster: ROSTER }), text).toEqual(["b_ceo"]);
    }
  });

  it("sends a message naming nobody to the CEO, else to the first member", () => {
    expect(resolveGroupTargets({ text: "What's the plan?", memberIds: MEMBERS, roster: ROSTER })).toEqual(["b_ceo"]);
    expect(resolveGroupTargets({ text: "What's the plan?", memberIds: ["b_dev", "b_ops"], roster: ROSTER })).toEqual(["b_dev"]);
    const slugged = [OPS, { ...bot("b_boss", "Jev"), slug: "ceo" } as Bot];
    expect(groupLeadId(["b_ops", "b_boss"], slugged)).toBe("b_boss");
  });

  it("never targets the excluded bot, and an explicit mention beats @everyone", () => {
    expect(resolveGroupTargets({ text: "@everyone", memberIds: MEMBERS, roster: ROSTER, exclude: "b_ceo" })).toEqual(["b_ops", "b_dev"]);
    expect(resolveGroupTargets({ text: "plan?", memberIds: MEMBERS, roster: ROSTER, exclude: "b_ceo" })).toEqual(["b_ops"]);
    expect(resolveGroupTargets({ text: "@everyone but @Ops first", memberIds: MEMBERS, roster: ROSTER })).toEqual(["b_ops"]);
    expect(isLeadTurn("plan?", MEMBERS, ROSTER)).toBe(true);
    expect(isLeadTurn("@Ops plan?", MEMBERS, ROSTER)).toBe(false);
    expect(isLeadTurn("@all plan?", MEMBERS, ROSTER)).toBe(false);
    expect(isLeadTurn("plan?", MEMBERS, ROSTER, ["b_ops"])).toBe(false);
  });
});

describe("group prompts name the lead", () => {
  const manifest = {
    mode: "local" as const, instanceId: "i", workspaceId: "w", agentId: "a", threadId: "t", workspaceDir: "/tmp/w",
    sandbox: "read-only" as const, supportedProviders: ["codex" as const], peers: [], recruitment: "unavailable" as const,
  };
  it("tells the lead it answers for the group and the others who the lead is", () => {
    const group = { name: "Team", members: ROSTER };
    const lead = buildLocalBrief({ bot: CEO, orgName: "Acme", manifest, group, teamTools: false });
    expect(lead).toContain("goes to you, the group's lead, alone");
    const member = buildPersonaPrompt({ bot: OPS, orgName: "Acme", group, since: [], roster: ROSTER });
    expect(member).toContain("goes to @CEO, the group's lead, alone");
    expect(member).toContain("@everyone asks every member");
  });
});

describe("dispatch", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "lbz-group-routing-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function setup() {
    const turns: CodexTurnInput[] = [];
    const harness = new LocalBizosHarness({
      rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
      execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
      environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "scripted-codex") }, devices: false,
      startTurn: (input): CodexTurnHandle => {
        turns.push(input);
        return { stop: () => undefined, respond: () => "unavailable", sessionId: () => null, settled: () => false };
      },
    });
    return { harness, turns };
  }
  const finish = (turn: CodexTurnInput, text: string): void => {
    turn.onEvent({ type: "item.completed", itemType: "assistant_text", itemId: `m-${Math.random()}`, phase: "final_answer", text });
    turn.onEvent({ type: "turn.completed", ok: true, stopReason: null });
  };
  const until = async (probe: () => boolean): Promise<void> => {
    for (let n = 0; n < 200 && !probe(); n++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(probe()).toBe(true);
  };

  it("routes an unnamed message to the lead only, who hands over by @mention", async () => {
    const { harness, turns } = setup();
    try {
      const ops = await harness.bots.create({ name: "Ops" });
      const ceo = await harness.bots.create({ name: "CEO" });
      const group = await harness.groups.create({ name: "Team", memberIds: [ops.id, ceo.id] });
      const sent = await harness.threads.send({ groupId: group.id }, { text: "Who fixes the invoices?" });
      expect(sent.runIds).toHaveLength(1);
      await until(() => turns.length === 1);
      expect(turns[0]!.text).toContain(GROUP_LEAD_TURN_NOTE);
      expect(turns[0]!.text).toContain("Who fixes the invoices?");
      expect((await harness.runs.get(sent.runIds[0]!))?.botId).toBe(ceo.id);
      finish(turns[0]!, "That's for @Ops.");
      await until(() => turns.length === 2);
      expect((await harness.runs.list({ limit: 1 }))[0]?.botId).toBe(ops.id);
      expect(turns[1]!.text).not.toContain(GROUP_LEAD_TURN_NOTE);
    } finally {
      harness.stop();
    }
  });

  it("routes @everyone to every member without the lead note", async () => {
    const { harness, turns } = setup();
    try {
      const ops = await harness.bots.create({ name: "Ops" });
      const ceo = await harness.bots.create({ name: "CEO" });
      const group = await harness.groups.create({ name: "Team", memberIds: [ops.id, ceo.id] });
      const sent = await harness.threads.send({ groupId: group.id }, { text: "@everyone status?" });
      expect(sent.runIds).toHaveLength(2);
      await until(() => turns.length === 1);
      expect(turns[0]!.text).not.toContain(GROUP_LEAD_TURN_NOTE);
      expect((await harness.runs.get(sent.runIds[0]!))?.botId).toBe(ops.id);
      expect((await harness.runs.get(sent.runIds[1]!))?.botId).toBe(ceo.id);
    } finally {
      harness.stop();
    }
  });
});
