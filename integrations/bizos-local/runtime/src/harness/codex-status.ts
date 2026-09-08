// Is `codex` installed, and is it signed in?
//
// Both answers come from the CLI itself — `codex --version` and
// `codex login status` — never from a guess, because "Local runtime ready"
// with no CLI behind it is exactly the kind of false green this product
// refuses to show.
import { createHash } from "node:crypto";
import { accessSync, constants, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { cleanChildEnvironment } from "./child-env.js";
import { augmentedPath, devOverridesAllowed, findCliCandidates } from "./env-path.js";
import { execCli } from "./procs.js";
import type { CodexCandidate, CodexStatus } from "./types.js";

export const PROBE_TIMEOUT_MS = 8_000;

/** codex-cli 0.147 reports a successful login on stderr; older versions
 * wrote the same line to stdout, so both streams are searched. */
export const LOGGED_IN = /^logged in\b/im;

/** `codex --version` answers `codex-cli <semver>`. Anything else is not the
 * binary this app drives, and running it would be running a stranger. */
export const CODEX_VERSION_LINE = /^codex-cli\b/;

export interface CodexPathOptions {
  /** A packaged build ignores `LBZ_CODEX_PATH` (see `devOverridesAllowed`). */
  packaged?: boolean;
}

/** A refusal the bridge can name (`ipc.runHandler` uses `name` as the code). */
export class CodexPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_codex_path";
  }
}

export function resolveCodexPath(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  options: CodexPathOptions = {},
): string {
  const override = environment.LBZ_CODEX_PATH?.trim();
  if (override && devOverridesAllowed(options.packaged === true, environment)) return override;
  const explicit = configured?.trim();
  if (explicit) return explicit;
  return findCliCandidates("codex", environment)[0] ?? "codex";
}

/**
 * The path this app is about to SPAWN — re-checked at that moment, every time.
 *
 * Validating `codexPath` when it is SET is not enough, and this is the whole
 * finding: the setting was validated through `realpath` and then the RAW string
 * was persisted, so pointing `~/.local/bin/codex` at a real Codex, saving, and
 * repointing the symlink afterwards made Electron run whatever it now points at
 * — as the user, outside every sandbox. Anything that can write
 * `<userData>/localbizos/settings.json` had the same door.
 *
 * Three conditions, all of them checked here rather than in a screen:
 *   · the stored path is CANONICAL (`realpath` of it is itself) — so it cannot
 *     be a symlink somebody repointed after the fact;
 *   · it is executable and still exists;
 *   · it is still one of the `codex` installations this Mac has on its PATH.
 *
 * A failure is a sentence, not a fallback: quietly running a different binary
 * than the one the user chose is the bug, not the cure.
 */
export function requireCodexPath(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  options: CodexPathOptions = {},
): string {
  const override = environment.LBZ_CODEX_PATH?.trim();
  if (override && devOverridesAllowed(options.packaged === true, environment)) return override;
  const explicit = configured?.trim();
  const candidates = codexCandidatePaths(environment);
  if (!explicit) {
    const found = candidates[0];
    if (!found) throw new CodexPathError("`codex` isn't installed, or isn't on this app's PATH");
    return found;
  }
  const canonical = canonicalExecutable(explicit);
  if (!canonical || canonical !== explicit || !candidates.includes(canonical)) {
    throw new CodexPathError(
      `${explicit} is not the codex this Mac has any more — open Settings → Runtime and choose it again`,
    );
  }
  return canonical;
}

/**
 * The opaque id of a candidate. The renderer picks one of THESE; it never types
 * a path, because a path from a renderer is a program this app would run.
 * Stable for a given canonical path, so the picker keeps its selection.
 */
export function codexCandidateId(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16);
}

/** The vetted installations, as the bridge contract's `CodexCandidate[]`. */
export function codexCandidates(environment: NodeJS.ProcessEnv = process.env): CodexCandidate[] {
  return codexCandidatePaths(environment).map((path) => ({ id: codexCandidateId(path), path }));
}

/** The canonical path an opaque candidate id stands for, or `null`. */
export function codexPathForId(id: string, environment: NodeJS.ProcessEnv = process.env): string | null {
  return codexCandidatePaths(environment).find((path) => codexCandidateId(path) === id) ?? null;
}

/** Canonical, de-duplicated absolute paths of every `codex` this Mac has on
 * the augmented PATH (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`,
 * nvm shims…). This list is the ONLY thing the renderer may choose from:
 * a compromised page must not be able to name an arbitrary executable. */
export function codexCandidatePaths(environment: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  for (const candidate of findCliCandidates("codex", environment)) {
    const canonical = canonicalExecutable(candidate);
    if (canonical) seen.add(canonical);
  }
  return [...seen];
}

/** `realpath` of a path that exists and carries the execute bit, or null. */
export function canonicalExecutable(path: string): string | null {
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

export async function probeCodexStatus(
  configuredPath: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  run: CliRunner = execCli,
  options: CodexPathOptions = {},
): Promise<CodexStatus> {
  // Deliberately LENIENT: this probe answers "what is at this path", which is
  // also how a candidate is vetted before it is ever allowed to become the
  // setting. Whether the SAVED path is still spawnable is `requireCodexPath`,
  // asked again at every turn and by `runtime.codexStatus`.
  const cli = resolveCodexPath(configuredPath, environment, options);
  // The probe spawns the same binary a turn will: it gets the same stripped
  // environment, so a key present at launch cannot flip billing here either.
  const childEnvironment = cleanChildEnvironment(environment, augmentedPath(environment)) as NodeJS.ProcessEnv;

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
        : version.message.slice(0, 200) || "codex did not answer --version",
    };
  }

  const versionLine = version.output.trim().split("\n")[0]?.trim() ?? "";
  if (!CODEX_VERSION_LINE.test(versionLine)) {
    return {
      found: false,
      path: cli,
      error: `\`${cli}\` answered "${versionLine.slice(0, 80)}" — that is not the codex CLI`,
    };
  }

  const login = await call(["login", "status"]);
  return {
    found: true,
    path: cli,
    version: versionLine,
    authenticated: login.ok && LOGGED_IN.test(login.output),
  };
}
