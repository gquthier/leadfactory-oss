// An agent the owner creates (POST /api/local/bots) greets them first in its
// chat: a complete bot message, unread, previewed — and no model run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { CodexTurnInput } from "../src/harness/codex-driver.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "lbz-bot-greeting-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function setup() {
  const turns: CodexTurnInput[] = [];
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: join(root, "codex") }, devices: false,
    startTurn: (input) => { turns.push(input); return { stop: () => undefined, respond: () => "unavailable", sessionId: () => null, settled: () => false }; },
  });
  const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined);
  return { harness, facade, turns };
}

it("greets in French by default, in English on request, without a run", async () => {
  const { harness, facade, turns } = setup();
  try {
    const { bot } = await facade.createBot({ name: "Véga" });
    const text = "Salut, je suis Véga. Qu'est-ce que je peux faire pour toi ?";
    expect(bot).toMatchObject({ unread: true, lastMessagePreview: text, status: "idle" });
    const messages = (await harness.threads.get({ botId: bot.id })).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "bot", botId: bot.id, deliveryState: "complete", blocks: [{ kind: "text", text }] });
    expect(messages[0]!.runId).toBeUndefined();

    const { bot: english } = await facade.createBot({ name: "Ada", language: "en" });
    expect((await harness.threads.get({ botId: english.id })).messages[0]!.blocks)
      .toEqual([{ kind: "text", text: "Hi, I'm Ada. What would you like me to do?" }]);
    await expect(facade.createBot({ name: "X", language: "de" })).rejects.toMatchObject({ status: 400 });

    // Created any other way (templates, recruit_agent, the IPC bridge): no greeting.
    const quiet = await harness.bots.create({ name: "Quiet" });
    expect((await harness.threads.get({ botId: quiet.id })).messages).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(turns).toHaveLength(0);
    expect(await harness.runs.list()).toHaveLength(0);
  } finally {
    harness.stop();
  }
});
