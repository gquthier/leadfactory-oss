// The Claude Code OAuth token, read where the CLI itself keeps it.
//
// macOS: the login Keychain, one generic password per config directory.
// The default `~/.claude` uses the service `Claude Code-credentials`; a plan
// with its own `CLAUDE_CONFIG_DIR` uses that name plus the first eight hex
// characters of sha256(configDir) — verified 2026-09-06 against the two
// isolated plans on this Mac. The account is the OS user name: the same
// service ALSO carries an `unknown` account that holds only `mcpOAuth`, and
// reading that one would answer "signed in" for a machine that is not.
// Elsewhere: `<configDir>/.credentials.json`, same JSON.
//
// The token never leaves this file except as an `Authorization` header:
// nothing here logs it, returns it in an error, or writes it anywhere.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { cleanChildEnvironment } from "./child-env.js";
import type { CliRunner } from "./claude-status.js";
import { execCli } from "./procs.js";

/** The Keychain can put a dialog on screen the first time; a read that is
 * waiting on a person must not hold a request open for ever. */
export const KEYCHAIN_TIMEOUT_MS = 15_000;
export const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const SECURITY_CLI = "/usr/bin/security";
/** A token still counts as usable for a minute past its stated expiry. */
const EXPIRY_GRACE_MS = 60_000;

export interface ClaudeOauth {
  accessToken: string;
  /** Epoch milliseconds, as the CLI stores it. */
  expiresAt: number | null;
  /** "max", "pro", "team"… */
  subscriptionType: string | null;
  /** e.g. "default_claude_max_20x". */
  rateLimitTier: string | null;
}

export interface ReadClaudeOauthInput {
  /** The plan's `CLAUDE_CONFIG_DIR`; absent means the machine default. */
  configDir?: string;
  homeDir: string;
  platform?: NodeJS.Platform;
  /** The OS account the Keychain item belongs to. */
  username?: string;
  environment?: NodeJS.ProcessEnv;
  run?: CliRunner;
  readFile?: (path: string) => string;
  nowMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Which Keychain generic password holds this config directory's token. */
export function keychainServiceForConfigDir(configDir: string | undefined, homeDir: string): string {
  const trimmed = configDir?.trim().replace(/\/+$/, "");
  if (!trimmed) return KEYCHAIN_SERVICE;
  if (resolve(trimmed) === join(homeDir, ".claude")) return KEYCHAIN_SERVICE;
  return `${KEYCHAIN_SERVICE}-${createHash("sha256").update(trimmed).digest("hex").slice(0, 8)}`;
}

/** The credentials file the CLI keeps outside macOS. */
export function credentialsFileForConfigDir(configDir: string | undefined, homeDir: string): string {
  const trimmed = configDir?.trim().replace(/\/+$/, "");
  return join(trimmed || join(homeDir, ".claude"), ".credentials.json");
}

/** The stored JSON → the fields this app uses, or `null` when it is not a
 * usable Claude.ai sign-in (missing, malformed, `mcpOAuth`-only, expired). */
export function parseClaudeOauth(raw: string | null, nowMs: number): ClaudeOauth | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const oauth = parsed.claudeAiOauth;
  if (!isRecord(oauth)) return null;
  const accessToken = typeof oauth.accessToken === "string" ? oauth.accessToken.trim() : "";
  if (!accessToken) return null;
  const expiresAt = typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null;
  if (expiresAt !== null && nowMs > expiresAt + EXPIRY_GRACE_MS) return null;
  return {
    accessToken,
    expiresAt,
    subscriptionType: typeof oauth.subscriptionType === "string" && oauth.subscriptionType ? oauth.subscriptionType : null,
    rateLimitTier: typeof oauth.rateLimitTier === "string" && oauth.rateLimitTier ? oauth.rateLimitTier : null,
  };
}

/** "max 20x" — the subscription plus the multiplier its tier names. */
export function planTypeLabel(oauth: ClaudeOauth | null): string | null {
  const subscription = oauth?.subscriptionType?.trim();
  if (!subscription) return null;
  const multiplier = /_(\d+)x$/.exec(oauth?.rateLimitTier ?? "");
  return multiplier ? `${subscription} ${multiplier[1]}x` : subscription;
}

function readKeychain(service: string, account: string, run: CliRunner, environment: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      run(
        SECURITY_CLI,
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { timeout: KEYCHAIN_TIMEOUT_MS, env: environment },
        (error, stdout) => resolve(error ? null : stdout),
      );
    } catch {
      resolve(null);
    }
  });
}

/** The token for one plan, or `null`. Never throws, never logs the secret. */
export async function readClaudeOauth(input: ReadClaudeOauthInput): Promise<ClaudeOauth | null> {
  const platform = input.platform ?? process.platform;
  const nowMs = input.nowMs ?? Date.now();
  if (platform === "darwin") {
    const base = input.environment ?? process.env;
    // The Keychain answers on the user's session, not on the environment, so
    // the child gets a minimal one — and never an API key.
    const environment = cleanChildEnvironment(
      { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: input.homeDir, ...(base.LANG ? { LANG: base.LANG } : {}) },
      "/usr/bin:/bin:/usr/sbin:/sbin",
    ) as NodeJS.ProcessEnv;
    const raw = await readKeychain(
      keychainServiceForConfigDir(input.configDir, input.homeDir),
      input.username ?? safeUsername(),
      input.run ?? execCli,
      environment,
    );
    return parseClaudeOauth(raw, nowMs);
  }
  const read = input.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  try {
    return parseClaudeOauth(read(credentialsFileForConfigDir(input.configDir, input.homeDir)), nowMs);
  } catch {
    return null;
  }
}

function safeUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return homedir().split("/").pop() ?? "";
  }
}

/** One authenticated GET against the Anthropic OAuth API. Resolves the parsed
 * body, or `null` for any refusal (401/403), wall (429), timeout or network
 * failure — the caller keeps whatever it already had. */
export async function anthropicOauthGet(input: {
  path: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<unknown | null> {
  const call = input.fetchImpl ?? globalThis.fetch;
  if (typeof call !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  timer.unref?.();
  try {
    const response = await call(`${ANTHROPIC_API_BASE}${input.path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "User-Agent": "localbizos/1",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
