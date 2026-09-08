// Routines as the app shows them: the same rows the cloud's `/api/crons`
// answers with, so one Routines app reads both. A local routine's trigger
// becomes a cron line the app already knows how to describe.
import type { Bot, Routine, RoutineTrigger, Run } from "./harness/types.js";

export interface PublicRoutine {
  id: string;
  name: string;
  /** Five-field cron when the trigger fits one; a sentence otherwise. */
  schedule: string;
  description: string;
  status: "active" | "paused";
  last_run_at: string | null;
  next_run_at: string | null;
  updated_at: string;
  /** Public agent id of the owner: who runs it, and who is responsible. */
  agent_id: string;
  agent_name: string;
  running: boolean;
  kind: "local";
  /** The runtime's own trigger, so a panel can edit it as it is. */
  trigger: RoutineTrigger;
}

export interface PublicRoutineRun {
  run_id: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  started_at: string;
  ended_at: string | null;
  error: string | null;
}

export function publicRoutineRun(run: Run, runIdFor: (id: string) => string): PublicRoutineRun {
  const state: PublicRoutineRun["state"] =
    run.state === "completed" ? "done"
    : run.state === "failed" ? "failed"
    : run.state === "cancelled" ? "cancelled"
    : run.state === "queued" ? "queued"
    : "running";
  return {
    run_id: runIdFor(run.id),
    state,
    started_at: run.startedAt,
    ended_at: run.endedAt ?? null,
    error: run.error ?? null,
  };
}

export function cronForTrigger(trigger: RoutineTrigger): string {
  if (trigger.frequency === "interval") {
    const minutes = Math.max(1, Math.round(trigger.everyMinutes));
    if (minutes < 60) return `*/${minutes} * * * *`;
    if (minutes % 60 === 0 && minutes < 24 * 60) return `0 */${minutes / 60} * * *`;
    return `every ${minutes} minutes`;
  }
  if (trigger.frequency === "daily") {
    const [hour, minute] = trigger.time.split(":").map((part) => Number(part));
    const days = trigger.weekdays && trigger.weekdays.length > 0 && trigger.weekdays.length < 7
      ? [...trigger.weekdays].sort((a, b) => a - b).join(",")
      : "*";
    return `${minute ?? 0} ${hour ?? 0} * * ${days}`;
  }
  return `once at ${trigger.at}`;
}

/** Newest of the instants a routine carries: what the app compares before a write. */
export function routineVersion(routine: Pick<Routine, "createdAt" | "lastRunAt" | "updatedAt">): string {
  return [routine.createdAt, routine.lastRunAt, routine.updatedAt]
    .filter((at): at is string => Boolean(at)).sort().at(-1)!;
}

export function publicRoutine(
  routine: Routine,
  bots: ReadonlyArray<Pick<Bot, "id" | "name">>,
  agentIdFor: (botId: string) => string,
): PublicRoutine {
  return {
    id: routine.id,
    name: routine.name,
    schedule: cronForTrigger(routine.trigger),
    description: routine.prompt,
    status: routine.enabled ? "active" : "paused",
    last_run_at: routine.lastRunAt ?? null,
    next_run_at: routine.enabled ? (routine.nextRunAt ?? null) : null,
    updated_at: routineVersion(routine),
    agent_id: agentIdFor(routine.botId),
    agent_name: bots.find((bot) => bot.id === routine.botId)?.name ?? "Unknown agent",
    running: routine.running,
    kind: "local",
    trigger: routine.trigger,
  };
}

/** What an agent may schedule: a name, a prompt, one of three rhythms, and an owner. */
export function triggerFromToolInput(input: Record<string, unknown>): RoutineTrigger {
  const frequency = input.frequency;
  if (frequency === "interval") {
    const every = Number(input.every_minutes);
    if (!Number.isFinite(every) || every < 1 || every > 7 * 24 * 60) throw new Error("every_minutes must be between 1 and 10080");
    return { kind: "schedule", frequency: "interval", everyMinutes: Math.round(every) };
  }
  if (frequency === "daily") {
    const time = typeof input.time === "string" ? input.time.trim() : "";
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("time must be HH:MM (24h, local)");
    const weekdays = Array.isArray(input.weekdays)
      ? input.weekdays.filter((day): day is number => typeof day === "number" && day >= 0 && day <= 6)
      : undefined;
    return { kind: "schedule", frequency: "daily", time, ...(weekdays && weekdays.length ? { weekdays } : {}) };
  }
  if (frequency === "once") {
    const at = typeof input.at === "string" ? input.at.trim() : "";
    if (Number.isNaN(Date.parse(at))) throw new Error("at must be an ISO instant in the future");
    return { kind: "schedule", frequency: "once", at: new Date(at).toISOString() };
  }
  throw new Error("frequency must be daily, interval or once");
}
