import { redactSecretsInText } from "./redact.js";

/** An agent's reported checkpoint, not an independent proof of its claims. */
export interface TaskCheckpoint {
  objective: string;
  status: "in_progress" | "completed" | "blocked" | "interrupted";
  summary: string;
  next_step: string;
  evidence: string[];
}

/**
 * The autonomy budget. An in_progress checkpoint that keeps moving is
 * continued automatically until one of these runs out — a TIME budget first,
 * because "three more turns" stopped long tasks halfway while a turn that
 * loops without progress is already stopped by the unchanged-checkpoint rule.
 */
export const MAX_TASK_CONTINUATIONS = 20;
export const MAX_TASK_WALL_MS = 45 * 60_000;
/** A task interrupted by an app shutdown is resumed at the next start when its
 * run was last touched this recently… */
export const RESTART_RESUME_WINDOW_MS = 12 * 60 * 60_000;
/** …and at most this many times in a row, whatever the number of restarts:
 * a task that crashes the app must not relaunch itself forever. */
export const MAX_RESTART_RESUMES = 2;
/** What a paused task waits for when an approval expired unanswered. */
export const WAITING_FOR_APPROVAL = "waiting for your approval";

export function parseTaskCheckpoint(raw: unknown): TaskCheckpoint {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid task checkpoint");
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).some(key => !["objective", "status", "summary", "next_step", "evidence"].includes(key))) {
    throw new Error("Unknown task checkpoint field");
  }
  const text = (name: string, limit: number, required = true): string => {
    const value = row[name];
    if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new Error(`Invalid ${name}`);
    return redactSecretsInText(value.trim());
  };
  if (!["in_progress", "completed", "blocked"].includes(String(row.status))) throw new Error("Invalid task status");
  if (!Array.isArray(row.evidence) || row.evidence.length > 12 || row.evidence.some(value => typeof value !== "string" || !value.trim() || value.length > 1000)) {
    throw new Error("Invalid task evidence");
  }
  if (row.status === "completed" && !row.evidence.length) throw new Error("Completion requires evidence from a tool result or checked artifact");
  return {
    objective: text("objective", 2000), status: row.status as TaskCheckpoint["status"],
    summary: text("summary", 2000), next_step: text("next_step", 2000, row.status !== "completed"),
    evidence: row.evidence.map(value => redactSecretsInText(value.trim())),
  };
}

export function taskRecord(task: TaskCheckpoint): string {
  // JSON keeps untrusted text quoted, including newlines and transcript markers.
  return JSON.stringify(task).replaceAll("<", "\\u003c");
}
