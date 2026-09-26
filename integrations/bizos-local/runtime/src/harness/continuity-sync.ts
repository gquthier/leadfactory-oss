import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContinuityStore,
  isQuickChatThread,
  payloadHash,
  type NeutralEvent,
} from "./continuity.js";
import { LeaseGuard, type ExecutionLease } from "./execution-lease.js";
import { Storage, writeFileAtomic } from "./storage.js";
import type {
  ContinuityIdentity,
  ContinuityTransport,
} from "../continuity-bridge.js";
import type { ThreadMessage } from "./types.js";
import { waitForCliShutdown } from "./procs.js";
import type { CodexDynamicTool } from "./codex-driver.js";
import {
  PUBLISH_CONVERSATION_ARTIFACT,
  READ_CONVERSATION_ARTIFACT,
  READ_CONVERSATION_ARCHIVE,
} from "../continuity-tools.js";
interface CanonicalEvent {
  eventId: string;
  schemaVersion: 1;
  localSequence: number;
  baseRevision: string;
  kind: NeutralEvent["kind"];
  content: string;
  author: NeutralEvent["author"];
  runId?: string;
  epoch?: number;
  sequence: string;
  contentHash: string;
  createdAt: string;
}
interface LinkedRun {
  requestId: string;
  claimId?: string;
  runId?: string;
  epoch?: number;
  turnId?: string;
  leaseToken?: string;
  threadId: string;
  localRunId: string;
  runtime: "claude" | "codex";
  leaseUntil?: string;
  finished?: boolean;
  supervised?: boolean;
  transferring?: boolean;
  processStopped?: boolean;
  finishPayload?: Record<string, unknown>;
  stopAcknowledged?: boolean;
}
const RUNS = "continuity-runs.json";
const STOPS = "continuity-stops.json";
const MAX_REQUEST_BYTES = 256 * 1024;
class DocumentValidationError extends Error {}
export function wireEvent(
  event: Pick<
    NeutralEvent,
    | "eventId"
    | "schemaVersion"
    | "localSequence"
    | "baseRevision"
    | "kind"
    | "content"
    | "author"
    | "runId"
    | "epoch"
  >,
): Record<string, unknown> {
  return {
    eventId: event.eventId,
    schemaVersion: 1,
    localSequence: event.localSequence,
    baseRevision: event.baseRevision,
    kind: event.kind,
    content: event.content,
    author: event.author,
    ...(event.runId ? { runId: event.runId, epoch: event.epoch } : {}),
  };
}
/** PostgreSQL jsonb text uses length-then-byte key order and spaces. The
 * event wire schema has only scalar fields, so its hash can be verified
 * independently without relying on server metadata or object insertion order. */
export function canonicalEventHash(
  event: NeutralEvent | CanonicalEvent,
): string {
  const wire = wireEvent(event as NeutralEvent);
  const keys = Object.keys(wire).sort(
    (a, b) =>
      Buffer.byteLength(a) - Buffer.byteLength(b) ||
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
  );
  return payloadHash(
    "{" +
      keys
        .map((key) => JSON.stringify(key) + ": " + JSON.stringify(wire[key]))
        .join(", ") +
      "}",
  );
}
/** All I/O uses the main bridge; no URL, key or paid fallback is inferred. */
export class ConversationContinuity {
  readonly store: ContinuityStore;
  readonly guard: LeaseGuard;
  private readonly syncing = new Map<string, Promise<void>>();
  private readonly publishing = new Map<string, Promise<void>>();
  private runs: Record<string, LinkedRun>;
  private readonly renewals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly stopped: Set<string>;
  private closed = false;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private tickFailures = 0;
  private shutdownDeadline: number | undefined;
  private tickCallback:
    | ((threadId: string, messages: ThreadMessage[]) => void)
    | undefined;
  private incoming: Record<
    string,
    { runId: string; epoch: number; runtime: "claude" | "codex" }
  >;
  constructor(
    private readonly storage: Storage,
    private readonly transport?: ContinuityTransport,
    now = () => Date.now(),
  ) {
    this.store = new ContinuityStore(storage);
    this.guard = new LeaseGuard(this.store, now);
    this.runs = storage.readJsonStrict(RUNS, {});
    this.stopped = new Set(storage.readJsonStrict<string[]>(STOPS, []));
    this.incoming = storage.readJsonStrict("continuity-incoming.json", {});
    // Older builds could link a QuickChat. Detach its local journal before
    // recovery or ticking can replay it; this never calls the cloud bridge.
    const oldQuickChats = new Set([
      ...this.store.links().map(({ threadId }) => threadId),
      ...Object.values(this.runs).map(run => run.threadId),
      ...Object.keys(this.incoming),
      ...Object.values(this.store.queued()).map(value => value && typeof value === "object" ? (value as { threadId?: unknown }).threadId : undefined),
    ].filter((threadId): threadId is string => typeof threadId === "string" && isQuickChatThread(threadId)));
    for (const threadId of oldQuickChats) this.forgetQuickChat(threadId);
    for (const { threadId } of this.store.links())
      for (const effect of this.store.effects(threadId))
        if (effect.state === "sent")
          this.store.effect(threadId, { ...effect, state: "unknown" });
  }
  private call<T>(
    operation: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (
      this.shutdownDeadline !== undefined &&
      Date.now() >= this.shutdownDeadline
    )
      throw new Error(
        "Graceful handoff deadline reached; waiting for reconciliation.",
      );
    if (!this.transport)
      throw new Error(
        "This linked conversation requires the enrolled desktop bridge.",
      );
    return this.transport<T>(operation, body);
  }
  private scope(threadId: string): Record<string, unknown> {
    this.assertPersistent(threadId);
    const link = this.store.status(threadId);
    if (!link) throw new Error("Conversation is not linked.");
    return { orgId: link.orgId, conversationId: link.conversationId };
  }
  private saveRun(run: LinkedRun): void {
    const next = {
      ...this.runs,
      [run.localRunId]: { ...this.runs[run.localRunId], ...run },
    };
    this.storage.writeJson(RUNS, next);
    this.runs = next;
  }
  linked(threadId: string): boolean {
    return !isQuickChatThread(threadId) && this.store.status(threadId) !== null;
  }
  private assertPersistent(threadId: string): void {
    if (isQuickChatThread(threadId)) throw new Error("QuickChat is local and ephemeral; it cannot use conversation continuity.");
  }
  forgetQuickChat(threadId: string): void {
    this.assertQuickChat(threadId);
    this.guard.stop(threadId);
    this.clearRenewal(threadId);
    this.store.forgetQuickChat(threadId);
    const removedRunIds = Object.entries(this.runs).filter(([, run]) => run.threadId === threadId).map(([id]) => id);
    const runs = Object.fromEntries(Object.entries(this.runs).filter(([, run]) => run.threadId !== threadId));
    if (Object.keys(runs).length !== Object.keys(this.runs).length) {
      this.storage.writeJson(RUNS, runs);
      this.runs = runs;
    }
    if (removedRunIds.some(id => this.stopped.has(id))) {
      for (const id of removedRunIds) this.stopped.delete(id);
      this.storage.writeJson(STOPS, [...this.stopped]);
    }
    if (Object.hasOwn(this.incoming, threadId)) {
      const incoming = { ...this.incoming };
      delete incoming[threadId];
      this.storage.writeJson("continuity-incoming.json", incoming);
      this.incoming = incoming;
    }
  }
  private assertQuickChat(threadId: string): void {
    if (!isQuickChatThread(threadId)) throw new Error("Only QuickChat continuity can be forgotten here.");
  }
  async identity(): Promise<ContinuityIdentity> {
    return this.call("status", {});
  }
  async link(
    threadId: string,
    input: {
      agentId: string;
      audience: "private" | "thread";
      threadId?: string;
      title: string;
    },
  ): Promise<unknown> {
    this.assertPersistent(threadId);
    const identity = await this.identity();
    const reply = await this.call<{ conversationId: string }>(
      "conversations/link",
      {
        orgId: identity.orgId,
        workspaceId: identity.workspaceId,
        localConversationId: threadId,
        ...input,
      },
    );
    this.store.link(threadId, {
      conversationId: reply.conversationId,
      installationId: identity.installationId,
      accountId: identity.userId,
      orgId: identity.orgId,
      agentId: input.agentId,
      workspaceId: identity.workspaceId,
    });
    await this.sync(threadId);
    return this.store.status(threadId);
  }
  async list(): Promise<unknown> {
    const identity = await this.identity();
    return this.call("conversations/list", { orgId: identity.orgId });
  }
  async agents(): Promise<unknown> {
    const identity = await this.identity();
    return this.call("agents/list", { orgId: identity.orgId });
  }
  async attach(threadId: string, conversationId: string): Promise<unknown> {
    this.assertPersistent(threadId);
    const identity = await this.identity();
    const rows = await this.call<{
      conversations: Array<{ conversationId: string; agentId: string }>;
    }>("conversations/list", { orgId: identity.orgId });
    const found = rows.conversations.find(
      (c) => c.conversationId === conversationId,
    );
    if (!found) throw new Error("Authorized conversation not found.");
    const existing = this.store.status(threadId);
    if (existing) {
      if (existing.conversationId !== conversationId)
        throw new Error(
          "This local thread is already linked to a different conversation.",
        );
      this.store.adoptInstallation(threadId, {
        installationId: identity.installationId,
        accountId: identity.userId,
        orgId: identity.orgId,
      });
      await this.sync(threadId);
      return this.store.status(threadId);
    }
    this.store.link(threadId, {
      conversationId,
      installationId: identity.installationId,
      accountId: identity.userId,
      orgId: identity.orgId,
      agentId: found.agentId,
      workspaceId: identity.workspaceId,
    });
    await this.sync(threadId);
    return this.store.status(threadId);
  }
  capture(message: ThreadMessage): void {
    if (isQuickChatThread(message.threadId)) return;
    const run = message.runId ? this.runs[message.runId] : undefined;
    this.store.capture(
      message,
      run?.runId && run.epoch
        ? { runId: run.runId, epoch: run.epoch }
        : undefined,
    );
  }
  projection(threadId: string): ThreadMessage[] {
    if (isQuickChatThread(threadId)) return [];
    const latest = new Map<string, NeutralEvent>();
    for (const e of this.store.messages(threadId))
      latest.set(e.localMessageId ?? e.eventId, e);
    const head = this.store.status(threadId)?.head ?? 0;
    return [...latest.values()]
      .sort(
        (a, b) =>
          (a.seq ?? head + a.localSequence) - (b.seq ?? head + b.localSequence),
      )
      .map((e) => ({
        id: e.localMessageId ?? e.eventId,
        threadId,
        seq: e.seq ?? head + e.localSequence,
        role: e.author === "human" ? "user" : "bot",
        blocks: [
          { kind: "text", text: e.content },
          ...(e.seq === undefined
            ? [
                {
                  kind: "meta" as const,
                  text: "Saved on this computer; awaiting synchronization.",
                },
              ]
            : []),
        ],
        createdAt: e.createdAt ?? new Date(0).toISOString(),
      }));
  }
  sync(threadId: string): Promise<void> {
    if (isQuickChatThread(threadId)) return Promise.resolve();
    const old = this.syncing.get(threadId);
    if (old) return old;
    const work = this.synchronize(threadId).finally(() =>
      this.syncing.delete(threadId),
    );
    this.syncing.set(threadId, work);
    return work;
  }
  private async synchronize(threadId: string): Promise<void> {
    if (!this.linked(threadId)) return;
    try {
      const identity = await this.identity();
      const link = this.store.status(threadId)!;
      if (
        identity.userId !== link.accountId ||
        identity.orgId !== link.orgId ||
        identity.installationId !== link.installationId
      )
        throw new Error(
          "This conversation link belongs to another account or installation; explicitly reattach it on this app.",
        );
      const scope = this.scope(threadId);
      // STOP is durable and takes priority over any later publication/handoff.
      for (const run of Object.values(this.runs))
        if (
          run.threadId === threadId &&
          this.stopped.has(run.localRunId) &&
          !run.stopAcknowledged
        )
          await this.reconcileStop(run);
      // Read first: the server may have accepted a previously lost append.
      await this.pull(threadId);
      for (const run of Object.values(this.runs).filter(
        (r) =>
          r.threadId === threadId &&
          !r.finished &&
          r.finishPayload &&
          !this.stopped.has(r.localRunId),
      )) {
        await this.call("runs/finish", run.finishPayload!);
        await this.pull(threadId);
        this.saveRun({ ...run, finished: true });
      }
      for (;;) {
        const pending = this.appendBatch(scope, this.store.pending(threadId));
        if (!pending.length) break;
        await this.call("conversations/append", {
          ...scope,
          events: pending.map(wireEvent),
        });
        // A receipt alone never marks our inbox durable; read committed rows.
        await this.pull(threadId);
        if (
          this.store
            .pending(threadId)
            .some((e) => e.eventId === pending[0]!.eventId)
        )
          throw new Error(
            "Server receipt was not present in the canonical journal.",
          );
      }
      const head = this.store.status(threadId)!.head;
      const ack = await this.call<{ acknowledgedThrough: string }>(
        "conversations/ack",
        { ...scope, through: String(head) },
      );
      this.store.ack(threadId, Number(ack.acknowledgedThrough));
    } catch (error) {
      if (!this.closed)
        this.store.error(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      throw error;
    }
  }
  private appendBatch(
    scope: Record<string, unknown>,
    events: NeutralEvent[],
  ): NeutralEvent[] {
    const batch: NeutralEvent[] = [];
    for (const event of events.slice(0, 100)) {
      const candidate = [...batch, event];
      const request = {
        operation: "conversations/append",
        body: { ...scope, events: candidate.map(wireEvent) },
      };
      if (
        Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES
      ) {
        if (!batch.length)
          throw new Error(
            "A conversation event exceeds the 256 KiB request limit; waiting for reconciliation.",
          );
        break;
      }
      batch.push(event);
    }
    return batch;
  }
  private async pull(threadId: string): Promise<void> {
    for (let pages = 0; pages < 1000; pages++) {
      const page = await this.call<{
        events: CanonicalEvent[];
        hasMore: boolean;
        latestCheckpointId?: string | null;
      }>("conversations/read", {
        ...this.scope(threadId),
        after: String(this.store.status(threadId)!.head),
        limit: 100,
      });
      if (!Array.isArray(page.events))
        throw new Error("Invalid conversation journal response.");
      const pending = this.store.pending(threadId);
      const events = page.events.map((e) => {
        const local = pending.find((p) => p.eventId === e.eventId);
        if (
          e.schemaVersion !== 1 ||
          !Number.isSafeInteger(Number(e.sequence)) ||
          Number(e.sequence) < 1 ||
          typeof e.content !== "string" ||
          typeof e.eventId !== "string" ||
          canonicalEventHash(e) !== e.contentHash
        )
          throw new Error("Canonical event hash or sequence is invalid.");
        if (
          local &&
          JSON.stringify(wireEvent(local)) !== JSON.stringify(wireEvent(e))
        )
          throw new Error("Canonical event differs from the durable outbox.");
        return {
          ...e,
          seq: Number(e.sequence),
          hash: local?.hash ?? payloadHash(e),
          ...(local?.localMessageId
            ? { localMessageId: local.localMessageId }
            : {}),
        };
      });
      if (events.length) {
        this.store.accept(threadId, events);
        const ids = new Set(events.map((e) => e.localMessageId ?? e.eventId));
        this.tickCallback?.(
          threadId,
          this.projection(threadId).filter((message) => ids.has(message.id)),
        );
      }
      if (!page.hasMore) {
        if (page.latestCheckpointId)
          await this.loadCheckpoint(threadId, page.latestCheckpointId);
        return;
      }
      if (!events.length)
        throw new Error("Conversation pagination did not advance.");
    }
    throw new Error("Conversation archive exceeds synchronization limit.");
  }
  async prepare(
    threadId: string,
    localRunId: string,
    runtime: string,
    abort: () => void,
  ): Promise<void> {
    if (!this.linked(threadId)) return;
    if (runtime !== "claude" && runtime !== "codex")
      throw new Error(
        "This linked conversation requires Claude or Codex on this computer. Choose cloud execution explicitly for an API model.",
      );
    if (this.stopped.has(localRunId)) throw new Error("Run was stopped.");
    if (
      Object.values(this.runs).some(
        (r) => r.threadId === threadId && r.transferring && !r.finished,
      )
    )
      throw new Error("Conversation is waiting for transfer reconciliation.");
    const { policy } = await this.call<{
      policy: {
        enabled: boolean;
        modelRuntime: "claude" | "codex";
        cloudFallback: null | { model: string; maxCostUsd: number };
        autoContinue: boolean;
      };
    }>("policies/get", this.scope(threadId));
    if (!policy.enabled)
      throw new Error(
        "Conversation execution is disabled in its continuity policy.",
      );
    await this.sync(threadId);
    this.assertNotStopped(threadId, localRunId);
    const requiredVersions = new Map<
      string,
      ReturnType<ContinuityStore["artifacts"]>[number]
    >();
    for (const artifact of this.store.artifacts(threadId))
      if (
        (requiredVersions.get(artifact.artifactId)?.version ?? 0) <
        artifact.version
      )
        requiredVersions.set(artifact.artifactId, artifact);
    for (const artifact of requiredVersions.values()) {
      if (!artifact.available || !artifact.localPath)
        throw new Error(
          "Required conversation artifact is unavailable on this computer.",
        );
      let bytes: Buffer;
      try {
        bytes = Buffer.from(readFileSync(artifact.localPath, "utf8"), "base64");
      } catch {
        throw new Error(
          "Required conversation artifact is missing on this computer.",
        );
      }
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.hash)
        throw new Error(
          "Required conversation artifact changed on disk; synchronize its authorized version again.",
        );
    }
    this.store.context(threadId);
    const incoming = this.incoming[threadId];
    if (incoming && incoming.runtime !== runtime)
      throw new Error(
        "The transferred mission requires the destination runtime selected in its handoff.",
      );
    let run = this.runs[localRunId] ?? {
      threadId,
      localRunId,
      runtime,
      requestId: randomUUID(),
      ...(incoming ? { runId: incoming.runId, epoch: incoming.epoch } : {}),
    };
    this.saveRun(run);
    if (!run.runId) {
      const started = await this.call<{
        runId: string;
        epoch: number;
        leaseUntil: string;
      }>("runs/start", {
        ...this.scope(threadId),
        requestId: run.requestId,
        modelRuntime: runtime,
        cloudFallback: policy.cloudFallback,
      });
      run = { ...run, ...started };
      this.saveRun(run);
    }
    this.assertNotStopped(threadId, localRunId);
    if (!run.claimId) {
      run = { ...run, claimId: randomUUID() };
      this.saveRun(run);
    }
    const claim = await this.call<{
      turnId: string;
      leaseToken: string;
      leaseUntil: string;
    }>("runs/claim", {
      ...this.scope(threadId),
      runId: run.runId,
      epoch: run.epoch,
      claimId: run.claimId,
    });
    run = { ...run, ...claim };
    this.saveRun(run);
    this.assertNotStopped(threadId, localRunId);
    const lease: ExecutionLease = {
      runId: run.runId!,
      generation: run.epoch!,
      leaseToken: claim.leaseToken,
      turnId: claim.turnId,
      expiresAt: Date.parse(claim.leaseUntil),
      grants: ["*"],
      budgetRemaining: 1,
    };
    this.guard.install(threadId, lease, abort);
    if (incoming) {
      const next = { ...this.incoming };
      delete next[threadId];
      this.storage.writeJson("continuity-incoming.json", next);
      this.incoming = next;
    }
    this.clearRenewal(threadId);
    const timer = setInterval(() => {
      void this.heartbeat(localRunId).catch((error) => {
        this.store.error(threadId, String(error));
        this.guard.stop(threadId);
      });
    }, 15_000);
    timer.unref();
    this.renewals.set(threadId, timer);
  }
  private credentials(run: LinkedRun): Record<string, unknown> {
    return {
      ...this.scope(run.threadId),
      runId: run.runId,
      epoch: run.epoch,
      turnId: run.turnId,
      leaseToken: run.leaseToken,
    };
  }
  private async heartbeat(localRunId: string): Promise<void> {
    const run = this.runs[localRunId];
    if (!run) return;
    this.guard.assert(run.threadId);
    const reply = await this.call<{ leaseUntil: string }>(
      "runs/heartbeat",
      this.credentials(run),
    );
    const lease = this.guard.get(run.threadId);
    if (lease) lease.expiresAt = Date.parse(reply.leaseUntil);
  }
  private clearRenewal(threadId: string): void {
    const timer = this.renewals.get(threadId);
    if (timer) clearInterval(timer);
    this.renewals.delete(threadId);
  }
  stop(threadId: string, localRunId?: string): void {
    const run = localRunId
      ? this.runs[localRunId]
      : Object.values(this.runs)
          .reverse()
          .find((r) => r.threadId === threadId && !r.finished);
    const id = localRunId ?? run?.localRunId;
    try {
      if (id && this.linked(threadId) && !this.stopped.has(id)) {
        this.stopped.add(id);
        // Even if persistence fails, this process must fail closed. The
        // caller receives the storage error instead of a false saved STOP.
        this.storage.writeJson(STOPS, [...this.stopped]);
      }
    } finally {
      // A late cancelled claim must never revoke a different turn's lease.
      const lease = this.guard.get(threadId);
      if (!lease || !localRunId || lease.runId === run?.runId) {
        this.clearRenewal(threadId);
        this.guard.stop(threadId);
      }
    }
    if (run?.runId && !run.stopAcknowledged)
      void this.reconcileStop(run).catch((e) => {
        if (!this.closed) this.store.error(threadId, String(e));
      });
  }
  private assertNotStopped(threadId: string, localRunId: string): void {
    if (!this.stopped.has(localRunId)) return;
    this.stop(threadId, localRunId);
    throw new Error("Run was stopped; continuation is not authorized.");
  }
  private async reconcileStop(run: LinkedRun): Promise<void> {
    if (!run.runId || run.stopAcknowledged) return;
    await this.call("runs/stop", {
      ...this.scope(run.threadId),
      runId: run.runId,
    });
    if (!this.closed)
      this.saveRun({ ...this.runs[run.localRunId]!, stopAcknowledged: true });
  }
  async finish(
    threadId: string,
    localRunId: string,
    ok: boolean,
    error?: string | null,
  ): Promise<void> {
    let run = this.runs[localRunId];
    if (!run?.runId || run.finished) return;
    this.clearRenewal(threadId);
    try {
      if (!(await waitForCliShutdown()))
        throw new Error(
          "CLI process stop could not be confirmed; transfer remains blocked.",
        );
      this.saveRun({ ...run, processStopped: true });
      run = this.runs[localRunId]!;
      for (const effect of this.store.effects(threadId))
        if (effect.class === "uncontrolled" && effect.state === "sent")
          this.store.effect(threadId, { ...effect, state: "unknown" });
      if (run.transferring) {
        await this.sync(threadId);
        return;
      }
      if (
        !ok &&
        !this.stopped.has(localRunId) &&
        run.supervised &&
        /quota|rate.?limit|429|capacity|unavailable/i.test(error ?? "")
      ) {
        const { policy } = await this.call<{
          policy: {
            enabled: boolean;
            autoContinue: boolean;
            cloudFallback: null | { model: string; maxCostUsd: number };
          };
        }>("policies/get", this.scope(threadId));
        if (policy.enabled && policy.autoContinue && policy.cloudFallback) {
          await this.prepareTransfer(threadId, {
            transferId: run.requestId,
            destination: { kind: "cloud", model: policy.cloudFallback.model },
          });
          return;
        }
      }
      // Human intents need no execution lease. Agent results use the bounded
      // terminal reconciliation channel, including after lease expiration.
      await this.pull(threadId);
      const humans = this.store
        .pending(threadId)
        .filter((e) => e.author === "human");
      for (let offset = 0; offset < humans.length; ) {
        const batch = this.appendBatch(
          this.scope(threadId),
          humans.slice(offset),
        );
        await this.call("conversations/append", {
          ...this.scope(threadId),
          events: batch.map(wireEvent),
        });
        offset += batch.length;
      }
      if (humans.length) await this.pull(threadId);
      const results = this.store
        .pending(threadId)
        .filter(
          (e) =>
            e.author === "agent" &&
            e.runId === run!.runId &&
            e.epoch === run!.epoch,
        );
      if (results.length > 100)
        throw new Error(
          "Too many unsynchronized results for one terminal receipt; waiting for reconciliation.",
        );
      const body = run.finishPayload ?? {
        ...this.credentials(run),
        status: ok ? "done" : "failed",
        ...(results.length ? { finalEvents: results.map(wireEvent) } : {}),
        ...(!ok && error ? { error: error.slice(0, 400) } : {}),
      };
      if (
        Buffer.byteLength(
          JSON.stringify({ operation: "runs/finish", body }),
          "utf8",
        ) > MAX_REQUEST_BYTES
      )
        throw new Error(
          "Terminal output exceeds the 256 KiB atomic receipt limit; results remain pending for reconciliation.",
        );
      this.saveRun({ ...run, finishPayload: body });
      await this.call("runs/finish", body);
      await this.pull(threadId);
      const head = this.store.status(threadId)!.head;
      const ack = await this.call<{ acknowledgedThrough: string }>(
        "conversations/ack",
        { ...this.scope(threadId), through: String(head) },
      );
      this.store.ack(threadId, Number(ack.acknowledgedThrough));
      this.saveRun({ ...this.runs[localRunId]!, finished: true });
    } finally {
      this.guard.release(threadId);
    }
  }
  policy(threadId: string): Promise<unknown> {
    return this.call("policies/get", this.scope(threadId));
  }
  isClosed(): boolean {
    return this.closed;
  }
  start(
    onMessages: (threadId: string, messages: ThreadMessage[]) => void,
    capabilities: () => {
      runtimes: Array<"claude" | "codex">;
      supervised: boolean;
    },
  ): void {
    if (this.tickTimer || this.closed) return;
    this.tickCallback = onMessages;
    const tick = async () => {
      try {
        const links = this.store.links().filter(({ threadId }) => !isQuickChatThread(threadId));
        if (links.length) {
          const identity = await this.identity();
          await this.call("devices/presence", {
            orgId: identity.orgId,
            capabilities: capabilities(),
          });
          for (const { threadId } of links) {
            if (this.closed) return;
            await this.sync(threadId);
          }
        }
        this.tickFailures = 0;
      } catch {
        this.tickFailures = Math.min(3, this.tickFailures + 1);
      }
      if (!this.closed) {
        this.tickTimer = setTimeout(
          () => void tick(),
          Math.min(60000, 15000 * 2 ** this.tickFailures) +
            Math.floor(Math.random() * 1000),
        );
        this.tickTimer.unref();
      }
    };
    this.tickTimer = setTimeout(() => void tick(), 50);
    this.tickTimer.unref();
  }
  async pendingTransfers(): Promise<unknown> {
    const identity = await this.identity();
    return this.call("transfers/list", { orgId: identity.orgId });
  }
  async prepareShutdown(): Promise<
    Array<{ threadId: string; state: string; reason?: string }>
  > {
    this.shutdownDeadline = Date.now() + 12_000;
    try {
      const results: Array<{
        threadId: string;
        state: string;
        reason?: string;
      }> = [];
      for (const run of Object.values(this.runs)) {
        if (!this.stopped.has(run.localRunId) || run.stopAcknowledged) continue;
        try {
          await this.reconcileStop(run);
        } catch (error) {
          results.push({
            threadId: run.threadId,
            state: "waiting",
            reason: String(error),
          });
        }
      }
      for (const run of Object.values(this.runs).filter(
        (r) =>
          !r.finished && !r.transferring && !this.stopped.has(r.localRunId),
      )) {
        try {
          const { policy } = await this.call<{
            policy: {
              enabled: boolean;
              autoContinue: boolean;
              cloudFallback: null | { model: string; maxCostUsd: number };
            };
          }>("policies/get", this.scope(run.threadId));
          if (
            !policy.enabled ||
            !policy.autoContinue ||
            !policy.cloudFallback ||
            !run.supervised
          ) {
            results.push({
              threadId: run.threadId,
              state: "waiting",
              reason:
                "No authorized and verified cloud continuation is available.",
            });
            continue;
          }
          await this.prepareTransfer(run.threadId, {
            transferId: run.requestId,
            destination: { kind: "cloud", model: policy.cloudFallback.model },
          });
          results.push({ threadId: run.threadId, state: "transferred" });
        } catch (error) {
          results.push({
            threadId: run.threadId,
            state: "waiting",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return results;
    } finally {
      this.shutdownDeadline = undefined;
    }
  }
  async prepareTransfer(
    threadId: string,
    input: {
      transferId: string;
      destination:
        | {
            kind: "installation";
            installationId: string;
            modelRuntime: "claude" | "codex";
          }
        | { kind: "cloud"; model: string };
      summary?: string;
    },
  ): Promise<unknown> {
    let run = Object.values(this.runs)
      .reverse()
      .find((r) => r.threadId === threadId && !r.finished);
    if (!run?.runId || !run.epoch)
      throw new Error("No linked mission can be transferred.");
    this.assertNotStopped(threadId, run.localRunId);
    if (!run.supervised)
      throw new Error(
        "This CLI has unverified native effects; automatic transfer is unavailable. Stop and reconcile it first.",
      );
    if (!this.guard.transferable(threadId))
      throw new Error(
        "An operation is pending or unknown; reconcile before transfer.",
      );
    this.saveRun({ ...run, transferring: true });
    this.clearRenewal(threadId);
    this.guard.freeze(threadId);
    const deadline = Math.min(
      Date.now() + 7000,
      this.shutdownDeadline ?? Infinity,
    );
    while (
      !this.runs[run.localRunId]?.processStopped &&
      Date.now() < deadline
    ) {
      this.assertNotStopped(threadId, run.localRunId);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this.assertNotStopped(threadId, run.localRunId);
    run = this.runs[run.localRunId]!;
    if (!run.processStopped || !this.guard.transferable(threadId))
      throw new Error("The source has not confirmed quiescence.");
    await this.sync(threadId);
    this.assertNotStopped(threadId, run.localRunId);
    const through = String(this.store.status(threadId)!.head);
    const artifacts = this.store.artifacts(threadId);
    if (artifacts.some((a) => !a.available))
      throw new Error("Required artifact is unavailable.");
    const journalName = `continuity-transfer-${payloadHash(input.transferId)}.json`;
    const previous = this.storage.readJsonStrict<{
      checkpointId: string;
      through: string;
      destination: typeof input.destination;
    } | null>(journalName, null);
    if (
      previous &&
      (previous.through !== through ||
        JSON.stringify(previous.destination) !==
          JSON.stringify(input.destination))
    )
      throw new Error(
        "Transfer preparation changed; use a new transfer request.",
      );
    const checkpointId = previous?.checkpointId ?? randomUUID();
    this.storage.writeJson(journalName, {
      checkpointId,
      through,
      destination: input.destination,
    });
    const checkpoint = await this.call<{ manifestHash: string }>(
      "checkpoints/put",
      {
        ...this.scope(threadId),
        checkpointId,
        through,
        summary:
          input.summary?.slice(0, 16000) ??
          "Continue the authorized conversation from its canonical archive.",
        instructions: [],
        openTasks: [],
        unknownOperations: [],
        artifacts: artifacts.map((a) => ({
          artifactId: a.artifactId,
          version: a.version,
          sha256: a.hash,
        })),
        supervised: true,
      },
    );
    this.assertNotStopped(threadId, run.localRunId);
    const body = {
      ...this.scope(threadId),
      runId: run.runId,
      epoch: run.epoch,
      transferId: input.transferId,
      expectedHead: through,
      checkpointId,
      destination: input.destination,
    };
    const prepared = await this.call<Record<string, unknown>>(
      "transfers/prepare",
      body,
    );
    this.assertNotStopped(threadId, run.localRunId);
    await this.call("transfers/quiesce", {
      ...this.scope(threadId),
      runId: run.runId,
      epoch: run.epoch,
      transferId: input.transferId,
    });
    this.assertNotStopped(threadId, run.localRunId);
    const receipt = {
      ...prepared,
      checkpointId,
      runId: run.runId,
      epoch: run.epoch,
      expectedHead: through,
      manifestHash: checkpoint.manifestHash,
    };
    this.storage.writeJson(journalName, {
      ...receipt,
      through,
      destination: input.destination,
    });
    if (input.destination.kind === "cloud") {
      const committed = await this.call("transfers/commit", {
        ...this.scope(threadId),
        runId: run.runId,
        epoch: run.epoch,
        transferId: input.transferId,
        expectedHead: through,
        manifestHash: checkpoint.manifestHash,
        sourceStopped: true,
      });
      this.assertNotStopped(threadId, run.localRunId);
      this.saveRun({ ...run, finished: true });
      return committed;
    }
    return receipt;
  }
  async acceptTransfer(
    threadId: string,
    input: {
      transferId: string;
      runId: string;
      epoch: number;
      checkpointId: string;
      expectedHead: string;
      manifestHash: string;
      modelRuntime: "claude" | "codex";
    },
  ): Promise<unknown> {
    await this.sync(threadId);
    if (String(this.store.status(threadId)!.head) !== input.expectedHead)
      throw new Error(
        "Conversation changed during transfer; prepare it again.",
      );
    const checkpoint = (await this.loadCheckpoint(
      threadId,
      input.checkpointId,
    )) as { manifestHash: string };
    if (checkpoint.manifestHash !== input.manifestHash)
      throw new Error("Transfer manifest mismatch.");
    const result = await this.call<{ runId: string; epoch: number }>(
      "transfers/commit",
      {
        ...this.scope(threadId),
        runId: input.runId,
        epoch: input.epoch,
        transferId: input.transferId,
        expectedHead: input.expectedHead,
        manifestHash: input.manifestHash,
        sourceStopped: true,
      },
    );
    const next = {
      ...this.incoming,
      [threadId]: {
        runId: result.runId,
        epoch: result.epoch,
        runtime: input.modelRuntime,
      },
    };
    this.storage.writeJson("continuity-incoming.json", next);
    this.incoming = next;
    return result;
  }
  /** Every mounted host tool crosses authority admission again immediately
   * before the effect; native CLI tools remain explicitly uncontrolled. */
  tools(
    threadId: string,
    localRunId: string,
    tools: CodexDynamicTool[],
  ): CodexDynamicTool[] {
    if (!this.linked(threadId)) return tools;
    return tools
      .filter(
        (tool) =>
          !["recruit_agent", "cloud_computer_run", "schedule_routine"].includes(
            tool.name,
          ),
      )
      .map((tool) => ({
        ...tool,
        call: async (args, context) =>
          this.execute(threadId, localRunId, tool.name, args, () =>
            tool.call(args, context),
          ),
      }));
  }
  async execute<T>(
    threadId: string,
    localRunId: string,
    tool: string,
    args: unknown,
    perform: () => Promise<T>,
  ): Promise<T> {
    if (!this.linked(threadId)) return perform();
    if (
      [
        "recruit_agent",
        "recruit",
        "schedule_routine",
        "routine",
        "cloud_computer_run",
      ].includes(tool)
    )
      throw new Error(
        "This linked execution cannot launch an unsupervised process or child mission.",
      );
    const run = this.runs[localRunId];
    if (!run) throw new Error("Linked execution is not admitted.");
    this.guard.assert(threadId, tool);
    const kind =
      /^(read_|list_|get_|computer_observe|search_|agency_list|commerce_list)/.test(
        tool,
      )
        ? "read"
        : "mediated";
    const argsHash = payloadHash(args);
    if (
      this.store
        .effects(threadId)
        .some(
          (e) =>
            e.argumentHash === argsHash &&
            e.tool === tool &&
            ["sent", "unknown"].includes(e.state),
        )
    )
      throw new Error(
        "An identical operation has an unknown outcome; reconcile before repeating it.",
      );
    const operationId = this.guard.prepare(threadId, tool, kind, argsHash);
    const admitted = await this.call<{
      admitted: boolean;
      existingStatus?: string;
    }>("runs/admit", {
      ...this.credentials(run),
      operationId,
      operationClass: kind === "read" ? "read" : "idempotent",
      argsHash,
      target: tool,
    });
    if (!admitted.admitted)
      throw new Error(
        `Operation already ${admitted.existingStatus ?? "submitted"}; reconcile instead of repeating.`,
      );
    this.guard.sent(threadId, operationId);
    try {
      const result = await perform();
      this.guard.update(threadId, operationId, "confirmed");
      await this.call("runs/receipt", {
        ...this.credentials(run),
        operationId,
        status: "confirmed",
        receipt: "Host tool returned.",
      });
      return result;
    } catch (error) {
      const status =
        error instanceof DocumentValidationError ? "failed" : "unknown";
      this.guard.update(threadId, operationId, status);
      void this.call("runs/receipt", {
        ...this.credentials(run),
        operationId,
        status,
        receipt:
          status === "failed"
            ? "Document was not written; validation failed."
            : "Result unavailable; external effect may have happened.",
      }).catch(() => undefined);
      throw error;
    }
  }
  verified(localRunId: string, supervised: boolean): void {
    const run = this.runs[localRunId];
    if (run) this.saveRun({ ...run, supervised });
  }
  markNativeUncontrolled(threadId: string): void {
    if (!this.linked(threadId)) return;
    const lease = this.guard.assert(threadId);
    this.store.effect(threadId, {
      id: randomUUID(),
      tool: "native_cli_tools",
      class: "uncontrolled",
      state: "sent",
      generation: lease.generation,
    });
  }
  async putArtifact(
    threadId: string,
    input: {
      artifactId?: string;
      version: number;
      previousHash: string | null;
      name: string;
      mimeType: string;
      contentBase64: string;
    },
  ): Promise<unknown> {
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.length > 128 * 1024) throw new Error("Artifact exceeds 128 KiB.");
    const artifactId = input.artifactId ?? randomUUID(); // Hash bytes, not the base64 transport encoding.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const result = await this.call<{
      artifactId: string;
      version: number;
      sha256: string;
      sizeBytes: number;
    }>("artifacts/put", {
      ...this.scope(threadId),
      ...input,
      artifactId,
      sha256: hash,
    });
    if (
      result.artifactId !== artifactId ||
      result.version !== input.version ||
      result.sha256 !== hash ||
      result.sizeBytes !== bytes.length
    )
      throw new Error("Artifact receipt does not match the published bytes.");
    this.persistArtifact(
      threadId,
      result.artifactId,
      result.version,
      result.sha256,
      result.sizeBytes,
      input.name,
      bytes,
    );
    return result;
  }
  private publishArtifact(
    threadId: string,
    localRunId: string | undefined,
    raw: unknown,
  ): Promise<unknown> {
    const predecessor = this.publishing.get(threadId) ?? Promise.resolve();
    // Serialize the complete read/version/write/checkpoint sequence. The next
    // publication validates its original CAS after waiting; it never rebases.
    const work = predecessor.then(() =>
      this.publishArtifactNow(threadId, localRunId, raw),
    );
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.publishing.set(threadId, settled);
    return work.finally(() => {
      if (this.publishing.get(threadId) === settled)
        this.publishing.delete(threadId);
    });
  }
  private async publishArtifactNow(
    threadId: string,
    localRunId: string | undefined,
    raw: unknown,
  ): Promise<unknown> {
    if (!localRunId || !this.runs[localRunId])
      throw new Error("Document publication requires the active linked run.");
    const run = this.runs[localRunId]!;
    const authorize = () => {
      this.assertNotStopped(threadId, localRunId);
      const lease = this.guard.assert(
        threadId,
        PUBLISH_CONVERSATION_ARTIFACT.name,
      );
      if (lease.runId !== run.runId || lease.generation !== run.epoch)
        throw new Error("Document publication belongs to a stale run.");
    };
    authorize();
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new DocumentValidationError(
        "Document publication requires explicit text fields.",
      );
    const input = raw as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          ![
            "artifactId",
            "name",
            "mimeType",
            "text",
            "version",
            "previousHash",
          ].includes(key),
      )
    )
      throw new DocumentValidationError(
        "Unknown publication field; disk paths and scope overrides are not accepted.",
      );
    if (
      typeof input.text !== "string" ||
      Buffer.byteLength(input.text, "utf8") > 128 * 1024
    )
      throw new DocumentValidationError("Document text exceeds 128 KiB UTF-8.");
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 200 ||
      /[\\/\r\n\0]/.test(input.name)
    )
      throw new DocumentValidationError(
        "Document name must be a bounded file name, not a path.",
      );
    if (
      typeof input.mimeType !== "string" ||
      !["text/plain", "text/markdown", "text/csv", "application/json"].includes(
        input.mimeType,
      )
    )
      throw new DocumentValidationError(
        "Only a supported text document type may be published.",
      );
    if (
      !Number.isSafeInteger(input.version) ||
      Number(input.version) < 1 ||
      (input.previousHash !== null &&
        (typeof input.previousHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(input.previousHash)))
    )
      throw new DocumentValidationError(
        "A document version and its previous SHA256 are required.",
      );
    if (
      input.artifactId !== undefined &&
      (typeof input.artifactId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          input.artifactId,
        ))
    )
      throw new DocumentValidationError("Artifact ID must be a UUID.");
    await this.sync(threadId);
    authorize();
    const latest = this.store
      .artifacts(threadId)
      .filter((a) => a.artifactId === input.artifactId)
      .sort((a, b) => b.version - a.version)[0];
    if (
      latest
        ? input.version !== latest.version + 1 ||
          input.previousHash !== latest.hash
        : input.version !== 1 || input.previousHash !== null
    )
      throw new DocumentValidationError(
        "Document version conflict; read the latest authorized version before updating.",
      );
    const result = (await this.putArtifact(threadId, {
      ...(typeof input.artifactId === "string"
        ? { artifactId: input.artifactId }
        : {}),
      name: input.name,
      mimeType: input.mimeType,
      version: Number(input.version),
      previousHash: input.previousHash as string | null,
      contentBase64: Buffer.from(input.text, "utf8").toString("base64"),
    })) as {
      artifactId: string;
      version: number;
      sha256: string;
      sizeBytes: number;
    };
    authorize();
    const artifacts = new Map<
      string,
      ReturnType<ContinuityStore["artifacts"]>[number]
    >();
    for (const artifact of this.store.artifacts(threadId))
      if ((artifacts.get(artifact.artifactId)?.version ?? 0) < artifact.version)
        artifacts.set(artifact.artifactId, artifact);
    if (
      artifacts.size > 100 ||
      [...artifacts.values()].some((a) => !a.available)
    )
      throw new Error(
        "Checkpoint dependencies are unavailable or exceed 100 documents; publication awaits reconciliation.",
      );
    const previous = this.storage.readJsonStrict<{
      summary?: string;
      instructions?: string[];
      openTasks?: string[];
    }>(`continuity-checkpoint-${payloadHash(threadId)}.json`, {});
    const checkpointId = randomUUID();
    const checkpoint = {
      ...this.scope(threadId),
      checkpointId,
      through: String(this.store.status(threadId)!.head),
      summary:
        previous.summary ??
        "Continue from the full canonical archive and these explicitly shared documents.",
      instructions: previous.instructions ?? [],
      openTasks: previous.openTasks ?? [],
      unknownOperations: this.store
        .effects(threadId)
        .filter((e) => e.state === "unknown")
        .map((e) => e.id),
      artifacts: [...artifacts.values()].map((a) => ({
        artifactId: a.artifactId,
        version: a.version,
        sha256: a.hash,
      })),
      supervised: run.supervised === true,
    };
    authorize();
    const committed = await this.call<{ manifestHash: string }>(
      "checkpoints/put",
      checkpoint,
    );
    this.storage.writeJson(
      `continuity-checkpoint-${payloadHash(threadId)}.json`,
      { ...checkpoint, ...committed },
    );
    return { ...result, checkpointId, manifestHash: committed.manifestHash };
  }
  private persistArtifact(
    threadId: string,
    id: string,
    version: number,
    hash: string,
    size: number,
    name: string,
    bytes: Buffer,
  ): void {
    const directory = join(this.storage.layout.root, "continuity-artifacts");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${payloadHash([id, version])}.base64`);
    writeFileAtomic(path, bytes.toString("base64"));
    this.store.artifact(threadId, {
      artifactId: id,
      version,
      hash,
      size,
      name,
      available: true,
      localPath: path,
    });
  }
  async readArtifact(
    threadId: string,
    artifactId: string,
    version: number,
  ): Promise<unknown> {
    const result = await this.call<{
      artifactId: string;
      version: number;
      sha256: string;
      sizeBytes: number;
      name: string;
      contentBase64: string;
    }>("artifacts/read", { ...this.scope(threadId), artifactId, version });
    const bytes = Buffer.from(result.contentBase64, "base64");
    const { createHash } = await import("node:crypto");
    if (
      bytes.length > 128 * 1024 ||
      bytes.length !== result.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== result.sha256
    )
      throw new Error("Artifact bytes do not match its receipt.");
    this.persistArtifact(
      threadId,
      artifactId,
      version,
      result.sha256,
      result.sizeBytes,
      result.name,
      bytes,
    );
    return result;
  }
  async loadCheckpoint(
    threadId: string,
    checkpointId: string,
  ): Promise<unknown> {
    const checkpoint = await this.call<{
      checkpointId: string;
      through: string;
      summary: string;
      instructions: string[];
      openTasks: string[];
      unknownOperations: string[];
      artifacts: Array<{ artifactId: string; version: number; sha256: string }>;
      manifestHash: string;
    }>("checkpoints/read", { ...this.scope(threadId), checkpointId });
    if (Number(checkpoint.through) > this.store.status(threadId)!.head)
      throw new Error("Checkpoint is ahead of the synchronized conversation.");
    for (const artifact of checkpoint.artifacts) {
      const known = this.store
        .artifacts(threadId)
        .find(
          (a) =>
            a.artifactId === artifact.artifactId &&
            a.version === artifact.version &&
            a.hash === artifact.sha256 &&
            a.available,
        );
      if (!known) {
        this.store.artifact(threadId, {
          artifactId: artifact.artifactId,
          version: artifact.version,
          hash: artifact.sha256,
          size: 0,
          name: "Required artifact",
          available: false,
        });
        await this.readArtifact(
          threadId,
          artifact.artifactId,
          artifact.version,
        );
      }
    }
    this.storage.writeJson(
      `continuity-checkpoint-${payloadHash(threadId)}.json`,
      checkpoint,
    );
    return checkpoint;
  }
  async invokePortableTool(
    threadId: string,
    localRunId: string,
    name: string,
    input: unknown,
    authorize?: () => void,
  ): Promise<unknown> {
    const tool = this.portableTools(threadId, localRunId).find(
      (tool) => tool.name === name,
    );
    if (!tool) throw new Error("Unknown conversation tool.");
    return this.execute(threadId, localRunId, name, input, () => {
      authorize?.();
      return tool.call(input, { callId: "mcp", threadId, turnId: localRunId });
    });
  }
  portableTools(threadId: string, localRunId?: string): CodexDynamicTool[] {
    return [
      {
        ...PUBLISH_CONVERSATION_ARTIFACT,
        call: async (args) => this.publishArtifact(threadId, localRunId, args),
      },
      {
        name: "list_accessible_computers",
        description:
          "List physical BizOS installations granted to this conversation agent, with presence and declared runtimes. An offline machine cannot supply its CLI or files.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        call: async () => {
          const link = this.store.status(threadId);
          if (!link?.agentId)
            throw new Error("Conversation agent mapping is unavailable.");
          const result = await this.call<{ devices: unknown[] }>(
            "devices/list",
            { orgId: link.orgId, agentId: link.agentId },
          );
          return {
            currentInstallationId: link.installationId,
            devices: result.devices,
          };
        },
      },
      {
        ...READ_CONVERSATION_ARCHIVE,
        call: async (args) => {
          const input = args as { after?: number; limit?: number };
          const after = input?.after ?? 0;
          const limit = input?.limit ?? 20;
          if (
            !Number.isSafeInteger(after) ||
            after < 0 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 20
          )
            throw new Error(
              "Archive page requires after >= 0 and limit between 1 and 20 events.",
            );
          const head = this.store.status(threadId)!.head;
          const rows = this.store
            .archive(threadId)
            .filter((e) => e.seq! > after)
            .slice(0, limit);
          const events: Array<{
            sequence: number;
            kind: NeutralEvent["kind"];
            author: NeutralEvent["author"];
            content: string;
          }> = [];
          for (const e of rows) {
            const event = {
              sequence: e.seq!,
              kind: e.kind,
              author: e.author,
              content: e.content,
            };
            if (
              JSON.stringify({
                events: [...events, event],
                next: event.sequence,
                head,
              }).length > 60000
            ) {
              if (!events.length)
                throw new Error(
                  "A single archive event exceeds the 60,000-character serialized page limit; no partial event or empty continuation page was returned.",
                );
              break;
            }
            events.push(event);
          }
          return {
            events,
            next: events.at(-1)?.sequence ?? after,
            head,
          };
        },
      },
      {
        ...READ_CONVERSATION_ARTIFACT,
        call: async (args) => {
          const input = args as {
            artifactId: string;
            version: number;
            offset?: number;
            limit?: number;
          };
          const offset = input.offset ?? 0;
          const limit = input.limit ?? 6000;
          if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 6000
          )
            throw new Error(
              "Document page requires offset >= 0 and limit between 1 and 6000 Unicode characters.",
            );
          const a = this.store
            .artifacts(threadId)
            .find(
              (a) =>
                a.artifactId === input.artifactId &&
                a.version === input.version &&
                a.available,
            );
          if (!a?.localPath)
            throw new Error("Artifact is unavailable on this computer.");
          const bytes = Buffer.from(
            readFileSync(a.localPath, "utf8"),
            "base64",
          );
          const { createHash } = await import("node:crypto");
          if (
            bytes.length > 128 * 1024 ||
            bytes.length !== a.size ||
            createHash("sha256").update(bytes).digest("hex") !== a.hash
          )
            throw new Error("Artifact hash changed on disk.");
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            throw new Error("This artifact is not a UTF-8 text document.");
          }
          const characters = Array.from(text);
          if (offset > characters.length)
            throw new Error(
              "Document page offset exceeds its total character count.",
            );
          const end = Math.min(offset + limit, characters.length);
          return {
            artifactId: a.artifactId,
            version: a.version,
            name: a.name,
            sha256: a.hash,
            text: characters.slice(offset, end).join(""),
            offset,
            next: end < characters.length ? end : null,
            total: characters.length,
          };
        },
      },
    ];
  }
  close(): void {
    this.closed = true;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickCallback = undefined;
    for (const id of this.renewals.keys()) this.clearRenewal(id);
    this.guard.close();
  }
}
