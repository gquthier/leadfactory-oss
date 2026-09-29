import { randomUUID } from "node:crypto";
import { ContinuityStore, type EffectRecord } from "./continuity.js";
export interface ExecutionLease {
  runId: string;
  generation: number;
  leaseToken: string;
  expiresAt: number;
  grants: string[];
  budgetRemaining: number;
  turnId?: string;
}
/** Local watchdog is independent of renewal traffic. A failed/late renewal
 * cannot keep the old process authorized. Aborting does not undo an effect. */
export class LeaseGuard {
  private readonly leases = new Map<
    string,
    { lease: ExecutionLease; abort: () => void }
  >();
  private readonly frozen = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly store: ContinuityStore,
    private readonly now = () => Date.now(),
  ) {
    this.timer = setInterval(() => this.check(), 200);
    this.timer.unref();
  }
  install(threadId: string, lease: ExecutionLease, abort: () => void): void {
    if (lease.expiresAt <= this.now() || lease.budgetRemaining <= 0)
      throw new Error("execution lease unavailable");
    const old = this.leases.get(threadId);
    if (old && old.lease.runId !== lease.runId)
      throw new Error("conversation already has an execution lease");
    this.frozen.delete(threadId);
    this.leases.set(threadId, { lease: { ...lease }, abort });
  }
  get(threadId: string): ExecutionLease | undefined {
    return this.leases.get(threadId)?.lease;
  }
  assert(threadId: string, tool?: string): ExecutionLease {
    if (this.frozen.has(threadId))
      throw new Error(
        "Execution is preparing a transfer; no new effects are admitted.",
      );
    const held = this.leases.get(threadId);
    if (
      !held ||
      held.lease.expiresAt <= this.now() ||
      held.lease.budgetRemaining <= 0
    ) {
      this.stop(threadId);
      throw new Error("Execution lease expired; waiting for reconciliation.");
    }
    if (
      tool &&
      !held.lease.grants.includes("*") &&
      !held.lease.grants.includes(tool)
    )
      throw new Error("Tool is outside the execution grant.");
    return held.lease;
  }
  prepare(
    threadId: string,
    tool: string,
    kind: EffectRecord["class"],
    argumentHash?: string,
    requestId?: string,
  ): string {
    const lease = this.assert(threadId, tool);
    const id = randomUUID();
    this.store.effect(threadId, {
      id,
      tool,
      class: kind,
      state: "prepared",
      generation: lease.generation,
      ...(argumentHash ? { argumentHash } : {}),
      ...(requestId ? { requestId } : {}),
    });
    return id;
  }
  sent(threadId: string, id: string): void {
    this.assert(threadId);
    this.update(threadId, id, "sent");
  }
  update(
    threadId: string,
    id: string,
    state: EffectRecord["state"],
    receipt?: string,
  ): void {
    const e = this.store.effects(threadId).find((e) => e.id === id);
    if (!e) throw new Error("unknown operation");
    this.store.effect(threadId, {
      ...e,
      state,
      ...(receipt ? { receipt: receipt.slice(0, 2000) } : {}),
    });
  }
  stop(threadId: string): void {
    const held = this.leases.get(threadId);
    if (!held) return;
    this.leases.delete(threadId);
    try {
      for (const e of this.store.effects(threadId))
        if (e.state === "sent")
          this.store.effect(threadId, { ...e, state: "unknown" });
    } finally {
      held.abort();
    }
  }
  freeze(threadId: string): void {
    this.frozen.add(threadId);
    this.leases.get(threadId)?.abort();
  }
  release(threadId: string): void {
    this.leases.delete(threadId);
    this.frozen.delete(threadId);
  }
  check(): void {
    for (const [threadId, { lease }] of this.leases)
      if (lease.expiresAt <= this.now()) this.stop(threadId);
  }
  transferable(threadId: string): boolean {
    return !this.store
      .effects(threadId)
      .some(
        (e) =>
          e.state === "unknown" ||
          e.state === "sent" ||
          e.state === "prepared" ||
          e.class === "uncontrolled",
      );
  }
  close(): void {
    clearInterval(this.timer);
    for (const key of this.leases.keys()) this.stop(key);
  }
}
