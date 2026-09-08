import type { Clock } from "./clock.js";
import { newId } from "./ids.js";
import type { Storage } from "./storage.js";
import type { CreateRoutineInput, Routine, RoutineTrigger } from "./types.js";

export const ROUTINES_FILE = "routines.json";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A refusal the bridge can name. `PayloadError`-style: `ipc.runHandler`
 * turns `name` into the envelope's `code`, so the renderer can tell an
 * unschedulable trigger from a disk failure. */
export class RoutineTriggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_routine_trigger";
  }
}

export const WEBHOOK_REFUSAL =
  "Webhook routines are not supported: nothing in Local BizOS listens for one. Use a schedule (once, daily or interval).";

/** Legacy `once` rows were `{time, date}` in local time. They predate the
 * normalized `{at}` instant and are still on disk, so they are converted
 * rather than dropped. */
function legacyOnceInstant(record: Record<string, unknown>): string | null {
  const time = typeof record.time === "string" && TIME.test(record.time) ? record.time : null;
  const date = typeof record.date === "string" && DATE.test(record.date) ? record.date : null;
  if (!time) return null;
  const day = date ?? new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${day}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface NormalizeTriggerOptions {
  /** When given, a `once` trigger must land strictly after this instant: a
   * one-off in the past can never fire, and an armed-looking routine that
   * never runs is the failure this whole shape exists to prevent. */
  now?: Date;
}

/** Coerce anything into the one trigger shape the scheduler can honour, or
 * `null`. Throws `RoutineTriggerError` for `webhook`, which is not merely
 * malformed — it is a shape this runtime deliberately removed. */
export function normalizeTrigger(raw: unknown, options: NormalizeTriggerOptions = {}): RoutineTrigger | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.kind === "webhook") throw new RoutineTriggerError(WEBHOOK_REFUSAL);
  if (record.kind !== "schedule") return null;
  const frequency = record.frequency;

  if (frequency === "interval") {
    if (typeof record.everyMinutes !== "number" || !Number.isFinite(record.everyMinutes)) return null;
    return {
      kind: "schedule",
      frequency: "interval",
      everyMinutes: Math.min(Math.max(Math.round(record.everyMinutes), 5), 60 * 24 * 7),
    };
  }

  if (frequency === "daily") {
    if (typeof record.time !== "string" || !TIME.test(record.time)) return null;
    const weekdays = Array.isArray(record.weekdays)
      ? [
          ...new Set(
            record.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6),
          ),
        ].sort()
      : undefined;
    return {
      kind: "schedule",
      frequency: "daily",
      time: record.time,
      ...(weekdays && weekdays.length ? { weekdays } : {}),
    };
  }

  if (frequency === "once") {
    const raw_at = typeof record.at === "string" ? record.at : legacyOnceInstant(record);
    if (!raw_at) return null;
    const at = new Date(raw_at);
    if (Number.isNaN(at.getTime())) return null;
    if (options.now && at.getTime() <= options.now.getTime()) return null;
    return { kind: "schedule", frequency: "once", at: at.toISOString() };
  }

  return null;
}

/** `normalizeTrigger` for a row already on disk: never throws, so one bad
 * routine cannot brick the store. */
function readTrigger(raw: unknown): RoutineTrigger | null {
  try {
    return normalizeTrigger(raw);
  } catch {
    return null;
  }
}

export class RoutineStore {
  private routines: Routine[];

  constructor(
    private readonly storage: Storage,
    private readonly clock: Clock,
  ) {
    const raw = this.storage.readJson<Routine[]>(ROUTINES_FILE, []);
    const rows = (Array.isArray(raw) ? raw : []).filter(
      (routine) => routine && typeof routine.id === "string" && typeof routine.botId === "string",
    );
    const kept: Routine[] = [];
    for (const routine of rows) {
      const trigger = readTrigger(routine.trigger);
      if (!trigger) {
        // Webhook rows (and anything else unschedulable) were drawn as armed
        // routines that could never fire. They are dropped, out loud.
        console.warn(`Local BizOS: dropping routine ${routine.id} — its trigger cannot be scheduled`);
        continue;
      }
      // `running` is process state, not durable state.
      kept.push({ ...routine, trigger, running: false });
    }
    this.routines = kept;
    if (kept.length !== rows.length) this.persist();
  }

  private persist(): void {
    this.storage.writeJson(ROUTINES_FILE, this.routines);
  }

  list(botId?: string): Routine[] {
    return this.routines.filter((routine) => !botId || routine.botId === botId).map((routine) => ({ ...routine }));
  }

  get(id: string): Routine | undefined {
    const found = this.routines.find((routine) => routine.id === id);
    return found ? { ...found } : undefined;
  }

  create(input: CreateRoutineInput): Routine {
    const trigger = normalizeTrigger(input.trigger, { now: this.clock.now() });
    if (!trigger) throw new RoutineTriggerError("invalid routine trigger");
    const name = String(input.name ?? "").trim().slice(0, 80);
    const prompt = String(input.prompt ?? "").trim().slice(0, 6000);
    if (!name || !prompt || !input.botId) throw new Error("a routine needs a bot, a name and a prompt");
    const routine: Routine = {
      id: newId("rtn"),
      botId: input.botId,
      name,
      prompt,
      trigger,
      enabled: input.enabled !== false,
      running: false,
      createdAt: this.clock.nowIso(),
      updatedAt: this.clock.nowIso(),
    };
    this.routines.push(routine);
    this.persist();
    return { ...routine };
  }

  update(id: string, patch: Partial<CreateRoutineInput> & { enabled?: boolean }): Routine {
    const index = this.routines.findIndex((routine) => routine.id === id);
    const current = this.routines[index];
    if (index < 0 || !current) throw new Error("routine not found");
    const trigger = patch.trigger
      ? normalizeTrigger(patch.trigger, { now: this.clock.now() })
      : current.trigger;
    if (!trigger) throw new RoutineTriggerError("invalid routine trigger");
    const lastVersion = Math.max(...[current.createdAt, current.updatedAt, current.lastRunAt]
      .map((at) => at ? Date.parse(at) : 0).filter(Number.isFinite));
    const next: Routine = {
      ...current,
      ...(patch.name ? { name: String(patch.name).trim().slice(0, 80) } : {}),
      ...(patch.prompt ? { prompt: String(patch.prompt).trim().slice(0, 6000) } : {}),
      ...(patch.botId ? { botId: patch.botId } : {}),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled === true }),
      trigger,
      updatedAt: new Date(Math.max(this.clock.now().getTime(), lastVersion + 1)).toISOString(),
    };
    if (patch.trigger && JSON.stringify(trigger) !== JSON.stringify(current.trigger)) delete next.nextRunAt;
    this.routines[index] = next;
    this.persist();
    return { ...next };
  }

  /** Scheduler bookkeeping — `nextRunAt` is persisted so a routine whose
   * window passed while the app was closed runs once, late, rather than
   * being silently skipped. */
  setSchedule(
    id: string,
    patch: { nextRunAt?: string | null; lastRunAt?: string; running?: boolean; enabled?: boolean },
  ): void {
    const index = this.routines.findIndex((routine) => routine.id === id);
    const current = this.routines[index];
    if (index < 0 || !current) return;
    const next: Routine = { ...current, ...patch, nextRunAt: current.nextRunAt };
    if (patch.nextRunAt === null) delete next.nextRunAt;
    else if (patch.nextRunAt) next.nextRunAt = patch.nextRunAt;
    this.routines[index] = next;
    this.persist();
  }

  remove(id: string): void {
    const before = this.routines.length;
    this.routines = this.routines.filter((routine) => routine.id !== id);
    if (this.routines.length !== before) this.persist();
  }

  removeForBot(botId: string): void {
    const before = this.routines.length;
    this.routines = this.routines.filter((routine) => routine.botId !== botId);
    if (this.routines.length !== before) this.persist();
  }
}
