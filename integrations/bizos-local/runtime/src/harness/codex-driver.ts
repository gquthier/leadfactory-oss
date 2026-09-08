// Codex driver — the local runtime's engine.
//
// Ported from OpenMausBot `server/drivers/codex.ts` (Apache-2.0): the
// official `codex` CLI, headless, over its `app-server` JSON-RPC protocol
// (newline-delimited JSON on stdio). Completion is a real `turn/completed`
// notification; approval requests arrive as server->client JSON-RPC
// requests and surface as canonical `request.opened` events answered
// through `respond()` — no MCP proxy and no socket needed.
//
// Verified against codex-cli 0.144.1: `initialize` answers with
// {userAgent, codexHome, platformFamily, platformOs} and its responses omit
// the `jsonrpc` member, so the frame router keys off `id` + `result`/`error`
// rather than the envelope. The same version accepts a structured
// `sandboxPolicy` on `turn/start` (and refuses a malformed one with
// -32600), which is how a folder the user shared read-write becomes a
// writable root — see `workspaceWritePolicy`.
//
// `resumeCursor` is the codex thread id; a later turn tries `thread/resume`
// and falls back to a fresh `thread/start`.
import { cleanChildEnvironment } from "./child-env.js";
import { augmentedPath } from "./env-path.js";
import type { CodexModelProvider } from "./inference.js";
import { describeSpawnFailure, killCliTree, spawnCli, type PipedChild } from "./procs.js";
import { redactSecrets, redactSecretsInText } from "./redact.js";
import { classifyError, computeBackoff, RETRY_MAX_ATTEMPTS } from "./retry.js";
import type { ReasoningEffort, SandboxMode } from "./types.js";

export const APPROVAL_TIMEOUT_MS = 15 * 60_000;

/** A `detail` is hashed into an "always allow" key, and it also goes on disk.
 * Bounded so a pathological request cannot grow the approvals file. */
const MAX_DETAIL_CHARS = 4000;

/** JSON with sorted keys, so two identical requests hash the same whatever
 * order the CLI happened to serialise them in. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (depth > 6) return '"…"';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(",")}}`;
}

/**
 * Every file path a "may I edit?" request is about.
 *
 * This is what "always allow" for an EDIT has to be keyed on. It used to be
 * keyed on the string `"edit"` — `item/fileChange/requestApproval` carries no
 * `command` and its `reason` is optional — so ONE click on "always allow" for
 * one file quietly auto-approved every future write that bot ever made, in its
 * workspace AND in every folder shared read-write.
 *
 * The exact envelope differs between codex versions, so every plausible place
 * is read; the paths are sorted and de-duplicated so the key is stable.
 */
export function fileChangePaths(params: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const take = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) found.add(value.trim());
  };
  const fromChanges = (changes: unknown): void => {
    if (!changes) return;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        if (typeof change === "string") take(change);
        else if (change && typeof change === "object") take((change as Record<string, unknown>).path);
      }
      return;
    }
    if (typeof changes === "object") for (const key of Object.keys(changes)) take(key);
  };
  const item = (params.item ?? {}) as Record<string, unknown>;
  fromChanges(params.fileChanges);
  fromChanges(params.changes);
  fromChanges(item.changes);
  fromChanges(item.fileChanges);
  take(params.path);
  take(item.path);
  for (const path of Array.isArray(params.paths) ? params.paths : []) take(path);
  return [...found].sort();
}

export const DENY_TIMEOUT_NOTE =
  "Local BizOS: nobody answered this permission request in time. Skip this action and finish what you can without it.";
export const QUESTION_TIMEOUT_NOTE = "No answer was given — use your best judgment.";

export interface StdioMcpServer {
  command: string;
  args: string[];
  /** Literal, per-server configuration. Verified against codex-cli 0.144:
   * `mcp_servers.<name>.env` is a MAP set on that server alone, so two
   * servers never overwrite each other. It reaches codex through argv, so
   * nothing secret may live here. */
  env: Record<string, string>;
  /** Secrets. Their NAMES go in argv (`env_vars`), their VALUES are set on
   * codex's own environment and forwarded from there — so a `ps` listing
   * shows a variable name and nothing else. Each name must be unique across
   * servers: the forwarding source is one shared environment. */
  forwarded: Record<string, string>;
  /** `true` mounts the server with `default_tools_approval_mode="auto"`;
   * `false` leaves codex's on-request policy so each call raises a card. */
  preApproved: boolean;
}

/** A remote (Streamable HTTP) MCP server. The bearer token, when there is
 * one, follows the same rule as stdio secrets: its NAME rides in argv
 * (`bearer_token_env_var`), its VALUE only ever in the child environment. */
export interface HttpMcpServer {
  url: string;
  /** Literal, non-secret headers — argv-visible, like `env` above. */
  headers: Record<string, string>;
  /** The environment variable codex reads the bearer token from. */
  bearerTokenEnv?: string;
  forwarded: Record<string, string>;
  preApproved: boolean;
}

export type McpServerSpec = StdioMcpServer | HttpMcpServer;

export function isHttpMcpServer(server: McpServerSpec): server is HttpMcpServer {
  return "url" in server;
}

export interface CodexDynamicTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(argumentsValue: unknown, context: {
    callId: string;
    threadId: string;
    turnId: string;
  }): Promise<unknown>;
}

export type RuntimeEvent =
  | { type: "turn.started" }
  | { type: "session.started"; sessionId: string | null; model: string | null }
  | { type: "content.delta"; streamKind: "assistant_text" | "reasoning_text"; delta: string }
  | { type: "item.started"; itemType: "tool"; itemId?: string; title: string }
  | { type: "item.completed"; itemType: "tool"; itemId?: string; ok: boolean }
  | { type: "item.completed"; itemType: "assistant_text"; text: string; itemId?: string; phase?: "commentary" | "final_answer" }
  | {
      type: "request.opened";
      requestId: string;
      requestType: "permission" | "question";
      tool: string;
      summary: string;
      /** What is actually being asked for, normalized: the exact command
       * for a shell/edit approval, the tool name for an MCP call. "Always
       * allow" is remembered against THIS, never against the coarse
       * `tool`, so allowing `ls -la` does not allow every future shell. */
      detail: string;
      /** The same request written for a HUMAN to inspect: the tool and its
       * arguments, the command, the files. It is what the card shows under
       * "Details", in monospace — `detail` above is a hashing key and reads
       * like one (`mcp:run_operation:{"message":…}`). */
      detailText?: string;
      choices?: string[];
    }
  | { type: "request.resolved"; requestId: string; behavior: RequestBehavior; source: RequestSource }
  | { type: "turn.retrying"; attempt: number; delayMs: number; reason: string }
  | { type: "token-usage"; input: number; output: number; cachedInput?: number }
  | { type: "runtime.error"; message: string; setup?: boolean }
  | { type: "turn.completed"; ok: boolean; stopReason: string | null };

export type RequestBehavior = "allow" | "deny" | "answer";
export type RequestSource = "user" | "timeout" | "system";

export interface CodexTurnInput {
  cli: string;
  cwd: string;
  text: string;
  /** Persona; codex has no system slot, so it is prefixed to `text`. */
  system?: string;
  model?: string;
  effort?: ReasoningEffort;
  sandbox: SandboxMode;
  /** Folders the user shared read-write in Settings → Access. They reach
   * codex as the structured per-turn `sandboxPolicy` — see
   * `workspaceWritePolicy`. */
  writableRoots?: string[];
  resumeCursor?: string | null;
  mcpServers?: Record<string, McpServerSpec>;
  /** An external OpenAI-compatible endpoint instead of the signed-in plan:
   * becomes `-c model_provider=…` plus its `model_providers.<id>` table, the
   * key riding in the child environment under `envKey`. */
  modelProvider?: CodexModelProvider;
  /** Host-side tools registered on the Codex thread. Unlike MCP servers,
   * these never receive a credential or inherit a child environment. */
  dynamicTools?: CodexDynamicTool[];
  environment?: Record<string, string | undefined>;
  /** Requests the user already said "always allow" to, for this bot. The
   * whole request is passed — a coarse `tool` alone would auto-accept every
   * command that happens to share a kind. */
  isAlwaysAllowed?: (request: { requestType: "permission" | "question"; tool: string; detail: string }) => boolean;
  /** Settings → Plans & usage said "never ask anyone". The thread starts with
   * `approvalPolicy: "never"` and `sandbox: "danger-full-access"`, and every
   * turn carries the `dangerFullAccess` sandbox policy. */
  skipPermissions?: boolean;
  /** Extra `turn/start` input items — materialized attachments, as
   * `{type:"localImage", path}`. Verified against the app-server v2 schema
   * (`UserInput`), so an image the user attached is really seen. */
  extraInput?: Array<Record<string, unknown>>;
  onEvent: (event: RuntimeEvent) => void;
  /** Redacted native protocol tee, for debugging protocol drift. */
  tee?: (entry: { dir: "in" | "out"; msg: unknown }) => void;
  /** Test seam: scales the retry backoff so a fake CLI's transient
   * failures do not stall real seconds. */
  retryScale?: number;
  /** Test seam: overrides the resolved PATH for the child. */
  pathOverride?: string;
}

export interface CodexTurnHandle {
  stop(): void;
  respond(
    requestId: string,
    decision: { behavior: RequestBehavior; message?: string },
  ): "allowed-once" | "answered" | "rejected" | "unavailable";
  /** The codex thread id, once `thread/start`/`thread/resume` answered —
   * persisted as the resume cursor for this bot × thread. */
  sessionId(): string | null;
  /** Whether the turn has finished (successfully or not). */
  settled(): boolean;
}

// ── the `-c` dialect: TOML, not JSON ────────────────────────────────────────
//
// `codex … -c key=value` parses VALUE as TOML. JSON was close enough to look
// right and wrong where it counts: a JSON object (`{"A":"b"}`) is a TOML
// *string*, not an inline table, so codex-cli 0.144.1 refused the whole
// config with `invalid type: string … expected a map in
// mcp_servers.bizos.env` and exited 1 before a single turn ran — the local
// runtime could not answer at all (F9 proof, 2026-09-02).
//
// Verified against the real binary (`~/.local/bin/codex`, codex-cli 0.144.1),
// `printf '' | codex app-server -c 'mcp_servers.t.command="/bin/echo"' -c …`:
//   env={A="b"}            → exit 0
//   env={"A-B"="b c",…}    → exit 0   (quoted keys, spaces and escapes)
//   env={}                 → exit 0
//   env={"A":"b"}          → exit 1   (the shipped bug)
// Arrays (`args`, `env_vars`) were already valid TOML by accident; they are
// built here too so ONE writer owns the escaping.

const TOML_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

/** A TOML *basic string*. Escapes what TOML 1.0 forbids raw: the backslash,
 * the quotation mark, and every control character (U+0000–U+001F, U+007F) —
 * the named escape when there is one, `\uXXXX` otherwise. */
export function tomlString(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = TOML_ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).toUpperCase().padStart(4, "0")}` : char;
  }
  return `${out}"`;
}

/** A TOML key: bare when it can be (`[A-Za-z0-9_-]+`), quoted otherwise. An
 * environment variable is normally bare, but nothing in the type says so. */
export function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/** `{A="b",C="d"}` — the inline table codex expects for a map. Empty is `{}`. */
export function tomlInlineTable(map: Record<string, string>): string {
  return `{${Object.entries(map)
    .map(([key, value]) => `${tomlKey(key)}=${tomlString(value)}`)
    .join(",")}}`;
}

/** `["a","b"]` — a TOML array of basic strings. */
export function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(",")}]`;
}

/** Build the `-c mcp_servers.<name>.…` arguments for one server.
 *
 * Values stay in the child ENVIRONMENT; argv carries only the variable
 * NAMES, so a session cookie never appears in `ps` output or a crash dump.
 */
export function mcpServerArgs(name: string, server: McpServerSpec): string[] {
  const prefix = `mcp_servers.${tomlKey(name)}`;
  const args: string[] = [];
  if (isHttpMcpServer(server)) {
    args.push("-c", `${prefix}.url=${tomlString(server.url)}`);
    if (Object.keys(server.headers).length) {
      args.push("-c", `${prefix}.http_headers=${tomlInlineTable(server.headers)}`);
    }
    if (server.bearerTokenEnv) {
      args.push("-c", `${prefix}.bearer_token_env_var=${tomlString(server.bearerTokenEnv)}`);
    }
  } else {
    args.push(
      "-c",
      `${prefix}.command=${tomlString(server.command)}`,
      "-c",
      `${prefix}.args=${tomlStringArray(server.args)}`,
      "-c",
      `${prefix}.env=${tomlInlineTable(server.env)}`,
      "-c",
      `${prefix}.env_vars=${tomlStringArray(Object.keys(server.forwarded))}`,
    );
  }
  if (server.preApproved) args.push("-c", `${prefix}.default_tools_approval_mode="auto"`);
  return args;
}

/** `-c model_provider=…` and the `model_providers.<id>` table for an
 * external endpoint. The key's NAME is the only secret-adjacent thing in
 * argv; the value is set on the child environment by
 * `codexChildEnvironment`. */
export function modelProviderArgs(provider: CodexModelProvider): string[] {
  const prefix = `model_providers.${tomlKey(provider.id)}`;
  return [
    "-c",
    `model_provider=${tomlString(provider.id)}`,
    "-c",
    `${prefix}.name=${tomlString(provider.name)}`,
    "-c",
    `${prefix}.base_url=${tomlString(provider.baseUrl)}`,
    "-c",
    `${prefix}.wire_api=${tomlString(provider.wireApi)}`,
    ...(provider.apiKey ? ["-c", `${prefix}.env_key=${tomlString(provider.envKey)}`] : []),
  ];
}

export function buildAppServerArgs(mcpServers: Record<string, McpServerSpec>, modelProvider?: CodexModelProvider): string[] {
  const args = ["app-server"];
  if (modelProvider) args.push(...modelProviderArgs(modelProvider));
  for (const [name, server] of Object.entries(mcpServers)) args.push(...mcpServerArgs(name, server));
  return args;
}

/** The environment a codex child gets: the shared clean base (see
 * `child-env.ts`) plus ONLY the forwarded secret names each tool server
 * needs. The servers' literal configuration (`server.env`) is deliberately
 * NOT hoisted — it is per-server and hoisting it is what used to hand every
 * server the same `LBZ_TOOLSET`, and the model the session cookie. */
export function codexChildEnvironment(
  base: Record<string, string | undefined>,
  mcpServers: Record<string, McpServerSpec>,
  pathValue: string,
  modelProvider?: CodexModelProvider,
): Record<string, string | undefined> {
  const environment = cleanChildEnvironment(base, pathValue);
  if (modelProvider?.apiKey) environment[modelProvider.envKey] = modelProvider.apiKey;
  for (const server of Object.values(mcpServers)) {
    for (const [name, value] of Object.entries(server.forwarded)) {
      if (name in environment && environment[name] !== value) {
        // Two servers claiming one name means one of them would silently
        // run with the other's credential. Refuse the turn instead.
        throw new Error(`two MCP servers claim the environment variable ${name}`);
      }
      environment[name] = value;
    }
  }
  return environment;
}

/** codex's own workspace-write settings, as `config/read` reports them. */
interface WorkspaceWriteConfig {
  writable_roots?: unknown;
  network_access?: unknown;
  exclude_slash_tmp?: unknown;
  exclude_tmpdir_env_var?: unknown;
}

export interface WorkspaceWritePolicy {
  type: "workspaceWrite";
  writableRoots: string[];
  networkAccess: boolean;
  excludeSlashTmp: boolean;
  excludeTmpdirEnvVar: boolean;
}

export interface ReadOnlyPolicy {
  type: "readOnly";
}

/** No sandbox at all. Verified against codex-cli 0.154.0 (`codex app-server
 * generate-json-schema`): `SandboxPolicy` is a tagged union whose arms are
 * `dangerFullAccess`, `readOnly`, `externalSandbox` and `workspaceWrite`, and
 * `ThreadStartParams.sandbox` (the coarse `SandboxMode` enum) accepts
 * `danger-full-access` alongside `read-only` and `workspace-write`. Only the
 * global `skip-all` permission policy produces it. */
export interface DangerFullAccessPolicy {
  type: "dangerFullAccess";
}

/** Build the `sandboxPolicy` a turn carries when the user shared a folder
 * read-write.
 *
 * Verified against codex-cli 0.144.1 (`codex app-server generate-json-schema`):
 * `TurnStartParams.sandboxPolicy` is a structured union — "Override the
 * sandbox policy for this turn and subsequent turns" — whose `workspaceWrite`
 * arm carries `writableRoots`. `ThreadStartParams` has no such field (only
 * the coarse `sandbox` enum), which is why this rides on `turn/start`.
 *
 * The override REPLACES the policy wholesale, so the user's own
 * `sandbox_workspace_write` FLAGS (network access, /tmp handling) are read back
 * with `config/read` and carried into it: without that, sharing one folder
 * would silently reset settings they chose for their own codex.
 *
 * Their `writable_roots` are deliberately NOT carried over. Local BizOS's
 * Access screen is a promise — it lists what is shared, and it lists what is
 * "never shared, whatever you turn on". A `~/.codex/config.toml` containing
 * `writable_roots = ["/"]` used to be merged in silently, so the screen said
 * `~/.ssh` was out of reach while the sandbox made it writable. What this app
 * grants is what this app was told to grant: the cwd, plus the folders shared
 * read-write, and nothing that arrived from somewhere else. */
export async function workspaceWritePolicy(
  read: (method: string, params: unknown) => Promise<unknown>,
  cwd: string,
  writableRoots: string[],
): Promise<WorkspaceWritePolicy> {
  let current: WorkspaceWriteConfig = {};
  try {
    const answer = (await read("config/read", { cwd })) as
      | { config?: { sandbox_workspace_write?: WorkspaceWriteConfig | null } }
      | undefined;
    current = answer?.config?.sandbox_workspace_write ?? {};
  } catch {
    // Older CLI, or a config it cannot read: the defaults below are what it
    // would have applied on its own.
  }
  return {
    type: "workspaceWrite",
    // Fail-closed: the cwd codex adds itself, plus exactly the folders this app
    // validated. Never `current.writable_roots`.
    writableRoots: [...new Set(writableRoots)],
    networkAccess: current.network_access === true,
    excludeSlashTmp: current.exclude_slash_tmp === true,
    excludeTmpdirEnvVar: current.exclude_tmpdir_env_var === true,
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function startCodexTurn(input: CodexTurnInput): CodexTurnHandle {
  const mcpServers = input.mcpServers ?? {};
  const retryScale = input.retryScale ?? 1;
  const messagePhases = new Map<string, "commentary" | "final_answer">();
  const completedMessages = new Set<string>();
  const asks = new Map<string, (behavior: RequestBehavior, message?: string, source?: RequestSource) => void>();
  const state = {
    settled: false,
    stopRequested: false,
    sawStreamDelta: false,
    sawAnyPublicOutput: false,
    sessionId: null as string | null,
    child: null as PipedChild | null,
  };

  const emit = (event: RuntimeEvent): void => {
    try {
      input.onEvent(event);
    } catch {
      // A listener must never take the turn down with it.
    }
  };

  const stop = (): void => {
    state.stopRequested = true;
    if (state.child) killCliTree(state.child);
  };

  const launch = (attempt: number): void => {
    const environment = codexChildEnvironment(
      input.environment ?? process.env,
      mcpServers,
      input.pathOverride ?? augmentedPath(input.environment as NodeJS.ProcessEnv | undefined),
      input.modelProvider,
    );
    const child = spawnCli(input.cli, buildAppServerArgs(mcpServers, input.modelProvider), {
      cwd: input.cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    state.child = child;
    let abandoned = false;
    let nextId = 1;
    const pending = new Map<number, PendingRequest>();

    const send = (message: unknown): void => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        // The child died; `close` settles the turn.
      }
      input.tee?.({ dir: "out", msg: redactSecrets(message) });
    };

    const request = (method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        // A wedged app-server can accept stdin and never reply; without
        // this the handshake await hangs and the bot stays busy forever.
        const timer = setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`codex ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        send({ jsonrpc: "2.0", id, method, params });
      });

    const settle = (ok: boolean, stopReason: string | null): void => {
      if (state.settled) return;
      state.settled = true;
      for (const finish of [...asks.values()]) finish("deny", "Local BizOS: the turn ended", "system");
      for (const entry of pending.values()) entry.reject(new Error("turn settled"));
      pending.clear();
      emit({ type: "turn.completed", ok, stopReason });
      // The app-server never exits on its own.
      killCliTree(child);
    };

    const handleServerRequest = (message: Record<string, unknown>): void => {
      const method = String(message.method ?? "");
      const params = (message.params ?? {}) as Record<string, unknown>;
      if (method === "item/tool/call") {
        const toolName = typeof params.tool === "string" ? params.tool : "";
        const tool = input.dynamicTools?.find((candidate) => candidate.name === toolName);
        const callId = typeof params.callId === "string" ? params.callId : "";
        const threadId = typeof params.threadId === "string" ? params.threadId : "";
        const turnId = typeof params.turnId === "string" ? params.turnId : "";
        void (async () => {
          try {
            if (!tool || !callId || !threadId || !turnId) throw new Error("Unknown or malformed local dynamic tool call.");
            const value = await tool.call(params.arguments, { callId, threadId, turnId });
            const text = typeof value === "string" ? value : JSON.stringify(value);
            send({
              jsonrpc: "2.0",
              id: message.id,
              result: { success: true, contentItems: [{ type: "inputText", text: text.slice(0, 16_000) }] },
            });
          } catch (caught) {
            const text = redactSecretsInText(caught instanceof Error ? caught.message : String(caught)).slice(0, 4_000);
            send({
              jsonrpc: "2.0",
              id: message.id,
              result: { success: false, contentItems: [{ type: "inputText", text }] },
            });
          }
        })();
        return;
      }
      const meta = (params._meta ?? {}) as Record<string, unknown>;
      const legacy = method === "execCommandApproval" || method === "applyPatchApproval";
      const isMcpElicitation =
        method === "mcpServer/elicitation/request" && meta.codex_approval_kind === "mcp_tool_call";
      const isQuestion = method === "item/tool/requestUserInput";
      const mcpTool = isMcpElicitation
        ? /tool "([^"]+)"/.exec(String(params.message ?? ""))?.[1]
        : undefined;
      const tool = isMcpElicitation
        ? (mcpTool ?? "mcp")
        : method === "item/fileChange/requestApproval" || method === "applyPatchApproval"
          ? "edit"
          : isQuestion
            ? "ask_user"
            : "shell";

      // What the user is really being asked to allow. `tool` is a KIND
      // ("shell", "edit", "mcp"); this is the thing itself, and it is what
      // "always allow" is keyed on — so it has to name the thing, not the kind.
      //
      //   · shell  → the command, as before;
      //   · edit   → the files, sorted (`edit` alone auto-approved every
      //              future write the bot ever made);
      //   · mcp    → the tool AND its arguments (the name alone meant that
      //              allowing one `run_operation` allowed every one after it —
      //              "anything that changes the business", billing included).
      //
      // When the arguments carry something that changes each time, the key
      // simply stops matching and the card is drawn again. That is the safe
      // direction to fail in.
      const editPaths = tool === "edit" ? fileChangePaths(params) : [];
      const rawDetail = isMcpElicitation
        ? `mcp:${tool}:${canonicalJson({
            message: typeof params.message === "string" ? params.message : null,
            arguments: params.arguments ?? meta.arguments ?? null,
          })}`
        : tool === "edit"
          ? `edit:${
              editPaths.length
                ? editPaths.join("\n")
                : canonicalJson({ reason: params.reason ?? null, params: params.item ?? null })
            }`
          : typeof params.command === "string"
            ? params.command
            : Array.isArray(params.command)
              ? (params.command as unknown[]).map(String).join(" ")
              : typeof params.reason === "string"
                ? params.reason
                : tool;
      const detail = rawDetail.slice(0, MAX_DETAIL_CHARS);
      // What a person would need to see to judge the request. Never the key.
      const mcpArguments = params.arguments ?? meta.arguments ?? null;
      const rawDetailText = isMcpElicitation
        ? [mcpTool ?? "", mcpArguments ? canonicalJson(mcpArguments) : ""].filter(Boolean).join("\n")
        : tool === "edit"
          ? editPaths.join("\n")
          : typeof params.command === "string"
            ? params.command
            : Array.isArray(params.command)
              ? (params.command as unknown[]).map(String).join(" ")
              : "";
      const detailText = rawDetailText.slice(0, MAX_DETAIL_CHARS);

      const accept = (): void =>
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: isMcpElicitation
            ? { action: "accept", content: {} }
            : { decision: legacy ? "approved" : "accept" },
        });

      // A request the user already answered "always allow" for never asks
      // again — the same request, not merely the same kind of request.
      if (!isQuestion && input.isAlwaysAllowed?.({ requestType: "permission", tool, detail })) {
        accept();
        return;
      }

      const requestId = `req_${nextId++}_${Date.now().toString(36)}`;
      const questions = Array.isArray(params.questions) ? (params.questions as Record<string, unknown>[]) : [];
      const summary =
        isMcpElicitation && typeof params.message === "string"
          ? params.message
          : typeof params.command === "string"
            ? params.command
            : questions.length
              ? questions
                  .map((question) => question.question ?? question.header)
                  .filter(Boolean)
                  .map(String)
                  .join(" · ")
              : typeof params.reason === "string"
                ? params.reason
                : tool;
      const firstQuestion = questions[0];
      const rawChoices = Array.isArray(firstQuestion?.options) ? firstQuestion.options : [];
      const choices = isQuestion
        ? rawChoices
            .map((option) => (option as Record<string, unknown>)?.label)
            .filter((label): label is string => typeof label === "string")
            .slice(0, 5)
        : undefined;

      const finish = (
        behavior: RequestBehavior,
        answer?: string,
        source: RequestSource = "user",
      ): void => {
        if (!asks.delete(requestId)) return;
        clearTimeout(timer);
        if (isQuestion) {
          const answers: Record<string, { answers: string[] }> = {};
          for (const question of questions) {
            answers[String(question.id)] = { answers: [answer || QUESTION_TIMEOUT_NOTE] };
          }
          send({ jsonrpc: "2.0", id: message.id, result: { answers } });
        } else if (behavior === "allow") {
          accept();
        } else {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: isMcpElicitation
              ? { action: "decline" }
              : { decision: legacy ? "denied" : "decline" },
          });
        }
        emit({ type: "request.resolved", requestId, behavior, source });
      };

      const timer = setTimeout(
        () =>
          isQuestion
            ? finish("answer", QUESTION_TIMEOUT_NOTE, "timeout")
            : finish("deny", DENY_TIMEOUT_NOTE, "timeout"),
        APPROVAL_TIMEOUT_MS,
      );
      timer.unref?.();
      asks.set(requestId, finish);
      emit({
        type: "request.opened",
        requestId,
        requestType: isQuestion ? "question" : "permission",
        tool,
        summary,
        detail,
        ...(detailText ? { detailText } : {}),
        ...(choices && choices.length ? { choices } : {}),
      });
    };

    const handleNotification = (message: Record<string, unknown>): void => {
      if (state.stopRequested || state.settled) return;
      const params = (message.params ?? {}) as Record<string, unknown>;
      switch (message.method) {
        case "item/agentMessage/delta": {
          const delta = typeof params.delta === "string" ? params.delta : "";
          if (delta) {
            state.sawStreamDelta = true;
            state.sawAnyPublicOutput = true;
            emit({ type: "content.delta", streamKind: "assistant_text", delta });
          }
          break;
        }
        case "item/reasoning/textDelta":
        case "item/reasoning/summaryTextDelta": {
          const delta = typeof params.delta === "string" ? params.delta : "";
          if (delta) emit({ type: "content.delta", streamKind: "reasoning_text", delta });
          break;
        }
        case "item/started": {
          const item = (params.item ?? {}) as Record<string, unknown>;
          if (item.type === "agentMessage" && typeof item.id === "string" &&
              (item.phase === "commentary" || item.phase === "final_answer")) messagePhases.set(item.id, item.phase);
          const title =
            item.type === "commandExecution"
              ? String(item.command ?? "shell")
              : item.type === "fileChange"
                ? "edit"
                : item.type === "mcpToolCall" || item.type === "dynamicToolCall"
                  ? String(item.tool ?? item.name ?? "mcp")
                  : item.type === "webSearch"
                    ? "web_search"
                    : null;
          if (title) {
            emit({
              type: "item.started",
              itemType: "tool",
              ...(typeof item.id === "string" ? { itemId: item.id } : {}),
              title,
            });
          }
          break;
        }
        case "item/completed": {
          const item = (params.item ?? {}) as Record<string, unknown>;
          if (item.type === "agentMessage") {
            if (typeof item.id === "string" && completedMessages.has(item.id)) break;
            const phase = item.phase === "commentary" || item.phase === "final_answer"
              ? item.phase : typeof item.id === "string" ? messagePhases.get(item.id) : undefined;
            const text = typeof item.text === "string" ? item.text : "";
            if (text.trim() || phase === "final_answer") {
              if (text && !state.sawStreamDelta) {
                emit({ type: "content.delta", streamKind: "assistant_text", delta: text });
              }
              state.sawStreamDelta = false;
              state.sawAnyPublicOutput = true;
              if (typeof item.id === "string") completedMessages.add(item.id);
              emit({ type: "item.completed", itemType: "assistant_text", text,
                ...(typeof item.id === "string" ? { itemId: item.id } : {}),
                ...(phase ? { phase } : {}),
              });
            }
          } else if (
            ["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch"].includes(String(item.type))
          ) {
            emit({
              type: "item.completed",
              itemType: "tool",
              ...(typeof item.id === "string" ? { itemId: item.id } : {}),
              ok: item.status !== "failed" && item.status !== "declined",
            });
          }
          break;
        }
        case "thread/tokenUsage/updated": {
          const usage = (params.tokenUsage ?? {}) as Record<string, unknown>;
          const total = (usage.last ?? usage.total) as Record<string, unknown> | undefined;
          if (total) {
            emit({
              type: "token-usage",
              input: Number(total.inputTokens ?? 0),
              output: Number(total.outputTokens ?? 0),
              ...(typeof total.cachedInputTokens === "number"
                ? { cachedInput: total.cachedInputTokens }
                : {}),
            });
          }
          break;
        }
        case "turn/completed": {
          const turn = (params.turn ?? {}) as Record<string, unknown>;
          const error = (turn.error ?? {}) as Record<string, unknown>;
          settle(
            turn.status === "completed",
            turn.status === "completed" ? null : String(error.message ?? turn.status ?? "failed"),
          );
          break;
        }
        case "error": {
          // Shape drift: 0.144 sends {message}, 0.139 nests it under
          // {error:{message}} — surface either.
          const nested = (params.error ?? {}) as Record<string, unknown>;
          const text = params.message ?? nested.message;
          // A configured-or-compromised codex can print anything here, its
          // own environment included; it reaches a persisted block, so it
          // is redacted before it leaves the driver.
          if (text) emit({ type: "runtime.error", message: redactSecretsInText(String(text)).slice(0, 400) });
          break;
        }
        default:
          break;
      }
    };

    let buffer = "";
    // Decode as UTF-8 across chunk boundaries — a raw `buffer += chunk`
    // splits multibyte characters that straddle two reads.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        input.tee?.({ dir: "in", msg: redactSecrets(message) });
        if (abandoned) continue;
        const hasResult = message.result !== undefined || message.error !== undefined;
        if (message.id !== undefined && hasResult) {
          const entry = pending.get(message.id as number);
          if (!entry) continue;
          pending.delete(message.id as number);
          if (message.error) {
            const error = message.error as Record<string, unknown>;
            entry.reject(new Error(String(error.message ?? JSON.stringify(error))));
          } else {
            entry.resolve(message.result);
          }
        } else if (message.id !== undefined && message.method) {
          handleServerRequest(message);
        } else if (message.method) {
          handleNotification(message);
        }
      }
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (abandoned) return;
      emit({ type: "runtime.error", ...describeSpawnFailure(error, input.cli, input.cwd) });
      settle(false, "spawn_error");
    });
    child.on("close", (code: number | null) => {
      if (abandoned || state.settled) return;
      if (state.stopRequested) {
        settle(false, "interrupted");
        return;
      }
      const tail = stderr ? `: ${redactSecretsInText(stderr.trim()).slice(-300)}` : "";
      emit({ type: "runtime.error", message: `codex exited ${code} before turn/completed${tail}` });
      settle(false, "exit_before_result");
    });

    if (attempt === 0) emit({ type: "turn.started" });

    void (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "localbizos", version: "1" },
          ...(input.dynamicTools?.length ? { capabilities: { experimentalApi: true } } : {}),
        });
        send({ jsonrpc: "2.0", method: "initialized", params: {} });

        let codexThreadId: string | null = null;
        let startedModel: string | null = null;
        const dynamicCursorPrefix = "lbz-dynamic-v1:";
        const persistedCursor = typeof input.resumeCursor === "string" ? input.resumeCursor : null;
        const cursor = persistedCursor?.startsWith(dynamicCursorPrefix)
          ? persistedCursor.slice(dynamicCursorPrefix.length)
          : input.dynamicTools?.length ? null : persistedCursor;
        if (cursor) {
          try {
            const resumed = (await request("thread/resume", { threadId: cursor })) as
              | { thread?: { id?: string } }
              | undefined;
            codexThreadId = resumed?.thread?.id ?? cursor;
          } catch {
            // Resume unsupported or the thread is gone — start fresh.
          }
        }
        if (!codexThreadId) {
          const started = (await request("thread/start", {
            cwd: input.cwd,
            ...(input.model ? { model: input.model } : {}),
            // `skip-all` is the whole point of the setting: no sandbox, no
            // approvals, for every agent at once.
            sandbox: input.skipPermissions ? "danger-full-access" : input.sandbox,
            approvalPolicy: input.skipPermissions ? "never" : "on-request",
            ephemeral: false,
            ...(input.dynamicTools?.length ? {
              dynamicTools: input.dynamicTools.map(({ name, description, inputSchema }) => ({
                type: "function",
                name,
                description,
                inputSchema,
              })),
            } : {}),
          })) as { thread?: { id?: string }; model?: string } | undefined;
          codexThreadId = started?.thread?.id ?? null;
          startedModel = started?.model ?? null;
        }
        const sessionId = codexThreadId && input.dynamicTools?.length
          ? `${dynamicCursorPrefix}${codexThreadId}`
          : codexThreadId;
        state.sessionId = sessionId;
        emit({ type: "session.started", sessionId, model: startedModel ?? input.model ?? null });

        // Writable roots only mean something in a write sandbox: in
        // `read-only` the user's shared folders are named to the bot and
        // readable by the tools, and nothing is writable — saying otherwise
        // would be a permission the runtime does not grant.
        //
        // The policy is sent on EVERY workspace-write turn, empty roots
        // included. `turn/start`'s override lasts "for this turn and subsequent
        // turns", so a resumed thread kept the roots of the turn that first set
        // them: revoking a shared folder left it writable until the app was
        // restarted. Sending the current policy every time is what makes a
        // revocation take effect on the next message.
        const writableRoots = input.sandbox === "workspace-write" ? (input.writableRoots ?? []) : [];
        const sandboxPolicy: WorkspaceWritePolicy | ReadOnlyPolicy | DangerFullAccessPolicy =
          input.skipPermissions
            ? { type: "dangerFullAccess" }
            : input.sandbox === "workspace-write"
              ? await workspaceWritePolicy(request, input.cwd, writableRoots)
              : { type: "readOnly" };

        await request("turn/start", {
          threadId: codexThreadId,
          input: [
            { type: "text", text: input.system ? `${input.system}\n\n${input.text}` : input.text },
            ...(input.extraInput ?? []),
          ],
          // Spread, not `effort: … ?? null`: against codex-cli, null is
          // indistinguishable from an absent key — both leave the thread's
          // current effort alone.
          ...(input.effort ? { effort: input.effort } : {}),
          // `TurnStartParams.approvalPolicy` overrides the thread's "for this
          // turn and subsequent turns". Sent only in `skip-all`, because a
          // RESUMED thread never sees `thread/start` again and would otherwise
          // keep asking under a policy the user has since turned off.
          ...(input.skipPermissions ? { approvalPolicy: "never" } : {}),
          sandboxPolicy,
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        const needsAuth = /(?:\b401\b|unauthorized|missing bearer|authentication required)/i.test(message);
        const verdict = classifyError(caught instanceof Error ? caught : { text: message });
        const retryable =
          !state.settled &&
          !needsAuth &&
          !state.stopRequested &&
          verdict.transient &&
          attempt < RETRY_MAX_ATTEMPTS - 1 &&
          !state.sawAnyPublicOutput;
        if (retryable) {
          const delayMs = computeBackoff(attempt);
          emit({ type: "turn.retrying", attempt: attempt + 1, delayMs, reason: verdict.reason });
          // This app-server never exits by itself. Retire the failed
          // attempt and silence its late handlers before the replacement.
          abandoned = true;
          killCliTree(child);
          const timer = setTimeout(() => {
            if (state.stopRequested) settle(false, "interrupted");
            else launch(attempt + 1);
          }, Math.max(1, Math.round(delayMs * retryScale)));
          timer.unref?.();
          return;
        }
        if (!state.settled) {
          emit({
            type: "runtime.error",
            message: redactSecretsInText(message),
            ...(needsAuth ? { setup: true } : {}),
          });
          settle(false, needsAuth ? "auth_required" : "rpc_error");
        }
      }
    })();
  };

  launch(0);

  return {
    stop,
    respond(requestId, decision) {
      const finish = asks.get(requestId);
      if (!finish) return "unavailable";
      finish(decision.behavior, decision.message, "user");
      return decision.behavior === "allow" ? "allowed-once" : decision.behavior === "answer" ? "answered" : "rejected";
    },
    sessionId: () => state.sessionId,
    settled: () => state.settled,
  };
}
