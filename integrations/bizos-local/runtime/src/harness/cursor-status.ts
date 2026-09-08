// Is the Cursor CLI installed, and is it signed in to a Cursor subscription?
//
// Mirrors `claude-status.ts` / `codex-status.ts`: both answers come from the
// CLI itself, never from a guess.
//   * `cursor-agent status --format json` → `{status, isAuthenticated,
//     hasAccessToken, hasRefreshToken, message}`. That shape IS the identity
//     check — `--version` alone answers a bare version string any binary
//     could print.
//   * `cursor-agent about --format json` → `{cliVersion, userEmail,
//     subscriptionTier, …}`, asked only when there is an account to describe
//     (or when `status` did not answer in Cursor's own shape). The CLI is a
//     large bundle and each start-up costs the best part of a second, so the
//     signed-out path — the one every launch runs — spawns it once.
// Both are read-only and neither starts a login.
//
// There is deliberately NO per-plan config directory here. `CURSOR_CONFIG_DIR`
// exists and moves settings/chats/projects, but on macOS the CLI keeps the
// account token in the login Keychain under a FIXED service name (domain
// `"cursor"` → `cursor-access-token` / `cursor-refresh-token`, account
// `cursor-user` — read from the shipped bundle 2026.09.02, on 2026-09-07), so
// two directories are still ONE account. A Cursor plan is therefore the
// machine's account: one per Mac.
import { accessSync, constants, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { cleanChildEnvironment } from "./child-env.js";
import { augmentedPath, devOverridesAllowed, findCliCandidates } from "./env-path.js";
import { execCli } from "./procs.js";
import type { CliRunner } from "./claude-status.js";
import { maskEmailHint } from "./plan-registry.js";

export const CURSOR_PROBE_TIMEOUT_MS = 10_000;
/** The binary Cursor's installer puts on the PATH (usually `~/.local/bin`,
 * which `augmentedPath` already adds for a Finder launch). */
export const CURSOR_CLI = "cursor-agent";
/** What the desktop shows verbatim when the CLI is missing. */
export const CURSOR_CLI_MISSING_MESSAGE =
  "Install the Cursor CLI first: https://cursor.com/docs/cli/installation";

export interface CursorPathOptions {
  packaged?: boolean;
}

export interface CursorCandidate {
  id: string;
  path: string;
}

export interface CursorStatus {
  found: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  /** "pro", "business"… as `cursor-agent about` reports it. */
  planType?: string;
  emailHint?: string;
  error?: string;
}

/** A refusal the bridge can name: `ipc.runHandler` uses `name` as the code,
 * so `POST /api/local/plans {provider:"cursor"}` answers 400 `cli_missing`. */
export class CursorCliMissingError extends Error {
  constructor(message: string = CURSOR_CLI_MISSING_MESSAGE) {
    super(message);
    this.name = "cli_missing";
  }
}

export function resolveCursorPath(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  options: CursorPathOptions = {},
): string {
  const override = environment.LBZ_CURSOR_PATH?.trim();
  if (override && devOverridesAllowed(options.packaged === true, environment)) return override;
  const explicit = configured?.trim();
  if (explicit) return explicit;
  return findCliCandidates(CURSOR_CLI, environment)[0] ?? CURSOR_CLI;
}

/** The path a TURN would run, or `cli_missing` — the same refusal the connect
 * route turns into a 400 the desktop prints as-is. */
export function requireCursorPath(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  options: CursorPathOptions = {},
): string {
  const override = environment.LBZ_CURSOR_PATH?.trim();
  if (override && devOverridesAllowed(options.packaged === true, environment)) return override;
  const explicit = configured?.trim();
  const candidates = cursorCandidatePaths(environment);
  if (!explicit) {
    const found = candidates[0];
    if (!found) throw new CursorCliMissingError();
    return found;
  }
  const canonical = canonicalExecutable(explicit);
  if (!canonical || !candidates.includes(canonical)) throw new CursorCliMissingError();
  return canonical;
}

export function cursorCandidateId(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16);
}

export function cursorCandidates(environment: NodeJS.ProcessEnv = process.env): CursorCandidate[] {
  return cursorCandidatePaths(environment).map((path) => ({ id: cursorCandidateId(path), path }));
}

export function cursorCandidatePaths(environment: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  for (const candidate of findCliCandidates(CURSOR_CLI, environment)) {
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

/**
 * The environment a Cursor child gets. `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN`
 * are deleted for the same reason `ANTHROPIC_API_KEY` is deleted for Claude:
 * a key inherited from the parent shell silently bills the turn to
 * pay-as-you-go instead of the subscription the person connected.
 */
export function cursorChildEnvironment(
  base: Record<string, string | undefined>,
  pathValue: string,
): Record<string, string | undefined> {
  const environment = cleanChildEnvironment(base, pathValue);
  delete environment.CURSOR_API_KEY;
  delete environment.CURSOR_AUTH_TOKEN;
  // The endpoint is the account's; a stray override would point the
  // subscription's turns at somebody else's gateway.
  delete environment.CURSOR_API_ENDPOINT;
  return environment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The first JSON object in a buffer that may also carry CLI chatter. */
function firstJsonObject(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  for (const candidate of [trimmed, ...trimmed.split("\n").map((line) => line.trim()).filter(Boolean)]) {
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      /* try the next line */
    }
  }
  return null;
}

/** `cursor-agent status --format json`, or its plain-text fallback. */
export function parseCursorStatus(output: string): { loggedIn: boolean; emailHint?: string } {
  const parsed = firstJsonObject(output);
  if (parsed) {
    const loggedIn =
      parsed.isAuthenticated === true ||
      parsed.authenticated === true ||
      parsed.status === "authenticated" ||
      parsed.loggedIn === true;
    const email =
      (typeof parsed.email === "string" && parsed.email) ||
      (typeof parsed.userEmail === "string" && parsed.userEmail) ||
      undefined;
    return { loggedIn, ...(email ? { emailHint: maskEmailHint(email) } : {}) };
  }
  const loggedIn = /\blogged\s+in\b/i.test(output) && !/\bnot\s+logged\s+in\b/i.test(output);
  const emailMatch = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i.exec(output);
  return { loggedIn, ...(emailMatch?.[1] ? { emailHint: maskEmailHint(emailMatch[1]) } : {}) };
}

/** `cursor-agent about --format json`: the identity check, the version, and
 * whatever the account will say about itself. */
export function parseCursorAbout(output: string): {
  isCursorCli: boolean;
  version?: string;
  emailHint?: string;
  planType?: string;
} {
  const parsed = firstJsonObject(output);
  if (!parsed || typeof parsed.cliVersion !== "string" || !parsed.cliVersion.trim()) {
    return { isCursorCli: false };
  }
  const email = typeof parsed.userEmail === "string" && parsed.userEmail.trim() ? parsed.userEmail.trim() : undefined;
  const tier =
    typeof parsed.subscriptionTier === "string" && parsed.subscriptionTier.trim()
      ? parsed.subscriptionTier.trim()
      : undefined;
  return {
    isCursorCli: true,
    version: parsed.cliVersion.trim(),
    ...(email ? { emailHint: maskEmailHint(email) ?? email } : {}),
    ...(tier ? { planType: tier } : {}),
  };
}

/**
 * Probe install + auth. Read-only: it never runs `cursor-agent login`, and
 * the child gets no API key, so "signed in" means the SUBSCRIPTION is signed
 * in — not that a key was lying around in the environment.
 */
export async function probeCursorStatus(
  configuredPath: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  run: CliRunner = execCli,
  options: CursorPathOptions = {},
): Promise<CursorStatus> {
  const cli = resolveCursorPath(configuredPath, environment, options);
  const childEnvironment = cursorChildEnvironment(
    environment,
    augmentedPath(environment),
  ) as NodeJS.ProcessEnv;

  const call = (args: string[]): Promise<{ ok: boolean; output: string; message: string }> =>
    new Promise((resolve) => {
      run(cli, args, { timeout: CURSOR_PROBE_TIMEOUT_MS, env: childEnvironment }, (error, stdout, stderr) =>
        resolve({
          ok: !error,
          output: `${stdout}\n${stderr}`,
          message: error ? error.message : "",
        }),
      );
    });

  const describe = async (): Promise<CursorStatus | { about: ReturnType<typeof parseCursorAbout> }> => {
    const about = await call(["about", "--format", "json"]);
    if (!about.ok && !about.output.trim()) {
      return {
        found: false,
        path: cli,
        error: /ENOENT/.test(about.message)
          ? CURSOR_CLI_MISSING_MESSAGE
          : about.message.slice(0, 200) || CURSOR_CLI_MISSING_MESSAGE,
      };
    }
    const identity = parseCursorAbout(about.output);
    if (!identity.isCursorCli) return { found: false, path: cli, error: `\`${cli}\` is not the Cursor CLI` };
    return { about: identity };
  };

  const status = await call(["status", "--format", "json"]);
  const parsed = parseCursorStatus(status.output);
  if (!isCursorStatusPayload(status.output)) {
    // Not Cursor's own answer: fall back to `about` for the identity and the
    // version, and take whatever the status text said about the account.
    const described = await describe();
    if (!("about" in described)) return described;
    const emailHint = parsed.emailHint ?? described.about.emailHint;
    return {
      found: true,
      path: cli,
      ...(described.about.version ? { version: described.about.version } : {}),
      authenticated: parsed.loggedIn,
      ...(emailHint ? { emailHint } : {}),
      ...(described.about.planType ? { planType: described.about.planType } : {}),
      ...(!parsed.loggedIn && !status.ok ? { error: status.message.slice(0, 200) || "not signed in" } : {}),
    };
  }

  if (!parsed.loggedIn) {
    // Signed out: there is no account to name, so the second start-up is
    // spent on nothing. This is the path every launch takes on a Mac that
    // has never connected Cursor.
    return { found: true, path: cli, authenticated: false };
  }

  const described = await describe();
  if (!("about" in described)) return described;
  const emailHint = parsed.emailHint ?? described.about.emailHint;
  return {
    found: true,
    path: cli,
    ...(described.about.version ? { version: described.about.version } : {}),
    authenticated: true,
    ...(emailHint ? { emailHint } : {}),
    ...(described.about.planType ? { planType: described.about.planType } : {}),
  };
}

/** Cursor's own `status --format json` shape, and nothing else: a boolean
 * `isAuthenticated` next to one of the fields only this CLI prints. */
export function isCursorStatusPayload(output: string): boolean {
  const parsed = firstJsonObject(output);
  if (!parsed) return false;
  if (typeof parsed.isAuthenticated !== "boolean") return false;
  return (
    typeof parsed.hasAccessToken === "boolean" ||
    typeof parsed.hasRefreshToken === "boolean" ||
    typeof parsed.status === "string"
  );
}
