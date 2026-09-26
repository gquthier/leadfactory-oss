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
it("refuses QuickChat link and attach before any bridge request", async () => {
  const { storage } = fixture();
  const { ConversationContinuity } = await import("../src/harness/continuity-sync.js");
  const calls: string[] = [];
  const continuity = new ConversationContinuity(storage, async operation => { calls.push(operation); throw new Error("Fixture bridge called"); });
  const threadId = `chat:qchat_${"a".repeat(32)}`;
  await expect(continuity.link(threadId, { agentId: "agent", audience: "private", title: "QuickChat" })).rejects.toThrow(/QuickChat/);
  await expect(continuity.attach(threadId, "conversation")).rejects.toThrow(/QuickChat/);
  expect(calls).toEqual([]);
  expect(continuity.store.status(threadId)).toBeNull();
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
  const context = store.context("bot:a");
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
