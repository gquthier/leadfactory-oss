// Keeping credentials out of the protocol tee.
//
// Ported from OpenMausBot `server/redact.ts` (Apache-2.0). The native log
// keeps the SHAPE of every message and loses the VALUES: a redacted entry
// still says a token was passed, under which name, and how long it was.

const SECRET_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "authorization",
  "auth_token",
  "cookie",
];

function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_KEY_PARTS.some((part) => lower.includes(part))) return true;
  return /(^|[_.-])keys?$/.test(lower);
}

const REDACTION_MARKER = /^«redacted \d+ chars»$/;

const mask = (value: string): string =>
  REDACTION_MARKER.test(value) ? value : `«redacted ${value.length} chars»`;

const KEY_PREFIXES: RegExp[] = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Supabase session cookies — the one credential this app actually hands out
  /\bsb-[A-Za-z0-9_-]{4,}-auth-token(?:\.\d+)?=[^;\s]{8,}/g,
];
const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})/g;
const PEM_BLOCK = /(-----BEGIN [A-Z ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z ]*PRIVATE KEY-----)/g;
const KEY_VALUE =
  /\b((?:[A-Za-z0-9_-]*_)?(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|auth[_-]?token|access[_-]?key|private[_-]?key|cookie)s?)(["']?\s*[=:]\s*)(["']?)([A-Za-z0-9._~+/=-]{8,})\3/gi;

export function redactSecretsInText(text: string): string {
  if (!text || text.length < 8) return text;
  let out = text;
  out = out.replace(
    PEM_BLOCK,
    (_m, open: string, body: string, close: string) => `${open}\n${mask(body.trim())}\n${close}`,
  );
  for (const expression of KEY_PREFIXES) out = out.replace(expression, (match) => mask(match));
  out = out.replace(BEARER, (_m, lead: string, token: string) => `${lead}${mask(token)}`);
  out = out.replace(
    KEY_VALUE,
    (_m, key: string, separator: string, quote: string, value: string) =>
      `${key}${separator}${quote}${mask(value)}${quote}`,
  );
  return out;
}

export function redactSecrets(input: unknown, depth = 0): unknown {
  if (typeof input === "string") return redactSecretsInText(input);
  if (depth > 12 || input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactSecrets(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && isSecretName(key)) {
      out[key] = mask(value);
      continue;
    }
    out[key] = redactSecrets(value, depth + 1);
  }
  return out;
}
