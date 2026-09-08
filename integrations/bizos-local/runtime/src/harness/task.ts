import { redactSecretsInText } from "./redact.js";

/** An agent's reported checkpoint, not an independent proof of its claims. */
export interface TaskCheckpoint {
  objective: string;
  status: "in_progress" | "completed" | "blocked" | "interrupted";
  summary: string;
  next_step: string;
  evidence: string[];
}

export const MAX_TASK_CONTINUATIONS = 3;

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
