// Turn dispatch — who answers, in what order, and what the thread shows
// while they do.
//
// Rules, in one place because they are the product:
//   * One turn at a time per thread. A queued turn is a real `queued` run,
//     not a hidden promise, so the UI can say "waiting" honestly.
//   * A direct message goes to that bot. A group message goes to the
//     mentioned members, in mention order; with no mention it goes to
//     EVERY member, in roster order — a question asked of a group was
//     asked of the group, and quietly picking one member would be a lie.
//   * A bot that mentions a teammate hands the turn over: the teammate
//     answers next, up to MAX_HOPS deep, and never to itself — and never
//     twice for the same message, because DEPTH alone does not bound a
//     fan-out. Four hops across a roster of ten is a thousand turns; the
//     budget below is what actually stops it.
//   * Stop cancels the whole chain, queued turns included.
//   * A reply is persisted WHOLE, exactly as it streamed, and a tool call is
//     named in words the user can read. Cutting it into bubbles is the
//     renderer's job (`src/lib/localbizos/bubbles.ts`): this harness used to
//     do it a second time when the turn ended, which deleted paragraphs the
//     reader had already read and re-sent them as new messages 400 ms later.
import { STATIC_CLAUDE_MODELS } from "./claude-models.js";
import { STATIC_CODEX_MODELS } from "./codex-models.js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { homedir } from "node:os";
import { MAX_TASK_CONTINUATIONS, parseTaskCheckpoint, taskRecord, type TaskCheckpoint } from "./task.js";
import type { Clock } from "./clock.js";
import type { BotStore } from "./bots.js";
import {
  startClaudeTurn as defaultStartClaudeTurn,
  type ClaudeTurnInput,
} from "./claude-driver.js";
import {
  cursorPermissionNote,
  startCursorTurn as defaultStartCursorTurn,
  type CursorTurnInput,
} from "./cursor-driver.js";
import { STATIC_CURSOR_MODELS } from "./cursor-models.js";
import {
  startCodexTurn as defaultStartCodexTurn,
  type CodexDynamicTool,
  type CodexTurnHandle,
  type CodexTurnInput,
  type RuntimeEvent,
  type McpServerSpec,
} from "./codex-driver.js";
import type { EventBus } from "./events.js";
import type { GroupStore } from "./groups.js";
import { newAskId } from "./ids.js";
import { resolveGroupTargets } from "./mentions.js";
import { findMentionedBotIds } from "./mentions.js";
import type { CodexModelProvider } from "./inference.js";
import type { ConnectedPlan, PlanProvider } from "./plan-types.js";
import { buildPersonaPrompt, type LocalArchitectureManifest } from "./prompt.js";
import { redactSecretsInText } from "./redact.js";
import { classifyError } from "./retry.js";
import { approvalTitle, labelForTool } from "./style.js";
import type { RunStore } from "./runs.js";
import { safeFileName, type Storage } from "./storage.js";
import { previewOf, type ThreadStore } from "./threads.js";
import {
  threadIdForTarget,
  type AccessMode,
  type AskAnswer,
  type AskAnsweredKind,
  type Attachment,
  type Bot,
  type MessageBlock,
  type RuntimeSettings,
  type StepItem,
  type ThreadMessage,
  type ThreadTarget,
} from "./types.js";

/**
 * A model id only means something to its own CLI. The settings keep one
 * model for whichever family answered last, so a ChatGPT plan pinned after a
 * Claude one would be told `claude-opus-4-5` and refuse the turn. A model
 * from the other family becomes "the CLI's own default".
 */
export function modelForFamily(family: PlanProvider | null | undefined, model: string | null | undefined): string | undefined {
  if (!model) return undefined;
  const isClaude = /^claude|^(opus|sonnet|haiku)\b/i.test(model) || STATIC_CLAUDE_MODELS.options.some((row) => row.id === model);
  const isCodex = /^(gpt|o[0-9]|codex)/i.test(model) || STATIC_CODEX_MODELS.options.some((row) => row.id === model);
  // Cursor's own catalogue borrows both vocabularies (`gpt-5`,
  // `sonnet-4-thinking`, `claude-opus-4-8`), so membership of its list is
  // what makes an id Cursor's — and an id only Cursor knows must not be
  // handed to codex or claude either.
  const isCursor = model === "auto" || STATIC_CURSOR_MODELS.options.some((row) => row.id === model);
  if (family === "cursor") return isCursor || (!isClaude && !isCodex) ? model : undefined;
  if (isCursor && !isClaude && !isCodex) return undefined;
  if (family === "codex" && isClaude && !isCodex) return undefined;
  if (family === "claude" && isCodex && !isClaude) return undefined;
  return model;
}

export const MAX_HOPS = 4;
/** Turns one user message may ever cause, handoffs included. */
export const MAX_CHAIN_TURNS = 12;
/** Turns that may sit waiting on one thread at once. */
export const MAX_QUEUED_TURNS = 12;
export const CURSORS_FILE = "cursors.json";
export const APPROVALS_FILE = "approvals.json";
export const QUEUE_FULL_NOTE =
  "Too many turns were already waiting on this thread, so the chain stops here.";
/** A group whose every member has been deleted or archived away.
 *
 * It used to `throw`, and the shell painted that under the composer where the
 * window had already run out of room: the message left, said "Sent", and then
 * nothing happened for the rest of the evening. A thread that took a message
 * owes the reader a sentence about what became of it — in the thread, where
 * they are looking. */
export const EMPTY_GROUP_NOTE =
  "Nobody in this group can answer — add a teammate to it in Group settings.";

/** What the transcript says about a turn that ran under `permissions:
 * "skip-all"`. History has to record the mode a run was allowed under, or
 * turning the switch back off would erase the evidence that it was ever on. */
export const SKIPPED_PERMISSIONS_NOTE =
  "Permissions are off for every agent — this turn ran without asking.";

/** What a family is called in a sentence the user reads. */
export const PROVIDER_LABEL: Record<PlanProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  cursor: "Cursor",
};

export interface DispatchDependencies {
  bots: BotStore;
  groups: GroupStore;
  threads: ThreadStore;
  runs: RunStore;
  events: EventBus;
  clock: Clock;
  storage: Storage;
  settings(): RuntimeSettings;
  orgName(): string;
  codexPath(): string;
  /** Claude Code binary, when a Claude plan is active. */
  claudePath?(): string;
  /** Cursor CLI binary, when a Cursor plan is active. */
  cursorPath?(): string;
  /** Resolve which connected plan answers this cursor (sticky / active / best). */
  resolvePlan?(input: {
    cursorKey: string;
    preferredProvider?: PlanProvider;
    botPlanId?: string;
  }): ConnectedPlan | null;
  /** Cool down a failed plan and pick the next; null when none remain. */
  failoverPlan?(input: {
    cursorKey: string;
    failedPlanId: string;
    preferredProvider?: PlanProvider;
  }): ConnectedPlan | null;
  /** Pin a thread×bot to a plan after a successful start. */
  pinPlan?(cursorKey: string, planId: string): void;
  /** Touch lastUsedAt after a turn uses a plan. */
  touchPlan?(planId: string): void;
  /** Per-bot MCP mount; empty when the tool surface is unavailable. */
  mcpServers(bot: Bot, context: { threadId: string; runId: string }): Record<string, McpServerSpec>;
  /** The external API-key provider chosen in Settings, when one is: it
   * answers through the codex CLI with `model_providers`, no plan involved. */
  inferenceProvider?(): CodexModelProvider | null;
  /** A bot's own external provider, by id; null when it no longer exists. */
  inferenceProviderById?(id: string): CodexModelProvider | null;
  /** Which family a plan belongs to, for a bot pinned to one. */
  planProviderOf?(planId: string): PlanProvider | null;
  /** Local host-side tools. The callback captures this exact active run. */
  dynamicTools?(bot: Bot, context: { threadId: string; runId: string }): CodexDynamicTool[];
  /** The codex cwd for a bot. */
  workspaceFor(bot: Bot): string;
  /** What this bot may reach on the Mac, from Settings → Access. Absent in
   * a harness that has no access store; then a bot sees its workspace and
   * nothing else, which is what the app did before Access existed. */
  sharedAccess?(bot: Bot): SharedAccess;
  /** Whether this bot has a browser of its own. Absent ⇒ no, and the persona
   * says nothing about a computer — a bot told it has tools that are not
   * mounted spends its turn discovering that. */
  hasComputer?(bot: Bot): boolean;
  localArchitecture?(input: { bot: Bot; threadId: string }): LocalArchitectureManifest;
  /** Raised when a run ends and the window is not focused. */
  onRunFinished?(input: { bot: Bot; outcome: "completed" | "failed"; preview: string }): void;
  /** Revoke ephemeral capabilities after every terminal outcome, including STOP. */
  onRunSettled?(runId: string): void;
  onRunStopped?(runId: string): void;
  /** Raised when a routine's run reaches a terminal state, so the routine
   * store can stop claiming it is still running AND the scheduler can hand the
   * routine's mutex back. `runId` names WHICH run ended: a terminal event that
   * arrives late must not unlock the run that replaced it. */
  onRoutineIdle?(routineId: string, runId: string): void;
  /** Test seam. */
  startTurn?: (input: CodexTurnInput) => CodexTurnHandle;
  /** Test seam for Claude print-mode turns. */
  startClaudeTurn?: (input: ClaudeTurnInput) => CodexTurnHandle;
  /** Test seam for Cursor print-mode turns. */
  startCursorTurn?: (input: CursorTurnInput) => CodexTurnHandle;
  environment?: Record<string, string | undefined>;
  retryScale?: number;
}

/** The Access grants that apply to one bot, resolved for one turn. */
export interface SharedAccess {
  folders: Array<{ path: string; mode: AccessMode }>;
  fullDiskRead: boolean;
}

const NO_ACCESS: SharedAccess = { folders: [], fullDiskRead: false };

interface QueuedTurn {
  continuationCount?: number;
  previousCheckpoint?: string;
  runId: string;
  threadId: string;
  botId: string;
  text: string;
  hop: number;
  /** The user message this turn descends from — the unit the fan-out
   * budget is counted against. */
  chainId: string;
  attachments?: Attachment[];
  routineId?: string;
  /** Present when a teammate handed this turn over. */
  fromBotId?: string;
}

interface ActiveTurn extends QueuedTurn {
  blockedOnInput?: boolean;
  /** Sandbox, roots, model, cwd and plan this turn ran under — see `policyKey`. */
  policyFingerprint: string;
  handle: CodexTurnHandle;
  message: ThreadMessage;
  publicMessages: Set<string>;
  publicMessagesEnabled: boolean;
  finalText: string;
  asks: Map<string, { requestId: string; approvalKey: string | null }>;
  /**
   * Cards THIS PROCESS opened, as opposed to the ones codex opened.
   *
   * The agent's computer asks its own question — "Allow Vega to act on
   * github.com?" — and it has to be the same card, in the same thread, answered
   * by the same buttons and remembered in the same approvals file, or the
   * product would have two permission systems that look alike and behave
   * differently. So a local ask is an ordinary `ask` block with an ordinary
   * `askId`; what is local is only WHO is waiting for the answer.
   */
  localAsks: Map<string, { approvalKey: string; settle(allowed: boolean): void }>;
  cancelled: boolean;
  /** The thread was cleared under this turn: its message no longer exists,
   * and nothing it produces from here may be written back. */
  discarded: boolean;
  /** Connected plan answering this turn, when multi-plan routing is wired. */
  planId?: string;
  planProvider?: PlanProvider;
  /** One inter-plan failover per user message — never thrash accounts. */
  failoverUsed?: boolean;
}

interface Chain {
  turns: number;
  outstanding: number;
  visited: Set<string>;
}

/** What "always allow" is remembered against.
 *
 * `${botId}|${requestType}|${tool}|${sha256(detail)}` — the DETAIL is what
 * makes this safe. Keyed on `tool` alone, one click on a card showing
 * `ls -la` silently auto-approved every future shell command the bot ever
 * ran, with no way to see or undo it. */
export function approvalKey(
  botId: string,
  requestType: string,
  tool: string,
  detail: string,
): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  return `${botId}|${requestType}|${tool}|${createHash("sha256").update(normalized).digest("hex")}`;
}

/**
 * Tools whose standing permission is about the TOOL, not its arguments.
 *
 * The default is the opposite, and the default is right: allowing one
 * `run_operation` must not allow every one after it, because each spends money
 * on something different. The agent's computer is the exception, and it is an
 * exception for a reason that is the whole point of the design.
 *
 * codex raises a card for any MCP tool that does not declare itself read-only,
 * even on a pre-approved server, and it keys "always allow" on the arguments.
 * For `computer_act` the arguments are a batch of clicks and they are never the
 * same twice — so "Always allow" would never once match, and the user would be
 * asked to authorise their agent's browser again on every scroll. A permission
 * dialog a person sees fifty times is a permission dialog they stop reading,
 * and the question that then stops being read is the one that matters: "Allow
 * Vega to act on github.com?", which `computer/manager.ts` asks separately, per
 * host, and which is NOT covered by this.
 *
 * So the card here means what it says — "Allow Vega to use its computer?" — and
 * Always allow makes it stick for that agent.
 */
const TOOL_SCOPED_APPROVALS = new Set(["computer_observe", "computer_act", "computer_download"]);

export function approvalDetailFor(tool: string, detail: string): string {
  return TOOL_SCOPED_APPROVALS.has(tool) ? `mcp:${tool}` : detail;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function extensionFor(attachment: Attachment): string {
  const fromName = extname(attachment.name || "").toLowerCase();
  if (fromName) return fromName.slice(0, 12);
  const mime = attachment.mimeType ?? "";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".bin";
}

export class Dispatcher {
  private readonly queues = new Map<string, QueuedTurn[]>();
  private readonly active = new Map<string, ActiveTurn>();
  private readonly chains = new Map<string, Chain>();
  private readonly cursors: Record<string, string>;
  private readonly approvals: Record<string, true>;

  constructor(private readonly deps: DispatchDependencies) {
    this.cursors = this.deps.storage.readJson<Record<string, string>>(CURSORS_FILE, {});
    this.approvals = this.deps.storage.readJson<Record<string, true>>(APPROVALS_FILE, {});
  }

  // ── public surface ────────────────────────────────────────────────────

  send(
    target: ThreadTarget,
    input: {
      text: string;
      mentionBotIds?: string[];
      attachments?: Attachment[];
      replyToMessageId?: string;
      /** `system`: written by the runtime, not the person. It is in the
       * record the bots read, and it starts their turns like any message,
       * but the app does not show it. */
      role?: "user" | "system";
    },
  ): { runIds: string[] } {
    const threadId = threadIdForTarget(target);
    const text = String(input.text ?? "").trim();
    const attachments = (input.attachments ?? []).slice(0, 8);
    if (!text && !attachments.length) throw new Error("nothing to send");
    const blocks: MessageBlock[] = [];
    if (text) blocks.push({ kind: "text", text });
    for (const attachment of attachments) {
      blocks.push(
        attachment.mimeType?.startsWith("image/") && (attachment.dataUrl ?? attachment.url)
          ? { kind: "image", url: (attachment.dataUrl ?? attachment.url)!, alt: attachment.name }
          : {
              kind: "file",
              name: attachment.name,
              ...(attachment.url ? { url: attachment.url } : {}),
              ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
            },
      );
    }
    const message = this.deps.threads.append(threadId, {
      role: input.role === "system" ? "system" : "user",
      blocks,
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    });
    this.deps.events.publish({ type: "thread.message.created", threadId, message });

    const targets = this.resolveTargets(target, text, input.mentionBotIds);
    if (!targets.length) {
      // The message is already in the thread. Refusing it now with an exception
      // would leave it sitting there with nothing to explain it — so the thread
      // says so itself, and only a target that does not exist at all (no thread
      // to write into) is still an error.
      if ("groupId" in target && this.deps.groups.get(target.groupId)) {
        this.note(threadId, EMPTY_GROUP_NOTE);
        return { runIds: [] };
      }
      throw new Error("no bot to answer on this thread");
    }
    const runIds: string[] = [];
    for (const botId of targets) {
      const runId = this.enqueue({
        threadId,
        botId,
        text,
        hop: 0,
        chainId: message.id,
        ...(attachments.length ? { attachments } : {}),
      });
      if (runId) runIds.push(runId);
    }
    return { runIds };
  }

  runRoutine(input: { botId: string; prompt: string; routineId: string }): { runId: string } {
    const threadId = threadIdForTarget({ botId: input.botId });
    const message = this.deps.threads.append(threadId, {
      role: "system",
      blocks: [{ kind: "meta", text: `Routine: ${input.prompt.slice(0, 160)}` }],
    });
    this.deps.events.publish({ type: "thread.message.created", threadId, message });
    const runId = this.enqueue({
      threadId,
      botId: input.botId,
      text: input.prompt,
      hop: 0,
      chainId: message.id,
      routineId: input.routineId,
    });
    if (!runId) throw new Error(QUEUE_FULL_NOTE);
    this.deps.events.publish({ type: "routine.fired", routineId: input.routineId, botId: input.botId, runId });
    return { runId };
  }

  stop(target: ThreadTarget): void {
    const threadId = threadIdForTarget(target);
    this.cancelQueued(threadId);
    const running = this.active.get(threadId);
    if (running) {
      running.cancelled = true;
      this.deps.onRunStopped?.(running.runId);
      running.handle.stop();
    }
  }

  private cancelQueued(threadId: string): void {
    for (const queued of this.queues.get(threadId) ?? []) {
      this.releaseChain(queued.chainId);
      this.deps.runs.update(queued.runId, { state: "cancelled" });
      this.deps.events.publish({
        type: "run.cancelled",
        runId: queued.runId,
        threadId,
        botId: queued.botId,
      });
      // A cancelled QUEUED turn never reaches `finish()`, which is the only
      // other place that clears this. Its routine used to stay pinned to
      // "running" until the app was restarted.
      if (queued.routineId) this.deps.onRoutineIdle?.(queued.routineId, queued.runId);
    }
    this.queues.set(threadId, []);
  }

  /** Stop everything on a thread AND disown whatever is still in flight.
   *
   * `threads.clear` deletes the transcript. Without this, the turn that was
   * running when the user hit Clear reached `finish()` a moment later and
   * appended its message straight back into the file the user had just
   * emptied — so "Clear" left the last conversation behind. */
  clearThread(target: ThreadTarget): void {
    const threadId = threadIdForTarget(target);
    this.stop(target);
    const running = this.active.get(threadId);
    if (running) running.discarded = true;
    for (const key of Object.keys(this.cursors)) {
      if (key.startsWith(`${threadId}|`)) delete this.cursors[key];
    }
    this.deps.storage.writeJson(CURSORS_FILE, this.cursors);
  }

  answer(input: { runId: string; askId: string; answer: AskAnswer }): void {
    const turn = [...this.active.values()].find((candidate) => candidate.runId === input.runId);
    if (!turn) throw new Error("that request is no longer open");
    const local = turn.localAsks.get(input.askId);
    if (local) {
      const allowed = input.answer.kind === "allow_once" || input.answer.kind === "allow_always";
      if (input.answer.kind === "allow_always") {
        this.approvals[local.approvalKey] = true;
        this.deps.storage.writeJson(APPROVALS_FILE, this.approvals);
      }
      turn.localAsks.delete(input.askId);
      this.markAskAnswered(turn, input.askId, input.answer.kind);
      this.deps.runs.update(turn.runId, { state: "working" });
      local.settle(allowed);
      return;
    }
    const ask = turn.asks.get(input.askId);
    if (!ask) throw new Error("that request is no longer open");
    const decision = this.decisionFor(input.answer);
    const outcome = turn.handle.respond(ask.requestId, decision);
    if (outcome === "unavailable") throw new Error("that request is no longer open");
    if (input.answer.kind === "allow_always" && ask.approvalKey && outcome === "allowed-once") {
      this.approvals[ask.approvalKey] = true;
      this.deps.storage.writeJson(APPROVALS_FILE, this.approvals);
    }
    turn.asks.delete(input.askId);
    this.markAskAnswered(turn, input.askId, input.answer.kind);
    this.deps.runs.update(turn.runId, { state: "working" });
  }

  /**
   * Is this bot answering somebody right now?
   *
   * The agent's computer asks before every tool call, and refuses when the
   * answer is no. A machine that could be driven outside a turn would be a
   * machine driven with no user watching, no thread to show it in, and no card
   * anybody would ever see — which is the definition of a back door, not of a
   * feature. See `computer/manager.ts`.
   */
  hasActiveTurn(botId: string): boolean {
    for (const turn of this.active.values()) {
      if (turn.botId === botId && !turn.cancelled && !turn.discarded) return true;
    }
    return false;
  }

  /** Has the user already said "always" to this exact thing? */
  isRemembered(key: string): boolean {
    return this.approvals[key] === true;
  }

  /**
   * Put a card of this process's own in the thread, and wait for it.
   *
   * `false` means denied — and it also means the turn ended underneath the
   * question, which from the caller's side is the same fact: nothing was agreed
   * to. There is no third answer, because "the user never saw it" must never be
   * treated as consent.
   */
  askLocally(input: {
    botId: string;
    summary: string;
    detailText?: string;
    approvalKey: string;
  }): Promise<boolean> {
    if (this.approvals[input.approvalKey] === true) return Promise.resolve(true);
    const turn = [...this.active.values()].find(
      (candidate) => candidate.botId === input.botId && !candidate.cancelled && !candidate.discarded,
    );
    if (!turn) return Promise.resolve(false);
    const askId = newAskId();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (allowed: boolean): void => {
        if (settled) return;
        settled = true;
        if (!allowed) turn.blockedOnInput = true;
        resolve(allowed);
      };
      turn.localAsks.set(askId, { approvalKey: input.approvalKey, settle });
      turn.message.blocks.push({
        kind: "ask",
        askId,
        runId: turn.runId,
        requestType: "permission",
        tool: "computer",
        summary: input.summary,
        ...(input.detailText ? { detailText: input.detailText } : {}),
        status: "pending",
      });
      this.persist(turn);
      this.deps.runs.update(turn.runId, { state: "waiting_input" });
      this.deps.bots.setStatus(input.botId, "waiting");
      this.deps.events.publish({
        type: "thread.ask",
        threadId: turn.threadId,
        messageId: turn.message.id,
        runId: turn.runId,
        askId,
      });
      this.deps.events.publish({
        type: "run.waiting_input",
        runId: turn.runId,
        threadId: turn.threadId,
        botId: input.botId,
      });
    });
  }

  /** How many "always allow" decisions this bot carries. */
  approvalsFor(botId: string): number {
    const prefix = `${botId}|`;
    return Object.keys(this.approvals).filter((key) => key.startsWith(prefix)).length;
  }

  /** Forget every "always allow" this bot was given. Without this there was
   * no way, anywhere in the product, to take a standing approval back. */
  clearApprovals(botId: string): number {
    const prefix = `${botId}|`;
    let cleared = 0;
    for (const key of Object.keys(this.approvals)) {
      if (!key.startsWith(prefix)) continue;
      delete this.approvals[key];
      cleared += 1;
    }
    if (cleared) this.deps.storage.writeJson(APPROVALS_FILE, this.approvals);
    return cleared;
  }

  activeRunIds(threadId: string): string[] {
    return this.deps.runs.active(threadId);
  }

  checkpointTask(scope: { botId: string; threadId: string; runId: string }, raw: unknown): TaskCheckpoint {
    const turn = this.active.get(scope.threadId);
    if (!this.deps.localArchitecture || !turn || turn.runId !== scope.runId || turn.botId !== scope.botId || turn.cancelled || turn.discarded) {
      throw new Error("Task checkpoint requires the matching active local run");
    }
    const task = parseTaskCheckpoint(raw);
    this.deps.runs.update(turn.runId, { task });
    return task;
  }

  /** Every turn on every thread — used when the window closes. */
  stopAll(): void {
    // A synchronous completion from stop() pumps the next queued turn. Empty
    // every queue first so shutdown cannot launch fresh CLI processes.
    for (const threadId of this.queues.keys()) this.cancelQueued(threadId);
    for (const turn of this.active.values()) {
      turn.cancelled = true;
      this.deps.onRunStopped?.(turn.runId);
      // The window is going away, so no card will ever be answered: everything
      // waiting on one is refused now rather than left hanging on a promise
      // whose thread has stopped existing.
      for (const local of turn.localAsks.values()) local.settle(false);
      turn.localAsks.clear();
      turn.handle.stop();
    }
  }

  // ── internals ─────────────────────────────────────────────────────────

  private resolveTargets(target: ThreadTarget, text: string, explicit?: string[]): string[] {
    if ("botId" in target) return this.deps.bots.get(target.botId) ? [target.botId] : [];
    const group = this.deps.groups.get(target.groupId);
    if (!group) return [];
    const roster = this.deps.bots.list();
    return resolveGroupTargets({
      text,
      memberIds: group.memberIds.filter((id) => roster.some((bot) => bot.id === id)),
      roster,
      ...(explicit ? { explicitMentionIds: explicit } : {}),
    });
  }

  private decisionFor(answer: AskAnswer): { behavior: "allow" | "deny" | "answer"; message?: string } {
    switch (answer.kind) {
      case "allow_once":
      case "allow_always":
        return { behavior: "allow" };
      case "text":
        return { behavior: "answer", message: answer.text };
      case "choice":
        return { behavior: "answer", message: answer.value };
      default:
        return { behavior: "deny" };
    }
  }

  private releaseChain(chainId: string): void {
    const chain = this.chains.get(chainId);
    if (!chain) return;
    chain.outstanding -= 1;
    if (chain.outstanding <= 0) this.chains.delete(chainId);
  }

  /** A grey line in the transcript. The only honest way for the thread to say
   * that nothing is coming. */
  private note(threadId: string, text: string): void {
    const message = this.deps.threads.append(threadId, {
      role: "system",
      blocks: [{ kind: "meta", text }],
    });
    this.deps.events.publish({ type: "thread.message.created", threadId, message });
  }

  private noteQueueFull(threadId: string): void {
    this.note(threadId, QUEUE_FULL_NOTE);
  }

  /** `null` when the turn was refused: the chain budget, the thread queue
   * cap, or a bot already answering this same message. */
  private enqueue(input: {
    threadId: string;
    botId: string;
    text: string;
    hop: number;
    chainId: string;
    attachments?: Attachment[];
    routineId?: string;
    fromBotId?: string;
  }): string | null {
    const chain = this.chains.get(input.chainId) ?? { turns: 0, outstanding: 0, visited: new Set<string>() };
    this.chains.set(input.chainId, chain);
    const queue = this.queues.get(input.threadId) ?? [];

    if (chain.turns >= MAX_CHAIN_TURNS || queue.length >= MAX_QUEUED_TURNS) {
      this.noteQueueFull(input.threadId);
      if (chain.outstanding <= 0) this.chains.delete(input.chainId);
      return null;
    }
    // A bot answers a given message once. Without this, two teammates each
    // naming a third put the same bot in the queue twice for one question.
    if (chain.visited.has(input.botId)) {
      if (chain.outstanding <= 0) this.chains.delete(input.chainId);
      return null;
    }

    const run = this.deps.runs.start({
      threadId: input.threadId,
      botId: input.botId,
      state: "queued",
      ...(input.routineId ? { routineId: input.routineId } : {}),
    });
    chain.turns += 1;
    chain.outstanding += 1;
    chain.visited.add(input.botId);
    queue.push({
      runId: run.id,
      threadId: input.threadId,
      botId: input.botId,
      text: input.text,
      hop: input.hop,
      chainId: input.chainId,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.routineId ? { routineId: input.routineId } : {}),
      ...(input.fromBotId ? { fromBotId: input.fromBotId } : {}),
    });
    this.queues.set(input.threadId, queue);
    this.pump(input.threadId);
    return run.id;
  }

  private pump(threadId: string): void {
    if (this.active.has(threadId)) return;
    const queue = this.queues.get(threadId) ?? [];
    const next = queue.shift();
    this.queues.set(threadId, queue);
    if (!next) return;
    const bot = this.deps.bots.get(next.botId);
    if (!bot) {
      this.releaseChain(next.chainId);
      this.deps.runs.update(next.runId, { state: "failed", error: "bot deleted" });
      this.deps.events.publish({
        type: "run.failed",
        runId: next.runId,
        threadId,
        botId: next.botId,
        error: "bot deleted",
      });
      if (next.routineId) this.deps.onRoutineIdle?.(next.routineId, next.runId);
      this.pump(threadId);
      return;
    }
    this.launch(next, bot);
  }

  /** Write the user's attachments into the bot's own workspace so the model
   * can actually open them.
   *
   * The transcript used to draw an image bubble while the turn was handed
   * nothing but the text: the bot was asked about a picture it had never
   * been shown. Images ride as `localImage` input items (verified against
   * the app-server `UserInput` schema); everything else is named in the
   * prompt with its real path, inside the sandbox the bot already has. */
  private materialize(
    bot: Bot,
    attachments: Attachment[],
  ): { note: string; input: Array<Record<string, unknown>> } {
    if (!attachments.length) return { note: "", input: [] };
    const directory = join(this.deps.workspaceFor(bot), "attachments");
    const lines: string[] = [];
    const input: Array<Record<string, unknown>> = [];
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    } catch {
      return { note: "", input: [] };
    }
    for (const attachment of attachments) {
      const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s.exec(attachment.dataUrl ?? "");
      if (!match?.[2]) {
        // A remote attachment has no bytes here; naming its URL is honest.
        if (attachment.url) lines.push(`- ${attachment.name} — ${attachment.url}`);
        continue;
      }
      const path = join(directory, `${safeFileName(attachment.id)}${extensionFor(attachment)}`);
      try {
        writeFileSync(path, Buffer.from(match[2], "base64"), { mode: 0o600 });
      } catch {
        continue;
      }
      lines.push(`- ${attachment.name} → ${path}`);
      if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
        input.push({ type: "localImage", path });
      }
    }
    return { note: lines.length ? `Attached files:\n${lines.join("\n")}` : "", input };
  }

  /** A turn that cannot start, ended honestly: the reason lands in the thread
   * as a system line, the run is `failed`, the routine stops claiming to run,
   * and the queue moves on. Throwing out of `launch` used to take the whole
   * `send()` down and leave the run pinned to `working` forever. */
  private abandon(queued: QueuedTurn, botId: string, reason: string): void {
    const { threadId } = queued;
    this.releaseChain(queued.chainId);
    this.deps.runs.update(queued.runId, { state: "failed", error: reason });
    const note = this.deps.threads.append(threadId, {
      role: "system",
      blocks: [{ kind: "meta", text: reason }],
    });
    this.deps.events.publish({ type: "thread.message.created", threadId, message: note });
    this.deps.events.publish({ type: "run.failed", runId: queued.runId, threadId, botId, error: reason });
    if (queued.routineId) this.deps.onRoutineIdle?.(queued.routineId, queued.runId);
    this.pump(threadId);
  }

  private launch(queued: QueuedTurn, bot: Bot, options: { failoverUsed?: boolean } = {}): void {
    const { threadId } = queued;
    const settings = this.deps.settings();
    // ONE switch, read once, for whichever CLI answers: Settings → Plans &
    // usage → Permissions. `skip-all` is global on purpose — see
    // `PermissionPolicy`.
    const skipPermissions = settings.local.permissions === "skip-all";
    const cursorKey = `${threadId}|${bot.id}`;
    // The bot's own choices (Agent settings) come before the global ones
    // (Plans & usage). A plan or provider that no longer exists is ignored.
    const ownPlanProvider = bot.planId ? (this.deps.planProviderOf?.(bot.planId) ?? null) : null;
    const preferredProvider = ownPlanProvider ?? settings.local.provider;
    // An external endpoint answers through codex and needs no plan at all;
    // otherwise the router picks among the connected plans.
    const ownExternal = bot.providerId ? (this.deps.inferenceProviderById?.(bot.providerId) ?? null) : null;
    const external = ownExternal ?? (bot.planId && ownPlanProvider ? null : (this.deps.inferenceProvider?.() ?? null));
    const plan = external
      ? null
      : this.deps.resolvePlan?.({
          cursorKey,
          ...(preferredProvider ? { preferredProvider } : {}),
          ...(bot.planId && ownPlanProvider ? { botPlanId: bot.planId } : {}),
        });
    const provider: PlanProvider = external ? "codex" : (plan?.provider ?? preferredProvider ?? "codex");

    let cli: string;
    try {
      if (provider === "claude") {
        if (!this.deps.claudePath) throw new Error("`claude` isn't configured for this runtime");
        cli = this.deps.claudePath();
      } else if (provider === "cursor") {
        if (!this.deps.cursorPath) throw new Error("`cursor-agent` isn't configured for this runtime");
        cli = this.deps.cursorPath();
      } else {
        cli = this.deps.codexPath();
      }
    } catch (error) {
      this.abandon(queued, bot.id, error instanceof Error ? error.message : String(error));
      return;
    }

    // The persona is built BEFORE this turn's own (empty) message lands in
    // the thread — otherwise "since my last turn" would start at it and the
    // bot would be handed no context at all.
    const publicMessagesEnabled = this.deps.localArchitecture?.({ bot, threadId })?.mode === "local";
    const shared = this.deps.sharedAccess?.(bot) ?? NO_ACCESS;
    const writableRoots = shared.folders
      .filter((folder) => folder.mode === "read-write")
      .map((folder) => folder.path);
    const attached = this.materialize(bot, queued.attachments ?? []);
    const message = this.deps.threads.append(threadId, {
      role: "bot",
      ...(publicMessagesEnabled ? { deliveryState: "control" as const } : {}),
      // The transcript is the only place a person can later find out that
      // this turn was allowed to do anything it liked. It says so, in the run
      // it belongs to, and it stays there when the setting is turned back off.
      // Cursor's print mode cannot raise an approval card at all, so the
      // transcript says so on EVERY Cursor turn, not only under `skip-all`.
      blocks: provider === "cursor"
        ? [{ kind: "meta", text: cursorPermissionNote(settings.local.permissions) }]
        : skipPermissions ? [{ kind: "meta", text: SKIPPED_PERMISSIONS_NOTE }] : [],
      botId: bot.id,
      runId: queued.runId,
    });
    this.deps.events.publish({ type: "thread.message.created", threadId, message });
    this.deps.runs.update(queued.runId, { state: "working", ...(!publicMessagesEnabled ? { messageId: message.id } : {}) });
    this.deps.bots.setStatus(bot.id, "working");
    this.deps.events.publish({ type: "run.started", runId: queued.runId, threadId, botId: bot.id });

    /**
     * What the CLI thread this cursor points at was STARTED under.
     *
     * `thread/resume` (and Claude `--resume`) carry the thread id and nothing
     * else. A change of plan (different CODEX_HOME / CLAUDE_CONFIG_DIR) MUST
     * invalidate the cursor — otherwise a turn would resume under the wrong
     * account. Same for sandbox, roots, model and cwd.
     */
    const policyKey = `${cursorKey}|policy`;
    // Under an external provider the plan's model id means nothing: the
    // provider's own default model answers unless the bot names one.
    const family = plan?.provider ?? preferredProvider;
    const model = external
      ? (bot.model ?? external.model ?? undefined)
      : (modelForFamily(family, bot.model) ?? modelForFamily(family, settings.local.model));
    // Mounted once, used for the fingerprint and the start alike: a tool
    // that appeared since the thread began (a new team tool, an app the
    // person added) must start a fresh thread, or a resumed one never sees it.
    const runContext = { threadId, runId: queued.runId };
    // Cursor's CLI has no `--mcp-config` and no host tool channel: it loads
    // MCP servers from the person's own Cursor configuration and nothing
    // else. Mounting none is honest — and the persona below is built from
    // this same empty surface, so a Cursor turn is never told it has team
    // tools it cannot call.
    const mountedServers = provider === "cursor" ? {} : this.deps.mcpServers(bot, runContext);
    const dynamicTools = provider === "cursor" ? undefined : this.deps.dynamicTools?.(bot, runContext);
    const toolSurface = [
      ...Object.keys(mountedServers).map((name) => `mcp:${name}`),
      ...(dynamicTools ?? []).map((tool) => `tool:${tool.name}`),
    ].sort();
    const policyFingerprint = JSON.stringify({
      // A resume cursor belongs to ONE CLI: `--resume <chatId>` means nothing
      // to codex, and a codex thread id means nothing to cursor-agent.
      provider,
      sandbox: settings.local.sandbox,
      // Turning permissions off (or back on) must not be inherited by a
      // thread that was started under the other policy: codex keeps a turn's
      // `approvalPolicy`/`sandboxPolicy` for the turns after it.
      permissions: settings.local.permissions ?? "ask",
      roots: [...writableRoots].sort(),
      model: model ?? null,
      cwd: this.deps.workspaceFor(bot),
      planId: plan?.id ?? null,
      providerId: external?.id ?? null,
      tools: toolSurface,
    });
    const resumeCursor =
      this.cursors[policyKey] === policyFingerprint ? (this.cursors[cursorKey] ?? null) : null;
    const persona = this.personaFor(bot, threadId, {
      replayHistory: !resumeCursor, provider, tools: toolSurface, excludeMessageId: message.id,
    });

    const turn: ActiveTurn = {
      ...queued,
      policyFingerprint,
      handle: undefined as unknown as CodexTurnHandle,
      message,
      asks: new Map(),
      publicMessages: new Set(),
      publicMessagesEnabled,
      finalText: "",
      localAsks: new Map(),
      cancelled: false,
      discarded: false,
      ...(plan ? { planId: plan.id, planProvider: plan.provider } : {}),
      failoverUsed: options.failoverUsed === true,
    };
    this.active.set(threadId, turn);

    const state = { text: "", steps: [] as StepItem[], failure: null as string | null };
    const environment: Record<string, string | undefined> = {
      ...(this.deps.environment ?? {}),
      ...(plan?.codexHome ? { CODEX_HOME: plan.codexHome } : {}),
      ...(plan?.configDir ? { CLAUDE_CONFIG_DIR: plan.configDir } : {}),
    };
    const turnText = [queued.text, attached.note].filter(Boolean).join("\n\n");
    const common = {
      cli,
      cwd: this.deps.workspaceFor(bot),
      text: turnText,
      system: persona,
      ...(model ? { model } : {}),
      ...(bot.thinking ?? settings.local.reasoningEffort
        ? { effort: bot.thinking ?? settings.local.reasoningEffort }
        : {}),
      sandbox: settings.local.sandbox,
      skipPermissions,
      resumeCursor,
      ...(Object.keys(environment).length ? { environment } : {}),
      ...(this.deps.retryScale ? { retryScale: this.deps.retryScale } : {}),
      onEvent: (event: RuntimeEvent) => this.onRuntimeEvent(turn, bot, cursorKey, state, event),
    };

    let handle: CodexTurnHandle;
    if (provider === "cursor") {
      const start = this.deps.startCursorTurn ?? defaultStartCursorTurn;
      // Built by hand rather than spread from `common`: cursor-agent takes
      // no reasoning effort, no MCP config and no approval callback, and a
      // field it does not know is a flag this app would not be able to
      // explain. There is no `isAlwaysAllowed` either — see the driver.
      handle = start({
        cli,
        cwd: this.deps.workspaceFor(bot),
        text: turnText,
        system: persona,
        ...(model ? { model } : {}),
        sandbox: settings.local.sandbox,
        skipPermissions,
        resumeCursor,
        ...(Object.keys(environment).length ? { environment } : {}),
        onEvent: (event: RuntimeEvent) => this.onRuntimeEvent(turn, bot, cursorKey, state, event),
        tee: (entry) => this.deps.storage.appendNdjson(this.deps.storage.nativePath(threadId), entry),
      });
    } else if (provider === "claude") {
      const start = this.deps.startClaudeTurn ?? defaultStartClaudeTurn;
      handle = start({
        ...common,
        ...(plan?.configDir ? { configDir: plan.configDir } : {}),
        // Same servers and exact stored approvals as Codex; any unmatched
        // permission is surfaced by Claude's bidirectional host protocol.
        mcpServers: mountedServers,
        mcpConfigDir: join(this.deps.storage.layout.root, "mcp"),
        // In `skip-all` a request should never arrive; if one does (an MCP
        // elicitation, a tool the CLI still guards), it is accepted rather
        // than left hanging against a card nobody was told to expect.
        isAlwaysAllowed: skipPermissions
          ? () => true
          : (request) => this.approvals[approvalKey(bot.id, request.requestType, request.tool, approvalDetailFor(request.tool, request.detail))] === true,
        tee: (entry) => this.deps.storage.appendNdjson(this.deps.storage.nativePath(threadId), entry),
      });
    } else {
      const start = this.deps.startTurn ?? defaultStartCodexTurn;
      // Codex gets the team tools as dynamic tools; the MCP twin is for
      // Claude, and mounting both would offer the same tool twice.
      const { local_team_actions: _mcpTwin, ...codexServers } = mountedServers;
      handle = start({
        ...common,
        ...(attached.input.length ? { extraInput: attached.input } : {}),
        ...(writableRoots.length ? { writableRoots } : {}),
        ...(external ? { modelProvider: external } : {}),
        mcpServers: dynamicTools ? codexServers : mountedServers,
        ...(dynamicTools ? { dynamicTools } : {}),
        isAlwaysAllowed: skipPermissions
          ? () => true
          : (request) =>
              this.approvals[
                approvalKey(
                  bot.id,
                  request.requestType,
                  request.tool,
                  approvalDetailFor(request.tool, request.detail),
                )
              ] === true,
        tee: (entry) => this.deps.storage.appendNdjson(this.deps.storage.nativePath(threadId), entry),
      });
    }
    turn.handle = handle;
    if (plan) {
      this.deps.pinPlan?.(cursorKey, plan.id);
      this.deps.touchPlan?.(plan.id);
    }
  }

  /** Quota / 429 that should flip to another connected plan, once. */
  private isPlanFailoverReason(message: string | null | undefined): boolean {
    if (!message) return false;
    const classified = classifyError({ text: message });
    return classified.reason === "quota" || classified.reason === "rate_limited";
  }

  /**
   * Cool the failed plan, clear the sticky pin, and re-launch once under the
   * next healthy plan. Returns true when a failover was started (caller must
   * NOT finish the run as failed).
   */
  private tryPlanFailover(
    turn: ActiveTurn,
    bot: Bot,
    failure: string | null,
  ): boolean {
    if (turn.failoverUsed || turn.cancelled || turn.discarded) return false;
    if (!turn.planId || !this.deps.failoverPlan) return false;
    if (!this.isPlanFailoverReason(failure)) return false;

    const settings = this.deps.settings();
    const preferredProvider = settings.local.provider ?? turn.planProvider;
    const cursorKey = `${turn.threadId}|${bot.id}`;
    const next = this.deps.failoverPlan({
      cursorKey,
      failedPlanId: turn.planId,
      ...(preferredProvider ? { preferredProvider } : {}),
    });
    if (!next) {
      this.note(
        turn.threadId,
        "All connected plans are out of quota — try again later, or connect another account in Settings → Plans.",
      );
      return false;
    }

    // Drop the resume cursor: a different auth home cannot continue the thread.
    delete this.cursors[cursorKey];
    delete this.cursors[`${cursorKey}|policy`];
    this.deps.storage.writeJson(CURSORS_FILE, this.cursors);

    const label = PROVIDER_LABEL[next.provider];
    this.note(
      turn.threadId,
      `Switched to your other ${label} plan — this thread started fresh.`,
    );

    // Close out the failed run, then spawn a fresh one under the next plan
    // WITHOUT going through `enqueue` — the chain's `visited` set already
    // holds this bot, and a second enqueue would refuse it.
    this.active.delete(turn.threadId);
    for (const askId of [...turn.asks.keys()]) this.markAskAnswered(turn, askId, "expired");
    turn.asks.clear();
    for (const [askId, local] of turn.localAsks) {
      this.markAskAnswered(turn, askId, "expired");
      local.settle(false);
    }
    turn.localAsks.clear();
    this.deps.runs.update(turn.runId, { state: "failed", error: failure ?? "plan failover" });
    this.deps.events.publish({
      type: "run.failed",
      runId: turn.runId,
      threadId: turn.threadId,
      botId: bot.id,
      error: failure ?? "plan failover",
    });

    const replacement = this.deps.runs.start({
      threadId: turn.threadId,
      botId: bot.id,
      state: "queued",
      ...(turn.routineId ? { routineId: turn.routineId } : {}),
    });
    const previousTask = this.deps.runs.get(turn.runId)?.task;
    if (previousTask) this.deps.runs.update(replacement.id, { task: previousTask });
    this.deps.onRunSettled?.(turn.runId);
    const chain = this.chains.get(turn.chainId);
    if (chain) chain.turns += 1;
    this.launch(
      {
        runId: replacement.id,
        continuationCount: turn.continuationCount,
        previousCheckpoint: turn.previousCheckpoint,
        threadId: turn.threadId,
        botId: bot.id,
        text: turn.text,
        hop: turn.hop,
        chainId: turn.chainId,
        ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
        ...(turn.routineId ? { routineId: turn.routineId } : {}),
        ...(turn.fromBotId ? { fromBotId: turn.fromBotId } : {}),
      },
      bot,
      { failoverUsed: true },
    );
    return true;
  }

  private personaFor(bot: Bot, threadId: string, runtime: { replayHistory: boolean; provider: string; tools: string[]; excludeMessageId: string }): string {
    const target: ThreadTarget = threadId.startsWith("group:")
      ? { groupId: threadId.slice(6) }
      : { botId: bot.id };
    const snapshot = this.deps.threads.snapshot(target);
    snapshot.messages = snapshot.messages.filter(row => row.id !== runtime.excludeMessageId);
    // Context starts after this bot's own last turn: it already knows what
    // it said, and repeating it wastes the window.
    const lastOwn = [...snapshot.messages].reverse().find((row) => row.botId === bot.id);
    // Local providers may reject an otherwise valid resume cursor and silently
    // start fresh. Always carry a bounded local transcript across that fallback.
    const since = lastOwn && !runtime.replayHistory && !this.deps.localArchitecture
      ? snapshot.messages.filter((row) => row.seq > lastOwn.seq)
      : snapshot.messages;
    const group = threadId.startsWith("group:") ? this.deps.groups.get(threadId.slice(6)) : undefined;
    const roster = this.deps.bots.list();
    const shared = this.deps.sharedAccess?.(bot) ?? NO_ACCESS;
    const architecture = this.deps.localArchitecture?.({ bot, threadId });
    const settings = this.deps.settings();
    const previousTask = architecture ? this.deps.runs.list(200).find(run => run.threadId === threadId && run.botId === bot.id && run.task)?.task : undefined;
    return buildPersonaPrompt({
      bot,
      orgName: this.deps.orgName(),
      ...(group
        ? {
            group: {
              name: group.name,
              members: group.memberIds
                .map((id) => roster.find((candidate) => candidate.id === id))
                .filter((candidate): candidate is Bot => Boolean(candidate)),
            },
          }
        : {}),
      since: since.filter((row) => row.blocks.length > 0),
      roster,
      sharedFolders: [this.deps.workspaceFor(bot)],
      ...(shared.folders.length ? { grantedFolders: shared.folders } : {}),
      ...(shared.fullDiskRead ? { fullDiskRead: true } : {}),
      ...(this.deps.hasComputer?.(bot) ? { hasComputer: true } : {}),
      ...(architecture ? { localArchitecture: {
        ...architecture,
        sandbox: settings.local.permissions === "skip-all" ? "danger-full-access" as const : settings.local.sandbox,
        host: { platform: process.platform, home: homedir(), provider: runtime.provider,
          permissions: settings.local.permissions ?? "ask", tools: runtime.tools },
      } } : {}),
      ...(previousTask ? { task: previousTask } : {}),
      nowIso: this.deps.clock.nowIso(),
    });
  }

  private persist(turn: ActiveTurn): void {
    if (turn.discarded) return;
    this.deps.threads.replace(turn.message);
    this.deps.events.publish({
      type: "thread.message.updated",
      threadId: turn.threadId,
      message: turn.message,
    });
  }

  private onRuntimeEvent(
    turn: ActiveTurn,
    bot: Bot,
    cursorKey: string,
    state: { text: string; steps: StepItem[]; failure: string | null },
    event: RuntimeEvent,
  ): void {
    // A prior provider attempt can emit late frames after continuation/failover.
    if (this.active.get(turn.threadId) !== turn || turn.discarded) return;
    const upsertSteps = (): void => {
      const index = turn.message.blocks.findIndex((block) => block.kind === "steps");
      const block: MessageBlock = { kind: "steps", items: [...state.steps] };
      if (index >= 0) turn.message.blocks[index] = block;
      else turn.message.blocks.unshift(block);
    };

    const upsertLegacyText = (): void => {
      const index = turn.message.blocks.findIndex(block => block.kind === "text");
      const block: MessageBlock = { kind: "text", text: state.text };
      if (index >= 0) turn.message.blocks[index] = block;
      else turn.message.blocks.push(block);
    };


    switch (event.type) {
      case "session.started":
        if (event.sessionId && !turn.discarded) {
          this.cursors[cursorKey] = event.sessionId;
          this.cursors[`${cursorKey}|policy`] = turn.policyFingerprint;
          this.deps.storage.writeJson(CURSORS_FILE, this.cursors);
        }
        break;

      // Public messages are published atomically at provider boundaries. In
      // particular, reasoning and incomplete text never enter the transcript.
      case "content.delta":
        if (!turn.publicMessagesEnabled && event.streamKind === "assistant_text") {
          state.text += event.delta;
          upsertLegacyText();
          this.deps.events.publish({ type: "thread.message.updated", threadId: turn.threadId, message: turn.message });
        }
        break;

      case "item.started": {
        // The thread says what happened, not which function ran:
        // "Read company state", never `get_company_state`. The raw name
        // still travels on `agent.tool.called`, which is machine-facing.
        state.steps.push({
          id: event.itemId ?? `step-${state.steps.length}`,
          label: labelForTool(event.title),
          state: "running",
        });
        upsertSteps();
        this.deps.events.publish({
          type: "agent.tool.called",
          threadId: turn.threadId,
          runId: turn.runId,
          tool: event.title,
        });
        this.persist(turn);
        break;
      }

      case "item.completed": {
        if (event.itemType === "assistant_text") {
          if (!turn.publicMessagesEnabled) { state.text = event.text; upsertLegacyText(); this.persist(turn); break; }
          if (turn.cancelled) break;
          if (!event.text.trim()) {
            if (event.phase === "final_answer") { turn.finalText = ""; state.text = ""; }
            break;
          }
          // Real drivers provide stable IDs; identical legacy snapshots are
          // idempotent within this attempt as well (e.g. completed then close).
          const key = event.itemId ?? `legacy:${event.text}`;
          if (turn.publicMessages.has(key)) break;
          turn.publicMessages.add(key);
          state.text = event.text;
          turn.finalText = event.phase === "commentary" ? "" : event.text;
          const message = this.deps.threads.append(turn.threadId, {
            role: "bot", deliveryState: "complete", blocks: [{ kind: "text", text: event.text }],
            botId: bot.id, runId: turn.runId,
            ...(turn.message.replyToMessageId ? { replyToMessageId: turn.message.replyToMessageId } : {}),
          });
          this.deps.runs.update(turn.runId, { messageId: message.id });
          this.deps.events.publish({ type: "thread.message.created", threadId: turn.threadId, message });
        } else {
          const step = state.steps.find((candidate) => candidate.id === event.itemId);
          if (step) step.state = event.ok ? "done" : "failed";
          upsertSteps();
        }
        this.persist(turn);
        break;
      }

      case "request.opened": {
        const askId = newAskId();
        turn.asks.set(askId, {
          requestId: event.requestId,
          // A question is answered, never "always allowed": there is
          // nothing standing to remember.
          approvalKey:
            event.requestType === "permission"
              ? approvalKey(
                  bot.id,
                  event.requestType,
                  event.tool,
                  approvalDetailFor(event.tool, event.detail),
                )
              : null,
        });
        turn.message.blocks.push({
          kind: "ask",
          askId,
          runId: turn.runId,
          requestType: event.requestType,
          tool: event.tool,
          // HUMANISED HERE, at the source. codex writes `Allow the bizos_actions
          // MCP server to run tool "run_operation"?`; that sentence names a
          // server nobody has heard of, quotes an identifier, and its underscores
          // were read as italics by the renderer, which then ate them. The card
          // asks "Allow Vega to run an operation in BizOS?" and keeps the call
          // itself under Details.
          summary: approvalTitle({
            botName: bot.name,
            tool: event.tool,
            requestType: event.requestType,
            fallback: event.summary,
          }),
          ...(event.detailText ? { detailText: event.detailText } : {}),
          status: "pending",
          ...(event.choices?.length
            ? { choices: event.choices.map((label) => ({ value: label, label })) }
            : {}),
        });
        this.persist(turn);
        this.deps.runs.update(turn.runId, { state: "waiting_input" });
        this.deps.bots.setStatus(bot.id, "waiting");
        this.deps.events.publish({
          type: "thread.ask",
          threadId: turn.threadId,
          messageId: turn.message.id,
          runId: turn.runId,
          askId,
        });
        this.deps.events.publish({
          type: "run.waiting_input",
          runId: turn.runId,
          threadId: turn.threadId,
          botId: bot.id,
        });
        break;
      }

      case "request.resolved": {
        if (event.behavior === "deny" || event.source === "timeout") turn.blockedOnInput = true;
        // A timeout or a settle answers on the user's behalf; the card must
        // stop looking actionable — and must not claim the user refused.
        //
        // `system` is that second case, and it was missing: when a turn ends
        // with a card still open, the driver denies every outstanding request
        // with `source: "system"` BEFORE it emits `turn.completed`. Only
        // `"timeout"` mapped to `expired`, so the card said "Denied" — telling
        // the user they refused something they were never shown — and the
        // sweep in `finish()` that exists to prevent exactly that found the map
        // already empty.
        for (const [askId, ask] of turn.asks) {
          if (ask.requestId !== event.requestId) continue;
          turn.asks.delete(askId);
          this.markAskAnswered(
            turn,
            askId,
            event.source === "timeout" || event.source === "system"
              ? "expired"
              : event.behavior === "allow"
                ? "allow_once"
                : event.behavior === "answer"
                  ? "text"
                  : "deny",
          );
        }
        break;
      }

      case "turn.retrying":
        turn.message.blocks.push({
          kind: "meta",
          text: `Retrying (${event.reason}) — attempt ${event.attempt + 1}.`,
        });
        this.persist(turn);
        break;

      case "runtime.error": {
        // Whatever the CLI printed reaches a persisted block and the
        // renderer; a configured-or-compromised codex can print its own
        // environment there, so it is masked one last time on the way in.
        const message = redactSecretsInText(event.message).slice(0, 400);
        state.failure = message;
        turn.message.blocks.push({ kind: "meta", text: message });
        this.persist(turn);
        break;
      }

      case "turn.completed":
        if (!event.ok && this.tryPlanFailover(turn, bot, state.failure ?? event.stopReason)) {
          break;
        }
        this.finish(turn, bot, state, event.ok, event.stopReason);
        break;

      default:
        break;
    }
  }

  private markAskAnswered(turn: ActiveTurn, askId: string, kind: AskAnsweredKind): void {
    if (turn.discarded) return;
    const index = turn.message.blocks.findIndex((block) => block.kind === "ask" && block.askId === askId);
    const block = turn.message.blocks[index];
    if (index < 0 || !block || block.kind !== "ask") return;
    turn.message.blocks[index] = {
      ...block,
      status: kind === "expired" ? "expired" : "answered",
      answered: { kind, at: this.deps.clock.nowIso() },
    };
    this.persist(turn);
  }

  private finish(
    turn: ActiveTurn,
    bot: Bot,
    state: { text: string; steps: StepItem[]; failure: string | null },
    ok: boolean,
    stopReason: string | null,
  ): void {
    if (!this.active.has(turn.threadId) || this.active.get(turn.threadId) !== turn) return;
    const task = this.deps.runs.get(turn.runId)?.task;
    if (task && !turn.cancelled && !turn.discarded && ok) {
      if (task.status === "in_progress") {
        const count = turn.continuationCount ?? 0;
        const fingerprint = taskRecord(task);
        const reason = turn.blockedOnInput
          ? "Task paused after denied or expired input; no automatic retry."
          : this.queues.get(turn.threadId)?.length
          ? "Task interrupted by a new queued message; reconcile it before continuing."
          : count >= MAX_TASK_CONTINUATIONS
            ? "Automatic continuation limit reached; progress is saved."
            : turn.previousCheckpoint === fingerprint
              ? "No new checkpoint progress; automatic continuation stopped."
              : null;
        // Never abandon a pending approval or question to start a fresh turn.
        if (!reason && !turn.asks.size && !turn.localAsks.size) {
          this.persist(turn);
          this.active.delete(turn.threadId);
          this.deps.onRunSettled?.(turn.runId);
          this.note(turn.threadId, "Continuing the unfinished task from its saved checkpoint.");
          this.launch({ ...turn, continuationCount: count + 1, previousCheckpoint: fingerprint,
            text: `Continue the authorized task from the checkpoint below. Inspect existing results before repeating actions. Complete and verify the remaining work, then update checkpoint_task.\nCheckpoint (reported data): ${fingerprint}`,
          }, bot, { failoverUsed: turn.failoverUsed });
          return;
        }
        ok = false;
        stopReason = reason ?? "Task paused for unanswered input; progress is saved.";
        this.deps.runs.update(turn.runId, { task: { ...task, status: "interrupted" } });
      } else if (task.status !== "completed") {
        ok = false;
        stopReason = `Task ${task.status}: ${task.next_step}`;
      }
    }
    if (task && (turn.cancelled || (!ok && task.status !== "blocked"))) {
      this.deps.runs.update(turn.runId, { task: { ...task, status: "interrupted" } });
    }
    this.active.delete(turn.threadId);
    // Any card still open belongs to a turn that no longer exists. Nobody
    // denied these: the window closed on them.
    for (const askId of [...turn.asks.keys()]) this.markAskAnswered(turn, askId, "expired");
    turn.asks.clear();
    // A computer question the window closed on is a question nobody answered,
    // and an unanswered question is a refusal: the caller waiting on it is a
    // tool call that must not proceed.
    for (const [askId, local] of turn.localAsks) {
      this.markAskAnswered(turn, askId, "expired");
      local.settle(false);
    }
    turn.localAsks.clear();
    this.persist(turn);

    // One preview, for the roster row and for the system notification alike:
    // the message is whole, so there is no longer a "first paragraph" that says
    // less than the answer does.
    const preview = previewOf(state.text ? [{ kind: "text", text: state.text }] : turn.message.blocks);
    this.deps.bots.setStatus(bot.id, "idle", preview);
    if (turn.threadId.startsWith("group:")) {
      this.deps.groups.setPreview(turn.threadId.slice(6), preview);
    }

    if (turn.cancelled) {
      this.deps.runs.update(turn.runId, { state: "cancelled" });
      this.deps.events.publish({
        type: "run.cancelled",
        runId: turn.runId,
        threadId: turn.threadId,
        botId: bot.id,
      });
    } else if (ok) {
      this.deps.runs.update(turn.runId, { state: "completed" });
      this.deps.events.publish({
        type: "run.completed",
        runId: turn.runId,
        threadId: turn.threadId,
        botId: bot.id,
      });
      this.deps.onRunFinished?.({ bot, outcome: "completed", preview });
      this.handoff(turn, bot, turn.publicMessagesEnabled ? turn.finalText : state.text);
    } else {
      const error = state.failure ?? stopReason ?? "the turn failed";
      this.deps.runs.update(turn.runId, { state: "failed", error });
      this.deps.events.publish({
        type: "run.failed",
        runId: turn.runId,
        threadId: turn.threadId,
        botId: bot.id,
        error,
      });
      this.deps.onRunFinished?.({ bot, outcome: "failed", preview: error });
    }

    if (turn.routineId) this.deps.onRoutineIdle?.(turn.routineId, turn.runId);
    this.deps.onRunSettled?.(turn.runId);
    // Released last, AFTER any handoff has claimed its place: releasing
    // first would drop the chain's budget and its `visited` set the moment
    // the parent turn ended, which is exactly when the fan-out starts.
    this.releaseChain(turn.chainId);
    this.pump(turn.threadId);
  }

  /** A reply that names a teammate hands the turn over. */
  private handoff(turn: ActiveTurn, bot: Bot, reply: string): void {
    if (turn.discarded || !turn.threadId.startsWith("group:") || turn.hop >= MAX_HOPS || !reply.trim()) return;
    const group = this.deps.groups.get(turn.threadId.slice(6));
    if (!group) return;
    const roster = this.deps.bots.list().filter((candidate) => group.memberIds.includes(candidate.id));
    const mentioned = findMentionedBotIds(reply, roster).filter((id) => id !== bot.id);
    for (const botId of mentioned) {
      const chain = this.chains.get(turn.chainId);
      if (chain?.visited.has(botId)) continue;
      const message = this.deps.threads.append(turn.threadId, {
        role: "system",
        blocks: [{ kind: "handoff", fromBotId: bot.id, toBotId: botId }],
      });
      this.deps.events.publish({ type: "thread.message.created", threadId: turn.threadId, message });
      this.enqueue({
        threadId: turn.threadId,
        botId,
        text: reply,
        hop: turn.hop + 1,
        chainId: turn.chainId,
        fromBotId: bot.id,
      });
    }
  }
}
