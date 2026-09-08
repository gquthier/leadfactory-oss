// One place that decides what a `codex` child may see.
//
// Every spawn of the CLI — the `--version`/`login status` probe, the model
// catalogue, and a real turn — goes through here, so a variable that must
// never reach the model cannot be forgotten in one of the three.
//
// `OPENAI_API_KEY` is deleted on purpose: a leaked key silently flips
// billing from the user's ChatGPT plan to pay-as-you-go.
// `ANTHROPIC_API_KEY` is deleted for the same reason against Claude Code:
// a present key silently flips billing off the Claude.ai subscription.
// `LBZ_SESSION_COOKIE` is deleted on purpose too: the session cookie now
// travels as a one-shot broker token (see `session-broker.ts`), and a stale
// variable inherited from the parent environment would put the real cookie
// back within `printenv` reach of the model.

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Claude's explicit config-dir selects a different macOS Keychain service,
 * even when its path is the ordinary ~/.claude. The machine account must use
 * the CLI default; additional plans keep their explicit isolated directory. */
export function claudeConfigEnvironment(
  base: Record<string, string | undefined>,
  configDir?: string,
): Record<string, string | undefined> {
  const environment = { ...base };
  if (configDir && resolve(configDir) === join(homedir(), ".claude")) delete environment.CLAUDE_CONFIG_DIR;
  else if (configDir) environment.CLAUDE_CONFIG_DIR = configDir;
  return environment;
}

/** Variables stripped from every CLI child, whatever the caller passed. */
export const FORBIDDEN_CHILD_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LBZ_SESSION_COOKIE",
] as const;

export function cleanChildEnvironment(
  base: Record<string, string | undefined>,
  pathValue: string,
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    ...base,
    PATH: pathValue,
    NPM_CONFIG_LOGLEVEL: "error",
  };
  for (const name of FORBIDDEN_CHILD_VARS) delete environment[name];
  return environment;
}
