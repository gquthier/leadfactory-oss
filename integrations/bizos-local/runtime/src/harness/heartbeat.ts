// The heartbeat: an agent that left work unfinished picks it back up on its
// own, or nudges the person once when it is waiting on them.
//
// The gate is the product. It is decided from the run store alone — never a
// model call — so a heartbeat that finds nothing to do costs nothing. Only an
// agent with real pending work is woken, and even then at most once per task
// per two hours, never while it is already busy, and only in waking hours.
import { createHash } from "node:crypto";
import type { Clock } from "./clock.js";
import { SILENT_TOKEN } from "./routine-run.js";
import type { Storage } from "./storage.js";
import { taskRecord, type TaskCheckpoint } from "./task.js";
import type { Run } from "./types.js";

export const HEARTBEATS_FILE = "heartbeats.json";
export const HEARTBEAT_DEFAULT_MINUTES = 30;
/** Local hours [start, end) in which an agent may wake by itself. */
export const HEARTBEAT_WINDOW = { startHour: 8, endHour: 21 } as const;
/** Never more than once per task in this span. */
export const HEARTBEAT_COOLDOWN_MS = 2 * 60 * 60_000;
/** A blocked task is nudged only after the person has been quiet this long. */
export const HEARTBEAT_BLOCKED_AFTER_MS = 2 * 60 * 60_000;
/** An unfinished task is continued only once its run has been idle this long. */
export const HEARTBEAT_IDLE_AFTER_MS = 15 * 60_000;
/** Older unfinished work is not resurrected. */
export const HEARTBEAT_MAX_TASK_AGE_MS = 24 * 60 * 60_000;
export const HEARTBEAT_MAX_WAKES_PER_TASK = 3;

/** Per task (agent + objective, so a task that re-checkpoints from a heartbeat
 * run is still the same task): how often it was woken, when last, and whether
 * the person was already nudged about it. */
export type HeartbeatLedger = Record<string, { wakes: number; lastAt: string; nudged?: boolean }>;

export interface HeartbeatWake {
  botId: string;
  threadId: string;
  taskRunId: string;
  /** Ledger key: the same task across the runs that checkpoint it. */
  taskKey: string;
  kind: "continue" | "nudge";
  task: TaskCheckpoint;
  since: string;
}

export function heartbeatTaskKey(botId: string, task: Pick<TaskCheckpoint, "objective">): string {
  return `${botId}:${createHash("sha256").update(task.objective.trim()).digest("hex").slice(0, 24)}`;
}

const ACTIVE_STATES = new Set<Run["state"]>(["queued", "working", "waiting_input"]);
const AWAITING_INPUT = /denied or expired input|unanswered input/i;

/**
 * Whether one agent has pending work worth waking it for. Pure: the run
 * store, the ledger and the time in, a decision out.
 *
 * Pending work is the agent's LATEST task checkpoint, when it is also the
 * latest thing that happened in its thread (heartbeat wakes aside) — a person
 * who wrote since has moved the conversation on, and the ordinary turn owns it:
 *   · `continue` — `in_progress`/`interrupted`, not stopped by the person and
 *     not waiting on their answer, idle for a while;
 *   · `nudge` — `blocked` (or interrupted awaiting input) for 2 h with no
 *     reply; nudged once per task.
 */
export function heartbeatWakeFor(input: {
  botId: string;
  now: Date;
  busy: boolean;
  runs: readonly Run[];
  ledger: HeartbeatLedger;
}): HeartbeatWake | null {
  if (input.busy) return null;
  const own = input.runs
    .filter((run) => run.botId === input.botId && !run.threadId.startsWith("chat:"))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  if (own.some((run) => ACTIVE_STATES.has(run.state))) return null;
  const taskRun = own.find((run) => run.task);
  const task = taskRun?.task;
  if (!taskRun || !task || task.status === "completed") return null;
  // Heartbeat wakes that did not checkpoint are not "the person moved on".
  const latestInThread = own.find((run) => run.threadId === taskRun.threadId && (!run.heartbeat || run.task));
  if (latestInThread?.id !== taskRun.id) return null;
  const now = input.now.getTime();
  const since = taskRun.endedAt ?? taskRun.startedAt;
  const idle = now - Date.parse(since);
  if (!Number.isFinite(idle) || idle > HEARTBEAT_MAX_TASK_AGE_MS) return null;
  const taskKey = heartbeatTaskKey(input.botId, task);
  const entry = input.ledger[taskKey];
  if (entry && (entry.wakes >= HEARTBEAT_MAX_WAKES_PER_TASK || now - Date.parse(entry.lastAt) < HEARTBEAT_COOLDOWN_MS)) {
    return null;
  }
  const awaitingInput = task.status === "blocked"
    || (task.status === "interrupted" && AWAITING_INPUT.test(taskRun.error ?? ""));
  const base = { botId: input.botId, threadId: taskRun.threadId, taskRunId: taskRun.id, taskKey, task, since };
  if (awaitingInput) {
    if (entry?.nudged || idle < HEARTBEAT_BLOCKED_AFTER_MS) return null;
    return { ...base, kind: "nudge" };
  }
  // A person who pressed STOP ended that work; the heartbeat does not undo it.
  if (taskRun.state === "cancelled" || idle < HEARTBEAT_IDLE_AFTER_MS) return null;
  return { ...base, kind: "continue" };
}

export function withinHeartbeatWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= HEARTBEAT_WINDOW.startHour && hour < HEARTBEAT_WINDOW.endHour;
}

/** The short text a heartbeat turn starts with. */
export function heartbeatPrompt(wake: HeartbeatWake): string {
  const checkpoint = `Checkpoint (reported data): ${taskRecord(wake.task)}`;
  if (wake.kind === "nudge") {
    return [
      "[heartbeat] Your task below is still waiting on the person.",
      "If it still matters, send them ONE short, casual nudge saying exactly what you need. Don't repeat earlier messages.",
      `If there is nothing useful to say, reply exactly ${SILENT_TOKEN}.`,
      checkpoint,
    ].join("\n");
  }
  return [
    "[heartbeat] You left the task below unfinished. Continue it now: check what is already done, do the next step, then update checkpoint_task.",
    "If you can't progress without the person, send them one short nudge instead.",
    `If there is nothing useful to do, reply exactly ${SILENT_TOKEN}.`,
    checkpoint,
  ].join("\n");
}

export interface HeartbeatDependencies {
  clock: Clock;
  storage: Storage;
  settings(): { enabled: boolean; everyMinutes: number };
  botIds(): string[];
  runs(): Run[];
  isBusy(botId: string): boolean;
  wake(input: HeartbeatWake & { prompt: string }): { runId: string } | null;
}

export class Heartbeat {
  private cancelTick: (() => void) | null = null;
  private running = false;
  private ledger: HeartbeatLedger;

  constructor(private readonly deps: HeartbeatDependencies) {
    const raw = deps.storage.readJson<HeartbeatLedger>(HEARTBEATS_FILE, {});
    this.ledger = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private schedule(): void {
    const minutes = this.deps.settings().everyMinutes || HEARTBEAT_DEFAULT_MINUTES;
    this.cancelTick = this.deps.clock.setTimeout(() => {
      if (!this.running) return;
      try {
        this.tick();
      } catch (error) {
        console.warn(`Local BizOS: heartbeat failed — ${error instanceof Error ? error.message : String(error)}`);
      }
      this.schedule();
    }, minutes * 60_000);
  }

  /** One pass over every agent. Returns the runs it started. */
  tick(): string[] {
    const settings = this.deps.settings();
    const now = this.deps.clock.now();
    if (!settings.enabled || !withinHeartbeatWindow(now)) return [];
    const runs = this.deps.runs();
    const started: string[] = [];
    for (const botId of this.deps.botIds()) {
      const wake = heartbeatWakeFor({ botId, now, busy: this.deps.isBusy(botId), runs, ledger: this.ledger });
      if (!wake) continue;
      const result = this.deps.wake({ ...wake, prompt: heartbeatPrompt(wake) });
      if (!result) continue;
      const previous = this.ledger[wake.taskKey];
      this.ledger[wake.taskKey] = {
        wakes: (previous?.wakes ?? 0) + 1,
        lastAt: now.toISOString(),
        ...(previous?.nudged || wake.kind === "nudge" ? { nudged: true } : {}),
      };
      started.push(result.runId);
    }
    if (started.length) this.persist(now);
    return started;
  }

  private persist(now: Date): void {
    // The ledger only matters inside the task-age window; older keys go.
    for (const [key, entry] of Object.entries(this.ledger)) {
      if (now.getTime() - Date.parse(entry.lastAt) > 3 * HEARTBEAT_MAX_TASK_AGE_MS) delete this.ledger[key];
    }
    this.deps.storage.writeJson(HEARTBEATS_FILE, this.ledger);
  }
}
