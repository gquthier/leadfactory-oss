// Pick which connected plan answers a turn, and what to do when that plan
// runs out of quota.
//
// Sticky pins keep a thread on one account so resume stays coherent; a
// cooldown after 429/quota clears the pin and hands the next turn to
// another healthy plan (fresh thread — different auth home).
import type { ConnectedPlan, PlanProvider, PlanRoutingState } from "./plan-types.js";

export const FAILOVER_COOLDOWN_MS = 30 * 60_000;

export interface ResolvePlanInput {
  plans: ConnectedPlan[];
  routing: PlanRoutingState;
  cursorKey: string;
  preferredProvider?: PlanProvider;
  /** The plan the bot itself was given in its settings: first choice while healthy. */
  botPlanId?: string;
  nowMs?: number;
}

export function isPlanHealthy(plan: ConnectedPlan, nowMs: number = Date.now()): boolean {
  if (plan.status === "rate_limited") {
    const until = plan.cooldownUntil ? Date.parse(plan.cooldownUntil) : NaN;
    return Number.isFinite(until) && until <= nowMs;
  }
  if (plan.status !== "connected") return false;
  if (!plan.cooldownUntil) return true;
  const until = Date.parse(plan.cooldownUntil);
  if (Number.isNaN(until)) return true;
  return until <= nowMs;
}

/** Lowest priority number wins; ties break on oldest `lastUsedAt`, then id. */
export function comparePlanPriority(a: ConnectedPlan, b: ConnectedPlan): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const aUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
  const bUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
  if (aUsed !== bUsed) return aUsed - bUsed;
  return a.id.localeCompare(b.id);
}

export function resolvePlan(input: ResolvePlanInput): ConnectedPlan | null {
  const nowMs = input.nowMs ?? Date.now();
  const byId = new Map(input.plans.map((plan) => [plan.id, plan]));

  if (input.botPlanId) {
    const own = byId.get(input.botPlanId);
    if (own && isPlanHealthy(own, nowMs)) return own;
  }

  const pinId = input.routing.pins[input.cursorKey];
  if (pinId) {
    const pinned = byId.get(pinId);
    if (pinned && isPlanHealthy(pinned, nowMs)) return pinned;
  }

  const activeId = input.routing.activePlanId;
  if (activeId) {
    const active = byId.get(activeId);
    if (active && isPlanHealthy(active, nowMs)) {
      if (!input.preferredProvider || active.provider === input.preferredProvider) return active;
    }
  }

  const healthy = input.plans.filter((plan) => isPlanHealthy(plan, nowMs));
  const preferred = input.preferredProvider
    ? healthy.filter((plan) => plan.provider === input.preferredProvider)
    : healthy;
  // "Claude first" with no signed-in Claude plan must not strand the turn:
  // a preference orders the plans, it does not exclude the other family
  // (measured 2026-09-05: a Claude login left half-done put every turn on a
  // CLI that was not signed in).
  const candidates = preferred.length ? preferred : healthy;
  if (!candidates.length) return null;
  return [...candidates].sort(comparePlanPriority)[0] ?? null;
}

export interface FailoverPlanInput extends ResolvePlanInput {
  failedPlanId: string;
  /** Wall-clock after which the failed plan may be tried again. */
  cooldownUntilIso: string;
  /** Mutators applied by the caller (registry); kept here so the policy is one place. */
  markCooldown(planId: string, untilIso: string): void;
  clearPin(cursorKey: string): void;
}

/**
 * Cool the failed plan down, drop the sticky pin, and pick the next healthy
 * plan (same provider preference as `resolvePlan`). Returns null when none
 * remain — the thread then owes the user an honest "out of quota" note.
 */
export function failoverPlan(input: FailoverPlanInput): ConnectedPlan | null {
  input.markCooldown(input.failedPlanId, input.cooldownUntilIso);
  input.clearPin(input.cursorKey);

  const plans = input.plans.map((plan) =>
    plan.id === input.failedPlanId
      ? { ...plan, cooldownUntil: input.cooldownUntilIso, status: "rate_limited" as const }
      : plan,
  );
  const pins = { ...input.routing.pins };
  delete pins[input.cursorKey];
  return resolvePlan({
    plans,
    routing: { ...input.routing, pins },
    cursorKey: input.cursorKey,
    ...(input.preferredProvider ? { preferredProvider: input.preferredProvider } : {}),
    nowMs: input.nowMs,
  });
}

/** Convenience: 30 minutes from `nowMs`. */
export function failoverCooldownUntil(nowMs: number = Date.now()): string {
  return new Date(nowMs + FAILOVER_COOLDOWN_MS).toISOString();
}
