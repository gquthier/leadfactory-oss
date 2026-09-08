// Transient-failure classification + capped backoff. Ported from
// OpenMausBot `server/drivers/retry.ts` (Apache-2.0). Pure functions: the
// driver keeps owning process lifetime while sharing one policy — a
// provider hiccup (429/5xx/overloaded/reset) is retried, an auth or
// request-shape problem never is.

export const RETRY_MAX_ATTEMPTS = 3;

/** Backoff before retry N: ~1s / ~3s / ~8s. */
export const BACKOFF_BASE_MS = [1_000, 3_000, 8_000] as const;

export interface ErrorClassification {
  transient: boolean;
  reason: string;
}

const TRANSIENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(?:429|rate.?limit|too many requests)\b/i, reason: "rate_limited" },
  { pattern: /\boverloaded\b|\bcapacity\b/i, reason: "overloaded" },
  {
    pattern: /\b5\d{2}\b|\binternal server error\b|\bbad gateway\b|\bservice unavailable\b/i,
    reason: "server_error",
  },
  {
    pattern:
      /\b(?:econnreset|econnrefused|epipe|etimedout|eai_again|connection reset|connection refused|socket hang up|network error|fetch failed)\b/i,
    reason: "connection_reset",
  },
  { pattern: /\btimeout(ed)?\b|\btimed? out\b/i, reason: "timeout" },
];

const TERMINAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(?:40[13]|unauthorized|forbidden|invalid api key|missing bearer|authentication required|not logged in|logged out)\b/i,
    reason: "auth",
  },
  { pattern: /\b402\b|\bquota\b|\bbilling\b|\bsubscription\b/i, reason: "quota" },
  {
    pattern: /\bmodel not found\b|\bunknown model\b|\bdoes not exist for model\b|\bunsupported model\b/i,
    reason: "unknown_model",
  },
  { pattern: /\b400\b|\b422\b|\binvalid request\b|\bmalformed\b|\bunexpected status\b/i, reason: "invalid_request" },
  { pattern: /\b404\b|\bno such thread\b|\bthread gone\b/i, reason: "not_found" },
  { pattern: /\b(?:interrupted|cancelled by user)\b/i, reason: "interrupted" },
];

export function classifyError(error: Error | { text: string } | null): ErrorClassification {
  const text = !error ? "" : error instanceof Error ? error.message : error.text;
  for (const { pattern, reason } of TERMINAL_PATTERNS) {
    if (pattern.test(text)) return { transient: false, reason };
  }
  for (const { pattern, reason } of TRANSIENT_PATTERNS) {
    if (pattern.test(text)) return { transient: true, reason };
  }
  return { transient: false, reason: "unknown" };
}

/** Capped exponential delay with ±25% jitter, in milliseconds. */
export function computeBackoff(attempt: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(attempt, 0), BACKOFF_BASE_MS.length - 1);
  const base = BACKOFF_BASE_MS[index] ?? BACKOFF_BASE_MS[BACKOFF_BASE_MS.length - 1] ?? 1_000;
  const jitter = base * 0.25;
  return Math.round(base - jitter + random() * jitter * 2);
}
