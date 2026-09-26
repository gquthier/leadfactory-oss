// Cursor CLI driver — print mode over stream-json.
//
// Spawns `cursor-agent -p … --output-format stream-json
// --stream-partial-output` in the bot's workspace and normalizes the frames
// into the same `RuntimeEvent` / `CodexTurnHandle` shape the Codex and Claude
// drivers emit, so `dispatch.ts` does not care which CLI answered.
//
// Two things are structurally different from the other two families, and both
// are deliberate:
//
//   * There is NO approval channel. Cursor print mode cannot raise a BizOS
//     permission card, so dispatch mounts only servers the host already marks
//     `preApproved`. The CLI stays sandboxed even under Local BizOS's global
//     skip setting; this driver never passes `--force`, `--yolo` or the global
//     `--approve-mcps` switch.
//   * There is NO `--mcp-config`, but Cursor CLI 2026.09.18 supports a local
//     plugin per invocation. The driver writes that plugin and its scoped
//     `Mcp(server:*)` permissions into a private disposable profile, passes it
//     with `--plugin-dir`, then removes it at the terminal outcome. The bot's
//     workspace and the person's project/global Cursor files are untouched.
//
// The prompt is a positional argument (Cursor has no system slot), so the
// persona is prefixed to the text exactly as the Codex driver does.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { augmentedPath } from "./env-path.js";
import { cursorChildEnvironment } from "./cursor-status.js";
import {
  isHttpMcpServer,
  type CodexTurnHandle,
  type McpServerSpec,
  type RuntimeEvent,
} from "./codex-driver.js";
import { describeSpawnFailure, killCliTree, spawnCli, type PipedChild } from "./procs.js";
import { redactSecrets, redactSecretsInText } from "./redact.js";
import { classifyError } from "./retry.js";
import { labelForTool } from "./style.js";
import type { PermissionPolicy, SandboxMode } from "./types.js";

export interface CursorTurnInput {
  cli: string;
  cwd: string;
  text: string;
  /** Persona; Cursor has no system slot, so it is prefixed to `text`. */
  system?: string;
  model?: string;
  sandbox: SandboxMode;
  /** The Cursor chat id from the previous turn, for `--resume`. */
  resumeCursor?: string | null;
  environment?: Record<string, string | undefined>;
  onEvent: (event: RuntimeEvent) => void;
  tee?: (entry: { dir: "in" | "out"; msg: unknown }) => void;
  pathOverride?: string;
  /** Settings → Plans & usage said "never ask anyone": see `buildCursorArgs`. */
  skipPermissions?: boolean;
  /** Run-scoped, host-preapproved MCP servers. Never sourced from user config. */
  mcpServers?: Record<string, McpServerSpec>;
}

/**
 * The argv for one print turn.
 *
 * `--trust` is unconditional: the workspace is a folder the person chose in
 * this app, and a trust prompt has no TTY to appear on — without it the turn
 * hangs. `--workspace` is passed as well as the child's `cwd` so the CLI's
 * own idea of the root is the one the harness picked.
 *
 * Cursor's own sandbox remains enabled for every print turn. It is not an
 * approval card, but it keeps the no-TTY family within the chosen workspace.
 * Run-scoped MCP permissions are carried by the disposable CLI profile.
 *   * sandbox `read-only`   → `--mode plan` on top of either of the two
 *     above, so the agent analyses and proposes instead of editing.
 */
export function buildCursorArgs(input: {
  text: string;
  system?: string;
  model?: string;
  cwd: string;
  sandbox: SandboxMode;
  resumeCursor?: string | null;
  skipPermissions?: boolean;
  pluginDir?: string;
}): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--trust",
    "--workspace",
    input.cwd,
  ];
  args.push("--sandbox", "enabled");
  if (input.pluginDir) args.push("--plugin-dir", input.pluginDir);
  if (input.sandbox === "read-only") args.push("--mode", "plan");
  if (input.model) args.push("--model", input.model);
  if (input.resumeCursor) args.push("--resume", input.resumeCursor);
  // Last, and after every flag: the prompt is positional.
  args.push(input.system ? `${input.system}\n\n${input.text}` : input.text);
  return args;
}

/** What the transcript says about a Cursor turn: this family has no approval
 * cards at all, whatever the global permission policy is. */
export function cursorPermissionNote(permissions: PermissionPolicy | undefined): string {
  return permissions === "skip-all"
    ? "Cursor print mode has no approval cards — this turn kept Cursor's workspace sandbox and auto-allowed only the run-scoped BizOS MCP tools mounted by the host."
    : "Cursor print mode has no approval cards — this turn ran inside Cursor's workspace sandbox; only host-preapproved BizOS tools were mounted.";
}

export const CURSOR_PLUGIN_MIN_VERSION = "2026.09.18";
const CURSOR_PLUGIN_DIR_NAME = "bizos-runtime";
const CURSOR_PLUGIN_PREFIX = `plugin-${CURSOR_PLUGIN_DIR_NAME}-`;

type CursorMcpProfile = Readonly<{
  root: string;
  pluginDir: string;
  configDir: string;
  launcher: string;
  forwarded: Record<string, string>;
}>;

function privateJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Cursor plugin config without secret values. Forwarded secrets live only in
 * this turn's child environment and are referenced by name. */
export function cursorMcpConfig(servers: Record<string, McpServerSpec>): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) throw new Error(`Cursor cannot mount MCP server ${name}`);
    if (isHttpMcpServer(server)) {
      mcpServers[name] = {
        url: server.url,
        headers: {
          ...server.headers,
          ...(server.bearerTokenEnv
            ? { Authorization: `Bearer \${env:${server.bearerTokenEnv}}` }
            : {}),
        },
      };
    } else {
      mcpServers[name] = {
        command: server.command,
        args: server.args,
        env: {
          ...server.env,
          ...Object.fromEntries(Object.keys(server.forwarded).map((key) => [key, `\${env:${key}}`])),
        },
      };
    }
  }
  return { mcpServers };
}

export function cursorMcpPermissions(servers: Record<string, McpServerSpec>): string[] {
  return Object.keys(servers).sort().map((name) => `Mcp(${CURSOR_PLUGIN_PREFIX}${name}:*)`);
}

/** Cursor print mode cannot forward a permission request to BizOS. Servers
 * that require one stay absent instead of being advertised but unusable. */
export function cursorPreapprovedServers(
  servers: Record<string, McpServerSpec>,
): Record<string, McpServerSpec> {
  return Object.fromEntries(Object.entries(servers).filter(([, server]) => server.preApproved));
}

function cursorMcpProfile(servers: Record<string, McpServerSpec>): CursorMcpProfile | null {
  if (!Object.keys(servers).length) return null;
  const root = mkdtempSync(join(realpathSync(tmpdir()), "bizos-cursor-"));
  try {
    chmodSync(root, 0o700);
    const pluginDir = join(root, CURSOR_PLUGIN_DIR_NAME);
    const manifestDir = join(pluginDir, ".cursor-plugin");
    const configDir = join(root, "profile");
    mkdirSync(manifestDir, { recursive: true, mode: 0o700 });
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    privateJson(join(manifestDir, "plugin.json"), {
      name: "bizos-runtime",
      version: "1.0.0",
      description: "Disposable run-scoped Local BizOS tools",
    });
    privateJson(join(pluginDir, "mcp.json"), cursorMcpConfig(servers));
    privateJson(join(configDir, "cli-config.json"), {
      permissions: { allow: cursorMcpPermissions(servers), deny: [] },
    });
    const launcher = join(root, "cursor-private");
    writeFileSync(launcher, "#!/bin/sh\numask 077\nexec \"$@\"\n", { encoding: "utf8", mode: 0o700 });
    chmodSync(launcher, 0o700);
    const forwarded: Record<string, string> = {};
    for (const server of Object.values(servers)) {
      for (const [key, value] of Object.entries(server.forwarded)) {
        if (key in forwarded && forwarded[key] !== value) {
          throw new Error(`Cursor MCP environment variable ${key} is ambiguous`);
        }
        forwarded[key] = value;
      }
    }
    return {
      root: realpathSync(root),
      pluginDir: realpathSync(pluginDir),
      configDir: realpathSync(configDir),
      launcher: realpathSync(launcher),
      forwarded,
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** The tool a `tool_call` frame names, across both encodings the CLI has
 * used: proto3 JSON (`{readToolCall:{…}}`) and protobuf-es' in-memory oneof
 * (`{tool:{case:"readToolCall",value:{…}}}`). */
export function cursorToolName(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) return "";
  const row = toolCall as Record<string, unknown>;
  const oneof = row.tool as Record<string, unknown> | undefined;
  if (oneof && typeof oneof === "object" && typeof oneof.case === "string" && oneof.case) return oneof.case;
  for (const key of Object.keys(row)) {
    if (key === "tool" || key === "args" || key === "result") continue;
    return key;
  }
  return "";
}

/**
 * Cursor's own tool names, in the words the shared vocabulary uses. The
 * table is here rather than in `style.ts` because these are protobuf field
 * names of one CLI, not tool ids the rest of the app knows; anything not
 * listed falls through to `labelForTool`, never to a raw `…ToolCall`.
 */
const CURSOR_TOOL_LABELS: Record<string, string> = {
  read: "Reading a file",
  edit: "Editing a file",
  applyAgentDiff: "Editing a file",
  delete: "Deleting a file",
  shell: "Running a command",
  ls: "Listing files",
  glob: "Searching files",
  grep: "Searching files",
  semSearch: "Searching files",
  readLints: "Checking the code",
  fetch: "Reading a page",
  webFetch: "Reading a page",
  webSearch: "Searching the web",
  createPlan: "Writing a plan",
  createGoal: "Writing a plan",
  updateGoal: "Updating the plan",
  readTodos: "Checking the plan",
  updateTodos: "Updating the plan",
  task: "Working on it",
  reflect: "Thinking it through",
  computerUse: "Using the computer",
  generateImage: "Making an image",
  askQuestion: "Working on it",
  communicateUpdate: "Working on it",
};

/** `readToolCall` → "Reading a file"; anything unnamed → the shared table's
 * own fallback, never a raw protobuf field name in the transcript. */
export function cursorToolTitle(toolCall: unknown): string {
  const name = cursorToolName(toolCall);
  if (!name) return labelForTool("");
  const bare = name.replace(/ToolCall$/, "");
  const known = CURSOR_TOOL_LABELS[bare] ?? CURSOR_TOOL_LABELS[bare.charAt(0).toLowerCase() + bare.slice(1)];
  return known ?? labelForTool(bare);
}

export function startCursorTurn(input: CursorTurnInput): CodexTurnHandle {
  const state = {
    settled: false,
    stopRequested: false,
    sessionId: null as string | null,
    child: null as PipedChild | null,
    resultError: null as string | null,
    resultSeen: false,
    profile: null as CursorMcpProfile | null,
  };

  const emit = (event: RuntimeEvent): void => {
    try {
      input.onEvent(event);
    } catch {
      /* a listener must never take the turn down */
    }
  };

  const text = new CursorAssistantText(emit);

  const finish = (ok: boolean, stopReason: string | null): void => {
    if (state.settled) return;
    state.settled = true;
    text.seal();
    if (state.child) {
      killCliTree(state.child);
      state.child = null;
    }
    if (state.profile) {
      rmSync(state.profile.root, { recursive: true, force: true });
      state.profile = null;
    }
    emit({ type: "turn.completed", ok, stopReason });
  };

  const stop = (): void => {
    state.stopRequested = true;
    if (state.child) killCliTree(state.child);
  };

  emit({ type: "turn.started" });

  let child: PipedChild;
  try {
    const workspace = realpathSync(input.cwd);
    state.profile = cursorMcpProfile(input.mcpServers ?? {});
    const environment: Record<string, string | undefined> = cursorChildEnvironment(
      input.environment ?? process.env,
      input.pathOverride ?? augmentedPath(input.environment as NodeJS.ProcessEnv | undefined),
    );
    if (state.profile) {
      Object.assign(environment, state.profile.forwarded, {
        CURSOR_CONFIG_DIR: state.profile.configDir,
        CURSOR_DATA_DIR: state.profile.configDir,
      });
    }
    const args = buildCursorArgs({
      text: input.text,
      cwd: workspace,
      sandbox: input.sandbox,
      ...(input.system ? { system: input.system } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(!state.profile && input.resumeCursor ? { resumeCursor: input.resumeCursor } : {}),
      ...(input.skipPermissions ? { skipPermissions: true } : {}),
      ...(state.profile ? { pluginDir: state.profile.pluginDir } : {}),
    });
    child = spawnCli(state.profile?.launcher ?? input.cli, state.profile ? [input.cli, ...args] : args, {
      cwd: workspace,
      env: environment as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = describeSpawnFailure(error as NodeJS.ErrnoException, input.cli, input.cwd);
    emit({ type: "runtime.error", message: failure.message, setup: failure.setup });
    finish(false, failure.message);
    return handle();
  }

  state.child = child;
  // Nothing is ever written to the child: the prompt is an argument and this
  // family has no control channel. Closing stdin stops the CLI waiting on it.
  try {
    child.stdin.end();
  } catch {
    /* already closed */
  }

  let buffer = "";
  const ingest = (chunk: string): void => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (state.stopRequested || state.settled) continue;
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        emit({ type: "runtime.error", message: "Cursor emitted a malformed protocol frame" });
        finish(false, "Cursor emitted a malformed protocol frame");
        continue;
      }
      const frame = message as Record<string, unknown>;
      input.tee?.({ dir: "out", msg: redactSecrets(frame) });
      handleCursorFrame(frame, state, text, emit);
      if (frame.type === "result") {
        state.resultSeen = true;
        if (frame.is_error === true || (typeof frame.subtype === "string" && frame.subtype.startsWith("error"))) {
          state.resultError = redactSecretsInText(
            String(frame.result ?? frame.error ?? "Cursor turn failed"),
          ).slice(0, 400);
        }
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => ingest(chunk));
  child.stderr.on("data", (chunk: string) => {
    // Auth / quota chatter lands on stderr as plain text: the CLI exits
    // non-zero without ever emitting a `result` frame.
    const chatter = chunk.trim();
    if (!chatter) return;
    const classification = classifyError({ text: chatter });
    if (classification.reason === "quota" || classification.reason === "rate_limited") {
      state.resultError ??= redactSecretsInText(chatter).slice(0, 400);
      emit({ type: "runtime.error", message: redactSecretsInText(chatter).slice(0, 400) });
    } else if (/authentication required|not logged in/i.test(chatter)) {
      state.resultError ??= redactSecretsInText(chatter).slice(0, 400);
    } else if (/unknown option.*plugin-dir|unknown argument.*plugin-dir/i.test(chatter)) {
      state.resultError ??= `Cursor ${CURSOR_PLUGIN_MIN_VERSION} or newer is required for Local BizOS tools.`;
    }
  });
  child.on("error", (error) => {
    const failure = describeSpawnFailure(error as NodeJS.ErrnoException, input.cli, input.cwd);
    emit({ type: "runtime.error", message: failure.message, setup: failure.setup });
    finish(false, failure.message);
  });
  child.on("close", (code) => {
    if (state.settled) return;
    if (state.stopRequested) {
      finish(false, "interrupted");
      return;
    }
    if (code === 0 && state.resultSeen && !state.resultError) {
      finish(true, null);
      return;
    }
    const message =
      state.resultError ??
      (code === 0
        ? "Cursor exited without a terminal result"
        : `cursor-agent exited with code ${code ?? "null"}`);
    emit({ type: "runtime.error", message });
    finish(false, message);
  });

  function handle(): CodexTurnHandle {
    return {
      stop,
      // No approval channel exists for this family: every answer is refused
      // rather than silently dropped into a protocol that cannot carry it.
      respond: () => "unavailable",
      sessionId: () => state.sessionId,
      settled: () => state.settled,
    };
  }

  return handle();
}

function handleCursorFrame(
  frame: Record<string, unknown>,
  state: { sessionId: string | null },
  text: CursorAssistantText,
  emit: (event: RuntimeEvent) => void,
): void {
  const type = typeof frame.type === "string" ? frame.type : "";
  const sessionId = typeof frame.session_id === "string" && frame.session_id ? frame.session_id : null;
  if (sessionId && !state.sessionId) {
    state.sessionId = sessionId;
    emit({
      type: "session.started",
      sessionId,
      model: typeof frame.model === "string" ? frame.model : null,
    });
  }

  if (type === "assistant") {
    text.ingest(extractCursorText(frame), isAggregateFrame(frame));
    return;
  }

  if (type === "thinking" && frame.subtype === "delta" && typeof frame.text === "string" && frame.text) {
    emit({ type: "content.delta", streamKind: "reasoning_text", delta: frame.text });
    return;
  }

  if (type === "tool_call") {
    // The aggregate assistant flush always precedes a tool call; seal what
    // the agent said before it started working.
    text.seal();
    const callId = typeof frame.call_id === "string" && frame.call_id ? frame.call_id : undefined;
    if (frame.subtype === "started") {
      emit({ type: "item.started", itemType: "tool", ...(callId ? { itemId: callId } : {}), title: cursorToolTitle(frame.tool_call) });
    } else if (frame.subtype === "completed") {
      emit({ type: "item.completed", itemType: "tool", ...(callId ? { itemId: callId } : {}), ok: !toolCallFailed(frame.tool_call) });
    }
    return;
  }

  if (type === "result") {
    text.seal();
    const usage = frame.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === "object") {
      const input = numberOf(usage.inputTokens);
      const output = numberOf(usage.outputTokens);
      const cached = numberOf(usage.cacheReadTokens);
      if (input !== null || output !== null) {
        emit({
          type: "token-usage",
          input: input ?? 0,
          output: output ?? 0,
          ...(cached !== null ? { cachedInput: cached } : {}),
        });
      }
    }
    const isError =
      frame.is_error === true || (typeof frame.subtype === "string" && frame.subtype.startsWith("error"));
    if (isError) {
      const resultText =
        (typeof frame.result === "string" && frame.result) ||
        (typeof frame.error === "string" && frame.error) ||
        "cursor turn failed";
      emit({ type: "runtime.error", message: redactSecretsInText(resultText).slice(0, 400) });
    }
    // `turn.completed` is emitted from the process `close` handler so we do
    // not double-settle when both a result line and an exit code arrive.
  }
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A completed shell/edit call the CLI marked as having failed. */
function toolCallFailed(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object") return false;
  const serialized = JSON.stringify(toolCall);
  return /"(error|spawnError|permissionDenied|timeout|rejected)"\s*:/.test(serialized);
}

export function extractCursorText(frame: Record<string, unknown>): string {
  const nested = frame.message as Record<string, unknown> | undefined;
  const content = nested?.content ?? frame.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const row = block as Record<string, unknown>;
    if (row.type === "text" && typeof row.text === "string") parts.push(row.text);
  }
  return parts.join("");
}

/**
 * Whether an `assistant` frame is the CLI's AGGREGATE flush rather than one
 * token.
 *
 * With `--stream-partial-output` the CLI emits both: one `assistant` frame
 * per token, and — at every tool call, every question, and just before the
 * `result` — one more carrying everything since the last flush. Rendering
 * both would print the answer twice.
 *
 * The two are told apart by shape first (a flush before the terminal result
 * has no `timestamp_ms`; a flush at a tool call carries `model_call_id`,
 * which a token frame never does) and, when the shape is ambiguous, by
 * content: a frame whose text is exactly the tokens accumulated so far is
 * the flush of those tokens. See `CursorAssistantText.ingest`.
 */
export function isAggregateFrame(frame: Record<string, unknown>): boolean {
  if (!("timestamp_ms" in frame)) return true;
  return "model_call_id" in frame && frame.model_call_id !== undefined && frame.model_call_id !== null;
}

/**
 * One provider message per flush boundary. Tokens stream out as
 * `content.delta`; the boundary seals them into a single `item.completed`,
 * exactly as the Claude driver does — so the local transcript keeps one
 * immutable message per thing the agent said.
 */
export class CursorAssistantText {
  private pending = "";
  private sequence = 0;

  constructor(private readonly emit: (event: RuntimeEvent) => void) {}

  ingest(text: string, aggregate: boolean): void {
    if (!text) return;
    if (!aggregate && this.pending && text === this.pending) {
      // Shape said "token", content says "the whole buffer": trust content.
      this.seal();
      return;
    }
    if (!aggregate) {
      this.delta(text);
      return;
    }
    if (text === this.pending) {
      this.seal();
      return;
    }
    if (this.pending && text.startsWith(this.pending)) {
      this.delta(text.slice(this.pending.length));
      this.seal();
      return;
    }
    // An aggregate that does not continue what we have (no partial output, or
    // a lost frame): close what we had and take this one whole.
    this.seal();
    this.delta(text);
    this.seal();
  }

  private delta(text: string): void {
    if (!text) return;
    this.pending += text;
    this.emit({ type: "content.delta", streamKind: "assistant_text", delta: text });
  }

  seal(): void {
    const text = this.pending;
    this.pending = "";
    if (!text.trim()) return;
    this.emit({
      type: "item.completed",
      itemType: "assistant_text",
      itemId: `cursor-${++this.sequence}-${randomBytes(4).toString("hex")}`,
      text,
    });
  }
}
