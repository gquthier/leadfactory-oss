import type { Clock } from "./clock.js";
import { newRunId } from "./ids.js";
import type { Storage } from "./storage.js";
import type { Run, RunState } from "./types.js";

export const RUNS_FILE = "runs.json";
const MAX_RUNS = 200;

const TERMINAL: RunState[] = ["completed", "failed", "cancelled"];

export class RunStore {
  private runs: Run[];

  constructor(
    private readonly storage: Storage,
    private readonly clock: Clock,
  ) {
    const raw = this.storage.readJson<Run[]>(RUNS_FILE, []);
    // A run that was in flight when the app was killed cannot continue: its
    // codex process is gone. Reporting it as still working would be a lie.
    // Its in_progress task is flagged instead, so the next start can resume
    // it once from its checkpoint (`Dispatcher.resumeInterruptedTasks`).
    this.runs = (Array.isArray(raw) ? raw : []).map((run) =>
      TERMINAL.includes(run.state) || run.state === "queued" ? run : { ...run, state: "cancelled", endedAt: run.endedAt ?? run.startedAt,
        ...(run.task ? { task: { ...run.task, status: "interrupted" as const } } : {}),
        ...(run.task?.status === "in_progress" ? { interruption: "shutdown" as const } : {}),
      },
    );
  }

  private persist(runs: Run[] = this.runs): void {
    const next = runs.length > MAX_RUNS ? runs.slice(-MAX_RUNS) : runs;
    this.storage.writeJson(RUNS_FILE, next);
    this.runs = next;
  }

  start(input: { id?: string; threadId: string; botId: string; routineId?: string; heartbeat?: boolean; state?: RunState }): Run {
    const existing=input.id ? this.get(input.id) : undefined;
    if(existing)return existing;
    const run: Run = {
      id: input.id ?? newRunId(),
      threadId: input.threadId,
      botId: input.botId,
      state: input.state ?? "working",
      startedAt: this.clock.nowIso(),
      ...(input.routineId ? { routineId: input.routineId } : {}),
      ...(input.heartbeat ? { heartbeat: true } : {}),
    };
    this.persist([...this.runs, run]);
    return { ...run };
  }

  update(id: string, patch: Partial<Pick<Run, "state" | "error" | "messageId" | "task" | "inference" | "usage" | "outcome" | "interruption" | "restartResumes">>): Run | undefined {
    const index = this.runs.findIndex((run) => run.id === id);
    const current = this.runs[index];
    if (index < 0 || !current) return undefined;
    const next: Run = {
      ...current,
      ...patch,
      updatedAt: this.clock.nowIso(),
      ...(patch.state && TERMINAL.includes(patch.state) ? { endedAt: this.clock.nowIso() } : {}),
    };
    const runs = [...this.runs];
    runs[index] = next;
    this.persist(runs);
    return { ...next };
  }

  get(id: string): Run | undefined {
    const found = this.runs.find((run) => run.id === id);
    return found ? { ...found } : undefined;
  }

  removeThread(threadId: string): void {
    this.runs = this.runs.filter(run => run.threadId !== threadId);
    this.persist();
  }

  active(threadId: string): string[] {
    return this.runs.filter((run) => run.threadId === threadId && !TERMINAL.includes(run.state)).map((run) => run.id);
  }

  list(limit = 50): Run[] {
    return this.runs.slice(-Math.max(1, Math.min(limit, MAX_RUNS))).reverse().map((run) => ({ ...run }));
  }
}
