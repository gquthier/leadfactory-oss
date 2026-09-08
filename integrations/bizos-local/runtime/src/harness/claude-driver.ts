// Claude Code driver — bidirectional print mode over stream-json.
//
// Spawns `claude -p … --output-format stream-json --verbose
// --include-partial-messages` against an isolated `CLAUDE_CONFIG_DIR` so
// each plan's OAuth stays separate. Intentionally NOT `--bare`: bare mode
// skips the config dir's credentials and would force API-key billing.
//
// Events are normalized into the same `RuntimeEvent` / `CodexTurnHandle`
// shape the Codex driver emits, so `dispatch.ts` does not care which CLI
// answered. CLI permission requests use the host control channel and the
// same persistent approval cards as the Codex driver.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigEnvironment, cleanChildEnvironment } from "./child-env.js";
import {
  isHttpMcpServer,
  APPROVAL_TIMEOUT_MS,
  DENY_TIMEOUT_NOTE,
  type CodexTurnInput,
  type CodexTurnHandle,
  type McpServerSpec,
  type RuntimeEvent,
} from "./codex-driver.js";
import { augmentedPath } from "./env-path.js";
import { describeSpawnFailure, killCliTree, spawnCli, type PipedChild } from "./procs.js";
import { redactSecrets, redactSecretsInText } from "./redact.js";
import { classifyError } from "./retry.js";
import type { ReasoningEffort, SandboxMode } from "./types.js";

export interface ClaudeTurnInput {
  cli: string;
  cwd: string;
  text: string;
  system?: string;
  model?: string;
  effort?: ReasoningEffort;
  sandbox: SandboxMode;
  resumeCursor?: string | null;
  /** Absolute CLAUDE_CONFIG_DIR for this plan. */
  configDir?: string;
  /** MCP servers for this turn — the same specs the codex driver mounts.
   * Written to a 0600 file handed over as `--mcp-config` and deleted when
   * the turn settles; print mode has no other way to receive them. */
  mcpServers?: Record<string, McpServerSpec>;
  /** Where that file is written. Required for `mcpServers` to take effect. */
  mcpConfigDir?: string;
  environment?: Record<string, string | undefined>;
  onEvent: (event: RuntimeEvent) => void;
  tee?: (entry: { dir: "in" | "out"; msg: unknown }) => void;
  pathOverride?: string;
  isAlwaysAllowed?: CodexTurnInput["isAlwaysAllowed"];
  /** Settings → Plans & usage said "never ask anyone": see `buildClaudeArgs`. */
  skipPermissions?: boolean;
  /** Test seam; production uses the same 15-minute deadline as Codex. */
  approvalTimeoutMs?: number;
}

/**
 * The `--mcp-config` document for one turn. Secrets go in as values: the
 * file is the ONLY channel Claude Code offers a print turn, and it lives
 * 0600 in the harness's own state folder for the length of the turn.
 */
export function claudeMcpConfig(servers: Record<string, McpServerSpec>): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (isHttpMcpServer(server)) {
      const token = server.bearerTokenEnv ? server.forwarded[server.bearerTokenEnv] : undefined;
      mcpServers[name] = {
        type: "http",
        url: server.url,
        headers: { ...server.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      };
    } else {
      mcpServers[name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: { ...server.env, ...server.forwarded },
      };
    }
  }
  return { mcpServers };
}

export function writeClaudeMcpConfig(dir: string, servers: Record<string, McpServerSpec>): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `claude-mcp-${randomBytes(6).toString("hex")}.json`);
  writeFileSync(path, `${JSON.stringify(claudeMcpConfig(servers))}\n`, { mode: 0o600 });
  return path;
}

/** Only servers explicitly marked "run without asking" are preapproved;
 * other requests reach the host permission channel. */
export function claudeAllowedTools(servers: Record<string, McpServerSpec>): string[] {
  return Object.entries(servers)
    .filter(([, server]) => server.preApproved)
    .map(([name]) => `mcp__${name}`);
}

/**
 * Permission mode for print turns.
 *
 * `workspace-write` → `acceptEdits` so the CLI may apply patches inside the
 * shared roots without an interactive TTY. Anything else → `default` (Claude
 * Code's normal non-interactive policy — no silent writes).
 */
export function permissionModeFor(sandbox: SandboxMode): "acceptEdits" | "default" {
  return sandbox === "workspace-write" ? "acceptEdits" : "default";
}

export function buildClaudeArgs(input: {
  text: string;
  model?: string;
  system?: string;
  resumeCursor?: string | null;
  cwd: string;
  effort?: ReasoningEffort;
  sandbox: SandboxMode;
  mcpConfigPath?: string;
  allowedTools?: string[];
  /**
   * The global "never ask" switch (`settings.local.permissions ===
   * "skip-all"`). It replaces the sandbox-derived permission mode with
   * `bypassPermissions` AND passes `--dangerously-skip-permissions`: the mode
   * alone still lets the CLI raise a prompt for what it considers dangerous.
   *
   * `--permission-prompt-tool stdio` stays on purpose. It costs nothing when
   * nothing asks, and a request that still arrives is auto-accepted by the
   * `isAlwaysAllowed` dispatch installs in this mode — better than a CLI
   * blocking on a prompt channel this harness never opened.
   */
  skipPermissions?: boolean;
}): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    input.skipPermissions ? "bypassPermissions" : permissionModeFor(input.sandbox),
    ...(input.skipPermissions ? ["--dangerously-skip-permissions"] : []),
    "--add-dir",
    input.cwd,
  ];
  if (input.model) args.push("--model", input.model);
  if (input.system) args.push("--append-system-prompt", input.system);
  if (input.resumeCursor) args.push("--resume", input.resumeCursor);
  if (input.effort) args.push("--effort", input.effort);
  // Only the harness's servers: without `--strict-mcp-config` the CLI also
  // loads the account's own connectors (claude.ai integrations, ~/.claude
  // servers), which the person never granted to a BizOS agent.
  if (input.mcpConfigPath) args.push("--mcp-config", input.mcpConfigPath, "--strict-mcp-config");
  if (input.allowedTools?.length) args.push("--allowedTools", input.allowedTools.join(","));
  return args;
}

export function claudeChildEnvironment(
  base: Record<string, string | undefined>,
  pathValue: string,
  configDir?: string,
): Record<string, string | undefined> {
  const environment = cleanChildEnvironment(base, pathValue);
  // Belt-and-suspenders: even if FORBIDDEN_CHILD_VARS drifts, print mode
  // must never see an Anthropic API key (subscription vs API billing).
  delete environment.ANTHROPIC_API_KEY;
  return claudeConfigEnvironment(environment, configDir);
}

export function startClaudeTurn(input: ClaudeTurnInput): CodexTurnHandle {
  const state = {
    settled: false,
    stopRequested: false,
    sessionId: null as string | null,
    child: null as PipedChild | null,
    mcpConfigPath: null as string | null,
    initialized: false,
    resultError: null as string | null,
    resultSeen: false,
  };
  const initializeId = `lbz-init-${randomBytes(8).toString("hex")}`;
  let initializeTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, { input: Record<string, unknown>; timer: ReturnType<typeof setTimeout> }>();
  const seenRequests = new Set<string>();

  const emit = (event: RuntimeEvent): void => {
    try {
      input.onEvent(event);
    } catch {
      /* a listener must never take the turn down */
    }
  };

  const publicMessages = new ClaudePublicMessages(emit);

  const writeFrame = (message: Record<string, unknown>): boolean => {
    const stdin = state.child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
    try {
      input.tee?.({ dir: "in", msg: redactSecrets(message) });
      stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch { return false; }
  };

  const resolvePermission = (requestId: string, allow: boolean, source: "user" | "timeout" | "system", message?: string, send = true): boolean => {
    const request = pending.get(requestId);
    if (!request) return false;
    if (send && !writeFrame({ type: "control_response", response: {
      subtype: "success", request_id: requestId,
      response: allow ? { behavior: "allow", updatedInput: request.input }
        : { behavior: "deny", message: message ?? "The user denied this action. Do not retry it." },
    } })) return false;
    clearTimeout(request.timer);
    pending.delete(requestId);
    emit({ type: "request.resolved", requestId, behavior: allow ? "allow" : "deny", source });
    return true;
  };

  const clearPermissions = (): void => {
    for (const id of [...pending.keys()]) resolvePermission(id, false, "system", undefined, false);
  };

  const dropMcpConfig = (): void => {
    if (!state.mcpConfigPath) return;
    try {
      unlinkSync(state.mcpConfigPath);
    } catch {
      /* already gone */
    }
    state.mcpConfigPath = null;
  };

  const finish = (ok: boolean, stopReason: string | null): void => {
    if (state.settled) return;
    state.settled = true;
    clearTimeout(initializeTimer);
    clearPermissions();
    if (state.child) {
      killCliTree(state.child);
      state.child = null;
    }
    dropMcpConfig();
    emit({ type: "turn.completed", ok, stopReason });
  };

  const stop = (): void => {
    state.stopRequested = true;
    clearTimeout(initializeTimer);
    for (const id of [...pending.keys()]) resolvePermission(id, false, "system", "The run was stopped. Do not execute this action.");
    clearPermissions();
    if (state.child) killCliTree(state.child);
  };

  emit({ type: "turn.started" });

  let child: PipedChild;
  try {
    const environment = claudeChildEnvironment(
      input.environment ?? process.env,
      input.pathOverride ?? augmentedPath(input.environment as NodeJS.ProcessEnv | undefined),
      input.configDir,
    );
    const servers = input.mcpServers ?? {};
    if (Object.keys(servers).length && input.mcpConfigDir) {
      state.mcpConfigPath = writeClaudeMcpConfig(input.mcpConfigDir, servers);
    }
    const allowedTools = state.mcpConfigPath ? claudeAllowedTools(servers) : [];
    const args = buildClaudeArgs({
      text: input.text,
      cwd: input.cwd,
      sandbox: input.sandbox,
      ...(input.model ? { model: input.model } : {}),
      ...(input.system ? { system: input.system } : {}),
      ...(input.resumeCursor ? { resumeCursor: input.resumeCursor } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(state.mcpConfigPath ? { mcpConfigPath: state.mcpConfigPath } : {}),
      ...(allowedTools.length ? { allowedTools } : {}),
      ...(input.skipPermissions ? { skipPermissions: true } : {}),
    });
    child = spawnCli(input.cli, args, {
      cwd: input.cwd,
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
  let buffer = "";

  const ingest = (chunk: string): void => {
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
      if (state.stopRequested || state.settled) continue;
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        emit({ type: "runtime.error", message: "Claude emitted a malformed protocol frame" });
        finish(false, "Claude emitted a malformed protocol frame");
        continue;
      }
      input.tee?.({ dir: "out", msg: redactSecrets(message) });
      publicMessages.ingest(message);
      if (message.type === "control_response") {
        const response = message.response as Record<string, unknown> | undefined;
        if (response?.request_id !== initializeId || state.initialized) continue;
        clearTimeout(initializeTimer);
        if (response.subtype !== "success") {
          const error = redactSecretsInText(String(response.error ?? "Claude initialization failed"));
          emit({ type: "runtime.error", message: error, setup: true });
          finish(false, error);
          continue;
        }
        state.initialized = true;
        writeFrame({ type: "user", session_id: input.resumeCursor ?? "", parent_tool_use_id: null,
          message: { role: "user", content: input.text } });
        continue;
      }
      if (message.type === "control_cancel_request") {
        if (typeof message.request_id === "string") resolvePermission(message.request_id, false, "system", undefined, false);
        continue;
      }
      if (message.type === "control_request") {
        const requestId = message.request_id;
        const request = message.request as Record<string, unknown> | undefined;
        if (typeof requestId !== "string" || !requestId || !request) continue;
        if (seenRequests.has(requestId)) continue;
        if (!state.initialized || state.stopRequested || state.settled || request.subtype !== "can_use_tool") {
          writeFrame({ type: "control_response", response: { subtype: "error", request_id: requestId, error: "Unsupported or inactive permission request" } });
          continue;
        }
        const tool = request.tool_name;
        const original = request.input;
        if (typeof tool !== "string" || !tool || !original || typeof original !== "object" || Array.isArray(original) || pending.size >= 64) {
          writeFrame({ type: "control_response", response: { subtype: "error", request_id: requestId, error: "Malformed permission request" } });
          continue;
        }
        const toolInput = original as Record<string, unknown>;
        // Hash the complete input, never a depth/length-truncated display.
        const fingerprint = JSON.stringify({ provider: "claude", cwd: input.cwd, sandbox: input.sandbox, tool, input: toolInput });
        const detail = `claude:${createHash("sha256").update(fingerprint).digest("hex")}`;
        seenRequests.add(requestId);
        const timer = setTimeout(() => {
          if (!resolvePermission(requestId, false, "timeout", DENY_TIMEOUT_NOTE)) {
            resolvePermission(requestId, false, "system", undefined, false);
          }
        }, input.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS);
        pending.set(requestId, { input: toolInput, timer });
        if (input.isAlwaysAllowed?.({ requestType: "permission", tool, detail }) === true) {
          resolvePermission(requestId, true, "system");
          continue;
        }
        const visible = JSON.stringify(redactSecrets(toolInput), null, 2);
        emit({ type: "request.opened", requestId, requestType: "permission", tool,
          summary: `Allow ${tool} in this agent's workspace?`, detail,
          detailText: `Workspace: ${input.cwd}\n${visible}` });
        continue;
      }
      handleClaudeLine(message, state, emit);
      if (message.type === "result") {
        state.resultSeen = true;
        if (message.is_error === true || (typeof message.subtype === "string" && message.subtype.startsWith("error"))) {
          state.resultError = redactSecretsInText(String(message.result ?? message.error ?? "Claude turn failed"));
        } else if (!state.initialized) state.resultError = "Claude initialization did not complete";
        clearPermissions();
        child.stdin.end();
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => ingest(chunk));
  child.stderr.on("data", (chunk: string) => {
    // Auth / quota chatter sometimes lands on stderr as plain text.
    const text = chunk.trim();
    if (!text) return;
    const classification = classifyError({ text });
    if (classification.reason === "quota" || classification.reason === "rate_limited") {
      emit({ type: "runtime.error", message: redactSecretsInText(text).slice(0, 400) });
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
    const message = state.resultError ?? (code === 0 ? "Claude exited without a terminal result" : `claude exited with code ${code ?? "null"}`);
    emit({ type: "runtime.error", message });
    finish(false, message);
  });

  function handle(): CodexTurnHandle {
    return {
      stop,
      respond: (requestId, decision) => {
        if (state.settled || state.stopRequested || decision.behavior === "answer") return "unavailable";
        if (!resolvePermission(requestId, decision.behavior === "allow", "user", decision.message)) return "unavailable";
        return decision.behavior === "allow" ? "allowed-once" : "rejected";
      },
      sessionId: () => state.sessionId,
      settled: () => state.settled,
    };
  }

  initializeTimer = setTimeout(() => {
    emit({ type: "runtime.error", message: "Claude initialization timed out", setup: true });
    finish(false, "Claude initialization timed out");
  }, 30_000);
  writeFrame({ type: "control_request", request_id: initializeId, request: { subtype: "initialize", hooks: {} } });
  return handle();
}

function handleClaudeLine(
  message: Record<string, unknown>,
  state: { sessionId: string | null },
  emit: (event: RuntimeEvent) => void,
): void {
  const type = typeof message.type === "string" ? message.type : "";
  if ((type === "assistant" || type === "stream_event") && message.parent_tool_use_id != null) return;
  const sessionId =
    (typeof message.session_id === "string" && message.session_id) ||
    (typeof message.sessionId === "string" && message.sessionId) ||
    null;
  if (sessionId && !state.sessionId) {
    state.sessionId = sessionId;
    emit({ type: "session.started", sessionId, model: null });
  }

  if (type === "system" && (message.subtype === "init" || message.subtype === "session_start")) {
    if (sessionId) {
      state.sessionId = sessionId;
      emit({
        type: "session.started",
        sessionId,
        model: typeof message.model === "string" ? message.model : null,
      });
    }
    return;
  }

  if (type === "result") {
    const isError = message.is_error === true ||
      (typeof message.subtype === "string" && message.subtype.startsWith("error"));
    const resultText =
      (typeof message.result === "string" && message.result) ||
      (typeof message.error === "string" && message.error) ||
      (typeof message.message === "string" && message.message) ||
      "";
    // Successful answer prose is not an error signal (e.g. French « limité »
    // or an explanation of quotas). Trust the protocol's terminal status.
    if (isError) {
      const classified = classifyError({ text: resultText || "claude turn failed" });
      emit({
        type: "runtime.error",
        message: redactSecretsInText(resultText || classified.reason).slice(0, 400),
      });
    }
    // `turn.completed` is emitted from the process `close` handler so we do
    // not double-settle when both a result line and exit code arrive.
    return;
  }
}

function extractAssistantText(message: Record<string, unknown>): string {
  const nested = message.message as Record<string, unknown> | undefined;
  const content = nested?.content ?? message.content;
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


/** One provider message, including all its text blocks, becomes one public
 * message. Stream tokens and full assistant snapshots are overlapping views,
 * never two replies. A closed identity is immutable even if replayed later. */
class ClaudePublicMessages {
  private current: { id: string; streamed: boolean; index: number; blocks: Map<number, string>; snapshots: string[]; phase?: "commentary" | "final_answer" } | null = null;
  private readonly sealed = new Set<string>();
  private sequence = 0;
  private sawMessageStart = false;
  private replaying = false;

  constructor(private readonly emit: (event: RuntimeEvent) => void) {}

  private open(id: string, streamed: boolean): void {
    if (this.current?.id === id) { this.current.streamed ||= streamed; return; }
    this.close();
    if (!this.sealed.has(id)) this.current = { id, streamed, index: 0, blocks: new Map(), snapshots: [] };
  }

  private close(streamCompleted = false): void {
    const message = this.current;
    this.current = null;
    if (!message || this.sealed.has(message.id)) return;
    this.sealed.add(message.id);
    // An error, permission request or next message cannot certify an
    // interrupted token stream. Only its own message_stop can seal it.
    if (message.streamed && this.sawMessageStart && !streamCompleted) return;
    const streamed = [...message.blocks.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join("");
    const text = streamed || message.snapshots.join("");
    if (text.trim()) this.emit({ type: "item.completed", itemType: "assistant_text", itemId: message.id, text, ...(message.phase ? { phase: message.phase } : {}) });
  }

  ingest(message: Record<string, unknown>): void {
    if (message.parent_tool_use_id != null) return;
    if (message.type === "stream_event") {
      const event = message.event as Record<string, unknown> | undefined;
      if (!event || typeof event !== "object") return;
      if (event.type === "message_start") {
        const nested = event.message as Record<string, unknown> | undefined;
        const id = typeof nested?.id === "string" ? nested.id : `claude-public-${++this.sequence}`;
        this.sawMessageStart = true;
        this.replaying = this.sealed.has(id);
        if (!this.replaying) this.open(id, true);
        return;
      }
      if (this.replaying) { if (event.type === "message_stop") this.replaying = false; return; }
      if (!this.current && !this.sawMessageStart && event.type === "content_block_delta") {
        // Older CLI fixtures omit message_start. Real streams carry IDs.
        this.open(`claude-public-${++this.sequence}`, true);
      }
      const current = this.current;
      if (!current) return;
      const index = typeof event.index === "number" ? event.index : current.index;
      if (event.type === "content_block_start") {
        current.index = index;
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === "text") current.blocks.set(index, typeof block.text === "string" ? block.text : "");
        if (block?.type === "tool_use") current.phase = "commentary";
      } else if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string" &&
            (!this.sawMessageStart || current.blocks.has(index))) {
          current.blocks.set(index, (current.blocks.get(index) ?? "") + delta.text);
          // Legacy IPC can still stream these public text blocks. Local
          // immutable delivery ignores deltas until the message is sealed.
          this.emit({ type: "content.delta", streamKind: "assistant_text", delta: delta.text });
        }
      } else if (event.type === "message_delta") {
        const reason = (event.delta as Record<string, unknown> | undefined)?.stop_reason;
        if (reason === "tool_use") current.phase = "commentary";
        else if (reason === "end_turn") current.phase = "final_answer";
      } else if (event.type === "message_stop") this.close(true);
      return;
    }
    if (message.type === "assistant") {
      const nested = message.message as Record<string, unknown> | undefined;
      const id = typeof nested?.id === "string" ? nested.id : this.current?.id ?? `claude-public-${++this.sequence}`;
      if (this.sealed.has(id)) return;
      this.open(id, false);
      const current = this.current;
      if (!current) return;
      if (nested?.stop_reason === "tool_use") current.phase = "commentary";
      else if (nested?.stop_reason === "end_turn") current.phase = "final_answer";
      const text = extractAssistantText(message);
      if (text) {
        if (current.streamed) {
          // Per-block assistant snapshots can precede content_block_stop. The
          // stream already owns text at this index; a snapshot fills only a
          // block without deltas. It must not overwrite other text blocks.
          if (current.blocks.has(current.index) && !current.blocks.get(current.index)) current.blocks.set(current.index, text);
          else if (!current.blocks.size) current.snapshots = [text];
        } else {
          const blocks = nested?.content ?? message.content;
          const parts = Array.isArray(blocks)
            ? blocks.flatMap(block => block?.type === "text" && typeof block.text === "string" ? [block.text] : [])
            : [text];
          // Full cumulative snapshots replace the same prefix. CLI versions
          // emitting individual blocks extend it instead; exact replay is a no-op.
          if (parts.length >= current.snapshots.length && current.snapshots.every((part, i) => parts[i] === part)) current.snapshots = parts;
          else if (parts.some((part, i) => current.snapshots[i] !== part)) current.snapshots.push(...parts);
        }
      }
      return;
    }
    if (message.type === "result") this.close();
    // can_use_tool can arrive before message_delta/message_stop for the
    // very same message. Keep its text buffer until its actual boundary.
    else if ((message.type === "control_request" || message.type === "user") && !this.current?.streamed) this.close();
  }
}
