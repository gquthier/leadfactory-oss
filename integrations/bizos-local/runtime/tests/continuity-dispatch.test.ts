import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { LocalBizosHarness } from "../src/harness/harness.js";
import { startOpenAiTurn } from "../src/harness/openai-driver.js";
import type {
  CodexTurnInput,
  CodexTurnHandle,
} from "../src/harness/codex-driver.js";
import type { ClaudeTurnInput } from "../src/harness/claude-driver.js";
import { canonicalEventHash } from "../src/harness/continuity-sync.js";
import type { ContinuityTransport } from "../src/continuity-bridge.js";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(test: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 250; i++) {
    if (await test()) return;
    await pause();
  }
  throw new Error("condition did not settle");
}
async function backend() {
  const conversationId = randomUUID();
  const events: any[] = [];
  const artifacts = new Map<string, any>();
  const checkpoints = new Map<string, any>();
  let latestCheckpointId: string | null = null;
  let active: string | null = null;
  const requests: any[] = [];
  const controls = {
    autoContinue: false,
    loseFinish: false,
    expiredAppend: false,
  };
  let transfer: any = null;
  const canonical = (e: any) => ({
    ...e,
    sequence: String(events.length + 1),
    contentHash: canonicalEventHash(e),
    createdAt: "2026-09-26T00:00:00Z",
  });
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const b = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const op = req.url!.split("/").slice(3).join("/");
      requests.push({ op, body: b });
      if (Buffer.concat(chunks).length > 256 * 1024)
        throw new Error("body_too_large");
      let result: any = {};
      if (req.url === "/v1/chat/completions") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Cloud revised Brief.md version 2, EUR 11.",
                },
                finish_reason: "stop",
              },
            ],
          }),
        );
        return;
      }
      if (op === "status")
        result = {
          installationId: req.headers["x-installation"],
          userId: "owner",
          orgId: "org",
          workspaceId: "workspace",
        };
      else if (op === "policies/get")
        result = {
          policy: {
            enabled: true,
            modelRuntime:
              req.headers["x-installation"] === "install-b"
                ? "codex"
                : "claude",
            cloudFallback: controls.autoContinue
              ? { model: "fixture-cloud", maxCostUsd: 1 }
              : null,
            autoContinue: controls.autoContinue,
          },
        };
      else if (op === "conversations/link") result = { conversationId };
      else if (op === "conversations/list")
        result = {
          conversations: [
            { conversationId, agentId: "cloud-agent", title: "Shared mission" },
          ],
        };
      else if (op === "agents/list")
        result = { agents: [{ agentId: "cloud-agent", name: "CEO" }] };
      else if (op === "conversations/append") {
        if (
          controls.expiredAppend &&
          b.events.some((e: any) => e.author === "agent")
        )
          throw new Error("stale_epoch");
        for (const e of b.events) {
          const old = events.find((r) => r.eventId === e.eventId);
          if (old) {
            if (old.content !== e.content) throw new Error("conflict");
          } else events.push(canonical(e));
        }
        result = { head: String(events.length), receipts: [] };
      } else if (op === "conversations/read") {
        const rows = events
          .filter((e) => Number(e.sequence) > Number(b.after))
          .slice(0, b.limit ?? 100);
        result = {
          events: rows,
          hasMore: Number(rows.at(-1)?.sequence ?? b.after) < events.length,
          latestCheckpointId,
        };
      } else if (op === "conversations/ack")
        result = { acknowledgedThrough: b.through };
      else if (op === "artifacts/put") {
        const bytes = Buffer.from(b.contentBase64, "base64");
        const record = { ...b, sizeBytes: bytes.length };
        artifacts.set(`${b.artifactId}:${b.version}`, record);
        result = {
          artifactId: b.artifactId,
          version: b.version,
          sha256: b.sha256,
          sizeBytes: bytes.length,
        };
      } else if (op === "artifacts/read") {
        result = artifacts.get(`${b.artifactId}:${b.version}`);
        if (!result) throw new Error("dependency_missing");
      } else if (op === "checkpoints/put") {
        latestCheckpointId = b.checkpointId;
        result = { ...b, manifestHash: "manifest" };
        checkpoints.set(b.checkpointId, result);
      } else if (op === "checkpoints/read")
        result = checkpoints.get(b.checkpointId);
      else if (op === "runs/start") {
        if (active) throw new Error("already_running");
        active = randomUUID();
        result = {
          runId: active,
          epoch: 1,
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        };
      } else if (op === "runs/claim")
        result = {
          turnId: randomUUID(),
          leaseToken: "fixture-token",
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        };
      else if (op === "runs/heartbeat")
        result = { leaseUntil: new Date(Date.now() + 60000).toISOString() };
      else if (op === "runs/admit")
        result = { admitted: true, operationId: b.operationId };
      else if (op === "runs/finish" || op === "runs/stop") {
        for (const event of b.finalEvents ?? []) {
          if (!events.some((row) => row.eventId === event.eventId))
            events.push(canonical(event));
        }
        active = null;
        result = { finished: true };
        if (controls.loseFinish) {
          controls.loseFinish = false;
          req.socket.destroy();
          return;
        }
      } else if (op === "devices/presence")
        result = { receivedAt: new Date().toISOString() };
      else if (op === "devices/list")
        result = {
          devices: [
            {
              installationId: "install-a",
              deviceName: "Mac A",
              online: true,
              capabilities: { runtimes: ["claude"], supervised: true },
            },
          ],
        };
      else if (op === "transfers/prepare") {
        transfer = { ...b, manifestHash: "manifest" };
        result = {
          transferId: b.transferId,
          status: "prepared",
          expectedHead: b.expectedHead,
          manifestHash: "manifest",
        };
      } else if (op === "transfers/quiesce") {
        transfer.sourceQuiesced = true;
        result = { sourceQuiesced: true };
      } else if (op === "transfers/commit") {
        if (!transfer.sourceQuiesced) throw new Error("source_not_quiesced");
        result = {
          transferId: b.transferId,
          status: "committed",
          runId: b.runId,
          epoch: b.epoch + 1,
          ownerInstallationId: null,
        };
      } else if (op === "transfers/list")
        result = { transfers: transfer ? [transfer] : [] };
      else if (op !== "runs/receipt") throw new Error("unknown " + op);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const transport =
    (installation: string): ContinuityTransport =>
    async <T>(operation: string, body: Record<string, unknown>) => {
      const r = await fetch(`${origin}/api/continuity/${operation}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-installation": installation,
        },
        body: JSON.stringify(body),
      });
      const result = (await r.json()) as T & { error?: string };
      if (!r.ok) throw new Error(result.error);
      return result;
    };
  return { conversationId, transport, origin, events, requests, controls };
}
async function computer(
  name: string,
  provider: "claude" | "codex",
  transport: ContinuityTransport,
  hold = false,
) {
  const root = mkdtempSync(join(tmpdir(), "continuity-computer-"));
  mkdirSync(join(root, "state"));
  const state = join(root, "state");
  writeFileSync(
    join(state, "plans.json"),
    JSON.stringify({
      plans: [
        {
          id: `pln_${name}_fixture`,
          provider,
          label: `Fixture ${name}`,
          authKind: "oauth",
          status: "connected",
          createdAt: "2026-09-26T00:00:00Z",
          priority: 0,
          ...(provider === "claude"
            ? { configDir: join(root, "config") }
            : { codexHome: join(root, "config") }),
        },
      ],
      routing: {
        pins: {},
        defaultPolicy: "priority",
        activePlanId: `pln_${name}_fixture`,
      },
    }),
  );
  const turns: Array<ClaudeTurnInput | CodexTurnInput> = [];
  const start = (input: ClaudeTurnInput | CodexTurnInput): CodexTurnHandle => {
    turns.push(input);
    let done = false;
    queueMicrotask(() => {
      input.onEvent({
        type: "session.started",
        sessionId: `${name}-native-${turns.length}`,
        model: null,
      });
      input.onEvent({
        type: "capabilities.verified",
        supervised: provider === "claude",
        tools: [],
      });
      input.onEvent({ type: "context.sent" });
      input.onEvent({ type: "context.confirmed" });
      input.onEvent({
        type: "item.completed",
        itemType: "assistant_text",
        text: `${name} completed ${turns.length}`,
        phase: "final_answer",
      });
      if (!hold) {
        done = true;
        input.onEvent({ type: "turn.completed", ok: true, stopReason: null });
      }
    });
    return {
      stop: () => {
        if (!done) {
          done = true;
          input.onEvent({
            type: "turn.completed",
            ok: false,
            stopReason: "interrupted",
          });
        }
      },
      respond: () => "unavailable",
      sessionId: () => `${name}-native`,
      settled: () => done,
    };
  };
  const harness = new LocalBizosHarness({
    rootDir: state,
    homeDir: root,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => name,
    execPath: process.execPath,
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: "/missing",
    devices: false,
    environment: {
      PATH: "/nowhere",
      LBZ_CODEX_PATH: process.execPath,
      LBZ_CLAUDE_PATH: process.execPath,
    },
    continuityTransport: transport,
    startTurn: start,
    startClaudeTurn: start,
    localArchitecture: (i) => ({
      mode: "local",
      instanceId: name,
      workspaceId: name,
      agentId: i.bot.id,
      threadId: i.threadId,
      workspaceDir: i.workspaceDir,
      sandbox: i.sandbox,
      supportedProviders: ["claude", "codex"],
      peers: [],
      recruitment: "autonomous-local-tools",
    }),
  });
  cleanup.push(() => {
    harness.stop();
    rmSync(root, { recursive: true, force: true });
  });
  await harness.runtime.setSettings({
    mode: "local",
    local: { provider, activePlanId: `pln_${name}_fixture` },
  });
  const bot = await harness.bots.create({ name: "CEO" });
  return { harness, bot, turns, threadId: `bot:${bot.id}` };
}
it("Claude A → OpenRouter HTTP → Codex B → old Claude A preserves an old correction and new artifact in the actual dispatcher", async () => {
  const b = await backend();
  const a = await computer("A", "claude", b.transport("install-a"));
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Shared mission",
  });
  for (let i = 0; i < 35; i++)
    a.harness.continuity.store.capture({
      id: `old-${i}`,
      threadId: a.threadId,
      seq: i + 1,
      role: "user",
      createdAt: "2026-09-26T00:00:00Z",
      blocks: [
        {
          kind: "text",
          text:
            i === 0
              ? "CORRECTION: maximum budget EUR 9."
              : `Archive message ${i}`,
        },
      ],
    });
  await a.harness.continuity.sync(a.threadId);
  const first = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Claude A first request" },
  );
  await until(
    async () =>
      (await a.harness.runs.get(first.runIds[0]!))?.state === "completed",
  );
  await until(
    () => a.harness.continuity.store.status(a.threadId)!.pending === 0,
  );
  await until(() => b.requests.some((r) => r.op === "runs/finish"));
  expect(a.turns[0]!.system).toContain("maximum budget EUR 9");
  expect(a.turns[0]!.resumeCursor).toBeNull();
  const cloud = b.transport("install-a");
  await cloud("conversations/append", {
    orgId: "org",
    conversationId: b.conversationId,
    events: [
      {
        eventId: randomUUID(),
        schemaVersion: 1,
        localSequence: 999,
        baseRevision: String(b.events.length),
        kind: "correction",
        content: "CLOUD CORRECTION: maximum budget is now EUR 11.",
        author: "human",
      },
    ],
  });
  await a.harness.continuity.sync(a.threadId);
  let cloudAnswer = "";
  await new Promise<void>((resolve) =>
    startOpenAiTurn({
      baseUrl: `${b.origin}/v1`,
      apiKey: "fixture-only",
      model: "fixture-openrouter",
      label: "OpenRouter double",
      system: a.harness.continuity.store.context(a.threadId),
      text: "Revise the brief with the latest budget",
      threadId: a.threadId,
      runId: "fixture-cloud-run",
      agent: false,
      dynamicTools: [],
      onEvent: (e) => {
        if (e.type === "item.completed" && e.itemType === "assistant_text")
          cloudAnswer = e.text;
        if (e.type === "turn.completed") resolve();
      },
    }),
  );
  await cloud("conversations/append", {
    orgId: "org",
    conversationId: b.conversationId,
    events: [
      {
        eventId: randomUUID(),
        schemaVersion: 1,
        localSequence: 1000,
        baseRevision: String(b.events.length),
        kind: "message",
        content: cloudAnswer,
        author: "agent",
      },
    ],
  });
  const bytes = Buffer.from("Brief v2: EUR 11");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const artifactId = randomUUID();
  await cloud("artifacts/put", {
    orgId: "org",
    conversationId: b.conversationId,
    artifactId,
    version: 2,
    previousHash: "fixture-v1",
    name: "Brief.md",
    mimeType: "text/markdown",
    contentBase64: bytes.toString("base64"),
    sha256: hash,
  });
  await cloud("checkpoints/put", {
    orgId: "org",
    conversationId: b.conversationId,
    checkpointId: randomUUID(),
    through: String(b.events.length),
    summary: "Updated brief",
    instructions: [],
    openTasks: [],
    unknownOperations: [],
    artifacts: [{ artifactId, version: 2, sha256: hash }],
    supervised: true,
  });
  const second = await computer("B", "codex", b.transport("install-b"));
  await second.harness.continuity.attach(second.threadId, b.conversationId);
  const sentB = await second.harness.threads.send(
    { botId: second.bot.id },
    { text: "Codex B request" },
  );
  await until(
    async () =>
      (await second.harness.runs.get(sentB.runIds[0]!))?.state === "completed",
  );
  await until(
    () => b.requests.filter((r) => r.op === "runs/finish").length === 2,
  );
  expect(second.turns[0]!.system).toContain("CLOUD CORRECTION");
  expect(second.turns[0]!.system).toContain(hash);
  expect(
    second.harness.continuity.store.artifacts(second.threadId),
  ).toMatchObject([{ version: 2, available: true, hash }]);
  const final = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Back on old Claude A" },
  );
  await until(
    async () =>
      (await a.harness.runs.get(final.runIds[0]!))?.state === "completed",
  );
  await until(
    () => b.requests.filter((r) => r.op === "runs/finish").length === 3,
  );
  expect(a.turns[1]!.resumeCursor).toBeNull();
  expect(a.turns[1]!.system).toContain("CLOUD CORRECTION");
  expect(a.turns[1]!.system).toContain(hash);
  expect(a.turns[1]!.system).toContain("B completed");
  expect(a.turns[1]!.text.match(/Back on old Claude A/g) ?? []).toHaveLength(1);
  expect(
    b.events.filter((e) => e.content === "Back on old Claude A"),
  ).toHaveLength(1);
}, 15000);
it("late final results use terminal reconciliation and retry the identical receipt after connection loss", async () => {
  const b = await backend();
  b.controls.expiredAppend = true;
  b.controls.loseFinish = true;
  const a = await computer("A", "claude", b.transport("install-a"));
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Lost receipt",
  });
  const sent = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Save final result even when the lease expires" },
  );
  await until(
    async () =>
      (await a.harness.runs.get(sent.runIds[0]!))?.state === "completed",
  );
  await until(() => b.requests.some((r) => r.op === "runs/finish"));
  await until(
    () => a.harness.continuity.store.status(a.threadId)!.error !== null,
  );
  await a.harness.continuity.sync(a.threadId);
  expect(a.harness.continuity.store.status(a.threadId)!.pending).toBe(0);
  expect(b.events.filter((e) => e.content === "A completed 1")).toHaveLength(1);
  const receipts = b.requests.filter((r) => r.op === "runs/finish");
  expect(receipts).toHaveLength(2);
  expect(receipts[1].body).toEqual(receipts[0].body);
  expect(
    b.requests
      .filter((r) => r.op === "conversations/append")
      .flatMap((r) => r.body.events)
      .every((e) => e.author === "human"),
  ).toBe(true);
}, 15000);
it("approved graceful shutdown actually freezes the dispatcher and commits a cloud handoff after source quiescence", async () => {
  const b = await backend();
  b.controls.autoContinue = true;
  const a = await computer("A", "claude", b.transport("install-a"), true);
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Continue in cloud",
  });
  await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Work across shutdown" },
  );
  await until(() => a.turns.length === 1);
  await pause();
  const results = await a.harness.continuity.prepareShutdown();
  expect(results).toEqual([{ threadId: a.threadId, state: "transferred" }]);
  const operations = b.requests.map((r) => r.op);
  expect(operations.indexOf("transfers/quiesce")).toBeGreaterThan(
    operations.indexOf("transfers/prepare"),
  );
  expect(operations.indexOf("transfers/commit")).toBeGreaterThan(
    operations.indexOf("transfers/quiesce"),
  );
  expect(operations).not.toContain("runs/stop");
  expect(operations).not.toContain("runs/finish");
}, 15000);
it("periodic reception refreshes a linked conversation and lists only its granted physical computers", async () => {
  const b = await backend();
  const a = await computer("A", "claude", b.transport("install-a"));
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Receives while idle",
  });
  await b.transport("install-a")("conversations/append", {
    orgId: "org",
    conversationId: b.conversationId,
    events: [
      {
        eventId: randomUUID(),
        schemaVersion: 1,
        localSequence: 1001,
        baseRevision: "0",
        kind: "message",
        content: "Cloud reply while Mac is idle",
        author: "agent",
      },
    ],
  });
  const received: any[] = [];
  a.harness.continuity.start(
    (_id, messages) => received.push(...messages),
    () => ({ runtimes: ["claude"], supervised: true }),
  );
  await until(() => received.length > 0);
  expect(received[0].blocks[0].text).toContain("while Mac is idle");
  expect(b.requests.some((r) => r.op === "devices/presence")).toBe(true);
  const tool = a.harness.continuity
    .portableTools(a.threadId)
    .find((t) => t.name === "list_accessible_computers")!;
  const result: any = await tool.call(
    { agentId: "other-agent" },
    { callId: "fixture", threadId: a.threadId, turnId: "fixture" },
  );
  expect(result.devices[0].deviceName).toBe("Mac A");
  expect(b.requests.find((r) => r.op === "devices/list")!.body).toEqual({
    orgId: "org",
    agentId: "cloud-agent",
  });
  a.harness.continuity.close();
}, 15000);

it("a persistence error during a provider callback revokes the active lease and stops the run", async () => {
  const b = await backend();
  const a = await computer("A", "claude", b.transport("install-a"), true);
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Disk failure",
  });
  const storage = (a.harness as any).storage;
  const original = storage.appendNdjson.bind(storage);
  const spy = vi
    .spyOn(storage, "appendNdjson")
    .mockImplementation((path: any, row: any) => {
      if (row.role === "bot" && row.deliveryState === "complete")
        throw new Error("ENOSPC callback fixture");
      return original(path, row);
    });
  try {
    const sent = await a.harness.threads.send(
      { botId: a.bot.id },
      { text: "A durable intent before disk failure" },
    );
    await until(
      async () =>
        (await a.harness.runs.get(sent.runIds[0]!))?.state === "failed",
    );
    expect(a.harness.continuity.guard.get(a.threadId)).toBeUndefined();
    expect((await a.harness.runs.get(sent.runIds[0]!))?.error).toContain(
      "Persistence failed",
    );
    expect(
      a.harness.continuity.store
        .pending(a.threadId)
        .some((e) => e.content === "A completed 1"),
    ).toBe(true);
  } finally {
    spy.mockRestore();
  }
}, 15000);

it.each(["cancelMission", "cancelRun"] as const)(
  "%s cancels admission in flight without launching a provider when its claim returns",
  async (cancel) => {
    const b = await backend();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let claimed = false;
    const transport: ContinuityTransport = async (op, body) => {
      const result = await b.transport("install-a")(op, body);
      if (op === "runs/claim") {
        claimed = true;
        await gate;
      }
      return result as any;
    };
    const a = await computer("A", "claude", transport, true);
    await a.harness.continuity.link(a.threadId, {
      agentId: "cloud-agent",
      audience: "private",
      title: "Stop while claiming",
    });
    const sent = await a.harness.threads.send(
      { botId: a.bot.id },
      { text: "Stop this preparation" },
    );
    await until(() => claimed);
    expect(await a.harness.threads[cancel](sent.runIds[0]!)).toBe(true);
    release();
    await until(
      () => b.requests.some((r) => r.op === "runs/stop") || a.turns.length > 0,
    );
    expect(a.turns).toHaveLength(0);
    expect((await a.harness.runs.get(sent.runIds[0]!))?.state).toBe(
      "cancelled",
    );
    expect(
      a.harness.continuity.store.queued()[sent.runIds[0]!],
    ).toBeUndefined();
    expect(a.harness.continuity.guard.get(a.threadId)).toBeUndefined();
  },
);

it("offline STOP survives coordinator reconstruction and excludes shutdown transfer when connectivity returns", async () => {
  const b = await backend();
  b.controls.autoContinue = true;
  let offline = false;
  const transport: ContinuityTransport = async (op, body) => {
    if (offline) throw new Error("fixture offline");
    return b.transport("install-a")(op, body);
  };
  const a = await computer("A", "claude", transport, true);
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Durable STOP",
  });
  const sent = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Stop even offline" },
  );
  await until(() => a.turns.length === 1);
  await pause();
  offline = true;
  await a.harness.threads.cancelMission(sent.runIds[0]!);
  await until(
    () => a.harness.continuity.store.status(a.threadId)!.error !== null,
  );
  offline = false;
  const { ConversationContinuity } =
    await import("../src/harness/continuity-sync.js");
  const reopened = new ConversationContinuity(
    (a.harness as any).storage,
    transport,
  );
  cleanup.push(() => reopened.close());
  await reopened.prepareShutdown();
  expect(b.requests.filter((r) => r.op.startsWith("transfers/"))).toHaveLength(
    0,
  );
  await expect(
    reopened.prepareTransfer(a.threadId, {
      transferId: randomUUID(),
      destination: { kind: "cloud", model: "fixture-cloud" },
    }),
  ).rejects.toThrow(/stop/i);
});

it("a cancelled old claim returning after the next run starts cannot revoke the new lease", async () => {
  const b = await backend();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let claims = 0;
  const transport: ContinuityTransport = async (op, body) => {
    const result = await b.transport("install-a")(op, body);
    if (op === "runs/claim" && ++claims === 1) await gate;
    return result as any;
  };
  const a = await computer("A", "claude", transport, true);
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Separate admission generations",
  });
  const old = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Old cancelled admission" },
  );
  await until(() => claims === 1);
  await a.harness.threads.cancelMission(old.runIds[0]!);
  await until(() => b.requests.some((r) => r.op === "runs/stop"));
  const next = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "New authorized work" },
  );
  await until(() => a.turns.length === 1);
  const lease = a.harness.continuity.guard.get(a.threadId);
  release();
  await pause();
  await pause();
  expect(a.turns).toHaveLength(1);
  expect(a.harness.continuity.guard.get(a.threadId)).toEqual(lease);
  expect((await a.harness.runs.get(next.runIds[0]!))?.state).toBe("working");
  expect((await a.harness.runs.get(old.runIds[0]!))?.state).toBe("cancelled");
});

it("STOP arriving during checkpoint upload prevents the remaining transfer calls", async () => {
  const b = await backend();
  b.controls.autoContinue = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let checkpoint = false;
  const transport: ContinuityTransport = async (op, body) => {
    const result = await b.transport("install-a")(op, body);
    if (op === "checkpoints/put") {
      checkpoint = true;
      await gate;
    }
    return result as any;
  };
  const a = await computer("A", "claude", transport, true);
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Transfer STOP race",
  });
  const sent = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Transfer only while permitted" },
  );
  await until(() => a.turns.length === 1);
  await pause();
  const transfer = a.harness.continuity.prepareShutdown();
  await until(() => checkpoint);
  a.harness.continuity.stop(a.threadId, sent.runIds[0]!);
  release();
  expect(await transfer).toMatchObject([
    { state: "waiting", reason: expect.stringMatching(/stop/i) },
  ]);
  expect(b.requests.filter((r) => r.op.startsWith("transfers/"))).toHaveLength(
    0,
  );
});

it("voice cancellation removes durable queued work and recovery refuses an old cancelled command", async () => {
  const b = await backend();
  const a = await computer("A", "claude", b.transport("install-a"), true);
  await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Blocking first turn" },
  );
  const queued = await a.harness.threads.send(
    { botId: a.bot.id },
    { text: "Cancelled queued command" },
  );
  const id = queued.runIds[0]!;
  const raw = a.harness.continuity.store.queued()[id];
  expect(raw).toBeDefined();
  expect(await a.harness.threads.cancelRun(id)).toBe(true);
  expect(a.harness.continuity.store.queued()[id]).toBeUndefined();
  a.harness.stop();
  // Also recover a stale record from a crash/older runtime after the durable
  // run cancellation but before removal of its queue projection.
  a.harness.continuity.store.queue(id, raw);
  const launched = vi.fn();
  const next = new LocalBizosHarness({
    ...(a.harness as any).options,
    startClaudeTurn: launched,
  });
  cleanup.push(() => next.stop());
  (next as any).dispatcher.resumeInterruptedTasks();
  await pause();
  expect(launched).not.toHaveBeenCalled();
  expect((await next.runs.get(id))?.state).toBe("cancelled");
  expect(next.continuity.store.queued()[id]).toBeUndefined();
});

it("outbox synchronization sends bounded UTF-8 batches and drains all valid messages", async () => {
  const b = await backend();
  const a = await computer("A", "claude", b.transport("install-a"));
  await a.harness.continuity.link(a.threadId, {
    agentId: "cloud-agent",
    audience: "private",
    title: "Offline backlog",
  });
  for (let i = 0; i < 14; i++)
    a.harness.continuity.store.capture({
      id: `offline-${i}`,
      threadId: a.threadId,
      seq: i + 1,
      role: "user",
      blocks: [{ kind: "text", text: (i % 2 ? "界" : "a").repeat(20000) }],
      createdAt: "2026-09-26T00:00:00Z",
    });
  await a.harness.continuity.sync(a.threadId);
  expect(a.harness.continuity.store.status(a.threadId)!.pending).toBe(0);
  expect(b.events).toHaveLength(14);
  const batches = b.requests.filter((r) => r.op === "conversations/append");
  expect(batches.length).toBeGreaterThan(1);
  expect(
    batches.every(
      (r) =>
        Buffer.byteLength(JSON.stringify({ operation: r.op, body: r.body })) <=
        256 * 1024,
    ),
  ).toBe(true);
});
