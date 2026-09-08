// Is `claude` installed, and is it signed in to a Claude.ai / Anthropic plan?
//
// Mirrors `codex-status.ts`: both answers come from the CLI itself
// (`claude --version`, `claude auth status`), never from a guess. When a
// plan carries an isolated `CLAUDE_CONFIG_DIR`, the probe sets that env so
// "Test connection" names the account THIS plan uses.
import { createHash } from "node:crypto";
import { accessSync, constants, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { claudeConfigEnvironment, cleanChildEnvironment } from "./child-env.js";
import { augmentedPath, devOverridesAllowed, findCliCandidates } from "./env-path.js";
import { execCli } from "./procs.js";
import { maskEmailHint } from "./plan-registry.js";

export const PROBE_TIMEOUT_MS = 8_000;

/** Anything that looks like a Claude Code version line. */
// "claude 1.0.x" (2025) and "2.1.261 (Claude Code)" (2026) are both the real CLI.
export const CLAUDE_VERSION_LINE = /^claude\b|\bclaude code\b/i;

export interface ClaudePathOptions {
  packaged?: boolean;
}

export interface ClaudeCandidate {
  id: string;
  path: string;
}

export interface ClaudeStatus {
  found: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  /** "max", "pro", "team"… as `claude auth status` reports it. */
  planType?: string;
  emailHint?: string;
  error?: string;
}

export class ClaudePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_claude_path";
  }
}

export function resolveClaudePath(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  options: ClaudePathOptions = {},
): string {
  const override = environment.LBZ_CLAUDE_PATH?.trim();
  if (override && devOverridesAllowed(options.packaged === true, environment)) return override;
  const explicit = configured?.trim();
  if (explicit) return explicit;
  return findCliCandidates("claude", environment)[0] ?? "claude";
}

export function requireClaudePath(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  options: ClaudePathOptions = {},
): string {
  const override = environment.LBZ_CLAUDE_PATH?.trim();
  if (override && devOverridesAllowed(options.packaged === true, environment)) return override;
  const explicit = configured?.trim();
  const candidates = claudeCandidatePaths(environment);
  if (!explicit) {
    const found = candidates[0];
    if (!found) throw new ClaudePathError("`claude` isn't installed, or isn't on this app's PATH");
    return found;
  }
  const canonical = canonicalExecutable(explicit);
  if (!canonical || canonical !== explicit || !candidates.includes(canonical)) {
    throw new ClaudePathError(
      `${explicit} is not the claude this Mac has any more — open Settings → Runtime and choose it again`,
    );
  }
  return canonical;
}

export function claudeCandidateId(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16);
}

export function claudeCandidates(environment: NodeJS.ProcessEnv = process.env): ClaudeCandidate[] {
  return claudeCandidatePaths(environment).map((path) => ({ id: claudeCandidateId(path), path }));
}

export function claudeCandidatePaths(environment: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  for (const candidate of findCliCandidates("claude", environment)) {
    const canonical = canonicalExecutable(candidate);
    if (canonical) seen.add(canonical);
  }
  return [...seen];
}

function canonicalExecutable(path: string): string | null {
  if (!path || !isAbsolute(path)) return null;
  try {
    const canonical = realpathSync(path);
    accessSync(canonical, constants.X_OK);
    return canonical;
  } catch {
    return null;
  }
}

export type CliRunner = (
  cli: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

/**
 * Probe install + auth. `configDir` becomes `CLAUDE_CONFIG_DIR` for the
 * auth check so an isolated plan is tested against ITS home, not ~/.claude.
 */
export async function probeClaudeStatus(
  configuredPath: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  run: CliRunner = execCli,
  options: ClaudePathOptions & { configDir?: string } = {},
): Promise<ClaudeStatus> {
  const cli = resolveClaudePath(configuredPath, environment, options);
  const childEnvironment = claudeConfigEnvironment(
    cleanChildEnvironment(environment, augmentedPath(environment)), options.configDir,
  ) as NodeJS.ProcessEnv;

  const call = (args: string[]): Promise<{ ok: boolean; output: string; message: string }> =>
    new Promise((resolve) => {
      run(cli, args, { timeout: PROBE_TIMEOUT_MS, env: childEnvironment }, (error, stdout, stderr) =>
        resolve({
          ok: !error,
          output: `${stdout}\n${stderr}`,
          message: error ? error.message : "",
        }),
      );
    });

  const version = await call(["--version"]);
  if (!version.ok) {
    return {
      found: false,
      path: cli,
      error: /ENOENT/.test(version.message)
        ? `\`${cli}\` isn't installed, or isn't on this app's PATH`
        : version.message.slice(0, 200) || "claude did not answer --version",
    };
  }

  const versionLine = version.output.trim().split("\n")[0]?.trim() ?? "";
  if (!CLAUDE_VERSION_LINE.test(versionLine)) {
    return {
      found: false,
      path: cli,
      error: `\`${cli}\` answered "${versionLine.slice(0, 80)}" — that is not the Claude Code CLI`,
    };
  }

  const auth = await call(["auth", "status"]);
  const parsed = parseClaudeAuthStatus(auth.output);
  return {
    found: true,
    path: cli,
    version: versionLine,
    authenticated: auth.ok && parsed.loggedIn,
    ...(parsed.emailHint ? { emailHint: parsed.emailHint } : {}),
    ...(parsed.planType ? { planType: parsed.planType } : {}),
    ...(!auth.ok && !parsed.loggedIn
      ? { error: auth.message.slice(0, 200) || undefined }
      : {}),
  };
}

/** Prefer JSON (`loggedIn` / `email`); fall back to plain-text cues. */
export function parseClaudeAuthStatus(output: string): { loggedIn: boolean; emailHint?: string; planType?: string } {
  const trimmed = output.trim();
  // Whole-buffer JSON, or a JSON line buried in chatter.
  for (const candidate of [trimmed, ...trimmed.split("\n").map((line) => line.trim()).filter(Boolean)]) {
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const loggedIn =
        parsed.loggedIn === true ||
        parsed.logged_in === true ||
        parsed.authenticated === true ||
        parsed.status === "logged_in";
      const planType =
        (typeof parsed.subscriptionType === "string" && parsed.subscriptionType)
        || (typeof parsed.planType === "string" && parsed.planType)
        || undefined;
      const email =
        (typeof parsed.email === "string" && parsed.email) ||
        (typeof parsed.account === "object" &&
          parsed.account &&
          typeof (parsed.account as { email?: unknown }).email === "string" &&
          (parsed.account as { email: string }).email) ||
        undefined;
      return { loggedIn, ...(email ? { emailHint: maskEmailHint(email) } : {}), ...(planType ? { planType } : {}) };
    } catch {
      /* try next */
    }
  }
  const loggedIn = /\blogged[\s_-]?in\b/i.test(output) && !/\bnot\s+logged[\s_-]?in\b/i.test(output);
  const emailMatch = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.exec(output);
  return {
    loggedIn,
    ...(emailMatch?.[1] ? { emailHint: maskEmailHint(emailMatch[1]) } : {}),
  };
}
