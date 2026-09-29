import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/harness/storage.js";
import { ContinuityStore, payloadHash } from "../src/harness/continuity.js";
import { LeaseGuard } from "../src/harness/execution-lease.js";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "continuity-"));
  roots.push(root);
  const storage = new Storage(root);
  return { root, storage, store: new ContinuityStore(storage) };
}
const binding = {
  conversationId: "conversation-1",
  installationId: "installation-a",
  accountId: "owner-1",
  orgId: "org-1",
};
function message(i: number, text: string) {
  return {
    id: `message-${i}`,
    threadId: "bot:a",
    seq: i,
    role: "user" as const,
    blocks: [{ kind: "text" as const, text }],
    createdAt: "2026-09-26T00:00:00Z",
  };
}
it("unlinked threads do not create an outbox; linked commits survive reconstruction and receipt loss", () => {
  const { storage, store } = fixture();
  store.capture(message(1, "private local"));
  expect(store.status("bot:a")).toBeNull();
  store.link("bot:a", binding);
  store.capture(message(2, "linked text"));
  const first = store.pending("bot:a");
  expect(first).toHaveLength(1);
  expect(new ContinuityStore(storage).pending("bot:a")).toEqual(first);
  store.accept("bot:a", [{ ...first[0]!, seq: 1 }]);
  expect(store.pending("bot:a")).toHaveLength(0);
  store.accept("bot:a", [{ ...first[0]!, seq: 1 }]);
  expect(store.archive("bot:a")).toHaveLength(1);
  expect(() =>
    store.accept("bot:a", [{ ...first[0]!, seq: 1, hash: "wrong" }]),
  ).toThrow();
});
it("rebases an unsent event when a restored installation has already used its local sequence", () => {
  const { storage, store } = fixture();
  store.link("bot:a", binding);
  store.capture(message(1, "first"));
  const first = store.pending("bot:a")[0]!;
  store.accept("bot:a", [{ ...first, seq: 1, originInstallationId: binding.installationId }]);
  store.capture(message(2, "new request from restored profile"));
  const pending = store.pending("bot:a")[0]!;
  expect(pending.localSequence).toBe(2);
  const remote = { ...first, eventId: "accepted-on-other-copy", localSequence: 2,
    content: "previously accepted request", localMessageId: undefined,
    seq: 2, originInstallationId: binding.installationId };
  store.accept("bot:a", [remote]);
  const recovered = new ContinuityStore(storage).pending("bot:a")[0]!;
  expect(recovered.eventId).toBe(pending.eventId);
  expect(recovered.localSequence).toBe(3);
  expect(recovered.hash).toBe(payloadHash((({ hash: _hash, ...row }) => row)(recovered)));
  store.capture(message(3, "next request"));
  expect(store.pending("bot:a").map(row => row.localSequence)).toEqual([3, 4]);
});
it("quarantines a legacy link from a different or unverified OS before cloud projection", () => {
  const { storage, store } = fixture();
  store.link("bot:a", { ...binding, workspaceId: "os_old" });
  store.capture(message(1, "old company private context"));
  expect(store.quarantineMismatchedWorkspace("bot:a", "os_new")).toBe(true);
  expect(store.status("bot:a")).toBeNull();
  expect(new ContinuityStore(storage).status("bot:a")).toBeNull();
  expect(storage.readJsonStrict<any>("continuity-quarantine.json", [])).toHaveLength(1);
  store.link("bot:b", binding); // .46 did not record an OS id.
  expect(store.quarantineMismatchedWorkspace("bot:b", "os_new")).toBe(true);
});
it("refuses sync and cloud calls when a stale link belongs to another OS", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const calls: string[] = [];
  const continuity = new ConversationContinuity(storage, async operation => {
    calls.push(operation);
    if (operation === "status") return { orgId: binding.orgId, userId: binding.accountId,
      installationId: binding.installationId, workspaceId: "os_shop" } as never;
    throw new Error(`unexpected ${operation}`);
  });
  continuity.store.link("bot:a", { ...binding, workspaceId: "os_office" });
  await expect(continuity.sync("bot:a")).rejects.toThrow(/another account or installation/);
  await expect(continuity.cloud("bot:a", "cloud/status", {})).rejects.toThrow(/own this linked conversation/);
  expect(calls).toEqual(["status", "status"]);
  continuity.close();
});
it("tombstones a linked conversation before forgetting its local continuity state", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const calls: Array<{ operation: string; body: Record<string, unknown> }> = [];
  const continuity = new ConversationContinuity(storage, async (operation, body) => {
    calls.push({ operation, body });
    if (operation === "status") return {
      orgId: binding.orgId,
      userId: binding.accountId,
      installationId: binding.installationId,
      workspaceId: "workspace-1",
    } as never;
    if (operation === "conversations/delete") return {
      conversationId: binding.conversationId,
      deleted: true,
      deletedAt: "2026-09-29T15:00:00.000Z",
    } as never;
    throw new Error(`unexpected ${operation}`);
  });
  continuity.store.link("bot:a", { ...binding, workspaceId: "workspace-1" });

  await expect(continuity.deleteConversation("bot:a")).resolves.toMatchObject({ deleted: true });
  expect(calls).toEqual([
    { operation: "status", body: {} },
    { operation: "conversations/delete", body: {
      orgId: binding.orgId,
      conversationId: binding.conversationId,
      workspaceId: "workspace-1",
      localConversationId: "bot:a",
    } },
  ]);
  expect(continuity.store.status("bot:a")).toBeNull();
  continuity.close();
});
it("keeps local continuity state when the remote tombstone is not acknowledged", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const continuity = new ConversationContinuity(storage, async (operation) => {
    if (operation === "status") return {
      orgId: binding.orgId,
      userId: binding.accountId,
      installationId: binding.installationId,
      workspaceId: "workspace-1",
    } as never;
    throw new Error("tombstone unavailable");
  });
  continuity.store.link("bot:a", { ...binding, workspaceId: "workspace-1" });

  await expect(continuity.deleteConversation("bot:a")).rejects.toThrow("tombstone unavailable");
  expect(continuity.store.status("bot:a")).not.toBeNull();
  continuity.close();
});
it("preserves a linked user message beyond the former 20k character cap", () => {
  const { store } = fixture();
  store.link("bot:a", binding);
  const text = "long context ".repeat(2_500);
  store.capture(message(1, text));
  expect(store.pending("bot:a")).toHaveLength(1);
  expect(store.pending("bot:a")[0]?.content).toBe(text);
});
it("keeps imported pre-link history in private agent context and out of the conversation archive", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const { ThreadStore } = await import("../src/harness/threads.js");
  const { systemClock } = await import("../src/harness/clock.js");
  const continuity = new ConversationContinuity(storage);
  continuity.store.link("bot:a", binding);
  continuity.importRecentHistory("bot:a", [
    message(1, "Le tarif convenu est de 79 EUR."),
    {
      ...message(2, "Je prépare la proposition."),
      role: "bot" as const,
      deliveryState: "complete" as const,
      botId: "a",
    },
  ]);

  const threads = new ThreadStore(storage, systemClock, continuity);
  const visible = JSON.stringify(threads.snapshot({ botId: "a" }).messages);
  const privateContext = continuity.store.context("bot:a");
  const hidden = continuity.hiddenContext("bot:a");

  expect(visible).not.toContain("Earlier local conversation");
  expect(visible).not.toContain("79 EUR");
  expect(continuity.store.pending("bot:a")).toEqual([]);
  expect(continuity.store.archive("bot:a")).toEqual([]);
  expect(privateContext).toContain("79 EUR");
  expect(hidden).toMatchObject({
    kind: "prior-local-transcript",
    content: expect.stringContaining("79 EUR"),
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(Buffer.byteLength(hidden!.content, "utf8")).toBeLessThanOrEqual(16 * 1024);
  expect(hidden!.content.length).toBeLessThanOrEqual(6_000);
  continuity.close();
});
it("hides the legacy synthetic pre-link user event after upgrading an existing profile", async () => {
  const { storage, store } = fixture();
  store.link("bot:a", binding);
  store.capture({
    ...message(1, "Earlier local conversation, imported when cloud backup was enabled (historical data):\nHuman: ancien échange"),
    id: "prelink:bot:a",
  });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const { ThreadStore } = await import("../src/harness/threads.js");
  const { systemClock } = await import("../src/harness/clock.js");
  const continuity = new ConversationContinuity(storage);
  const threads = new ThreadStore(storage, systemClock, continuity);

  expect(continuity.store.pending("bot:a")).toEqual([]);
  expect(threads.snapshot({ botId: "a" }).messages).toEqual([]);
  expect(continuity.hiddenContext("bot:a")?.content).toContain("ancien échange");
  continuity.close();
});
it("permits QuickChat continuity through the enrolled bridge", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const calls: string[] = [];
  const continuity = new ConversationContinuity(storage, async operation => { calls.push(operation); throw new Error("Fixture bridge called"); });
  const threadId = `chat:qchat_${"a".repeat(32)}`;
  await expect(continuity.link(threadId, { agentId: "agent", audience: "private", title: "QuickChat" })).rejects.toThrow(/Fixture bridge/);
  await expect(continuity.attach(threadId, "conversation")).rejects.toThrow(/Fixture bridge/);
  expect(calls).toEqual(["status", "status"]);
  expect(continuity.store.status(threadId)).toBeNull();
  continuity.close();
});
it("persists the opt-out and refuses new cloud links or transcript capture", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const transport = vi.fn(async () => { throw new Error("unexpected cloud request"); });
  const continuity = new ConversationContinuity(storage, transport);
  continuity.store.link("bot:a", binding);
  continuity.setBackupEnabled(false);
  continuity.capture(message(1, "private after opt-out"));
  expect(continuity.store.pending("bot:a")).toHaveLength(0);
  await expect(continuity.link("bot:b", { agentId: "ceo", audience: "private", title: "B" })).rejects.toThrow(/disabled/);
  await expect(continuity.attach("bot:b", "conversation-1")).rejects.toThrow(/disabled/);
  expect(transport).not.toHaveBeenCalled();
  expect(new ConversationContinuity(storage).backupEnabled()).toBe(false);
  continuity.close();
});
it("configures BizOS cloud execution with only the opaque mixture identifier", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const calls: Array<{ operation: string; body: Record<string, unknown> }> = [];
  const continuity = new ConversationContinuity(storage, async (operation, body) => {
    calls.push({ operation, body });
    if (operation === "policies/get") return { policy: { enabled: false, modelRuntime: "codex", cloudFallback: null, autoContinue: false } } as never;
    if (operation === "policies/set") return { ok: true } as never;
    throw new Error(`unexpected ${operation}`);
  });
  continuity.store.link("bot:a", binding);

  await continuity.enableCloud("bot:a");

  expect(calls.map(call => call.operation)).toEqual(["policies/get", "policies/set"]);
  expect(calls[1]?.body).toMatchObject({
    policy: { enabled: true, cloudFallback: { model: "bizos-mixture", maxCostUsd: 5 } },
  });
  expect(JSON.stringify(calls)).not.toMatch(/gemini|deepseek|openrouter|qwen|anthropic/i);
  continuity.close();
});
it("repairs a disabled imported policy for a local CLI turn without authorizing cloud execution", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const calls: Array<{ operation: string; body: Record<string, unknown> }> = [];
  const continuity = new ConversationContinuity(storage, async (operation, body) => {
    calls.push({ operation, body });
    if (operation === "policies/get") return { policy: { enabled: false, modelRuntime: "claude", cloudFallback: null, autoContinue: false } } as never;
    if (operation === "policies/set") return { ok: true } as never;
    if (operation === "status") return { orgId: binding.orgId, userId: binding.accountId, installationId: binding.installationId, workspaceId: "workspace-a", machineName: "QA Mac" } as never;
    if (operation === "runs/start") return { runId: "run-1", epoch: 1, leaseUntil: new Date(Date.now() + 60_000).toISOString() } as never;
    if (operation === "runs/claim") return { turnId: "turn-1", leaseToken: "lease-1", leaseUntil: new Date(Date.now() + 60_000).toISOString() } as never;
    throw new Error(`unexpected ${operation}`);
  });
  continuity.store.link("bot:a", binding);
  vi.spyOn(continuity, "sync").mockResolvedValue();
  await continuity.prepare("bot:a", "local-1", "codex", () => undefined);
  expect(calls.find(call => call.operation === "policies/set")?.body.policy).toEqual({
    enabled: true, modelRuntime: "codex", cloudFallback: null, autoContinue: false,
  });
  expect(calls.find(call => call.operation === "runs/start")?.body.cloudFallback).toBeNull();
  continuity.close();
});
it("does not advance memory after disk failure or silently reset a corrupt continuity ledger", () => {
  const { storage, store } = fixture();
  store.link("bot:a", binding);
  const spy = vi.spyOn(storage, "writeJson").mockImplementationOnce(() => {
    throw new Error("ENOSPC");
  });
  expect(() => store.capture(message(1, "never saved"))).toThrow("ENOSPC");
  spy.mockRestore();
  expect(store.pending("bot:a")).toHaveLength(0);
  writeFileSync(join(storage.layout.root, "continuity.json"), "{");
  expect(() => new ContinuityStore(storage)).toThrow(/corrupt/);
});
it("portable context retains old correction, revisions and file hashes, and never replays historical tool calls", () => {
  const { store } = fixture();
  store.link("bot:a", binding);
  for (let i = 1; i <= 35; i++)
    store.capture(
      message(
        i,
        i === 1 ? "Correction: budget is EUR 7, not EUR 70." : `message ${i}`,
      ),
    );
  const pending = store.pending("bot:a");
  store.accept(
    "bot:a",
    pending.map((e, i) => ({ ...e, seq: i + 1 })),
  );
  store.capture({
    ...message(1, "Correction: budget is EUR 9."),
    role: "user",
  });
  const revision = store.pending("bot:a")[0]!;
  store.accept("bot:a", [{ ...revision, seq: 36 }]);
  store.artifact("bot:a", {
    artifactId: "document-1",
    version: 2,
    hash: payloadHash("new file"),
    size: 8,
    name: "Brief.md",
    available: true,
  });
  store.setMachineContext("bot:a", "Studio Mac", ["Travel Mac"]);
  const context = store.context("bot:a");
  expect(context).toContain("Current Mac: Studio Mac");
  expect(context).toContain("Other accessible Macs: Travel Mac");
  expect(context).toContain("EUR 9");
  expect(context).not.toContain("EUR 7");
  expect(context).toContain(payloadHash("new file"));
  expect(context).toContain("historical data");
});
it("session start is not payload confirmation; uncertain and externally changed sessions reconstruct", () => {
  const { store } = fixture();
  store.link("bot:a", binding);
  const key = store.prepareBinding(
    "bot:a",
    {
      provider: "claude",
      accountId: "plan-a",
      runtime: "claude-v1",
      policy: "p",
    },
    12,
    "hash",
  );
  store.bindingEvent(key, { type: "session.started", sessionId: "native-a" });
  expect(store.binding(key)?.confirmedSeq).toBe(0);
  store.bindingEvent(key, { type: "context.sent" });
  store.bindingEvent(key, { type: "context.confirmed" });
  expect(store.binding(key)).toMatchObject({
    preparedSeq: 12,
    sentSeq: 12,
    confirmedSeq: 12,
  });
  expect(store.resumeCursor(key)).toBeNull(); // V1 has no independent native history attestation.
});
it("lease expiry aborts supervised work and prevents a new effect; unknown effects are not repeatable", async () => {
  const { store } = fixture();
  store.link("bot:a", binding);
  let now = 100;
  const stopped = vi.fn();
  const guard = new LeaseGuard(store, () => now);
  guard.install(
    "bot:a",
    {
      runId: "run-1",
      generation: 1,
      leaseToken: "ticket",
      expiresAt: 200,
      grants: ["computer_act"],
      budgetRemaining: 1,
    },
    stopped,
  );
  const op = guard.prepare("bot:a", "computer_act", "mediated");
  guard.sent("bot:a", op);
  now = 201;
  guard.check();
  expect(stopped).toHaveBeenCalledOnce();
  expect(() => guard.prepare("bot:a", "computer_act", "mediated")).toThrow(
    /lease/,
  );
  expect(store.effects("bot:a")).toMatchObject([{ id: op, state: "unknown" }]);
  expect(guard.transferable("bot:a")).toBe(false);
  guard.close();
});
it("replays one operation_id through the signed broker without another local image effect", async () => {
  const { storage } = fixture();
  storage.writeJson("continuity-runs.json", { "local-run": { requestId: "request", threadId: "bot:a", localRunId: "local-run", runtime: "codex", runId: "server-run", epoch: 1, turnId: "turn", leaseToken: "lease" } });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const transport = vi.fn(async (operation: string) => operation === "runs/admit" ? { admitted: true } : {});
  const continuity = new ConversationContinuity(storage, transport as any);
  continuity.store.link("bot:a", binding);
  continuity.guard.install("bot:a", { runId: "server-run", generation: 1, leaseToken: "lease", expiresAt: Date.now() + 60_000, grants: ["*"], budgetRemaining: 5 }, () => undefined);
  const perform = vi.fn(async () => ({ url: "https://fixture.example/generated.png", status: "completed" }));
  const input = { tool: "bizos_image_generate", arguments: { prompt: "A blue bird", operation_id: "image-once" } };
  expect(await continuity.execute("bot:a", "local-run", "bizos_image_generate", input, perform)).toEqual(await perform.mock.results[0]!.value);
  expect(await continuity.execute("bot:a", "local-run", "bizos_image_generate", input, perform)).toEqual({ url: "https://fixture.example/generated.png", status: "completed" });
  expect(perform).toHaveBeenCalledTimes(2); // The broker replays its receipt; it does not charge again.
  expect(continuity.store.effects("bot:a")).toHaveLength(1);
  await expect(continuity.execute("bot:a", "local-run", "bizos_image_generate", { tool: "bizos_image_generate", arguments: { prompt: "Changed", operation_id: "image-once" } }, perform)).rejects.toThrow(/operation_id|different arguments/i);
  continuity.close();
});
it("reconciles an uncertain broker effect immediately and clears the continuity blocker", async () => {
  const { storage } = fixture();
  storage.writeJson("continuity-runs.json", { "local-run": { requestId: "request", threadId: "bot:a", localRunId: "local-run", runtime: "codex", runId: "server-run", epoch: 1, turnId: "turn", leaseToken: "lease" } });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const receipts: Array<Record<string, unknown>> = [];
  const transport = vi.fn(async (operation: string, body: Record<string, unknown>) => {
    if (operation === "runs/admit") return { admitted: true };
    if (operation === "runs/effect") return { operationId: body.operationId, status: "sent", receipt: null, target: "bizos_image_generate", argsHash: payloadHash({ tool: "bizos_image_generate", arguments: { prompt: "bird", operation_id: "image-reconcile" } }) };
    if (operation === "runs/receipt") { receipts.push(body); return {}; }
    return {};
  });
  const continuity = new ConversationContinuity(storage, transport as any);
  continuity.store.link("bot:a", binding);
  continuity.guard.install("bot:a", { runId: "server-run", generation: 1, leaseToken: "lease", expiresAt: Date.now() + 60_000, grants: ["*"], budgetRemaining: 5 }, () => undefined);
  let attempts = 0;
  const perform = vi.fn(async () => {
    attempts++;
    if (attempts === 1) throw new Error("broker response lost");
    return { status: "completed", url: "https://fixture.test/image.png" };
  });
  const input = { tool: "bizos_image_generate", arguments: { prompt: "bird", operation_id: "image-reconcile" } };
  await expect(continuity.execute("bot:a", "local-run", "bizos_image_generate", input, perform)).resolves.toMatchObject({ status: "completed" });
  expect(perform).toHaveBeenCalledTimes(2);
  expect(continuity.store.effects("bot:a")).toMatchObject([{ state: "confirmed" }]);
  expect(receipts.at(-1)).toMatchObject({ status: "confirmed" });
  continuity.close();
});
it("recovers a broker-confirmed effect without changing its terminal receipt", async () => {
  const { storage } = fixture();
  storage.writeJson("continuity-runs.json", { "local-run": { requestId: "request", threadId: "bot:a", localRunId: "local-run", runtime: "codex", runId: "server-run", epoch: 1, turnId: "turn", leaseToken: "lease" } });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const args = { name: "Analyst", initial_task: "Introduce yourself" };
  const receipts: string[] = [];
  const continuity = new ConversationContinuity(storage, async (operation, body) => {
    if (operation === "runs/admit") return { admitted: true } as never;
    if (operation === "runs/receipt") {
      receipts.push(String(body.status));
      throw new Error("idempotency_conflict");
    }
    if (operation === "runs/effect") return { operationId: body.operationId, status: "confirmed",
      receipt: "Host tool returned.", target: "recruit_agent", argsHash: payloadHash(args) } as never;
    return {} as never;
  });
  continuity.store.link("bot:a", binding);
  continuity.guard.install("bot:a", { runId: "server-run", generation: 1, leaseToken: "lease", expiresAt: Date.now() + 60_000, grants: ["*"], budgetRemaining: 5 }, () => undefined);
  let attempts = 0;
  const result = await continuity.execute("bot:a", "local-run", "recruit_agent", args, async () => {
    attempts++;
    if (attempts === 1) throw new Error("sidecar response lost after effect");
    return { agentId: "agent-1" };
  });
  expect(result).toEqual({ agentId: "agent-1" });
  expect(attempts).toBe(2);
  expect(receipts).toEqual(["unknown"]);
  expect(continuity.store.effects("bot:a")).toMatchObject([{ state: "confirmed", receipt: "Host tool returned." }]);
  continuity.close();
});
it("returns a confirmed recruitment receipt without executing the effect twice", async () => {
  const { storage } = fixture();
  storage.writeJson("continuity-runs.json", { "local-run": { requestId: "request", threadId: "bot:a", localRunId: "local-run", runtime: "codex", runId: "server-run", epoch: 1, turnId: "turn", leaseToken: "lease" } });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const transport = async (operation: string) => operation === "runs/admit" ? { admitted: true } : {};
  const continuity = new ConversationContinuity(storage, transport as any);
  continuity.store.link("bot:a", binding);
  continuity.guard.install("bot:a", { runId: "server-run", generation: 1, leaseToken: "lease", expiresAt: Date.now() + 60_000, grants: ["*"], budgetRemaining: 5 }, () => undefined);
  const perform = vi.fn(async () => ({ agentId: "analyst" }));
  expect(await continuity.execute("bot:a", "local-run", "recruit_agent", { name: "Analyst" }, perform)).toEqual({ agentId: "analyst" });
  expect(await continuity.execute("bot:a", "local-run", "recruit_agent", { name: "Analyst" }, perform)).toEqual({ agentId: "analyst" });
  expect(perform).toHaveBeenCalledTimes(1);
  continuity.close();
  const reopened = new ConversationContinuity(storage, transport as any);
  reopened.guard.install("bot:a", { runId: "server-run", generation: 1, leaseToken: "lease", expiresAt: Date.now() + 60_000, grants: ["*"], budgetRemaining: 5 }, () => undefined);
  expect(await reopened.execute("bot:a", "local-run", "recruit_agent", { name: "Analyst" }, perform)).toEqual({ agentId: "analyst" });
  expect(perform).toHaveBeenCalledTimes(1);
  reopened.close();
});
it("reuses a routine identity after a lost tool reply and preserves later pause state", async () => {
  const { storage } = fixture();
  const { RoutineStore } = await import("../src/harness/routines.js");
  const { fixedClock } = await import("../src/harness/clock.js");
  const clock = fixedClock(Date.parse("2026-09-29T10:00:00Z"));
  const store = new RoutineStore(storage, clock);
  const input = { id: "rtn_recover", botId: "bot-a", name: "Review", prompt: "Check evidence",
    trigger: { kind: "schedule" as const, frequency: "interval" as const, everyMinutes: 10 } };
  const first = store.create(input);
  store.update(first.id, { enabled: false });
  expect(new RoutineStore(storage, clock).create(input)).toMatchObject({ id: first.id, enabled: false });
  expect(store.list()).toHaveLength(1);
  expect(() => store.create({ ...input, prompt: "Different work" })).toThrow(/different arguments/);
  const once = { ...input, id: "rtn_once", trigger: { kind: "schedule" as const,
    frequency: "once" as const, at: "2026-09-29T10:10:00+00:00" } };
  const createdOnce = store.create(once);
  const later = new RoutineStore(storage, fixedClock(Date.parse("2026-09-29T11:00:00Z")));
  expect(later.create(once)).toMatchObject({ id: createdOnce.id,
    trigger: { kind: "schedule", frequency: "once", at: "2026-09-29T10:10:00.000Z" } });
  expect(later.list()).toHaveLength(2);
});
it("marks an irreconcilable broker effect failed with a clear error so later effects can run", async () => {
  const { storage } = fixture();
  storage.writeJson("continuity-runs.json", { "local-run": { requestId: "request", threadId: "bot:a", localRunId: "local-run", runtime: "codex", runId: "server-run", epoch: 1, turnId: "turn", leaseToken: "lease" } });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const receipts: Array<Record<string, unknown>> = [];
  const transport = vi.fn(async (operation: string, body: Record<string, unknown>) => {
    if (operation === "runs/admit") return { admitted: true };
    if (operation === "runs/effect") return {
      operationId: body.operationId,
      status: "unknown",
      receipt: null,
      target: "bizos_image_generate",
      argsHash: payloadHash({ tool: "bizos_image_generate", arguments: { prompt: "bird", operation_id: "image-failed" } }),
    };
    if (operation === "runs/receipt") { receipts.push(body); return {}; }
    return {};
  });
  const continuity = new ConversationContinuity(storage, transport as any);
  continuity.store.link("bot:a", binding);
  continuity.guard.install("bot:a", { runId: "server-run", generation: 1, leaseToken: "lease", expiresAt: Date.now() + 60_000, grants: ["*"], budgetRemaining: 5 }, () => undefined);
  const input = { tool: "bizos_image_generate", arguments: { prompt: "bird", operation_id: "image-failed" } };
  await expect(continuity.execute("bot:a", "local-run", "bizos_image_generate", input, async () => { throw new Error("broker unavailable"); }))
    .rejects.toThrow(/could not be verified|n'a pas pu être vérifiée/i);
  expect(continuity.store.effects("bot:a")).toMatchObject([{ state: "failed", receipt: expect.stringMatching(/could not be verified|non vérifiée/i) }]);
  expect(receipts.at(-1)).toMatchObject({ status: "failed" });
  await expect(continuity.execute("bot:a", "local-run", "read_company", {}, async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  continuity.close();
});
it("settles a crash-left unknown effect with the broker before the next turn", async () => {
  const { storage } = fixture();
  storage.writeJson("continuity-runs.json", { "old-local-run": {
    requestId: "request", threadId: "bot:a", localRunId: "old-local-run", runtime: "codex",
    runId: "server-run", epoch: 3, turnId: "turn", leaseToken: "lease",
  } });
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const receipts: Array<Record<string, unknown>> = [];
  const argumentHash = payloadHash({ tool: "schedule_routine", arguments: { prompt: "Every Monday" } });
  const continuity = new ConversationContinuity(storage, async (operation, body) => {
    if (operation === "runs/effect") return {
      operationId: body.operationId,
      status: "unknown",
      receipt: "Result unavailable; external effect may have happened.",
      target: "schedule_routine",
      argsHash: argumentHash,
    } as never;
    if (operation === "runs/receipt") { receipts.push(body); return {} as never; }
    throw new Error(`unexpected ${operation}`);
  });
  continuity.store.link("bot:a", binding);
  continuity.store.effect("bot:a", {
    id: "operation-1", tool: "schedule_routine", class: "mediated", state: "unknown",
    generation: 3, argumentHash,
  });

  const internal = continuity as unknown as {
    reconcileInterruptedEffects(threadId: string): Promise<string[]>;
  };
  await expect(internal.reconcileInterruptedEffects("bot:a")).resolves.toEqual([
    expect.stringMatching(/marked failed/),
  ]);
  expect(continuity.store.effects("bot:a")).toMatchObject([{ state: "failed" }]);
  expect(receipts).toMatchObject([{ operationId: "operation-1", status: "failed" }]);
  continuity.close();
});
it("keeps a pending user message visible after a transcript projection write fails", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } =
    await import("../src/harness/continuity-sync.js");
  const { ThreadStore } = await import("../src/harness/threads.js");
  const { systemClock } = await import("../src/harness/clock.js");
  const continuity = new ConversationContinuity(storage);
  continuity.store.link("bot:a", binding);
  const threads = new ThreadStore(storage, systemClock, continuity);
  vi.spyOn(storage, "appendNdjson").mockImplementationOnce(() => {
    throw new Error("disk-full projection");
  });
  expect(() =>
    threads.append("bot:a", {
      id: "saved-intent",
      role: "user",
      blocks: [{ kind: "text", text: "Keep this offline intention" }],
    }),
  ).toThrow("disk-full");
  const recovered = new ConversationContinuity(storage);
  const reopened = new ThreadStore(storage, systemClock, recovered);
  expect(reopened.snapshot({ botId: "a" }).messages).toMatchObject([
    {
      id: "saved-intent",
      blocks: [
        { kind: "text", text: "Keep this offline intention" },
        {
          kind: "meta",
          text: expect.stringContaining("awaiting synchronization"),
        },
      ],
    },
  ]);
  continuity.close();
  recovered.close();
});
it("does not upload streaming drafts as dozens of semantic corrections", () => {
  const { store } = fixture();
  store.link("bot:a", binding);
  for (let i = 1; i < 60; i++)
    store.capture(
      { ...message(1, "x".repeat(i)), role: "bot" },
      { runId: "run", epoch: 1 },
    );
  expect(store.pending("bot:a")).toHaveLength(0);
  store.capture(
    { ...message(1, "Final answer"), role: "bot", deliveryState: "complete" },
    { runId: "run", epoch: 1 },
  );
  expect(store.pending("bot:a")).toHaveLength(1);
});
it("canonical hash covers author, kind, base revision, epoch and all content bytes", async () => {
  const { canonicalEventHash } =
    await import("../src/harness/continuity-sync.js");
  const event: any = {
    eventId: "id",
    schemaVersion: 1,
    localSequence: 1,
    baseRevision: "0",
    kind: "message",
    content: "hello",
    author: "agent",
    runId: "run",
    epoch: 1,
  };
  const original = canonicalEventHash(event);
  for (const [field, value] of Object.entries({
    kind: "correction",
    baseRevision: "1",
    epoch: 2,
    content: "changed",
    author: "human",
  }))
    expect(canonicalEventHash({ ...event, [field]: value })).not.toBe(original);
});
it("persists a routine occurrence before advancing its schedule, and recovers the same command ID after a lost enqueue response", async () => {
  const { storage } = fixture();
  const { RoutineStore } = await import("../src/harness/routines.js");
  const { Scheduler } = await import("../src/harness/scheduler.js");
  const { fixedClock } = await import("../src/harness/clock.js");
  const clock = fixedClock(Date.parse("2026-09-26T00:00:00Z"));
  const routines = new RoutineStore(storage, clock);
  const routine = routines.create({
    botId: "bot-a",
    name: "Review",
    prompt: "Durable original payload",
    trigger: { kind: "schedule", frequency: "interval", everyMinutes: 5 },
  });
  let originalId: string | undefined;
  const first = new Scheduler({
    storage,
    routines,
    clock,
    fire: (input) => {
      originalId = input.occurrenceId;
      throw new Error("lost enqueue response");
    },
  });
  await expect(first.runNow(routine.id)).rejects.toThrow("lost enqueue");
  first.stop();
  const persisted = storage.readJsonStrict<any>("routine-occurrences.json", {});
  expect(persisted[originalId!].input.routine.prompt).toBe(
    "Durable original payload",
  );
  expect(persisted[originalId!].done).toBeUndefined();
  const calls: any[] = [];
  const recovered = new Scheduler({
    storage,
    routines: new RoutineStore(storage, clock),
    clock,
    fire: (input) => {
      calls.push(input);
      return { runId: "same-durable-run" };
    },
  });
  recovered.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toHaveLength(1);
  expect(calls[0].occurrenceId).toBe(originalId);
  expect(calls[0].routine.prompt).toBe("Durable original payload");
  recovered.stop();
});

it("linked projections keep pre-link history before new messages and preserve local attachment metadata", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } =
    await import("../src/harness/continuity-sync.js");
  const { ThreadStore } = await import("../src/harness/threads.js");
  const { systemClock } = await import("../src/harness/clock.js");
  const continuity = new ConversationContinuity(storage);
  const threads = new ThreadStore(storage, systemClock, continuity);
  let previous = "";
  for (let i = 0; i < 75; i++)
    previous = threads.append("bot:a", {
      role: "user",
      blocks: [{ kind: "text", text: `Before linking ${i}` }],
    }).id;
  continuity.store.link("bot:a", binding);
  const file = {
    kind: "file" as const,
    name: "Brief.md",
    path: "/fixture/Brief.md",
    id: "fixture-file",
    mimeType: "text/markdown",
    size: 4,
  };
  const created = threads.append("bot:a", {
    role: "user",
    replyToMessageId: previous,
    blocks: [{ kind: "text", text: "New linked message" }, file],
  });
  for (const acknowledged of [false, true]) {
    if (acknowledged)
      continuity.store.accept(
        "bot:a",
        continuity.store.pending("bot:a").map((e, i) => ({ ...e, seq: i + 1 })),
      );
    const reopened = new ThreadStore(
      storage,
      systemClock,
      new ConversationContinuity(storage),
    );
    const page = reopened.pageAfter({ botId: "a" }, previous)!;
    expect(page.messages.map((m) => m.id)).toEqual([created.id]);
    expect(reopened.snapshot({ botId: "a" }).messages.at(-1)?.id).toBe(
      created.id,
    );
    expect(page.messages[0]!.seq).toBeGreaterThan(75);
    expect(page.messages[0]!.blocks).toContainEqual(file);
    expect(page.messages[0]!.replyToMessageId).toBe(previous);
    expect(page.messages[0]!.createdAt).toBe(created.createdAt);
  }
  continuity.close();
});

it("local attachment-only and control messages stay after an imported remote archive across restart", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } =
    await import("../src/harness/continuity-sync.js");
  const { ThreadStore } = await import("../src/harness/threads.js");
  const { systemClock } = await import("../src/harness/clock.js");
  const continuity = new ConversationContinuity(storage);
  const threads = new ThreadStore(storage, systemClock, continuity);
  const greeting = threads.append("bot:a", {
    role: "bot",
    blocks: [{ kind: "text", text: "Local greeting before attach" }],
  });
  continuity.store.link("bot:a", binding);
  continuity.store.accept(
    "bot:a",
    Array.from({ length: 75 }, (_, i) => ({
      eventId: `remote-${i + 1}`,
      schemaVersion: 1,
      localSequence: i + 1,
      baseRevision: "0",
      kind: "message",
      content: `Remote ${i + 1}`,
      author: "human",
      hash: payloadHash(`Remote ${i + 1}`),
      seq: i + 1,
      createdAt: "2026-09-25T00:00:00Z",
    })),
  );
  const file = {
    kind: "file" as const,
    name: "Brief.md",
    path: "/fixture/Brief.md",
    id: "fixture-file",
    mimeType: "text/markdown",
    size: 4,
  };
  const attached = threads.append("bot:a", {
    role: "user",
    blocks: [file],
    replyToMessageId: "remote-75",
  });
  expect(attached.seq).toBeGreaterThan(75);
  const control = threads.append("bot:a", {
    role: "bot",
    deliveryState: "control",
    blocks: [{ kind: "meta", text: "Local control after attachment" }],
  });
  // A subsequent remote update must not move either local-only row back to
  // the pre-link greeting; the original chronology survives reconstruction.
  continuity.store.accept("bot:a", [
    {
      eventId: "remote-76",
      schemaVersion: 1,
      localSequence: 76,
      baseRevision: "75",
      kind: "message",
      content: "Remote 76",
      author: "human",
      hash: payloadHash("Remote 76"),
      seq: 76,
    },
  ]);
  const recovered = new ConversationContinuity(storage);
  const reopened = new ThreadStore(storage, systemClock, recovered);
  expect(
    reopened.pageAfter({ botId: "a" }, "remote-75")!.messages.map((m) => m.id),
  ).toEqual([attached.id, control.id, "remote-76"]);
  expect(reopened.pageAfter({ botId: "a" }, greeting.id)!.messages[0]?.id).toBe(
    "remote-1",
  );
  expect(reopened.snapshot({ botId: "a" }).messages.map((m) => m.id)).toEqual(
    expect.arrayContaining([attached.id, control.id]),
  );
  expect(reopened.get("bot:a", attached.id)).toMatchObject({
    replyToMessageId: "remote-75",
    blocks: [file],
  });
  expect(reopened.get("bot:a", attached.id)!.seq).toBeGreaterThan(75);
  expect(continuity.store.pending("bot:a")).toHaveLength(0);
  continuity.close();
  recovered.close();
});

it.each(["immediate", "already-terminal"])(
  "routine recovery releases its lock for %s settlement",
  async (mode) => {
    const { storage } = fixture();
    const { RoutineStore } = await import("../src/harness/routines.js");
    const { Scheduler } = await import("../src/harness/scheduler.js");
    const { fixedClock } = await import("../src/harness/clock.js");
    const clock = fixedClock(Date.parse("2026-09-26T00:00:00Z"));
    const routines = new RoutineStore(storage, clock);
    const routine = routines.create({
      botId: "bot-a",
      name: "Review",
      prompt: "Keep checking",
      trigger: { kind: "schedule", frequency: "interval", everyMinutes: 5 },
    });
    storage.writeJson("routine-occurrences.json", {
      old: {
        input: { routine, missed: false, occurrenceId: "old" },
        schedule: {
          lastRunAt: clock.nowIso(),
          nextRunAt: clock.nowIso(),
          running: true,
        },
      },
    });
    let count = 0;
    const recovered = new Scheduler({
      storage,
      routines,
      clock,
      isRunTerminal: (runId: string) =>
        mode === "already-terminal" && runId === "old-run",
      fire: () => {
        const runId = count++ === 0 ? "old-run" : "new-run";
        if (mode === "immediate" && runId === "old-run")
          recovered.settle(routine.id, runId);
        return { runId };
      },
    });
    recovered.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(routines.get(routine.id)?.running).toBe(false);
    await expect(recovered.runNow(routine.id)).resolves.toEqual({
      runId: "new-run",
    });
    recovered.stop();
  },
);
