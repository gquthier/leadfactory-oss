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
    // A run that was in flight when the app was killed cannot resume: its
    // codex process is gone. Reporting it as still working would be a lie.
    this.runs = (Array.isArray(raw) ? raw : []).map((run) =>
      TERMINAL.includes(run.state) ? run : { ...run, state: "cancelled", endedAt: run.endedAt ?? run.startedAt,
        ...(run.task ? { task: { ...run.task, status: "interrupted" as const } } : {}),
      },
    );
  }

  private persist(): void {
    if (this.runs.length > MAX_RUNS) this.runs = this.runs.slice(-MAX_RUNS);
    this.storage.writeJson(RUNS_FILE, this.runs);
  }

  start(input: { threadId: string; botId: string; routineId?: string; state?: RunState }): Run {
    const run: Run = {
      id: newRunId(),
      threadId: input.threadId,
      botId: input.botId,
      state: input.state ?? "working",
      startedAt: this.clock.nowIso(),
      ...(input.routineId ? { routineId: input.routineId } : {}),
    };
    this.runs.push(run);
    this.persist();
    return { ...run };
  }

  update(id: string, patch: Partial<Pick<Run, "state" | "error" | "messageId" | "task">>): Run | undefined {
    const index = this.runs.findIndex((run) => run.id === id);
    const current = this.runs[index];
    if (index < 0 || !current) return undefined;
    const next: Run = {
      ...current,
      ...patch,
      ...(patch.state && TERMINAL.includes(patch.state) ? { endedAt: this.clock.nowIso() } : {}),
    };
    this.runs[index] = next;
    this.persist();
    return { ...next };
  }

  get(id: string): Run | undefined {
    const found = this.runs.find((run) => run.id === id);
    return found ? { ...found } : undefined;
  }

  active(threadId: string): string[] {
    return this.runs.filter((run) => run.threadId === threadId && !TERMINAL.includes(run.state)).map((run) => run.id);
  }

  list(limit = 50): Run[] {
    return this.runs.slice(-Math.max(1, Math.min(limit, MAX_RUNS))).reverse().map((run) => ({ ...run }));
  }
}
