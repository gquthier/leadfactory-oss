// Real Codex usage, from the CLI itself.
//
// `codex app-server` answers `account/read` (email, plan) and
// `account/rateLimits/read` (the same windows the TUI's /status shows: a
// primary window, a secondary one, and per-limit breakdowns). Measured
// 2026-09-05 on codex-cli 0.154: `primary.usedPercent`, `windowDurationMins`,
// `resetsAt` (epoch seconds), plus `rateLimitReachedType` when a wall is hit.
// Nothing here writes; the CLI is started, asked, and stopped.
import { spawn } from "node:child_process";
import { cleanChildEnvironment } from "./child-env.js";
import { augmentedPath } from "./env-path.js";

export interface UsageWindow {
  /** "5h", "weekly", "daily" or the raw duration when it is none of those. */
  label: string;
  windowMinutes: number;
  usedPct: number;
  resetsAt: string | null;
  /** The limit this window belongs to, when the account has several. */
  limitName: string | null;
}

export interface PlanUsage {
  at: string;
  planType: string | null;
  email: string | null;
  /** The account is at a wall right now. */
  reached: boolean;
  windows: UsageWindow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function windowLabel(minutes: number): string {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "weekly";
  if (minutes === 1440) return "daily";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
}

function windowOf(raw: unknown, limitName: string | null): UsageWindow | null {
  if (!isRecord(raw)) return null;
  const usedPct = typeof raw.usedPercent === "number" ? raw.usedPercent : null;
  const minutes = typeof raw.windowDurationMins === "number" ? raw.windowDurationMins : null;
  if (usedPct === null || minutes === null) return null;
  const resets = typeof raw.resetsAt === "number" ? new Date(raw.resetsAt * 1000).toISOString() : null;
  return { label: windowLabel(minutes), windowMinutes: minutes, usedPct: Math.max(0, Math.min(100, usedPct)), resetsAt: resets, limitName };
}

/** The `account/rateLimits/read` result and the `account/read` result → one usage snapshot. */
export function parseCodexUsage(rateLimits: unknown, account: unknown, nowIso: string): PlanUsage | null {
  if (!isRecord(rateLimits)) return null;
  const windows: UsageWindow[] = [];
  const main = isRecord(rateLimits.rateLimits) ? rateLimits.rateLimits : null;
  const seen = new Set<string>();
  const push = (window: UsageWindow | null) => {
    if (!window) return;
    const key = `${window.limitName ?? ""}|${window.windowMinutes}`;
    if (seen.has(key)) return;
    seen.add(key);
    windows.push(window);
  };
  if (main) {
    const name = typeof main.limitName === "string" ? main.limitName : null;
    push(windowOf(main.primary, name));
    push(windowOf(main.secondary, name));
  }
  if (isRecord(rateLimits.rateLimitsByLimitId)) {
    for (const entry of Object.values(rateLimits.rateLimitsByLimitId)) {
      if (!isRecord(entry)) continue;
      const name = typeof entry.limitName === "string" ? entry.limitName : null;
      push(windowOf(entry.primary, name));
      push(windowOf(entry.secondary, name));
    }
  }
  const accountRow = isRecord(account) && isRecord(account.account) ? account.account : null;
  const planType =
    (accountRow && typeof accountRow.planType === "string" ? accountRow.planType : null)
    ?? (main && typeof main.planType === "string" ? main.planType : null);
  return {
    at: nowIso,
    planType,
    email: accountRow && typeof accountRow.email === "string" ? accountRow.email : null,
    reached: Boolean(main && typeof main.rateLimitReachedType === "string" && main.rateLimitReachedType),
    windows,
  };
}

/** Start `codex app-server` under this plan's home, ask, stop. `null` when the CLI does not answer. */
export function readCodexUsage(input: {
  cli: string;
  codexHome?: string;
  environment?: NodeJS.ProcessEnv;
  nowIso?: () => string;
  timeoutMs?: number;
}): Promise<PlanUsage | null> {
  const base = input.environment ?? process.env;
  const environment = cleanChildEnvironment(base as Record<string, string | undefined>, augmentedPath(base));
  if (input.codexHome) environment.CODEX_HOME = input.codexHome;
  const timeoutMs = input.timeoutMs ?? 12_000;
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const answers = new Map<number, unknown>();
    let child: ReturnType<typeof spawn>;
    const finish = (value: PlanUsage | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        child?.kill("SIGTERM");
      } catch {
        /* gone */
      }
      resolve(value);
    };
    const deadline = setTimeout(() => finish(null), timeoutMs);
    try {
      child = spawn(input.cli, ["app-server"], { env: environment as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      finish(null);
      return;
    }
    const send = (message: unknown): void => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        /* close settles */
      }
    };
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof message.id !== "number") continue;
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          send({ jsonrpc: "2.0", id: 2, method: "account/read", params: { refreshToken: false } });
          send({ jsonrpc: "2.0", id: 3, method: "account/rateLimits/read", params: {} });
          continue;
        }
        answers.set(message.id, "result" in message ? message.result : null);
        if (answers.has(2) && answers.has(3)) {
          finish(parseCodexUsage(answers.get(3), answers.get(2), (input.nowIso ?? (() => new Date().toISOString()))()));
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "localbizos-usage", title: "BizOS", version: "1" } } });
  });
}
