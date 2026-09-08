// PATH augmentation for GUI launches. Ported from OpenMausBot
// `server/env-path.ts` (Apache-2.0), trimmed to the macOS/Linux cases this
// app ships.
//
// An app opened from Finder inherits a bare PATH (/usr/bin:/bin:…): no
// ~/.local/bin (where `codex` lives on this machine), no /opt/homebrew/bin,
// no nvm shims. The terminal sees the CLI; the packaged app does not.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

function nvmBinDirectories(home: string): string[] {
  try {
    const base = join(home, ".nvm", "versions", "node");
    return readdirSync(base)
      .filter((version) => version.startsWith("v"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => join(base, version, "bin"));
  } catch {
    return [];
  }
}

export function knownBinDirectories(home: string = homedir()): string[] {
  return [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".asdf", "shims"),
    join(home, "bin"),
    ...nvmBinDirectories(home),
  ];
}

export function mergePaths(parts: string[]): string {
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}

let cached: string | null = null;

/** Current best PATH, synchronously. Cheap after the first call. */
export function augmentedPath(environment: NodeJS.ProcessEnv = process.env): string {
  if (cached !== null) return cached;
  cached = mergePaths([
    ...(environment.PATH ? environment.PATH.split(delimiter) : []),
    ...knownBinDirectories().filter((directory) => existsSync(directory)),
  ]);
  return cached;
}

export function resetPathCacheForTests(): void {
  cached = null;
}

/** `LBZ_CODEX_PATH` and `LBZ_MCP_NODE` replace a signed, shipped binary
 * with whatever a variable says. That is a developer and test convenience,
 * never a production one: a packaged app ignores both unless it was
 * launched by the E2E harness. Documented in
 * `docs/architecture/05-infra-devops-security.md`. */
export function devOverridesAllowed(
  packaged: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return !packaged || environment.LOCALBIZOS_TEST_HARNESS === "1";
}

/** Every `name` binary on the augmented PATH, in PATH order. A path-ish
 * name is echoed back — it already IS a location. */
export function findCliCandidates(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!name || /[\n\r]/.test(name)) return [];
  if (name.includes("/")) return existsSync(name) ? [name] : [];
  const found: string[] = [];
  for (const directory of augmentedPath(environment).split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
}
