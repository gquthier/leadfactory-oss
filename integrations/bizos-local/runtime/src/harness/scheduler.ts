// Local routines. They only run while Local BizOS is open — this is a
// desktop app, not a server — so the scheduler says so honestly: a window
// that passed while the app was closed runs ONCE, late, and the prompt says
// so, never as a silent skip and never as a burst of catch-up runs.
import type { Clock } from "./clock.js";
import type { RoutineStore } from "./routines.js";
import type { Routine, RoutineTrigger } from "./types.js";

export const TICK_MS = 30_000;

function atLocalTime(day: Date, time: string): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  const next = new Date(day);
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return next;
}

/** The next moment a trigger should fire strictly after `from`, or `null`
 * when it never will again (a `once` whose moment has passed). */
export function computeNextRun(trigger: RoutineTrigger, from: Date): Date | null {
  if (trigger.frequency === "interval") {
    return new Date(from.getTime() + trigger.everyMinutes * 60_000);
  }
  if (trigger.frequency === "once") {
    const at = new Date(trigger.at);
    if (Number.isNaN(at.getTime())) return null;
    return at.getTime() > from.getTime() ? at : null;
  }
  const weekdays = trigger.weekdays?.length ? new Set(trigger.weekdays) : null;
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = new Date(from);
    day.setDate(day.getDate() + offset);
    const at = atLocalTime(day, trigger.time);
    if (!at || at.getTime() <= from.getTime()) continue;
    if (weekdays && !weekdays.has(at.getDay())) continue;
    return at;
  }
  return null;
}

export interface SchedulerDependencies {
  routines: RoutineStore;
  clock: Clock;
  /** Start a routine turn. Returns the run it started, so a manual run and
   * a scheduled one are literally the same code path — `runNow` used to
   * bypass every piece of bookkeeping below. */
  fire(input: { routine: Routine; missed: boolean }): Promise<{ runId: string } | undefined> | ({ runId: string } | undefined);
}

export class Scheduler {
  private cancelTick: (() => void) | null = null;
  private running = false;
  /**
   * `routineId → the fire that owns it`, held for the WHOLE run.
   *
   * One routine, one run at a time. Nothing consulted `routine.running`, so
   * "Run now" during a run started a second one, and the first completion then
   * announced `running: false` while the second was still going. The mutex is
   * held HERE rather than in the store because the store is a file: two ticks
   * in the same millisecond both read `false` from it.
   *
   * How long "the whole run" is, is the part that was wrong. The lock used to
   * be dropped in a `finally` around `deps.fire()` — which reads as "held until
   * the turn is done" and is not: in production `fire` is
   * `dispatch.runRoutine`, which ENQUEUES and returns `{runId}` in the same
   * tick. So the mutex was released while the turn was still waiting in the
   * queue, and a second Run now (or the next 30-second tick) started another
   * one. The test that claimed otherwise used a `fire` that blocked until the
   * run finished — a contract the dispatcher has never had.
   *
   * So the token is now held until the run it started reaches a TERMINAL state:
   * the dispatcher calls `settle(routineId, runId)` on completion, on failure,
   * and when a queued turn is cancelled by Stop. `runId` is what makes that
   * safe — a late terminal event from an earlier run cannot unlock the run that
   * replaced it.
   */
  private readonly inFlight = new Map<
    string,
    {
      token: symbol;
      runId?: string;
      /** Terminal reports that arrived BEFORE the run had a name — see
       * `settle`. Resolved against the real `runId` in `run`. */
      settledEarly?: Set<string>;
    }
  >();

  constructor(private readonly deps: SchedulerDependencies) {}

  /** Bring every schedule up to date, then start ticking.
   *
   * A routine whose `nextRunAt` is already in the past was due while the
   * app was closed: it fires ONCE, flagged as missed, and is then
   * rescheduled from now. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.catchUp();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private schedule(): void {
    this.cancelTick = this.deps.clock.setTimeout(() => {
      if (!this.running) return;
      this.tick();
      this.schedule();
    }, TICK_MS);
  }

  private catchUp(): void {
    const now = this.deps.clock.now();
    for (const routine of this.deps.routines.list()) {
      if (!routine.enabled) continue;
      if (!routine.nextRunAt) {
        const next = computeNextRun(routine.trigger, now);
        this.deps.routines.setSchedule(routine.id, {
          nextRunAt: next ? next.toISOString() : null,
          // A routine with no next window is not armed. Leaving it enabled
          // drew a switch that was on and a schedule that never came.
          ...(next ? {} : { enabled: false }),
        });
        continue;
      }
      if (new Date(routine.nextRunAt).getTime() <= now.getTime()) this.fire(routine, true);
    }
  }

  tick(): void {
    const now = this.deps.clock.now();
    for (const routine of this.deps.routines.list()) {
      if (!routine.enabled || !routine.nextRunAt) continue;
      if (new Date(routine.nextRunAt).getTime() <= now.getTime()) this.fire(routine, false);
    }
  }

  /** The manual "Run now" button. Same bookkeeping, same fire. */
  async runNow(id: string): Promise<{ runId: string } | undefined> {
    const routine = this.deps.routines.get(id);
    if (!routine) throw new Error("routine not found");
    if (this.inFlight.has(routine.id)) throw new Error("that routine is already running");
    return this.run(routine, false);
  }

  /**
   * The dispatcher reporting that a routine's run is over — completed, failed,
   * or cancelled while it was still queued. This is what releases the mutex,
   * and it is the ONLY thing that does once a turn is in flight.
   *
   * `runId` is checked against the one that holds the lock: a terminal event
   * arriving late, for a run that has already been superseded, must not unlock
   * the run that is going now, nor tell the store it stopped.
   */
  settle(routineId: string, runId?: string): void {
    const held = this.inFlight.get(routineId);
    if (held && runId !== undefined && held.runId === undefined) {
      // The lock is taken and the run has not said its name yet: `deps.fire` is
      // still enqueueing. Nothing here can tell whether this report belongs to
      // the run being started or to the one before it — and `runId` matched
      // ANYTHING while it was `undefined`, so a late report from an earlier run
      // unlocked a turn that had just begun and the next tick started a second
      // one. It is held instead, and `run` answers it the moment it knows the
      // name: a report for a run the dispatcher refused inside that same window
      // still frees the routine, which is what keeps this from being a lock
      // nobody can open.
      (held.settledEarly ??= new Set()).add(runId);
      return;
    }
    if (held && runId !== undefined && held.runId !== undefined && held.runId !== runId) return;
    if (held) this.inFlight.delete(routineId);
    this.deps.routines.setSchedule(routineId, { running: false });
  }

  /**
   * Fire a routine, exactly once at a time.
   *
   * Two things used to leave a routine pinned to `running: true` until the app
   * was restarted, with nothing in the product able to clear it:
   *   · the dispatcher REFUSES a turn when the thread's queue is full — it
     *     throws `QUEUE_FULL_NOTE` — and both tick paths call this with `void`,
   *     so that became an unhandled promise rejection in the Electron main
   *     process and the flag stayed on;
   *   · a queued turn cancelled by Stop never reached `finish()` (fixed in the
   *     dispatcher, which now reports it idle).
   *
   * Ownership is a token, not a boolean: only the fire that SET `running`
   * clears it, so a late failure from an earlier run cannot un-flag a run that
   * started after it.
   */
  /** A scheduled fire is nobody's promise: `void this.run(...)` turned the
   * dispatcher's "the queue is full" refusal into an unhandled rejection in the
   * Electron main process. It is reported where a routine's failures belong —
   * on the routine — and swallowed here. */
  private fire(routine: Routine, missed: boolean): void {
    void this.run(routine, missed).catch(() => {
      this.deps.routines.setSchedule(routine.id, { running: false });
    });
  }

  private async run(routine: Routine, missed: boolean): Promise<{ runId: string } | undefined> {
    if (this.inFlight.has(routine.id)) return undefined;
    const token = Symbol(routine.id);
    this.inFlight.set(routine.id, { token });
    const now = this.deps.clock.now();
    const next = computeNextRun(routine.trigger, now);
    this.deps.routines.setSchedule(routine.id, {
      lastRunAt: now.toISOString(),
      nextRunAt: next ? next.toISOString() : null,
      // `running` is true from here until the dispatcher reports the run
      // finished — the flag used to be permanently false, so the UI never
      // showed a routine that was actually working.
      running: true,
      // A `once` routine has no next window. Leaving it enabled with no
      // date would make it look armed forever.
      ...(next ? {} : { enabled: false }),
    });
    try {
      const started = await this.deps.fire({ routine, missed });
      // Nothing started (the bot is gone): the lock goes back immediately, or
      // the routine could never be run again without a restart.
      if (!started) {
        this.release(routine.id, token);
        return undefined;
      }
      // From here the DISPATCHER owns the lock, and holds it until it reports
      // this exact run settled. Nothing is released in a `finally`: `fire`
      // returning is the turn being QUEUED, not the turn being over.
      const held = this.inFlight.get(routine.id);
      if (held?.token === token) {
        if (held.settledEarly?.has(started.runId)) {
          // This run was already over before its name got here (the dispatcher
          // refuses a turn — a deleted bot, a Stop — inside the enqueue). The
          // lock it was going to hold is handed back now, or the routine would
          // stay locked until the app restarts.
          this.release(routine.id, token);
          return started;
        }
        held.runId = started.runId;
      }
      return started;
    } catch (error) {
      // The turn was refused (a full queue, a bot that vanished). The routine
      // is not running, and saying so is the whole job here.
      this.release(routine.id, token);
      throw error;
    }
  }

  private release(routineId: string, token: symbol): void {
    if (this.inFlight.get(routineId)?.token !== token) return;
    this.inFlight.delete(routineId);
    this.deps.routines.setSchedule(routineId, { running: false });
  }
}
