import type { Bot, RuntimeSettings } from "./harness/types.js";
import type { PublicPlan } from "./harness/plan-types.js";

export type VoicePlanProvider = "codex" | "claude";

export interface VoiceBinding {
  planId: string;
  provider: VoicePlanProvider;
}

export type VoiceCallState = "prepared" | "queued" | "running" | "done" | "failed" | "cancelled";

export interface VoiceRunSummary {
  runId: string;
  state: Exclude<VoiceCallState, "prepared">;
}

export interface VoiceTaskResult extends VoiceRunSummary {
  content: string | null;
  error: string | null;
}

export interface VoiceCallSnapshot {
  callId: string;
  agentId: string;
  threadId: string;
  binding: VoiceBinding;
  state: VoiceCallState;
  operationId: string | null;
  message: string | null;
  runs: VoiceRunSummary[];
  results: VoiceTaskResult[];
  createdAt: string;
  updatedAt: string;
}

export type VoiceCallMutationResponse = VoiceCallSnapshot & { duplicate: boolean };

export class VoiceTaskError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function usableNow(plan: PublicPlan, nowMs: number): boolean {
  const cooldownUntil = plan.cooldownUntil ? Date.parse(plan.cooldownUntil) : NaN;
  const coolingDown = Number.isFinite(cooldownUntil) && cooldownUntil > nowMs;
  return !coolingDown && (plan.status === "connected" || plan.status === "rate_limited");
}

/** The connected ChatGPT/Claude plan a voice call uses when none is chosen. */
function automaticVoicePlan(plans: readonly PublicPlan[], nowMs: number): PublicPlan | undefined {
  return plans
    .filter((plan) =>
      (plan.provider === "codex" || plan.provider === "claude")
      && usableNow(plan, nowMs)
      && !plan.usage?.reached
      && (plan.quota?.usedPct ?? 0) < 100)
    .sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt))[0];
}

function sameBinding(left: VoiceBinding, right: VoiceBinding): boolean {
  return left.planId === right.planId && left.provider === right.provider;
}

/**
 * Resolve the account a voice delegation is allowed to use. This is an exact
 * binding, rather than the normal chat router's preference: voice must fail
 * when the chosen personal account is unavailable and must never drift to an
 * API-key provider, Cursor, another account or another family.
 */
export function resolveVoiceBinding(input: {
  bot: Pick<Bot, "archived" | "planId" | "providerId">;
  settings: RuntimeSettings;
  plans: readonly PublicPlan[];
  expectedBinding?: VoiceBinding;
  nowMs?: number;
}): VoiceBinding {
  if (input.bot.archived) {
    throw new VoiceTaskError(422, "voice_agent_archived", "The selected agent is archived.");
  }
  if (input.bot.providerId || (!input.bot.planId && input.settings.local.inferenceProviderId)) {
    throw new VoiceTaskError(
      422,
      "voice_external_provider_not_allowed",
      "Voice tasks require a connected ChatGPT or Claude personal plan.",
    );
  }

  const nowMs = input.nowMs ?? Date.now();
  // With no bot override and no active plan, a normal chat turn is routed to
  // a connected plan automatically. Voice does the same ONCE, at the start of
  // the call, and the desktop then pins that binding for every later task, so
  // a call still never drifts to another account.
  const planId = input.bot.planId
    ?? input.settings.local.activePlanId
    ?? input.expectedBinding?.planId
    ?? automaticVoicePlan(input.plans, nowMs)?.id;
  if (!planId) {
    throw new VoiceTaskError(
      422,
      "voice_plan_not_selected",
      "Connect a ChatGPT or Claude personal plan before starting a voice task.",
    );
  }
  const plan = input.plans.find((candidate) => candidate.id === planId);
  if (!plan) {
    throw new VoiceTaskError(422, "voice_plan_unavailable", "The selected personal plan is no longer connected.");
  }
  if (plan.provider !== "codex" && plan.provider !== "claude") {
    throw new VoiceTaskError(
      422,
      "voice_plan_provider_not_allowed",
      "Voice tasks support ChatGPT and Claude personal plans only.",
    );
  }
  if (!usableNow(plan, nowMs)) {
    throw new VoiceTaskError(422, "voice_plan_unavailable", "The selected personal plan is disconnected, expired, or cooling down.");
  }
  if (plan.usage?.reached || (plan.quota?.usedPct ?? 0) >= 100) {
    throw new VoiceTaskError(422, "voice_plan_quota_exhausted", "The selected personal plan reports no remaining quota.");
  }

  const binding: VoiceBinding = { planId: plan.id, provider: plan.provider };
  if (input.expectedBinding && !sameBinding(binding, input.expectedBinding)) {
    throw new VoiceTaskError(
      409,
      "voice_binding_changed",
      "The selected agent plan changed during this voice session.",
    );
  }
  return binding;
}
