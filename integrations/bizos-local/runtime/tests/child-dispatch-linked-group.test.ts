// R53: once the CEO's team group was auto-linked, every later recruitment
// failed to start the recruit's first task — the recruiter's handoff was
// appended to the linked group as an agent message with no execution
// authority (« linked agent message has no execution authority »).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ContinuityTransport } from "../src/continuity-bridge.js";
import type { CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "lbz-child-linked-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function setup() {
  const bridge: ContinuityTransport = async <T>(operation: string, body: Record<string, unknown>) => {
    let result: unknown = {};
    if (operation === "status") result = { linked: true, orgId: "org-1", workspaceId: "local:fixture:workspace", userId: "owner", installationId: "install" };
    else if (operation === "conversations/read") result = { events: [], hasMore: false, latestCheckpointId: null };
    else if (operation === "conversations/append") result = { head: "0", receipts: [] };
    else if (operation === "conversations/ack") result = { acknowledgedThrough: body.through };
    return result as T;
  };
  const turns: CodexTurnInput[] = [];
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "none.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "codex") }, devices: false, continuityTransport: bridge,
    startTurn: (input): CodexTurnHandle => { turns.push(input); return { stop: () => undefined, respond: () => "unavailable", sessionId: () => null, settled: () => false }; },
  });
  harness.continuity.setBackupEnabled(true);
  return { harness, turns };
}

async function parentRun(harness: LocalBizosHarness, ceoId: string): Promise<string> {
  const sent = await harness.threads.send({ botId: ceoId }, { text: "Recrute TEST53 Nina." });
  const runId = sent.runIds[0]!;
  for (let n = 0; n < 200 && (await harness.runs.get(runId))?.state !== "working"; n++) await new Promise((resolve) => setTimeout(resolve, 10));
  return runId;
}

it("starts the recruit's first task in a linked team group, the handoff standing as a system line", async () => {
  const { harness } = setup();
  const ceo = await harness.bots.create({ name: "CEO" });
  const nina = await harness.bots.create({ name: "TEST53 Nina" });
  const group = await harness.groups.create({ name: "CEO team", memberIds: [ceo.id, nina.id] });
  harness.continuity.store.link(`group:${group.id}`, { conversationId: "conv-team", installationId: "install", accountId: "owner", orgId: "org-1", agentId: "ceo", workspaceId: "local:fixture:workspace" });
  expect(harness.continuity.linked(`group:${group.id}`)).toBe(true);
  const runId = await parentRun(harness, ceo.id);

  const launched = await harness.threads.dispatchChild(
    { botId: ceo.id, threadId: `bot:${ceo.id}`, runId },
    { botId: nina.id, groupId: group.id },
    { text: "@TEST53 Nina Présente-toi puis propose trois idées de clips.", messageId: "msg_r53_handoff", allowPreviouslyVisited: true },
  );
  expect(launched.runId).toBeTruthy();
  const handoff = await harness.threads.message({ groupId: group.id }, "msg_r53_handoff");
  expect(handoff).toMatchObject({ role: "system", blocks: [{ kind: "text", text: expect.stringContaining("Présente-toi") }] });
});

it("keeps the recruiter's own bubble in an unlinked team group", async () => {
  const { harness } = setup();
  const ceo = await harness.bots.create({ name: "CEO" });
  const nina = await harness.bots.create({ name: "TEST53 Nina" });
  const group = await harness.groups.create({ name: "CEO team", memberIds: [ceo.id, nina.id] });
  const runId = await parentRun(harness, ceo.id);
  await harness.threads.dispatchChild(
    { botId: ceo.id, threadId: `bot:${ceo.id}`, runId },
    { botId: nina.id, groupId: group.id },
    { text: "@TEST53 Nina Présente-toi.", messageId: "msg_r53_bubble", allowPreviouslyVisited: true },
  );
  expect(await harness.threads.message({ groupId: group.id }, "msg_r53_bubble")).toMatchObject({ role: "bot", botId: ceo.id });
});
