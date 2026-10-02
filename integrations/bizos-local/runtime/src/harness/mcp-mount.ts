// Mounting the BizOS tool surface onto a codex turn.
//
// Two stdio servers, deliberately split by blast radius:
//   `bizos`          read-only routes, pre-approved so a bot can look at
//                    the real state without interrupting the user
//   `bizos_actions`  everything that spends money or changes the business;
//                    left on codex's on-request policy, so each call
//                    surfaces as an approval card in the thread
//
// Two rules hold that split, and they used to be broken in the same place:
//
//  1. WHICH TOOLSET a server serves travels in the server's own ARGV
//     (`--toolset=read|actions`). It used to travel in `LBZ_TOOLSET`, which
//     codex forwards from ITS OWN environment — one environment for both
//     servers, last value wins — so `bizos` was mounted with the ACTIONS
//     tools and pre-approved. argv is per-server and cannot collide.
//  2. The SESSION COOKIE never travels at all. Each server gets a one-shot
//     broker token (`session-broker.ts`) under a name of its own, forwarded
//     through codex's environment so it stays out of every process listing.
//     The token is spent at the server's first breath; what a model can read
//     out of the environment afterwards is a dead string.
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { devOverridesAllowed, findCliCandidates } from "./env-path.js";
import type { StdioMcpServer } from "./codex-driver.js";

export interface McpLauncher {
  command: string;
  args: string[];
  /** Environment the launcher itself needs (not the tool configuration). */
  env: Record<string, string>;
  /** Which runtime starts the server — reported by `runtime.toolsStatus()`. */
  kind: "electron" | "node";
}

export interface LauncherInput {
  /** Absolute path to the compiled `bizos-mcp.mjs`. */
  scriptPath: string;
  /** `process.execPath` — the Electron binary, or node in a dev run. */
  execPath: string;
  packaged: boolean;
  /** Whether the `RunAsNode` Electron fuse is on for this build. The
   * packaged app deliberately turns it off, which also disables
   * ELECTRON_RUN_AS_NODE — so a packaged build needs a real node. */
  runAsNodeAvailable: boolean;
  environment?: NodeJS.ProcessEnv;
}

/** How to start the tool server, or `null` when this machine has no way to
 * run it. `null` is a real outcome, not an error to paper over: the bots
 * still run, they just get told the BizOS tools are unavailable. */
export function resolveMcpLauncher(input: LauncherInput): McpLauncher | null {
  const environment = input.environment ?? process.env;
  const override = environment.LBZ_MCP_NODE?.trim();
  // A packaged build ignores the override: it ships its own runtime, and a
  // variable that can replace it is a way to run a stranger as the user.
  if (override && devOverridesAllowed(input.packaged, environment)) {
    return { command: override, args: [input.scriptPath], env: {}, kind: "node" };
  }
  if (input.runAsNodeAvailable) {
    return {
      command: input.execPath,
      args: [input.scriptPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      kind: "electron",
    };
  }
  // Packaged builds disable the RunAsNode fuse, so the app binary cannot
  // act as node. Fall back to a real node on the augmented PATH; the
  // script must be outside the asar for it to be readable, which the
  // `asarUnpack` entry in package.json guarantees.
  const node = findCliCandidates("node", environment)[0];
  if (!node || !existsSync(unpackedScriptPath(input.scriptPath))) return null;
  return { command: node, args: [unpackedScriptPath(input.scriptPath)], env: {}, kind: "node" };
}

/** electron-builder writes an `asarUnpack`ed file to a sibling
 * `app.asar.unpacked` tree; that copy is a real file a plain node can read. */
export function unpackedScriptPath(scriptPath: string): string {
  const marker = `app.asar${sep}`;
  return scriptPath.includes(marker)
    ? scriptPath.replace(marker, `app.asar.unpacked${sep}`)
    : scriptPath;
}

/** Mints one-shot credentials. `SessionBroker` satisfies it; a test can too. */
export interface TokenIssuer {
  readonly url: string;
  issue(cookie: string): string;
}

export interface McpMountInput {
  launcher: McpLauncher | null;
  baseUrl: string;
  /** The live session. It is exchanged for tokens here and goes no further. */
  sessionCookie: string;
  /** `null` when the broker is not up: the servers mount without a session
   * and every tool answers "signed out" rather than silently reading none. */
  broker: TokenIssuer | null;
  /** The bot's codex cwd; always readable by `upload_document`. */
  workspaceDir: string;
  /** Folders this bot was given in Settings → Access, canonical. They are
   * PATHS, not secrets, so travelling in argv (`mcp_servers.<name>.env`) is
   * fine — unlike the session cookie, which never leaves the main process. */
  sharedDirs?: string[];
  /** The home folder, when the user turned Full disk (read-only) on. */
  fullDiskReadRoot?: string;
  /** Folders no tool may read whatever else is granted. Computed by the
   * harness and passed down, so the deny list has ONE definition
   * (`access.ts`) — the tool server ships unpacked beside the asar and
   * cannot import from `dist/harness`. */
  deniedDirs?: string[];
  /** `false` puts the read tools behind approval cards too. */
  autoApproveReads: boolean;
  /**
   * The agent's computer, when this build has one.
   *
   * `url` is the loopback computer broker in the main process
   * (`computer/broker.ts`) and `token` is minted for THIS spawn and bound to
   * THIS bot — so the tool server it reaches cannot name another agent's
   * machine, and there is nothing in its environment that could. Both absent ⇒
   * the `bizos_computer` server is not mounted at all, which is how a build
   * without Electron and the cloud runtime answer honestly.
   */
  computer?: { url: string; token: string };
}

/** The environment variable each server reads its one-shot token from.
 * Distinct per toolset: codex forwards named variables out of a SINGLE
 * environment, so one shared name would hand both servers the same token
 * and exactly one of them would start. */
export const TOKEN_VAR = { read: "LBZ_MCP_TOKEN_READ", actions: "LBZ_MCP_TOKEN_ACTIONS" } as const;

export type Toolset = keyof typeof TOKEN_VAR;

/** The computer server's own credential. It is not a session token and the
 * session broker never sees it: it names one BOT, not the user, and it buys
 * nothing outside a turn (`computer/broker.ts` says why). Its own name, for the
 * same reason the two above have theirs — codex forwards named variables out of
 * ONE environment. */
export const COMPUTER_TOKEN_VAR = "LBZ_MCP_TOKEN_COMPUTER";

export function buildMcpServers(input: McpMountInput): Record<string, StdioMcpServer> {
  if (!input.launcher || !input.baseUrl) return {};
  const launcher = input.launcher;
  const sharedDirs = (input.sharedDirs ?? []).filter(Boolean);
  const deniedDirs = (input.deniedDirs ?? []).filter(Boolean);
  const shared = {
    LBZ_BASE_URL: input.baseUrl,
    LBZ_WORKSPACE_DIR: input.workspaceDir,
    ...(sharedDirs.length ? { LBZ_SHARED_DIRS: JSON.stringify(sharedDirs) } : {}),
    ...(input.fullDiskReadRoot ? { LBZ_FULL_DISK_READ_ROOT: input.fullDiskReadRoot } : {}),
    ...(deniedDirs.length ? { LBZ_DENIED_DIRS: JSON.stringify(deniedDirs) } : {}),
    ...(input.broker ? { LBZ_BROKER_URL: input.broker.url } : {}),
  };
  const server = (toolset: Toolset, preApproved: boolean): StdioMcpServer => ({
    command: launcher.command,
    // The toolset is argv, never environment: see the header.
    args: [...launcher.args, `--toolset=${toolset}`],
    env: { ...launcher.env, ...shared },
    forwarded: input.broker ? { [TOKEN_VAR[toolset]]: input.broker.issue(input.sessionCookie) } : {},
    preApproved,
  });
  return {
    bizos: server("read", input.autoApproveReads),
    // Never pre-approved: an operation spends the user's Work Credits.
    bizos_actions: server("actions", false),
    ...(input.computer
      ? {
          // Pre-approved on purpose, and it is not a hole: the gate for these
          // tools is not codex's approval mode, it is the manager. A call is
          // refused outside a turn, and acting on a host this agent is SIGNED IN
          // to raises a card whatever codex thinks. Leaving them on codex's
          // on-request policy instead would put a card in front of every scroll
          // and every look at a page nobody is logged into — which trains the
          // user to click Allow, and that is the actual hole.
          bizos_computer: {
            command: launcher.command,
            args: [...launcher.args, "--toolset=computer"],
            env: { ...launcher.env, LBZ_COMPUTER_URL: input.computer.url },
            forwarded: { [COMPUTER_TOKEN_VAR]: input.computer.token },
            preApproved: true,
          } satisfies StdioMcpServer,
        }
      : {}),
  };
}

export interface ToolsStatus {
  available: boolean;
  reason?: string;
  launcher: "electron" | "node" | "none";
}

/** Why the tool surface is missing, in words a person can act on. */
export function describeMissingTools(launcher: McpLauncher | null, baseUrl: string): string | null {
  if (!baseUrl) return "BizOS tools are off: this window has no BizOS address yet.";
  if (!launcher)
    return "BizOS tools are off: this packaged build cannot start the tool server because no Node.js runtime was found on this Mac.";
  return null;
}

/** The whole truth for the Runtime card: available, why not, and by what. */
export function describeToolsStatus(launcher: McpLauncher | null, baseUrl: string): ToolsStatus {
  const reason = describeMissingTools(launcher, baseUrl);
  return {
    available: reason === null,
    ...(reason ? { reason } : {}),
    launcher: launcher?.kind ?? "none",
  };
}
