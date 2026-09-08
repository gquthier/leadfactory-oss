// Real Claude plan usage, from the account's own OAuth endpoint.
//
// `GET /api/oauth/usage` is what the CLI's own `/usage` reads: a five-hour
// window, a seven-day one, and — on accounts that have them — per-model
// seven-day windows. Measured 2026-09-06 on a Max 20x subscription:
// `utilization` is already a percentage, `resets_at` an ISO instant, and a
// window that does not apply comes back as a bare `null`.
//
// The response also carries codenamed windows for features this account may
// not have; those are ignored rather than shown as limits nobody can read.
import { anthropicOauthGet, planTypeLabel, readClaudeOauth, type ClaudeOauth } from "./claude-credentials.js";
import type { PlanUsage, UsageWindow } from "./codex-usage.js";

/** The windows a person can act on, and how they are named on the plan row. */
const CLAUDE_WINDOWS: ReadonlyArray<{ key: string; label: string; windowMinutes: number; limitName: string | null }> = [
  { key: "five_hour", label: "5h", windowMinutes: 300, limitName: null },
  { key: "seven_day", label: "weekly", windowMinutes: 10080, limitName: null },
  { key: "seven_day_opus", label: "weekly", windowMinutes: 10080, limitName: "opus" },
  { key: "seven_day_sonnet", label: "weekly", windowMinutes: 10080, limitName: "sonnet" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function instantOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** The `/api/oauth/usage` body → one usage snapshot. `null` when the body is
 * not an object; an account with no applicable window answers no windows. */
export function parseClaudeUsage(body: unknown, oauth: ClaudeOauth | null, nowIso: string): PlanUsage | null {
  if (!isRecord(body)) return null;
  const windows: UsageWindow[] = [];
  let reached = false;
  for (const spec of CLAUDE_WINDOWS) {
    const raw = body[spec.key];
    if (!isRecord(raw)) continue;
    if (typeof raw.utilization !== "number" || !Number.isFinite(raw.utilization)) continue;
    const usedPct = Math.max(0, Math.min(100, raw.utilization));
    if (usedPct >= 100) reached = true;
    if (typeof raw.locked_reason === "string" && raw.locked_reason) reached = true;
    windows.push({
      label: spec.label,
      windowMinutes: spec.windowMinutes,
      usedPct,
      resetsAt: instantOrNull(raw.resets_at),
      limitName: spec.limitName,
    });
  }
  return {
    at: nowIso,
    planType: planTypeLabel(oauth),
    // The endpoint names no address, and the plan row already carries the
    // hint `claude auth status` gave.
    email: null,
    reached,
    windows,
  };
}

/** Read this plan's token, ask Anthropic what it has spent, and answer a
 * snapshot. `null` on a missing/expired token, a refusal, a wall or a
 * network failure — the caller keeps the usage it already showed. */
export async function readClaudeUsage(input: {
  configDir?: string;
  homeDir: string;
  environment?: NodeJS.ProcessEnv;
  nowIso?: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PlanUsage | null> {
  const oauth = await readClaudeOauth({
    ...(input.configDir ? { configDir: input.configDir } : {}),
    homeDir: input.homeDir,
    ...(input.environment ? { environment: input.environment } : {}),
  });
  if (!oauth) return null;
  const body = await anthropicOauthGet({
    path: "/api/oauth/usage",
    accessToken: oauth.accessToken,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  if (body === null) return null;
  return parseClaudeUsage(body, oauth, (input.nowIso ?? (() => new Date().toISOString()))());
}
