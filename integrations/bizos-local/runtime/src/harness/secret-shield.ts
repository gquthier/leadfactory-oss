// Secret shield: what an agent's COMMANDS may never read, and how each CLI is
// told so.
//
// The CLIs run as the user. Without this, a shell command an agent runs can
// read the sidecar descriptor (its owner bearer), `providers.json` (API keys),
// the Boat key, the desktop's cookie jar, and the other CLI's credentials —
// no approval card is raised for a command that merely SUCCEEDS.
//
// Three enforcement points, one list:
//   * codex, `read-only` / `workspace-write` (its own seatbelt): a permission
//     profile passed as `thread/start` config overrides —
//     `permissions.<name>.filesystem = { "/": "read", <cwd>: "write", …,
//     <protected>: "deny" }` plus `network.enabled`. Verified against
//     codex-cli 0.155.1 with `codex sandbox` (deny wins, writes inside the
//     declared roots work, network follows the profile) and against
//     `codex app-server` (`thread/start` accepts the overrides).
//   * codex `danger-full-access` and Claude `bypassPermissions`: the CLI has
//     no sandbox of its own, so the whole process tree is started under one
//     macOS seatbelt profile — `(allow default)` plus `(deny file-read*)` on
//     the list. Nested sandboxes are refused by macOS (`sandbox_apply:
//     Operation not permitted`), which is exactly why this wrapper is used
//     ONLY where the CLI applies no sandbox itself.
//   * Claude, every mode: `permissions.deny` rules for the Read/Edit/Write/
//     Glob/Grep tools through `--settings`. Bash has no path pattern, hence
//     the seatbelt above in bypass mode.
//
// The CLI's OWN credentials are a special case: the codex process reads
// `$CODEX_HOME/auth.json` and Claude reads its config directory. Both are
// denied to the OTHER CLI's commands and, for codex, to its own sandboxed
// commands; the outer seatbelt (bypass modes) leaves the running CLI's own
// files readable because the process tree is one sandbox.
//
// `LOCALBIZOS_SECRET_SHIELD=0` turns everything here off (support escape
// hatch); it is never set by the app.

import { existsSync, readdirSync, realpathSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SECRET_SHIELD_ENV = "LOCALBIZOS_SECRET_SHIELD";
export const CODEX_SHIELD_PROFILE = "bizos_shield";
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export function secretShieldEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[SECRET_SHIELD_ENV]?.trim().toLowerCase();
  return !(value === "0" || value === "off" || value === "false");
}

/** Seatbelt matches the REAL path: `/tmp/x` is `/private/tmp/x` to the
 * kernel. A missing path keeps its resolved spelling — the file may appear
 * later (a plan directory, a key file written on first use). */
export function canonicalProtectedPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export interface RuntimeSecretLocations {
  /** The harness storage root (`Storage.layout.root`). */
  storageRoot: string;
  /** The sidecar state root, parent of `runtime/`. */
  stateRoot?: string;
  /** The desktop descriptor holding the sidecar owner bearer. */
  descriptorPath?: string;
  /** Native computer descriptor, when the desktop passes one. */
  nativeDescriptorPath?: string;
  /** Machine-level Boat key file (`BOAT_API_KEY_FILE`). */
  boatKeyFile?: string;
  /** Extra absolute paths named by the desktop (`LOCALBIZOS_PROTECTED_PATHS`). */
  extra?: readonly string[];
  /** Vault folders whose `Knowledge/Imported Context` THIS agent may still
   * read: the vaults whose company CEO it is (the import brief asks the CEO
   * to read it). Every other vault's import is denied. */
  importedContextReaders?: readonly string[];
  home?: string;
}

/** Relative to a vault: the private creation snapshot (web organization
 * import or picked folder), written once by the runtime. */
export const IMPORTED_CONTEXT_DIR = join("Knowledge", "Imported Context");

/** `vaults/<id>/Knowledge/Imported Context` for every managed vault, except
 * the vaults named in `readers`. The folder need not exist yet; the vault is
 * resolved to its real path so the kernel sees the same spelling. */
export function importedContextPaths(storageRoot: string, readers: readonly string[] = []): string[] {
  const allowed = new Set(readers.map(canonicalProtectedPath));
  const vaults = join(storageRoot, "vaults");
  let entries: Dirent[];
  try {
    entries = readdirSync(vaults, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const vault = canonicalProtectedPath(join(vaults, entry.name));
    if (allowed.has(vault)) continue;
    paths.push(join(vault, IMPORTED_CONTEXT_DIR));
  }
  return paths;
}

/** Files and folders of the RUNTIME and the desktop that no agent command
 * may read, whatever the mode. The storage root itself is NOT listed: the
 * agents' workspaces live under it. */
export function runtimeProtectedPaths(input: RuntimeSecretLocations): string[] {
  const home = input.home ?? homedir();
  const root = input.storageRoot;
  const paths = [
    input.descriptorPath,
    input.nativeDescriptorPath,
    input.boatKeyFile,
    ...(input.stateRoot
      ? [join(input.stateRoot, "instance.json"), join(input.stateRoot, "sidecar.log"), join(input.stateRoot, "collaboration-index.json")]
      : []),
    join(root, "providers.json"),
    join(root, "apps.json"),
    join(root, "settings.json"),
    join(root, "cloud-computer.json"),
    join(root, "continuity.json"),
    join(root, "continuity-runs.json"),
    join(root, "continuity-stops.json"),
    join(root, "continuity-incoming.json"),
    join(root, "plans"),
    join(root, "mcp"),
    join(root, "native"),
    join(root, "threads"),
    // Session cursors and run records (hashes, ids, tasks): no agent reads
    // them. Before .52 `cursors.json` also held the Claude brief verbatim.
    join(root, "cursors.json"),
    join(root, "runs.json"),
    // The organization context imported into each company: readable by that
    // company's CEO only, so an injected specialist cannot exfiltrate it.
    ...importedContextPaths(root, input.importedContextReaders ?? []),
    join(home, "Library", "Application Support", "BizOS-Simple", "Cookies"),
    join(home, "Library", "Application Support", "BizOS-Simple", "Partitions"),
    join(home, "Library", "Application Support", "BizOS-Simple", "Local Storage"),
    join(home, "Library", "Application Support", "BizOS-Simple", "Session Storage"),
    ...(input.extra ?? []),
  ].filter((path): path is string => typeof path === "string" && path.trim().length > 0);
  return [...new Set(paths.map(canonicalProtectedPath))];
}

/** Credential files of the two CLIs. `own` names the CLI about to run: its
 * own files are excluded from the OUTER seatbelt (the process needs them)
 * but stay in tool-level rules and in the other CLI's list. */
export function cliCredentialPaths(input: {
  home?: string;
  codexHome?: string;
  claudeConfigDir?: string;
  own?: "codex" | "claude";
}): string[] {
  const home = input.home ?? homedir();
  const codexHome = input.codexHome ?? join(home, ".codex");
  const claudeDir = input.claudeConfigDir ?? join(home, ".claude");
  const codex = [join(codexHome, "auth.json")];
  const claude = [join(claudeDir, ".credentials.json")];
  const list = input.own === "codex" ? claude : input.own === "claude" ? codex : [...codex, ...claude];
  return [...new Set(list.map(canonicalProtectedPath))];
}

function sbplString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A seatbelt profile that allows everything except reading the listed
 * paths (files and whole folders, symlinked spellings included since the
 * kernel resolves them). Later rules win in SBPL, so the denies follow the
 * `(allow default)`. */
export function seatbeltDenyReadProfile(paths: readonly string[]): string {
  const rules = [...new Set(paths.map(canonicalProtectedPath))]
    .map((path) => `(deny file-read* (literal ${sbplString(path)}) (subpath ${sbplString(path)}))`)
    .join("\n");
  return `(version 1)\n(allow default)\n${rules}\n`;
}

export function seatbeltAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" && existsSync(SANDBOX_EXEC);
}

/** Wrap a CLI launch in `sandbox-exec` when the platform supports it; the
 * command is otherwise launched as-is (Linux/Windows have no seatbelt). */
export function seatbeltLaunch(
  command: string,
  args: readonly string[],
  profile: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; sandboxed: boolean } {
  if (!seatbeltAvailable(platform)) return { command, args: [...args], sandboxed: false };
  return { command: SANDBOX_EXEC, args: ["-p", profile, command, ...args], sandboxed: true };
}

/** Claude Code `permissions.deny` rules for the path-taking tools. Bash has
 * no path-shaped rule, hence the seatbelt in bypass mode.
 *
 * An absolute path is written `//path`: in Claude Code rules a single leading
 * `/` anchors at the settings source, not at the filesystem root
 * (code.claude.com/docs/en/permissions, "Read and Edit"; checked for
 * claude 2.1.284). Before .52 the rules used `/path` and matched nothing. */
export function claudeDenySettings(paths: readonly string[]): { permissions: { deny: string[] } } {
  const deny: string[] = [];
  for (const path of [...new Set(paths.map(canonicalProtectedPath))]) {
    const rule = path.startsWith("/") && !path.startsWith("//") ? `/${path}` : path;
    for (const tool of ["Read", "Edit", "Write", "Glob", "Grep"]) {
      deny.push(`${tool}(${rule})`, `${tool}(${rule}/**)`);
    }
  }
  return { permissions: { deny } };
}

export interface CodexShieldProfileInput {
  cwd: string;
  sandbox: "read-only" | "workspace-write";
  writableRoots?: readonly string[];
  networkAccess?: boolean;
  excludeSlashTmp?: boolean;
  excludeTmpdirEnvVar?: boolean;
  tmpdir?: string;
  protectedPaths: readonly string[];
  name?: string;
}

/** codex config overrides selecting a permission profile equivalent to the
 * requested sandbox mode — the cwd and shared folders writable in
 * `workspace-write` (plus `/tmp` and `$TMPDIR` unless the user excluded
 * them, as codex itself does), everything else readable — with the
 * protected paths denied. Passed as `thread/start` `config`. */
export function codexShieldConfig(input: CodexShieldProfileInput): Record<string, unknown> {
  const name = input.name ?? CODEX_SHIELD_PROFILE;
  const filesystem: Record<string, "read" | "write" | "deny"> = { "/": "read" };
  if (input.sandbox === "workspace-write") {
    const writable = [input.cwd, ...(input.writableRoots ?? [])];
    if (!input.excludeSlashTmp) writable.push("/tmp");
    if (!input.excludeTmpdirEnvVar && input.tmpdir) writable.push(input.tmpdir);
    for (const path of writable) filesystem[canonicalProtectedPath(path)] = "write";
  }
  for (const path of input.protectedPaths) filesystem[canonicalProtectedPath(path)] = "deny";
  return {
    default_permissions: name,
    permissions: { [name]: { filesystem, network: { enabled: input.networkAccess === true } } },
  };
}
