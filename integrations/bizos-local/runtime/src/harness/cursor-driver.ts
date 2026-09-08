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
//   * There is NO approval channel. `-p` runs every tool the agent asks for;
//     the CLI answers its own `interaction_query` requests (verified in the
//     shipped bundle 2026.09.02). So no permission card can ever be raised
//     for a Cursor turn — `dispatch` writes that into the turn's `meta` note.
//     What the harness CAN still choose is how much the CLI is allowed to do:
//     `--force`/`--sandbox` under `skip-all`, Cursor's own sandbox under
//     `ask`, and `--mode plan` when the runtime sandbox is read-only.
//   * There is NO `--mcp-config`. The CLI loads MCP servers from the user's
//     own Cursor configuration only, so this driver mounts none and writes
//     nothing into the workspace's `.cursor/`. The team tools are absent from
//     a Cursor turn, and `dispatch` keeps them out of the persona too.
//
// The prompt is a positional argument (Cursor has no system slot), so the
// persona is prefixed to the text exactly as the Codex driver does.
import { randomBytes } from "node:crypto";
import { augmentedPath } from "./env-path.js";
import { cursorChildEnvironment } from "./cursor-status.js";
import type { CodexTurnHandle, RuntimeEvent } from "./codex-driver.js";
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
}

/**
 * The argv for one print turn.
 *
 * `--trust` is unconditional: the workspace is a folder the person chose in
 * this app, and a trust prompt has no TTY to appear on — without it the turn
 * hangs. `--workspace` is passed as well as the child's `cwd` so the CLI's
 * own idea of the root is the one the harness picked.
 *
 * permissions × sandbox, in full:
 *   * `skip-all`            → `--force --sandbox disabled` (the global
 *     "never ask anyone" switch; Cursor runs everything, unsandboxed).
 *   * `ask`                 → no `--force`, `--sandbox enabled`. Cursor's own
 *     sandbox keeps commands inside the workspace. It is NOT an approval
 *     card — this family cannot raise one — it is the boundary that stands in
 *     for the card.
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
  if (input.skipPermissions) args.push("--force", "--sandbox", "disabled");
  else args.push("--sandbox", "enabled");
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
    ? "Cursor never asks in print mode — this turn ran with the sandbox off."
    : "Cursor never asks in print mode — this turn ran inside Cursor's own sandbox, with no approval cards.";
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
    emit({ type: "turn.completed", ok, stopReason });
  };

  const stop = (): void => {
    state.stopRequested = true;
    if (state.child) killCliTree(state.child);
  };

  emit({ type: "turn.started" });

  let child: PipedChild;
  try {
    const environment = cursorChildEnvironment(
      input.environment ?? process.env,
      input.pathOverride ?? augmentedPath(input.environment as NodeJS.ProcessEnv | undefined),
    );
    const args = buildCursorArgs({
      text: input.text,
      cwd: input.cwd,
      sandbox: input.sandbox,
      ...(input.system ? { system: input.system } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.resumeCursor ? { resumeCursor: input.resumeCursor } : {}),
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
