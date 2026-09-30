// R53: the 30 s auto-link must never link a thread while a run is working on
// it. That run was admitted unlinked; once the thread became linked, its reply
// had no execution authority and the run stopped (« linked agent message has
// no execution authority »). Seen on a just-recruited teammate's first task.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ContinuityTransport } from "../src/continuity-bridge.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { CollaborationFacade, LocalTeamBroker } from "../src/sidecar.js";
import { emptyDurableIndex } from "../src/sidecar-contract.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "lbz-autolink-run-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it("links a new teammate's thread only after its first run has settled", async () => {
  const linkedThreads: string[] = [];
  const bridge: ContinuityTransport = async <T>(operation: string, body: Record<string, unknown>) => {
    let result: unknown = {};
    if (operation === "status") result = { linked: true, orgId: "org-1", workspaceId: "local:fixture:workspace", userId: "owner", installationId: "install" };
    else if (operation === "conversations/list") result = { conversations: [] };
    else if (operation === "agents/list") result = { agents: [] };
    else if (operation === "conversations/link") { linkedThreads.push(String(body.localConversationId)); result = { conversationId: `conv-${linkedThreads.length}` }; }
    else if (operation === "conversations/read") result = { events: [], hasMore: false, latestCheckpointId: null };
    else if (operation === "conversations/append") result = { head: "0", receipts: [] };
    else if (operation === "conversations/ack") result = { acknowledgedThrough: body.through };
    return result as T;
  };
  const harness = new LocalBizosHarness({
    rootDir: join(root, "state"), homeDir: root, baseUrl: "", readSessionCookie: async () => "", orgName: () => "Acme",
    execPath: "/fake/node", packaged: false, runAsNodeAvailable: false, mcpScriptPath: join(root, "disabled.mjs"),
    environment: { PATH: "/nowhere" }, devices: false, continuityTransport: bridge,
  });
  const facade = new CollaborationFacade(harness, "fixture", new LocalTeamBroker(), emptyDurableIndex(), null, () => undefined, bridge);
  harness.continuity.setBackupEnabled(true);
  const nina = await harness.bots.create({ name: "TEST53 Nina" });
  const thread = `bot:${nina.id}`;
  // The first task the recruitment dispatched is still working.
  const runStore = (harness as unknown as { runStore: { start(input: { threadId: string; botId: string; state: string }): { id: string }; update(id: string, patch: { state: string }): void } }).runStore;
  const run = runStore.start({ threadId: thread, botId: nina.id, state: "working" });
  expect(harness.threads.activeRunIds({ botId: nina.id })).toEqual([run.id]);

  await facade.autoLinkAll();
  expect(harness.continuity.store.status(thread)).toBeNull();
  expect(linkedThreads).not.toContain(thread);

  runStore.update(run.id, { state: "completed" });
  await facade.autoLinkAll();
  expect(linkedThreads).toContain(thread);
  expect(harness.continuity.store.status(thread)).toMatchObject({ conversationId: expect.stringMatching(/^conv-/) });
});
