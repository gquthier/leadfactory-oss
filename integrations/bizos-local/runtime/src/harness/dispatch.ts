// Turn dispatch — who answers, in what order, and what the thread shows
// while they do.
//
// Rules, in one place because they are the product:
//   * One turn at a time per thread. A queued turn is a real `queued` run,
//     not a hidden promise, so the UI can say "waiting" honestly.
//   * A direct message goes to that bot. A group message goes to the
//     mentioned members, in mention order; `@everyone` (`@all`, `@tous`,
//     `@team`, `@équipe`) goes to EVERY member, in roster order; with no
//     mention it goes to ONE lead — the CEO when the group has one, else its
//     first member — who answers for the group and is told so in its turn,
//     and hands over by naming a teammate (next rule). One answer to a plain
//     question, like a group chat with bots, not a chorus.
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
import { onboardingTurnNote, type OnboardingStatus } from "./onboarding.js";
import { STATIC_CLAUDE_MODELS } from "./claude-models.js";
import { STATIC_CODEX_MODELS } from "./codex-models.js";
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  MAX_RESTART_RESUMES,
  MAX_TASK_CONTINUATIONS,
  MAX_TASK_WALL_MS,
  RESTART_RESUME_WINDOW_MS,
  WAITING_FOR_APPROVAL,
  parseTaskCheckpoint,
  taskRecord,
  type TaskCheckpoint,
} from "./task.js";
import { loadMemory } from "./memory.js";
import type { Clock } from "./clock.js";
import type { BotStore } from "./bots.js";
import {
  startClaudeTurn as defaultStartClaudeTurn,
  type ClaudeTurnInput,
} from "./claude-driver.js";
import {
  cursorPreapprovedServers,
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
import { isLeadTurn, resolveGroupTargets } from "./mentions.js";
import { findMentionedBotIds } from "./mentions.js";
import type { ExternalExecutionProvider, OllamaExecutionProvider } from "./inference.js";
import { startOllamaTurn as defaultStartOllamaTurn, type OllamaTurnInput } from "./ollama-driver.js";
import { startOpenAiTurn as defaultStartOpenAiTurn, type OpenAiTurnInput } from "./openai-driver.js";
import type { ConnectedPlan, PlanProvider } from "./plan-types.js";
import {
  GROUP_LEAD_TURN_NOTE,
  buildLocalBrief,
  buildPersonaPrompt,
  buildQuickChatPrompt,
  buildTurnContext,
  type LocalArchitectureManifest,
} from "./prompt.js";
import { singleLine } from "./prompt.js";
import { redactSecretsInText } from "./redact.js";
import { classifyError } from "./retry.js";
import { approvalTitle, labelForTool } from "./style.js";
import { assessAsk } from "./ask-impact.js";
import {
  extensionForImageType,
  extractLinks,
  fetchLinkPreview as defaultFetchLinkPreview,
  formatBytes,
  outputsDirFor,
  parseCompanyName,
  parseQuickReplies,
  parseSendToChat,
  resolveAttachment,
  type FetchedPreview,
  type ResolvedAttachment,
} from "./chat-outputs.js";
import { classifyRoutineReply } from "./routine-run.js";
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
  type RoutineRunOutcome,
  type RoutineTrigger,
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

/** A voice delegation is already bound by the trusted local controller to one
 * personal account. It is not a routing preference: the dispatcher must use
 * exactly this account or fail the run. */
export interface TurnExecutionPolicy {
  source: "voice";
  binding: { planId: string; provider: "codex" | "claude" };
  /** Phase one deliberately has no child-run lineage, so coordination tools
   * refuse every call instead of letting a recruited run escape call-wide
   * STOP. They stay mounted: the tool surface is in the resume fingerprint. */
  allowTeamDelegation: false;
}

export interface TurnContext {
  threadId: string;
  runId: string;
  executionPolicy?: TurnExecutionPolicy;
}

export interface ChildDispatchResult {
  messageId: string;
  runId: string;
  state: "queued" | "working" | "waiting_input" | "completed" | "failed" | "cancelled";
  error?: string;
}

export interface DispatchDependencies {
  bots: BotStore;
  chatExecutor?(chatId: string): Bot | undefined;
  onConversationMessage?(message: ThreadMessage): void;
  onboardingStatus?(botId: string): OnboardingStatus | null;
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
    exactPlanId?: string;
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
  mcpServers(bot: Bot, context: TurnContext): Record<string, McpServerSpec>;
  /** The external API-key provider chosen in Settings, when one is: it
   * answers through the codex CLI with `model_providers`, no plan involved. */
  inferenceProvider?(): ExternalExecutionProvider | null;
  /** A bot's own external provider, by id; null when it no longer exists. */
  inferenceProviderById?(id: string): ExternalExecutionProvider | null;
  /** The local plan tier (`entitlement.ts`). On `free`, a bot's or the
   * global external provider is ignored and the turn answers with the
   * connected personal plan, with a one-line note. Absent ⇒ no gating. */
  planTier?(): "free" | "pro";
  /** Which family a plan belongs to, for a bot pinned to one. */
  planProviderOf?(planId: string): PlanProvider | null;
  /** Local host-side tools. The callback captures this exact active run. */
  dynamicTools?(bot: Bot, context: TurnContext): CodexDynamicTool[];
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
  localArchitecture?(input: { bot: Bot; threadId: string; executionPolicy?: TurnExecutionPolicy }): LocalArchitectureManifest;
  /** Raised when a run ends and the window is not focused. */
  onRunFinished?(input: { bot: Bot; outcome: "completed" | "failed"; preview: string }): void;
  /** Revoke ephemeral capabilities after every terminal outcome, including STOP. */
  onRunSettled?(runId: string): void;
  /** Raised the moment a STOP is asked for, BEFORE the CLI has settled: a
   * capability must die now, and every request it has in flight with it,
   * not when the process finally exits. `onRunSettled` still follows. */
  onRunStopped?(runId: string): void;
  /** Raised when a routine's run reaches a terminal state, so the routine
   * store can stop claiming it is still running AND the scheduler can hand the
   * routine's mutex back. `runId` names WHICH run ended: a terminal event that
   * arrives late must not unlock the run that replaced it. */
  onRoutineIdle?(routineId: string, runId: string): void;
  /** A routine or heartbeat turn reached its end: how it ended for the person
   * (`silent` published nothing), the text it published (for continuity) and
   * whether its owner ended the routine with `[DONE]`. Called BEFORE
   * `onRoutineIdle`. */
  onQuietTurnSettled?(input: {
    runId: string;
    botId: string;
    threadId: string;
    routineId?: string;
    heartbeat: boolean;
    outcome: RoutineRunOutcome;
    report: string;
    done: boolean;
  }): void;
  /** Test seam. */
  startTurn?: (input: CodexTurnInput) => CodexTurnHandle;
  /** Test seam for Claude print-mode turns. */
  startClaudeTurn?: (input: ClaudeTurnInput) => CodexTurnHandle;
  /** Test seam for Cursor print-mode turns. */
  startCursorTurn?: (input: CursorTurnInput) => CodexTurnHandle;
  startOllamaTurn?: (input: OllamaTurnInput) => CodexTurnHandle;
  /** Test seam for native OpenAI-compatible API turns. */
  startOpenAiTurn?: (input: OpenAiTurnInput) => CodexTurnHandle;
  environment?: Record<string, string | undefined>;
  retryScale?: number;
  /** Link previews for the first external https link of a reply. `false`
   * turns the fetch off (no egress for previews); absent ⇒ on. */
  linkPreviews?: boolean;
  /** Test seam for the preview fetch. */
  fetchLinkPreview?: (url: string) => Promise<FetchedPreview | null>;
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
  /** When the task this turn continues began: the autonomy budget is wall
   * clock, counted from the first turn of the task. */
  taskStartedAtMs?: number;
  /** The thread message whose text IS this turn's text: left out of the
   * context so a message is never sent twice in one prompt. */
  triggerMessageId?: string;
  /** Restart-resumes in a row that led to this turn. */
  restartResumes?: number;
  /** A group message that named nobody, answered by this bot as the group's
   * lead: its turn text says so (`GROUP_LEAD_TURN_NOTE`). */
  groupLead?: boolean;
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
  /** The routine this turn runs for, as it was when it fired. */
  routine?: { name: string; trigger: RoutineTrigger; endsAt?: string };
  /** A proactive heartbeat wake. */
  heartbeat?: boolean;
  /** Routine/heartbeat replies are held until the turn ends, then published
   * together — or not at all when the verdict is `[SILENT]`. */
  quietTexts?: string[];
  /** Present when a teammate handed this turn over. */
  fromBotId?: string;
  executionPolicy?: TurnExecutionPolicy;
  ollamaBinding?: OllamaExecutionProvider;
}

interface ActiveTurn extends QueuedTurn {
  onboardingNameProposed?: boolean;
  /** The API provider and model a native API turn answers with, recorded on
   * the run once the provider really answered. */
  apiBinding?: { providerId: string; model: string };
  blockedOnInput?: boolean;
  /** An approval or question expired unanswered (not refused by anyone). */
  expiredInput?: { askId: string; summary: string; approvalKey: string | null };
  /** How the brief and context were delivered, reconciled on
   * `session.started` — see `SessionContext`. */
  sessionContext?: SessionContext;
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
  localAsks: Map<string, {
    /** null for a handoff: taking the seat is never a standing permission. */
    approvalKey: string | null;
    settle(decision: "allowed" | "denied" | "cancelled"): void;
  }>;
  /** Files and images `send_to_chat` staged for the NEXT reply message of
   * this turn (`image` / `file` blocks), and the caption to use when no
   * text comes with them. Drained when a reply lands; flushed at the end. */
  pendingOutputs: MessageBlock[];
  pendingCaption?: string;
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

/**
 * What a local turn handed its provider session, so the next turn knows
 * whether that session already holds the brief and the chat.
 *
 * `full`: the brief and a bounded transcript were sent (a new session, or one
 * not primed yet). `delta`: only the messages since this agent's last reply
 * (the session was primed). `codex`: the driver chose — `system` on a fresh
 * or unprimed thread, `resumedSystem` on a primed one — so the thread is
 * primed either way once it starts.
 */
interface SessionContext {
  mode: "full" | "delta" | "codex";
  provider: PlanProvider;
  /** The brief as built for this turn. */
  brief: string;
  resumedFrom: string | null;
  /** This turn (re)sends the brief even into a resumed session. */
  sendsBrief: boolean;
}

/** A primed session's brief is refreshed when it changed and is this old. */
export const BRIEF_REFRESH_MS = 6 * 60 * 60_000;

/** The run note of a free-tier turn whose custom model was set aside. */
export const FREE_TIER_PROVIDER_NOTE =
  "Custom models need BizOS Pro: this reply used your connected plan instead.";

/** The queued half of an active turn, to launch the turn that continues it. */
function queuedOf(turn: ActiveTurn): QueuedTurn {
  return {
    runId: turn.runId, threadId: turn.threadId, botId: turn.botId, text: turn.text, hop: turn.hop, chainId: turn.chainId,
    ...(turn.continuationCount !== undefined ? { continuationCount: turn.continuationCount } : {}),
    ...(turn.previousCheckpoint !== undefined ? { previousCheckpoint: turn.previousCheckpoint } : {}),
    ...(turn.taskStartedAtMs !== undefined ? { taskStartedAtMs: turn.taskStartedAtMs } : {}),
    ...(turn.triggerMessageId !== undefined ? { triggerMessageId: turn.triggerMessageId } : {}),
    ...(turn.restartResumes !== undefined ? { restartResumes: turn.restartResumes } : {}),
    ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
    ...(turn.routineId ? { routineId: turn.routineId } : {}),
    ...(turn.fromBotId ? { fromBotId: turn.fromBotId } : {}),
    ...(turn.executionPolicy ? { executionPolicy: turn.executionPolicy } : {}),
    ...(turn.ollamaBinding ? { ollamaBinding: turn.ollamaBinding } : {}),
  };
}

/** Ollama and API providers: in-process drivers with host tools only. */
function nativeProvider(provider: string): boolean {
  return provider === "ollama" || provider === "api";
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** An approval that expired unanswered while a task waited on it. A late
 * answer resumes the task (`Dispatcher.answer`). In memory only: after a
 * restart the next message in the thread continues the task instead. */
interface ExpiredAsk {
  runId: string;
  threadId: string;
  botId: string;
  messageId: string;
  summary: string;
  approvalKey: string | null;
  chainId: string;
}

/** A one-time grant from a late "allow once": consumed by the retried call. */
const ONE_SHOT_APPROVAL_MS = 60 * 60_000;

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

/** The weight fields of an `ask` block (`ask-impact.ts`), never a throw:
 * a card with no impact line beats no card at all. */
function askWeight(input: { tool: string; summary?: string; detailText?: string }): Partial<Extract<MessageBlock, { kind: "ask" }>> {
  try {
    const weight = assessAsk(input);
    return {
      action: weight.action,
      ...(weight.target ? { target: weight.target } : {}),
      impact: weight.impact,
      ...(weight.reversible !== undefined ? { reversible: weight.reversible } : {}),
      allowAlways: weight.allowAlways,
      ...(weight.details ? { details: weight.details } : {}),
    };
  } catch {
    return {};
  }
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
  /** Source threads that own cross-thread child chains. This lets STOP on a
   * finished parent DM still cancel a child that remains active elsewhere. */
  private readonly chainOwners = new Map<string, Set<string>>();
  /** Run → mission chain while any turn in that mission is outstanding.
   * Kept after a parent finishes so the public cancel endpoint can target
   * exactly its descendants without stopping a newer, unrelated DM turn. */
  private readonly runChains = new Map<string, string>();
  private readonly cursors: Record<string, string>;
  private readonly approvals: Record<string, true>;
  private readonly expiredAsks = new Map<string, ExpiredAsk>();
  private readonly oneShotApprovals = new Map<string, number>();
  private restartResumeDone = false;

  constructor(private readonly deps: DispatchDependencies) {
    this.cursors = this.deps.storage.readJson<Record<string, string>>(CURSORS_FILE, {});
    this.approvals = this.deps.storage.readJson<Record<string, true>>(APPROVALS_FILE, {});
  }

  // ── public surface ────────────────────────────────────────────────────

  send(
    target: ThreadTarget,
    input: {
      text: string;
      messageId?: string;
      mentionBotIds?: string[];
      attachments?: Attachment[];
      replyToMessageId?: string;
      /** `system`: written by the runtime, not the person. It is in the
       * record the bots read, and it starts their turns like any message,
       * but the app does not show it. */
      role?: "user" | "system";
      executionPolicy?: TurnExecutionPolicy;
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
      ...(input.messageId ? { id: input.messageId } : {}),
      role: input.role === "system" ? "system" : "user",
      blocks,
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    });
    this.deps.events.publish({ type: "thread.message.created", threadId, message });

    const targets = this.resolveTargets(target, text, input.mentionBotIds);
    const groupLead = "groupId" in target && targets.length === 1 && this.isGroupLeadMessage(target.groupId, text, input.mentionBotIds);
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
        triggerMessageId: message.id,
        ...(groupLead ? { groupLead: true } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(input.executionPolicy ? { executionPolicy: input.executionPolicy } : {}),
      });
      if (runId) runIds.push(runId);
    }
    return { runIds };
  }

  /**
   * Start a routine turn in its owner's direct thread.
   *
   * Nothing is written to the thread up front any more: a routine whose verdict
   * is `[SILENT]` must leave no trace in the conversation, and one that speaks
   * is announced by `routine.fired` right before its reply (see `deliverQuiet`).
   */
  runRoutine(input: {
    botId: string;
    prompt: string;
    routineId: string;
    routine?: { name: string; trigger: RoutineTrigger; endsAt?: string };
  }): { runId: string } {
    const threadId = threadIdForTarget({ botId: input.botId });
    const runId = this.enqueue({
      threadId,
      botId: input.botId,
      text: input.prompt,
      hop: 0,
      chainId: `routine:${input.routineId}:${newAskId()}`,
      routineId: input.routineId,
      ...(input.routine ? { routine: input.routine } : {}),
    });
    if (!runId) throw new Error(QUEUE_FULL_NOTE);
    return { runId };
  }

  /** Wake an agent proactively (the sidecar heartbeat). Same quiet delivery
   * as a routine, no routine attached. */
  runHeartbeat(input: { botId: string; threadId: string; prompt: string }): { runId: string } | null {
    const runId = this.enqueue({
      threadId: input.threadId,
      botId: input.botId,
      text: input.prompt,
      hop: 0,
      chainId: `heartbeat:${input.botId}:${newAskId()}`,
      heartbeat: true,
    });
    return runId ? { runId } : null;
  }

  /** Whether this bot has a turn running or waiting anywhere. */
  isBusy(botId: string): boolean {
    if (this.hasActiveTurn(botId)) return true;
    for (const queue of this.queues.values()) if (queue.some((queued) => queued.botId === botId)) return true;
    return false;
  }

  /** Dispatch a real child turn from an active parent capability. Unlike a
   * fresh `send`, this inherits the parent's chain budget and STOP lineage. */
  dispatchChild(
    scope: { botId: string; threadId: string; runId: string },
    target: { botId: string; groupId?: string },
    input: { text: string; messageId: string },
  ): ChildDispatchResult {
    const parent = this.active.get(scope.threadId);
    if (!parent || parent.runId !== scope.runId || parent.botId !== scope.botId || parent.cancelled || parent.discarded) {
      throw new Error("initial task requires the matching active parent run");
    }
    if (parent.hop >= MAX_HOPS) throw new Error("the parent mission reached its handoff depth limit");
    // Through the team channel when there is one: the recruiter's words stand
    // in the group as its own message, and the answer lands beside them — a
    // conversation between agents the person can read. Without a group, the
    // task stays a system line in the recruit's own chat, as before.
    const threadId = target.groupId
      ? threadIdForTarget({ groupId: target.groupId })
      : threadIdForTarget({ botId: target.botId });
    if (this.deps.threads.get(threadId, input.messageId)) {
      throw new Error("the initial task message already exists and will not be dispatched twice");
    }
    const message = this.deps.threads.append(threadId, target.groupId
      ? { id: input.messageId, role: "bot", botId: scope.botId, deliveryState: "complete", blocks: [{ kind: "text", text: input.text }] }
      : { id: input.messageId, role: "system", blocks: [{ kind: "text", text: input.text }] });
    this.deps.events.publish({ type: "thread.message.created", threadId, message });
    const owned = this.chainOwners.get(scope.threadId) ?? new Set<string>();
    owned.add(parent.chainId);
    this.chainOwners.set(scope.threadId, owned);
    const runId = this.enqueue({
      threadId,
      botId: target.botId,
      text: input.text,
      hop: parent.hop + 1,
      chainId: parent.chainId,
      triggerMessageId: message.id,
      fromBotId: parent.botId,
      ...(parent.executionPolicy ? { executionPolicy: parent.executionPolicy } : {}),
    });
    if (!runId) throw new Error("the parent mission reached its turn or queue limit");
    const run = this.deps.runs.get(runId);
    return {
      messageId: message.id,
      runId,
      state: run?.state ?? "failed",
      ...(run?.error ? { error: run.error } : {}),
    };
  }

  stop(target: ThreadTarget): void {
    const threadId = threadIdForTarget(target);
    const chainIds = new Set<string>();
    const running = this.active.get(threadId);
    if (running) chainIds.add(running.chainId);
    for (const queued of this.queues.get(threadId) ?? []) chainIds.add(queued.chainId);
    for (const owned of this.chainOwners.get(threadId) ?? []) chainIds.add(owned);
    if (!chainIds.size) return;
    for (const chainId of chainIds) this.cancelChain(chainId);
  }

  /** Cancel one run without stopping unrelated work queued on the same
   * thread. Voice STOP uses this exact ownership boundary. */
  cancelRun(runId: string): boolean {
    for (const running of this.active.values()) {
      if (running.runId !== runId) continue;
      running.cancelled = true;
      this.deps.onRunStopped?.(running.runId);
      running.handle.stop();
      return true;
    }
    for (const [threadId, queue] of this.queues) {
      const index = queue.findIndex((queued) => queued.runId === runId);
      if (index < 0) continue;
      const [queued] = queue.splice(index, 1);
      if (!queued) return false;
      this.queues.set(threadId, queue);
      this.releaseChain(queued.chainId);
      this.deps.runs.update(runId, { state: "cancelled" });
      this.deps.events.publish({ type: "run.cancelled", runId, threadId, botId: queued.botId });
      if (queued.routineId) this.deps.onRoutineIdle?.(queued.routineId, runId);
      this.deps.onRunStopped?.(runId);
      this.deps.onRunSettled?.(runId);
      if (!this.active.has(threadId)) this.pump(threadId);
      return true;
    }
    return false;
  }

  cancelMission(runId: string): boolean {
    const chainId = this.runChains.get(runId);
    if (!chainId) return false;
    this.cancelChain(chainId);
    return true;
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

  /** STOP follows a mission across DM child dispatches, not merely across
   * one transcript. All queued and active descendants share `chainId`. */
  private cancelChain(chainId: string): void {
    const pump = new Set<string>();
    for (const [threadId, queue] of this.queues) {
      const kept: QueuedTurn[] = [];
      for (const queued of queue) {
        if (queued.chainId !== chainId) {
          kept.push(queued);
          continue;
        }
        this.releaseChain(queued.chainId);
        this.deps.runs.update(queued.runId, { state: "cancelled" });
        this.deps.events.publish({ type: "run.cancelled", runId: queued.runId, threadId, botId: queued.botId });
        if (queued.routineId) this.deps.onRoutineIdle?.(queued.routineId, queued.runId);
        this.deps.onRunStopped?.(queued.runId);
        this.deps.onRunSettled?.(queued.runId);
        pump.add(threadId);
      }
      this.queues.set(threadId, kept);
    }
    for (const turn of [...this.active.values()]) {
      if (turn.chainId !== chainId || turn.cancelled) continue;
      turn.cancelled = true;
      this.deps.onRunStopped?.(turn.runId);
      turn.handle.stop();
      pump.add(turn.threadId);
    }
    for (const threadId of pump) if (!this.active.has(threadId)) this.pump(threadId);
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

  /** Expiry revokes the chat before STOP can synchronously call back. A
   * driver that never acknowledges abort is detached, with every late write
   * guarded independently by its tombstone in Storage. */
  expireQuickChat(chatId: string): void {
    const threadId = `chat:${chatId}`;
    const running = this.active.get(threadId);
    if (running) running.discarded = true;
    this.clearThread({ chatId });
    if (running) {
      this.active.delete(threadId);
      for (const local of running.localAsks.values()) local.settle("cancelled");
      running.localAsks.clear();
      running.asks.clear();
      this.drainOutputs(running);
      this.deps.onRunSettled?.(running.runId);
      this.releaseChain(running.chainId);
    }
    this.queues.delete(threadId);
    for (const [id, ask] of this.expiredAsks) if (ask.threadId === threadId) this.expiredAsks.delete(id);
    for (const key of this.oneShotApprovals.keys()) if (key.startsWith(`${chatId}|`)) this.oneShotApprovals.delete(key);
    this.clearApprovals(chatId);
  }

  /** A standing "always allow", or a one-time grant from a late "allow once". */
  private isPreApproved(key: string): boolean {
    if (this.approvals[key] === true) return true;
    const until = this.oneShotApprovals.get(key);
    if (until === undefined) return false;
    this.oneShotApprovals.delete(key);
    return until > this.deps.clock.now().getTime();
  }

  /**
   * A late answer to a request that expired while its task waited on it.
   *
   * The turn that asked is gone, so nothing can be answered in place: the
   * card records the answer, an approval is remembered for the retried call
   * (once, or always), and a new turn continues the task from its checkpoint.
   * A refusal only closes the card; the task stays paused.
   */
  answerExpired(input: { runId: string; askId: string; answer: AskAnswer }): boolean {
    const expired = this.expiredAsks.get(input.askId);
    if (!expired || expired.runId !== input.runId) return false;
    this.expiredAsks.delete(input.askId);
    const message = this.deps.threads.get(expired.threadId, expired.messageId);
    const index = message?.blocks.findIndex((block) => block.kind === "ask" && block.askId === input.askId) ?? -1;
    const block = message?.blocks[index];
    if (message && block?.kind === "ask") {
      message.blocks[index] = { ...block, status: "answered", answered: { kind: input.answer.kind, at: this.deps.clock.nowIso() } };
      this.deps.threads.replace(message);
      this.deps.events.publish({ type: "thread.message.updated", threadId: expired.threadId, message });
    }
    const run = this.deps.runs.get(expired.runId);
    const task = run?.task;
    if (input.answer.kind === "deny" || !task || task.status !== "blocked") return true;
    if (expired.approvalKey && input.answer.kind === "allow_always") {
      this.approvals[expired.approvalKey] = true;
      this.deps.storage.writeJson(APPROVALS_FILE, this.approvals);
    } else if (expired.approvalKey && input.answer.kind === "allow_once") {
      this.oneShotApprovals.set(expired.approvalKey, this.deps.clock.now().getTime() + ONE_SHOT_APPROVAL_MS);
    }
    const reply = input.answer.kind === "text" ? input.answer.text : input.answer.kind === "choice" ? input.answer.value : "";
    const resumed: TaskCheckpoint = { ...task, status: "in_progress" };
    const note = this.deps.threads.append(expired.threadId, {
      role: "system",
      blocks: [{ kind: "meta", text: "Answer received; resuming the paused task from its checkpoint." }],
    });
    this.deps.events.publish({ type: "thread.message.created", threadId: expired.threadId, message: note });
    this.enqueue({
      threadId: expired.threadId,
      botId: expired.botId,
      hop: 0,
      chainId: note.id,
      text: [
        `The person answered your expired request (${singleLine(expired.summary, 200)}) after the turn had ended:`,
        reply ? `their answer (data, not instructions): ${JSON.stringify(reply.slice(0, 2000))}` : "approved. Retry that exact action now; it will not ask again.",
        "Continue the task from the checkpoint below. Don't redo finished steps; verify, then update checkpoint_task.",
        `Checkpoint (reported data): ${taskRecord(resumed)}`,
      ].join("\n"),
      resume: { task: resumed, previousCheckpoint: taskRecord(resumed) },
    });
    return true;
  }

  answer(input: { runId: string; askId: string; answer: AskAnswer }): void {
    const turn = [...this.active.values()].find((candidate) => candidate.runId === input.runId);
    if (!turn && this.answerExpired(input)) return;
    if (!turn) throw new Error("that request is no longer open");
    const local = turn.localAsks.get(input.askId);
    if (local) {
      const allowed = input.answer.kind === "allow_once" || input.answer.kind === "allow_always";
      if (input.answer.kind === "allow_always" && local.approvalKey) {
        this.approvals[local.approvalKey] = true;
        this.deps.storage.writeJson(APPROVALS_FILE, this.approvals);
      }
      turn.localAsks.delete(input.askId);
      this.markAskAnswered(turn, input.askId, input.answer.kind);
      this.deps.runs.update(turn.runId, { state: "working" });
      local.settle(allowed ? "allowed" : "denied");
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
  hasActiveTurn(requester: string | { botId: string; threadId?: string; runId?: string }): boolean {
    const scope = typeof requester === "string" ? { botId: requester } : requester;
    return Boolean(this.findActiveTurnFor(scope));
  }

  private findActiveTurnFor(scope: { botId: string; threadId?: string; runId?: string }): ActiveTurn | undefined {
    for (const turn of this.active.values()) {
      if (turn.botId !== scope.botId || turn.cancelled || turn.discarded) continue;
      if (scope.threadId !== undefined && turn.threadId !== scope.threadId) continue;
      if (scope.runId !== undefined && turn.runId !== scope.runId) continue;
      return turn;
    }
    return undefined;
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
    threadId?: string;
    runId?: string;
    summary: string;
    detailText?: string;
    approvalKey: string;
  }): Promise<boolean> {
    if (this.approvals[input.approvalKey] === true) return Promise.resolve(true);
    const turn = this.findActiveTurnFor(input);
    if (!turn) return Promise.resolve(false);
    // `skip-all` is ONE global switch for every permission, whichever process
    // asks: the CLIs never raise a card under it, and neither does this one.
    // (A question to the person is not a permission and still goes through.)
    if (this.deps.settings().local.permissions === "skip-all") return Promise.resolve(true);
    const askId = newAskId();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (decision: "allowed" | "denied" | "cancelled"): void => {
        if (settled) return;
        settled = true;
        const allowed = decision === "allowed";
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
        ...askWeight({ tool: "computer", summary: input.summary, ...(input.detailText ? { detailText: input.detailText } : {}) }),
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

  /** A run-bound card for login/CAPTCHA/2FA. It deliberately has no approval
   * key: “Always allow” can never make a later handoff happen silently. */
  requestComputerHandoff(input: {
    botId: string;
    threadId?: string;
    runId?: string;
    reason: string;
  }): Promise<"allowed" | "denied" | "cancelled"> {
    const turn = this.findActiveTurnFor(input);
    if (!turn) return Promise.resolve("cancelled");
    const askId = newAskId();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (decision: "allowed" | "denied" | "cancelled"): void => {
        if (settled) return;
        settled = true;
        if (decision !== "allowed") turn.blockedOnInput = true;
        resolve(decision);
      };
      turn.localAsks.set(askId, { approvalKey: null, settle });
      const name = this.deps.bots.get(input.botId)?.name ?? "This agent";
      turn.message.blocks.push({
        kind: "ask",
        askId,
        runId: turn.runId,
        requestType: "permission",
        tool: "computer_handoff",
        summary: `${name} needs you to take control of its computer.`,
        detailText: input.reason,
        action: "Take control",
        target: "this agent's computer",
        impact: "medium",
        reversible: true,
        allowAlways: false,
        details: { kind: "text", text: input.reason },
        status: "pending",
      });
      this.persist(turn);
      this.deps.runs.update(turn.runId, { state: "waiting_input" });
      this.deps.bots.setStatus(input.botId, "waiting");
      this.deps.events.publish({ type: "thread.ask", threadId: turn.threadId, messageId: turn.message.id, runId: turn.runId, askId });
      this.deps.events.publish({ type: "run.waiting_input", runId: turn.runId, threadId: turn.threadId, botId: input.botId });
    });
  }

  setComputerHandoffWaiting(
    requester: { botId: string; threadId?: string; runId?: string },
    waiting: boolean,
  ): void {
    const turn = this.findActiveTurnFor(requester);
    if (!turn) return;
    this.deps.runs.update(turn.runId, { state: waiting ? "waiting_input" : "working" });
    this.deps.bots.setStatus(turn.botId, waiting ? "waiting" : "working");
    if (waiting) {
      this.deps.events.publish({ type: "run.waiting_input", runId: turn.runId, threadId: turn.threadId, botId: turn.botId });
    }
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

  /**
   * `send_to_chat`: stage files and images from the agent's workspace on its
   * current reply. They land as `image` / `file` blocks on the NEXT message
   * this turn publishes (with its text, in order) — or on a message of their
   * own at the end of the turn if no text follows.
   *
   * Nothing is copied: a file stays where the agent wrote it, and only a file
   * inside the agent's folder or the company vault can be sent at all.
   */
  sendToChat(scope: { botId: string; threadId: string; runId: string }, raw: unknown): {
    attached: Array<Pick<ResolvedAttachment, "id" | "kind" | "fileName" | "contentType" | "size" | "width" | "height" | "path">>;
    note: string;
  } {
    const turn = this.active.get(scope.threadId);
    if (!turn || turn.runId !== scope.runId || turn.botId !== scope.botId || turn.cancelled || turn.discarded) {
      throw new Error("Sending to the chat requires the matching active run");
    }
    const bot = this.deps.bots.get(scope.botId);
    if (!bot) throw new Error("Sending to the chat requires the matching active run");
    const input = parseSendToChat(raw);
    const roots = this.outputRootsFor(bot, scope.threadId);
    const resolved = input.files.map((file) => resolveAttachment(file.path, roots, file.alt ? { alt: file.alt } : {}));
    const blocks: MessageBlock[] = resolved.map((file) => file.kind === "image"
      ? {
          kind: "image", url: pathToFileURL(file.path).href, id: file.id, path: file.path, fileName: file.fileName,
          mimeType: file.contentType, size: file.size,
          ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
          ...(file.alt ? { alt: file.alt } : {}),
        }
      : { kind: "file", name: file.fileName, id: file.id, path: file.path, mimeType: file.contentType, size: file.size });
    turn.pendingOutputs.push(...blocks);
    if (input.caption) turn.pendingCaption = input.caption;
    const outputs = outputsDirFor(roots[roots.length - 1]!, this.deps.clock.now());
    const outside = resolved.filter((file) => !file.path.startsWith(`${outputs}${sep}`));
    return {
      attached: resolved.map(({ id, kind, fileName, contentType, size, width, height, path }) => ({
        id, kind, fileName, contentType, size, path,
        ...(width !== undefined && height !== undefined ? { width, height } : {}),
      })),
      note: [
        `${resolved.length === 1 ? `${resolved[0]!.fileName} (${formatBytes(resolved[0]!.size)})` : `${resolved.length} files`} will be attached to your next message in this chat — write that message now; no need to repeat the path.`,
        ...(outside.length ? [`Files you produce belong under ${outputs}; these were sent from where they are.`] : []),
      ].join(" "),
    };
  }

  /**
   * `offer_quick_replies` / `propose_company_name`: staged on the NEXT reply
   * exactly like `send_to_chat`, as `quick_replies` / `proposal` blocks —
   * one of each per reply, the latest call winning.
   */
  offerQuickReplies(scope: { botId: string; threadId: string; runId: string }, raw: unknown): { choices: string[]; note: string } {
    const turn = this.activeTurnFor(scope, "Offering quick replies");
    const choices = parseQuickReplies(raw);
    const onboarding = this.deps.onboardingStatus?.(scope.botId);
    if (onboarding && onboarding.stage !== "ready") {
      if (turn.onboardingNameProposed) throw new Error("Wait for the person's answer to the company name before asking about priorities.");
      if (onboarding.stage === "name") throw new Error("Resolve the company name first. Record an already known name in Company.md; otherwise propose only the name and wait for the answer.");
    }
    turn.pendingOutputs = turn.pendingOutputs.filter((block) => block.kind !== "quick_replies");
    turn.pendingOutputs.push({ kind: "quick_replies", choices });
    return { choices, note: `${choices.length} quick ${choices.length === 1 ? "reply" : "replies"} will appear under your next message in this chat — write that message now; do not list them again in prose.` };
  }

  proposeCompanyName(scope: { botId: string; threadId: string; runId: string }, raw: unknown): { name: string; note: string } {
    const turn = this.activeTurnFor(scope, "Proposing a company name");
    const name = parseCompanyName(raw);
    const onboarding = this.deps.onboardingStatus?.(scope.botId);
    if (onboarding && onboarding.stage !== "ready") {
      if (onboarding.companyName) throw new Error(`The company name is already known: ${onboarding.companyName}. Keep it and ask only for the next priority.`);
      if (turn.pendingOutputs.some(block => block.kind === "quick_replies")) throw new Error("The priority question has already been offered. Do not add a company name question to this turn.");
      turn.onboardingNameProposed = true;
    }
    turn.pendingOutputs = turn.pendingOutputs.filter((block) => block.kind !== "proposal");
    turn.pendingOutputs.push({ kind: "proposal", proposalKind: "company-name", value: name });
    return { name, note: `The name “${name}” will be proposed under your next message, with a button to accept it — write that message now; the person decides.` };
  }

  assertOnboardingRecruitment(scope: { botId: string; threadId: string; runId: string }): void {
    const onboarding = this.deps.onboardingStatus?.(scope.botId);
    if (!onboarding || onboarding.stage === "ready") return;
    const turn = this.activeTurnFor(scope, "Recruiting");
    if (onboarding.stage === "name" || turn.onboardingNameProposed) throw new Error("Resolve the company name and wait for the person's answer before asking for priorities or recruiting.");
    throw new Error("Ask for the first priority and wait for the person's separate answer before recruiting a specialist.");
  }

  private activeTurnFor(scope: { botId: string; threadId: string; runId: string }, what: string): ActiveTurn {
    const turn = this.active.get(scope.threadId);
    if (!turn || turn.runId !== scope.runId || turn.botId !== scope.botId || turn.cancelled || turn.discarded) {
      throw new Error(`${what} requires the matching active run`);
    }
    return turn;
  }

  /** Where an agent may send files from: its own folder, then the company
   * vault when this turn has one. The LAST root is the company workspace,
   * where `outputs/YYYY-MM-DD/` lives. */
  private outputRootsFor(bot: Bot, threadId: string): string[] {
    const canonical = (path: string): string => { try { return realpathSync(path); } catch { return path; } };
    const own = canonical(this.deps.workspaceFor(bot));
    const rawVault = this.deps.localArchitecture?.({ bot, threadId })?.sharedBrainPath;
    const vault = rawVault ? canonical(rawVault) : null;
    return vault && vault !== own ? [own, vault] : [own];
  }

  private drainOutputs(turn: ActiveTurn): MessageBlock[] {
    const blocks = turn.pendingOutputs.splice(0);
    delete turn.pendingCaption;
    return blocks;
  }

  /**
   * Outputs staged after the last reply of a turn — or in a turn that ended
   * with none — still reach the chat, on a message of their own, captioned
   * with what the tool call said. A silent routine publishes nothing, and
   * neither does a cancelled or discarded turn.
   */
  private flushOutputs(
    turn: ActiveTurn,
    bot: Bot,
    state: { text: string },
    quiet: { outcome: RoutineRunOutcome; published: string } | null,
  ): void {
    if (!turn.pendingOutputs.length) return;
    if (turn.cancelled || turn.discarded || quiet?.outcome === "silent" || quiet?.outcome === "cancelled") { this.drainOutputs(turn); return; }
    const caption = turn.pendingCaption;
    const blocks = this.drainOutputs(turn);
    if (turn.publicMessagesEnabled) {
      const found = caption ? extractLinks(caption) : { links: [], previewUrl: null };
      const message = this.deps.threads.append(turn.threadId, {
        role: "bot", deliveryState: "complete",
        blocks: [...(caption ? [{ kind: "text" as const, text: caption }] : []), ...blocks],
        botId: bot.id, runId: turn.runId,
        ...(found.links.length ? { links: found.links } : {}),
      });
      this.deps.runs.update(turn.runId, { messageId: message.id });
      this.deps.events.publish({ type: "thread.message.created", threadId: turn.threadId, message });
      this.previewLater(turn, message, found.previewUrl);
      return;
    }
    if (caption && !state.text.trim()) {
      state.text = caption;
      turn.message.blocks.push({ kind: "text", text: caption });
    }
    turn.message.blocks.push(...blocks);
    this.persist(turn);
  }

  /**
   * The card for a reply's first external link, fetched AFTER the reply is
   * in the chat: the words never wait for a web page. When it arrives, the
   * message is rewritten in place and `thread.message.updated` says so; when
   * it does not, nothing happens at all.
   */
  private previewLater(turn: ActiveTurn, message: ThreadMessage, url: string | null): void {
    if (!url || this.deps.linkPreviews === false) return;
    const fetchPreview = this.deps.fetchLinkPreview ?? ((target: string) => defaultFetchLinkPreview(target));
    void fetchPreview(url).then((preview) => {
      if (!preview || turn.discarded || (turn.threadId.startsWith("chat:") && !this.deps.chatExecutor?.(turn.botId))) return;
      // The thread may have been cleared meanwhile: never resurrect a message.
      const current = this.deps.threads.get(message.threadId, message.id);
      if (!current) return;
      const image = preview.image ? this.storePreviewImage(preview.image) : null;
      current.preview = {
        url: preview.url,
        domain: preview.domain,
        ...(preview.title ? { title: preview.title } : {}),
        ...(preview.description ? { description: preview.description } : {}),
        ...(preview.date ? { date: preview.date } : {}),
        ...(image ? { image } : {}),
      };
      this.deps.threads.replace(current);
      this.deps.events.publish({ type: "thread.message.updated", threadId: current.threadId, message: current });
    }).catch(() => undefined);
  }

  /** A preview image is kept in the runtime's own state (never in the
   * transcript, never in the workspace) and served like an attachment. */
  private storePreviewImage(image: NonNullable<FetchedPreview["image"]>): NonNullable<ThreadMessage["preview"]>["image"] | null {
    try {
      const directory = join(this.deps.storage.layout.root, "previews");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const id = `prv_${createHash("sha256").update(image.bytes).digest("hex").slice(0, 24)}`;
      const path = join(directory, `${id}${extensionForImageType(image.contentType)}`);
      writeFileSync(path, image.bytes, { mode: 0o600 });
      return {
        id, path, contentType: image.contentType, size: image.bytes.length,
        ...(image.width !== undefined && image.height !== undefined ? { width: image.width, height: image.height } : {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * At start: continue, once, each task an app shutdown cut while it was
   * in_progress (last touched within `RESTART_RESUME_WINDOW_MS`).
   *
   * Guarded three ways against a relaunch loop: once per boot, the old run
   * is marked `resumed` before its continuation is queued, and a lineage of
   * `MAX_RESTART_RESUMES` restart-resumes in a row is left alone. Only the
   * latest run of a bot × thread is considered, so a task the person has
   * since moved on from is not revived.
   */
  resumeInterruptedTasks(): string[] {
    if (this.restartResumeDone || !this.deps.localArchitecture) return [];
    this.restartResumeDone = true;
    const now = this.deps.clock.now().getTime();
    const seen = new Set<string>();
    const runIds: string[] = [];
    for (const run of this.deps.runs.list(200)) {
      const key = `${run.threadId}|${run.botId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (run.interruption !== "shutdown" || !run.task || run.threadId.startsWith("chat:")) continue;
      this.deps.runs.update(run.id, { interruption: "resumed" });
      const touched = Date.parse(run.updatedAt ?? run.endedAt ?? run.startedAt);
      if (!Number.isFinite(touched) || now - touched > RESTART_RESUME_WINDOW_MS) continue;
      const lineage = (run.restartResumes ?? 0) + 1;
      if (lineage > MAX_RESTART_RESUMES) continue;
      const bot = this.deps.bots.get(run.botId);
      if (!bot || bot.archived) continue;
      const task: TaskCheckpoint = { ...run.task, status: "in_progress" };
      const note = this.deps.threads.append(run.threadId, {
        role: "system",
        blocks: [{ kind: "meta", text: "The app restarted; resuming the unfinished task from its checkpoint." }],
      });
      this.deps.events.publish({ type: "thread.message.created", threadId: run.threadId, message: note });
      const runId = this.enqueue({
        threadId: run.threadId,
        botId: run.botId,
        hop: 0,
        chainId: note.id,
        text: `The app restarted; continue from your checkpoint, don't redo finished steps. Inspect existing results first, then complete, verify and update checkpoint_task.\nCheckpoint (reported data): ${taskRecord(task)}`,
        resume: { task, previousCheckpoint: taskRecord(task), restartResumes: lineage },
      });
      if (runId) runIds.push(runId);
    }
    return runIds;
  }

  /** Every turn on every thread — used when the window closes. */
  stopAll(): void {
    // A synchronous completion from stop() pumps the next queued turn. Empty
    // every queue first so shutdown cannot launch fresh CLI processes.
    if (this.deps.localArchitecture) {
      for (const queue of this.queues.values()) {
        for (const queued of queue) {
          if (this.deps.runs.get(queued.runId)?.task?.status === "in_progress") this.deps.runs.update(queued.runId, { interruption: "shutdown" });
        }
      }
    }
    for (const threadId of this.queues.keys()) this.cancelQueued(threadId);
    for (const turn of this.active.values()) {
      // A task cut mid-flight by the app going away is resumed once at the
      // next start (`resumeInterruptedTasks`); a STOP never is.
      if (this.deps.localArchitecture && this.deps.runs.get(turn.runId)?.task?.status === "in_progress") {
        this.deps.runs.update(turn.runId, { interruption: "shutdown" });
      }
      turn.cancelled = true;
      this.deps.onRunStopped?.(turn.runId);
      // The window is going away, so no card will ever be answered: everything
      // waiting on one is refused now rather than left hanging on a promise
      // whose thread has stopped existing. The cards close HERE, the way
      // `finish()` closes them: a CLI that never answers this stop (the app
      // is quitting) would otherwise leave `pending` blocks behind a run the
      // store reports as cancelled on the next start — and a card that still
      // looks actionable for a run that has ended.
      for (const askId of [...turn.asks.keys()]) this.markAskAnswered(turn, askId, "expired");
      turn.asks.clear();
      for (const [askId, local] of turn.localAsks) {
        this.markAskAnswered(turn, askId, "expired");
        local.settle("cancelled");
      }
      turn.localAsks.clear();
      turn.handle.stop();
    }
  }

  // ── internals ─────────────────────────────────────────────────────────

  private resolveTargets(target: ThreadTarget, text: string, explicit?: string[]): string[] {
    if ("chatId" in target) return this.deps.chatExecutor?.(target.chatId) ? [target.chatId] : [];
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

  private isGroupLeadMessage(groupId: string, text: string, explicit?: string[]): boolean {
    const group = this.deps.groups.get(groupId);
    if (!group) return false;
    return isLeadTurn(text, group.memberIds, this.deps.bots.list(), explicit);
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
    if (chain.outstanding <= 0) {
      this.chains.delete(chainId);
      for (const [threadId, owned] of this.chainOwners) {
        owned.delete(chainId);
        if (!owned.size) this.chainOwners.delete(threadId);
      }
      for (const [runId, ownedChainId] of this.runChains) {
        if (ownedChainId === chainId) this.runChains.delete(runId);
      }
    }
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
    routine?: { name: string; trigger: RoutineTrigger; endsAt?: string };
    heartbeat?: boolean;
    fromBotId?: string;
    executionPolicy?: TurnExecutionPolicy;
    triggerMessageId?: string;
    groupLead?: boolean;
    /** A task continued by this turn (restart / late-approval resumes). */
    resume?: { task: TaskCheckpoint; previousCheckpoint: string; restartResumes?: number };
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
      ...(input.heartbeat ? { heartbeat: true } : {}),
    });
    this.runChains.set(run.id, input.chainId);
    if (input.resume) {
      this.deps.runs.update(run.id, {
        task: input.resume.task,
        ...(input.resume.restartResumes ? { restartResumes: input.resume.restartResumes } : {}),
      });
    }
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
      ...(input.routine ? { routine: input.routine } : {}),
      ...(input.heartbeat ? { heartbeat: true } : {}),
      ...(input.fromBotId ? { fromBotId: input.fromBotId } : {}),
      ...(input.executionPolicy ? { executionPolicy: input.executionPolicy } : {}),
      ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
      ...(input.groupLead ? { groupLead: true } : {}),
      ...(input.resume ? {
        previousCheckpoint: input.resume.previousCheckpoint,
        ...(input.resume.restartResumes ? { restartResumes: input.resume.restartResumes } : {}),
      } : {}),
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
    const bot = threadId === `chat:${next.botId}`
      ? this.deps.chatExecutor?.(next.botId)
      : this.deps.bots.get(next.botId);
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
    if (next.routineId && bot.archived) {
      this.abandon(next, bot.id, "Routine owner is archived; the routine was paused.");
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
    // An explicit external binding must remain exact even after deletion.
    const strictBinding = queued.executionPolicy?.source === "voice" ? queued.executionPolicy.binding : null;
    const ownPlanProvider = strictBinding ? null : bot.planId ? (this.deps.planProviderOf?.(bot.planId) ?? null) : null;
    const preferredProvider = strictBinding?.provider ?? ownPlanProvider ?? settings.local.provider;
    // An external endpoint answers through codex and needs no plan at all;
    // otherwise the router picks among the connected plans.
    let ownExternal: ExternalExecutionProvider | null = null;
    let globalExternal: ExternalExecutionProvider | null = null;
    // Free tier: custom models (external providers) are a Pro feature. The
    // selection is kept — upgrading brings it back — but this turn answers
    // with the connected plan, and says so.
    const globalProviderId = settings.local.inferenceProviderId;
    const freeTier = !strictBinding && !queued.ollamaBinding && this.deps.planTier?.() === "free";
    const ignoredProvider = freeTier && Boolean(bot.providerId || (!(bot.planId && ownPlanProvider) && globalProviderId));
    try {
      ownExternal = strictBinding || queued.ollamaBinding || freeTier ? null : bot.providerId ? (this.deps.inferenceProviderById?.(bot.providerId) ?? null) : null;
      globalExternal = strictBinding || queued.ollamaBinding || freeTier || bot.providerId || (bot.planId && ownPlanProvider) ? null : this.deps.inferenceProvider?.() ?? null;
    } catch (error) {
      this.abandon(queued, bot.id, error instanceof Error ? error.message : String(error)); return;
    }
    if (!strictBinding && !freeTier && bot.providerId && !ownExternal && !queued.ollamaBinding) { this.abandon(queued, bot.id, "The selected inference provider was removed; choose a provider in Agent settings."); return; }
    const external = strictBinding ? null : queued.ollamaBinding ?? ownExternal ?? (bot.planId && ownPlanProvider ? null : globalExternal);
    if (!strictBinding && !freeTier && !bot.providerId && !(bot.planId && ownPlanProvider) && globalProviderId && !external) {
      this.abandon(queued, bot.id, "The selected inference provider was removed; choose a provider in Settings."); return;
    }
    const plan = external
      ? null
      : this.deps.resolvePlan?.({
          cursorKey,
          ...(preferredProvider ? { preferredProvider } : {}),
          ...(bot.planId && ownPlanProvider ? { botPlanId: bot.planId } : {}),
          ...(strictBinding ? { exactPlanId: strictBinding.planId } : {}),
        });
    if (strictBinding && (!plan || plan.id !== strictBinding.planId || plan.provider !== strictBinding.provider)) {
      this.abandon(queued, bot.id, "The voice task's selected personal plan is no longer available.");
      return;
    }
    const provider: PlanProvider | "ollama" | "api" = external?.kind === "ollama" ? "ollama" : external?.kind === "api" ? "api" : external ? "codex" : (plan?.provider ?? preferredProvider ?? "codex");
    // Ollama and API providers run in-process: no CLI, no MCP mount, no
    // resumable provider session, host dynamic tools only.
    const native = provider === "ollama" || provider === "api";
    const family = plan?.provider ?? preferredProvider;
    const model = external
      ? (queued.ollamaBinding?.model || bot.model?.trim() || external.model || undefined)
      : (modelForFamily(family, bot.model) ?? modelForFamily(family, settings.local.model));
    if (provider === "ollama" && !model) { this.abandon(queued, bot.id, "Select an installed Ollama model in Settings."); return; }
    if (provider === "api" && !model) { this.abandon(queued, bot.id, "Choose a model for this API provider in Settings → Plans & usage."); return; }

    let cli: string;
    try {
      if (native) {
        cli = "";
      } else if (provider === "claude") {
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
    const publicMessagesEnabled = this.deps.localArchitecture?.({ bot, threadId, ...(queued.executionPolicy ? { executionPolicy: queued.executionPolicy } : {}) })?.mode === "local";
    const shared = this.deps.sharedAccess?.(bot) ?? NO_ACCESS;
    const writableRoots = shared.folders
      .filter((folder) => folder.mode === "read-write")
      .map((folder) => folder.path);
    if (native && queued.attachments?.length) {
      this.abandon(queued, bot.id, provider === "ollama" ? "Ollama attachments are not supported in this local runtime." : "Attachments are not supported with API providers yet."); return;
    }
    const attached = this.materialize(bot, queued.attachments ?? []);
    const message = this.deps.threads.append(threadId, {
      role: "bot",
      ...(publicMessagesEnabled ? { deliveryState: "control" as const } : {}),
      // The transcript is the only place a person can later find out that
      // this turn was allowed to do anything it liked. It says so, in the run
      // it belongs to, and it stays there when the setting is turned back off.
      // Cursor's print mode cannot raise an approval card at all, so the
      // transcript says so on EVERY Cursor turn, not only under `skip-all`.
      blocks: [
        ...(ignoredProvider ? [{ kind: "meta" as const, text: FREE_TIER_PROVIDER_NOTE }] : []),
        ...(provider === "cursor"
          ? [{ kind: "meta" as const, text: cursorPermissionNote(settings.local.permissions) }]
          : skipPermissions ? [{ kind: "meta" as const, text: SKIPPED_PERMISSIONS_NOTE }] : []),
      ],
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
    // Mounted once, used for the fingerprint and the start alike: a tool
    // that appeared since the thread began (a new team tool, an app the
    // person added) must start a fresh thread, or a resumed one never sees it.
    const runContext: TurnContext = { threadId, runId: queued.runId, ...(queued.executionPolicy ? { executionPolicy: queued.executionPolicy } : {}) };
    const availableServers = native ? {} : this.deps.mcpServers(bot, runContext);
    // Cursor print mode has no BizOS approval channel. Its disposable plugin
    // therefore mounts only servers whose host policy already allows calls;
    // anything that needs a permission card remains absent and is not named
    // in the persona. The driver adds exact per-server MCP permissions.
    const mountedServers = provider === "cursor"
      ? cursorPreapprovedServers(availableServers)
      : availableServers;
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
      providerId: external?.kind === "ollama" || external?.kind === "api" ? external.providerId : external?.id ?? null,
      ...(external?.kind === "ollama" ? { baseUrl: external.baseUrl } : {}),
      tools: toolSurface,
    });
    const resumeCursor = native || (provider === "cursor" && Object.keys(mountedServers).length > 0) ? null :
      this.cursors[policyKey] === policyFingerprint ? (this.cursors[cursorKey] ?? null) : null;
    // Local Codex / Claude / Cursor agents get the slim brief once per
    // provider session and only what is new on every turn after it; the
    // cloud path, quick chats and native Ollama keep their prompts.
    const local = native || threadId.startsWith("chat:") ? null : this.localPromptFor(bot, queued, {
      provider, tools: toolSurface, excludeMessageId: message.id, resumeCursor, cursorKey, writableRoots, skipPermissions,
    });
    const persona = local ? local.system : this.personaFor(bot, threadId, {
      replayHistory: !resumeCursor, provider, tools: toolSurface, excludeMessageId: message.id,
      ...(external?.kind === "api" ? { apiLabel: external.label } : {}),
      ...(queued.executionPolicy ? { executionPolicy: queued.executionPolicy } : {}),
    });

    // A new turn here supersedes a paused request: its checkpoint is in the
    // context, and the agent asks again if it still needs to.
    for (const [askId, expired] of this.expiredAsks) {
      if (expired.threadId === threadId && expired.botId === bot.id) this.expiredAsks.delete(askId);
    }
    const turn: ActiveTurn = {
      ...queued,
      ...(external?.kind === "ollama" ? { ollamaBinding: { ...external, model: model! } } : {}),
      ...(external?.kind === "api" ? { apiBinding: { providerId: external.providerId, model: model! } } : {}),
      policyFingerprint,
      handle: undefined as unknown as CodexTurnHandle,
      message,
      asks: new Map(),
      publicMessages: new Set(),
      publicMessagesEnabled,
      ...(queued.routineId || queued.heartbeat ? { quietTexts: [...(queued.quietTexts ?? [])] } : {}),
      finalText: "",
      localAsks: new Map(),
      pendingOutputs: [],
      cancelled: false,
      discarded: false,
      ...(plan ? { planId: plan.id, planProvider: plan.provider } : {}),
      failoverUsed: options.failoverUsed === true,
      ...(local ? { sessionContext: local.sessionContext } : {}),
      taskStartedAtMs: queued.taskStartedAtMs ?? this.deps.clock.now().getTime(),
    };
    this.active.set(threadId, turn);

    const state = { text: "", steps: [] as StepItem[], failure: null as string | null };
    const environment: Record<string, string | undefined> = {
      ...(this.deps.environment ?? {}),
      ...(plan?.codexHome ? { CODEX_HOME: plan.codexHome } : {}),
      ...(plan?.configDir ? { CLAUDE_CONFIG_DIR: plan.configDir } : {}),
    };
    const turnText = [local?.turnPrefix, queued.groupLead ? GROUP_LEAD_TURN_NOTE : "", queued.text, attached.note].filter(Boolean).join("\n\n");
    const common = {
      cli,
      cwd: this.deps.workspaceFor(bot),
      text: turnText,
      ...(persona ? { system: persona } : {}),
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
    if (provider === "api" && external?.kind === "api") {
      handle = (this.deps.startOpenAiTurn ?? defaultStartOpenAiTurn)({
        baseUrl: external.baseUrl, apiKey: external.apiKey, model: model!, label: external.label,
        system: persona, text: turnText, threadId, runId: queued.runId, agent: !threadId.startsWith("chat:"),
        dynamicTools: dynamicTools ?? [],
        onEvent: (event) => this.onRuntimeEvent(turn, bot, cursorKey, state, event),
      });
    } else if (provider === "ollama" && external?.kind === "ollama") {
      handle = (this.deps.startOllamaTurn ?? defaultStartOllamaTurn)({
        baseUrl: external.baseUrl, model: model!, system: persona, text: turnText,
        threadId, runId: queued.runId, agent: !threadId.startsWith("chat:"),
        dynamicTools: dynamicTools ?? [],
        onEvent: (event) => this.onRuntimeEvent(turn, bot, cursorKey, state, event),
      });
    } else if (provider === "cursor") {
      const start = this.deps.startCursorTurn ?? defaultStartCursorTurn;
      // Built by hand rather than spread from `common`: cursor-agent takes
      // no reasoning effort or approval callback. Its MCP plugin contains
      // only host-preapproved servers and is removed with the turn.
      handle = start({
        cli,
        cwd: this.deps.workspaceFor(bot),
        text: turnText,
        ...(persona ? { system: persona } : {}),
        ...(model ? { model } : {}),
        sandbox: settings.local.sandbox,
        skipPermissions,
        resumeCursor,
        mcpServers: mountedServers,
        ...(Object.keys(environment).length ? { environment } : {}),
        onEvent: (event: RuntimeEvent) => this.onRuntimeEvent(turn, bot, cursorKey, state, event),
        tee: (entry) => {
          if (turn.discarded || (threadId.startsWith("chat:") && !this.deps.chatExecutor?.(bot.id))) return;
          this.deps.storage.appendNdjson(this.deps.storage.nativePath(threadId), entry);
        },
      });
    } else if (provider === "claude") {
      const start = this.deps.startClaudeTurn ?? defaultStartClaudeTurn;
      handle = start({
        ...common,
        ...(writableRoots.length ? { additionalDirectories: writableRoots } : {}),
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
          : (request) => this.isPreApproved(approvalKey(bot.id, request.requestType, request.tool, approvalDetailFor(request.tool, request.detail))),
        tee: (entry) => {
          if (turn.discarded || (threadId.startsWith("chat:") && !this.deps.chatExecutor?.(bot.id))) return;
          this.deps.storage.appendNdjson(this.deps.storage.nativePath(threadId), entry);
        },
      });
    } else {
      const start = this.deps.startTurn ?? defaultStartCodexTurn;
      // Codex gets the team tools as dynamic tools; the MCP twin is for
      // Claude, and mounting both would offer the same tool twice.
      const { local_team_actions: _mcpTwin, ...codexServers } = mountedServers;
      handle = start({
        ...common,
        ...(attached.input.length ? { extraInput: attached.input } : {}),
        ...(local?.resumedSystem !== undefined ? { resumedSystem: local.resumedSystem } : {}),
        ...(writableRoots.length ? { writableRoots } : {}),
        ...(external?.kind === "codex" ? { modelProvider: external } : {}),
        mcpServers: dynamicTools ? codexServers : mountedServers,
        ...(dynamicTools ? { dynamicTools } : {}),
        isAlwaysAllowed: skipPermissions
          ? () => true
          : (request) =>
              this.isPreApproved(
                approvalKey(
                  bot.id,
                  request.requestType,
                  request.tool,
                  approvalDetailFor(request.tool, request.detail),
                ),
              ),
        tee: (entry) => {
          if (turn.discarded || (threadId.startsWith("chat:") && !this.deps.chatExecutor?.(bot.id))) return;
          this.deps.storage.appendNdjson(this.deps.storage.nativePath(threadId), entry);
        },
      });
    }
    turn.handle = handle;
    if (turn.discarded) { handle.stop(); return; }
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
    if (turn.executionPolicy?.source === "voice" || turn.failoverUsed || turn.cancelled || turn.discarded) return false;
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
    for (const key of Object.keys(this.cursors)) if (key.startsWith(`${cursorKey}|`)) delete this.cursors[key];
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
      local.settle("cancelled");
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
      ...(turn.heartbeat ? { heartbeat: true } : {}),
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
        taskStartedAtMs: turn.taskStartedAtMs,
        triggerMessageId: turn.triggerMessageId,
        threadId: turn.threadId,
        botId: bot.id,
        text: turn.text,
        hop: turn.hop,
        chainId: turn.chainId,
        ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
        ...(turn.routineId ? { routineId: turn.routineId } : {}),
        ...(turn.routine ? { routine: turn.routine } : {}),
        ...(turn.heartbeat ? { heartbeat: true } : {}),
        ...(turn.quietTexts ? { quietTexts: turn.quietTexts } : {}),
        ...(turn.fromBotId ? { fromBotId: turn.fromBotId } : {}),
      },
      bot,
      { failoverUsed: true },
    );
    return true;
  }

  /**
   * The local prompt, split by what the provider session already holds.
   *
   * A session is PRIMED once it has received the brief and the chat so far
   * (`${cursorKey}|ctx` names that session). A primed session is sent only
   * what is new since this agent last spoke; anything else — a new session,
   * a session from before this rule, a provider that silently started over —
   * gets the brief and a bounded transcript again.
   *
   * The brief is byte-stable within a session (Claude re-sends it in its
   * system slot on every turn and caches it). It is refreshed when it changed
   * and is older than `BRIEF_REFRESH_MS`: memory and teammates evolve, and a
   * chat thread can live on one session for months.
   */
  private localPromptFor(bot: Bot, queued: QueuedTurn, runtime: {
    provider: PlanProvider;
    tools: string[];
    excludeMessageId: string;
    resumeCursor: string | null;
    cursorKey: string;
    writableRoots: string[];
    skipPermissions: boolean;
  }): { system: string; resumedSystem?: string; turnPrefix: string; sessionContext: SessionContext } | null {
    const { threadId } = queued;
    const architecture = this.deps.localArchitecture?.({
      bot,
      threadId,
      ...(queued.executionPolicy ? { executionPolicy: queued.executionPolicy } : {}),
    });
    if (!architecture || architecture.mode !== "local") return null;
    const settings = this.deps.settings();
    const target: ThreadTarget = threadId.startsWith("group:") ? { groupId: threadId.slice(6) } : { botId: bot.id };
    const all = this.deps.threads.snapshot(target).messages.filter((row) => row.id !== runtime.excludeMessageId);
    const lastOwn = [...all].reverse().find((row) => row.botId === bot.id);
    const keep = (row: ThreadMessage): boolean => row.id !== queued.triggerMessageId && row.blocks.length > 0;
    const group = threadId.startsWith("group:") ? this.deps.groups.get(threadId.slice(6)) : undefined;
    const roster = this.deps.bots.list();
    const shared = this.deps.sharedAccess?.(bot) ?? NO_ACCESS;
    const workspace = this.deps.workspaceFor(bot);
    const sandbox = runtime.skipPermissions ? "danger-full-access" as const : settings.local.sandbox;
    const userDir = architecture.sharedBrainPath ?? this.deps.storage.layout.workspacesDir;
    if (!architecture.sharedBrainPath) {
      try { mkdirSync(userDir, { recursive: true, mode: 0o700 }); } catch { /* named as unreadable in the brief */ }
    }
    const memory = loadMemory({
      agentDir: workspace,
      userDir,
      readOnly: sandbox === "read-only",
      userWritable: sandbox === "danger-full-access" || [workspace, ...runtime.writableRoots].some((root) => isInside(userDir, root)),
    });
    const brief = buildLocalBrief({
      bot,
      orgName: this.deps.orgName(),
      manifest: {
        ...architecture,
        sandbox,
        host: { platform: process.platform, home: homedir(), provider: runtime.provider,
          permissions: settings.local.permissions ?? "ask", tools: runtime.tools },
      },
      ...(group ? { group: {
        name: group.name,
        members: group.memberIds
          .map((id) => roster.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is Bot => Boolean(candidate)),
      } } : {}),
      ...(shared.folders.length ? { grantedFolders: shared.folders } : {}),
      ...(shared.fullDiskRead ? { fullDiskRead: true } : {}),
      ...(this.deps.hasComputer?.(bot)
        && runtime.tools.some((tool) => tool === "mcp:bizos_computer" || tool === "mcp:local_team_actions" || tool === "tool:computer_observe")
        ? { hasComputer: true } : {}),
      teamTools: runtime.tools.some((tool) => tool === "mcp:local_team_actions" || tool === "tool:checkpoint_task"),
      memory,
    });
    const task = this.deps.runs.list(200).find((run) => run.threadId === threadId && run.botId === bot.id && run.task)?.task;
    const nowIso = this.deps.clock.nowIso();
    const onboarding = this.deps.onboardingStatus?.(bot.id);
    const onboardingNote = onboarding ? onboardingTurnNote(onboarding) : "";
    const context = (fresh: boolean): string => [buildTurnContext({
      since: (fresh || !lastOwn ? all : all.filter((row) => row.seq > lastOwn.seq)).filter(keep),
      roster,
      nowIso,
      ...(task ? { task } : {}),
      fresh,
    }), onboardingNote].filter(Boolean).join("\n\n");

    const key = runtime.cursorKey;
    const primed = Boolean(runtime.resumeCursor) && this.cursors[`${key}|ctx`] === runtime.resumeCursor;
    const briefHash = createHash("sha256").update(brief).digest("hex");
    const briefAt = Date.parse(this.cursors[`${key}|briefAt`] ?? "");
    const refresh = primed && this.cursors[`${key}|briefHash`] !== briefHash &&
      (!Number.isFinite(briefAt) || this.deps.clock.now().getTime() - briefAt > BRIEF_REFRESH_MS);
    const withBrief = (text: string): string => [brief, text].filter(Boolean).join("\n\n");
    const resumedFrom = runtime.resumeCursor;

    if (runtime.provider === "codex") {
      // The driver picks: `system` on thread/start (or a failed resume),
      // `resumedSystem` when the thread really resumed.
      const full = withBrief(context(true));
      return {
        system: full,
        resumedSystem: !primed ? full : refresh ? withBrief(`(Your brief was updated; it replaces the earlier one.)\n\n${context(false)}`) : context(false),
        turnPrefix: "",
        sessionContext: { mode: "codex", provider: "codex", brief, resumedFrom, sendsBrief: !primed || refresh },
      };
    }
    if (runtime.provider === "claude") {
      const snapshot = primed && !refresh ? this.cursors[`${key}|brief`] : undefined;
      return {
        system: snapshot ?? brief,
        turnPrefix: context(!primed),
        sessionContext: { mode: primed ? "delta" : "full", provider: "claude", brief, resumedFrom, sendsBrief: snapshot === undefined },
      };
    }
    // Cursor: no system slot; the brief is prefixed once per session.
    return {
      system: !primed || refresh ? brief : "",
      turnPrefix: context(!primed),
      sessionContext: { mode: primed ? "delta" : "full", provider: runtime.provider, brief, resumedFrom, sendsBrief: !primed || refresh },
    };
  }

  /** Reconcile what the provider session holds once it has an id. */
  private recordSessionContext(turn: ActiveTurn, cursorKey: string, sessionId: string, resumed: boolean | undefined): void {
    const context = turn.sessionContext;
    if (!context) return;
    if (context.mode === "delta" && sessionId !== context.resumedFrom) {
      // Sent only the delta, but the provider started a new session: it has
      // neither brief nor chat. The next turn starts over with both.
      for (const suffix of ["ctx", "brief", "briefHash", "briefAt"]) delete this.cursors[`${cursorKey}|${suffix}`];
      return;
    }
    this.cursors[`${cursorKey}|ctx`] = sessionId;
    const sentBrief = context.mode === "codex" ? resumed !== true || context.sendsBrief : context.sendsBrief;
    if (sentBrief) {
      // Only Claude re-sends the brief itself; the others need its hash.
      if (context.provider === "claude") this.cursors[`${cursorKey}|brief`] = context.brief;
      this.cursors[`${cursorKey}|briefHash`] = createHash("sha256").update(context.brief).digest("hex");
      this.cursors[`${cursorKey}|briefAt`] = this.deps.clock.nowIso();
    }
  }

  private personaFor(bot: Bot, threadId: string, runtime: {
    /** Present for a native API turn: the provider's name. */
    apiLabel?: string;
    replayHistory: boolean;
    provider: string;
    tools: string[];
    excludeMessageId: string;
    executionPolicy?: TurnExecutionPolicy;
  }): string {
    if (threadId.startsWith("chat:")) {
      const messages = this.deps.threads.snapshot({ chatId: threadId.slice(5) }).messages
        .filter(row => row.id !== runtime.excludeMessageId);
      return buildQuickChatPrompt({ bot, messages, workspace: this.deps.workspaceFor(bot), settings: this.deps.settings(), nativeOllama: runtime.provider === "ollama",
        ...(runtime.provider === "api" ? { nativeApi: runtime.apiLabel ?? "API" } : {}) });
    }
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
    const architecture = this.deps.localArchitecture?.({
      bot,
      threadId,
      ...(runtime.executionPolicy ? { executionPolicy: runtime.executionPolicy } : {}),
    });
    const settings = this.deps.settings();
    const previousTask = architecture ? this.deps.runs.list(200).find(run => run.threadId === threadId && run.botId === bot.id && run.task)?.task : undefined;
    return buildPersonaPrompt({
      bot,
      nativeOllama: runtime.provider === "ollama",
      ...(runtime.provider === "api" ? { nativeApi: runtime.apiLabel ?? "API" } : {}),
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
      ...(!nativeProvider(runtime.provider) && shared.folders.length ? { grantedFolders: shared.folders } : {}),
      ...(!nativeProvider(runtime.provider) && shared.fullDiskRead ? { fullDiskRead: true } : {}),
      ...(this.deps.hasComputer?.(bot)
        && runtime.tools.some((tool) => tool === "mcp:bizos_computer" || tool === "mcp:local_team_actions" || tool === "tool:computer_observe")
        ? { hasComputer: true } : {}),
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
    if (turn.threadId.startsWith("chat:") && !this.deps.chatExecutor?.(turn.botId)) return;
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
      case "external.model.verified":
        if (turn.apiBinding) this.deps.runs.update(turn.runId, { inference: {
          kind: "api", providerId: turn.apiBinding.providerId, model: turn.apiBinding.model, locality: "remote",
        } });
        break;
      case "ollama.model.verified":
        if (turn.ollamaBinding) this.deps.runs.update(turn.runId, { inference: {
          kind: "ollama", providerId: turn.ollamaBinding.providerId, model: turn.ollamaBinding.model, locality: "local",
        } });
        break;
      case "session.started":
        if (event.sessionId && !turn.discarded) {
          this.cursors[cursorKey] = event.sessionId;
          this.cursors[`${cursorKey}|policy`] = turn.policyFingerprint;
          this.recordSessionContext(turn, cursorKey, event.sessionId, event.resumed);
          this.deps.storage.writeJson(CURSORS_FILE, this.cursors);
        }
        break;

      // Public messages are published atomically at provider boundaries. In
      // particular, reasoning and incomplete text never enter the transcript.
      case "content.delta":
        if (!turn.publicMessagesEnabled && event.streamKind === "assistant_text") {
          state.text += event.delta;
          upsertLegacyText();
          this.deps.onConversationMessage?.(turn.message);
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
          if (!turn.publicMessagesEnabled) {
            state.text = event.text;
            upsertLegacyText();
            turn.message.blocks.push(...this.drainOutputs(turn));
            this.persist(turn);
            break;
          }
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
          if (turn.quietTexts) {
            // Held back: a routine's verdict may still be [SILENT].
            turn.quietTexts.push(event.text);
            break;
          }
          const found = extractLinks(event.text);
          const message = this.deps.threads.append(turn.threadId, {
            role: "bot", deliveryState: "complete",
            // The words first, then what `send_to_chat` staged: one message,
            // text and attachments together, in the order they were given.
            blocks: [{ kind: "text", text: event.text }, ...this.drainOutputs(turn)],
            botId: bot.id, runId: turn.runId,
            ...(turn.message.replyToMessageId ? { replyToMessageId: turn.message.replyToMessageId } : {}),
            ...(found.links.length ? { links: found.links } : {}),
          });
          this.deps.runs.update(turn.runId, { messageId: message.id });
          this.deps.events.publish({ type: "thread.message.created", threadId: turn.threadId, message });
          this.previewLater(turn, message, found.previewUrl);
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
          ...(event.requestType === "permission"
            ? askWeight({ tool: event.tool, summary: event.summary, ...(event.detailText ? { detailText: event.detailText } : {}) })
            : {}),
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
        // A refusal stops the task. An EXPIRY is not a refusal — the person
        // was away — so it pauses the task instead (see `finish`).
        if (event.behavior === "deny" && event.source !== "timeout") turn.blockedOnInput = true;
        if (event.source === "timeout" && !turn.expiredInput) {
          for (const [askId, ask] of turn.asks) {
            if (ask.requestId !== event.requestId) continue;
            const block = turn.message.blocks.find((row) => row.kind === "ask" && row.askId === askId);
            turn.expiredInput = {
              askId,
              summary: block?.kind === "ask" ? block.summary : "a pending request",
              approvalKey: ask.approvalKey,
            };
          }
        }
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

      case "token-usage": {
        if (!this.deps.runs.get(turn.runId)?.inference) break;
        const previous = this.deps.runs.get(turn.runId)?.usage;
        this.deps.runs.update(turn.runId, { usage: {
          inputTokens: (previous?.inputTokens ?? 0) + event.input,
          outputTokens: (previous?.outputTokens ?? 0) + event.output,
          ...((previous?.cachedInputTokens !== undefined || event.cachedInput !== undefined)
            ? { cachedInputTokens: (previous?.cachedInputTokens ?? 0) + (event.cachedInput ?? 0) } : {}),
        } });
        break;
      }

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
    if (task && !turn.cancelled && !turn.discarded && ok && turn.expiredInput && !turn.blockedOnInput &&
      (task.status === "in_progress" || task.status === "blocked")) {
      // Nobody refused anything: the person was away. The task is PAUSED on
      // its checkpoint, not failed, and a late answer (or any reply in the
      // thread) picks it up again — see `answer` and `buildTurnContext`.
      const expired = turn.expiredInput;
      this.deps.runs.update(turn.runId, { task: {
        ...task,
        status: "blocked",
        next_step: `${WAITING_FOR_APPROVAL}: ${expired.summary}`.slice(0, 2000),
      } });
      this.expiredAsks.set(expired.askId, {
        runId: turn.runId, threadId: turn.threadId, botId: bot.id, messageId: turn.message.id,
        summary: expired.summary, approvalKey: expired.approvalKey, chainId: turn.chainId,
      });
      this.note(turn.threadId, "Task paused, waiting for your approval. Answer the request or reply here, and it picks up from its checkpoint.");
    } else if (task && !turn.cancelled && !turn.discarded && ok) {
      if (task.status === "in_progress") {
        const count = turn.continuationCount ?? 0;
        const fingerprint = taskRecord(task);
        const elapsed = this.deps.clock.now().getTime() - (turn.taskStartedAtMs ?? this.deps.clock.now().getTime());
        const reason = turn.blockedOnInput || turn.expiredInput
          ? "Task paused after denied or expired input; no automatic retry."
          : this.queues.get(turn.threadId)?.length
          ? "Task interrupted by a new queued message; reconcile it before continuing."
          : count >= MAX_TASK_CONTINUATIONS || elapsed >= MAX_TASK_WALL_MS
            ? "Automatic continuation budget reached (45 min or 20 turns); progress is saved. Reply to continue."
            : turn.previousCheckpoint === fingerprint
              ? "No new checkpoint progress; automatic continuation stopped."
              : null;
        // Never abandon a pending approval or question to start a fresh turn.
        if (!reason && !turn.asks.size && !turn.localAsks.size) {
          this.persist(turn);
          this.active.delete(turn.threadId);
          this.deps.onRunSettled?.(turn.runId);
          this.note(turn.threadId, "Continuing the unfinished task from its saved checkpoint.");
          this.launch({ ...queuedOf(turn), continuationCount: count + 1, previousCheckpoint: fingerprint,
            triggerMessageId: undefined,
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
      local.settle("cancelled");
    }
    turn.localAsks.clear();
    this.persist(turn);
    const quiet = this.deliverQuiet(turn, bot, state, ok);
    this.flushOutputs(turn, bot, state, quiet);

    // One preview, for the roster row and for the system notification alike:
    // the message is whole, so there is no longer a "first paragraph" that says
    // less than the answer does.
    const preview = quiet
      ? quiet.published ? previewOf([{ kind: "text", text: quiet.published }]) : ""
      : previewOf(state.text ? [{ kind: "text", text: state.text }] : turn.message.blocks);
    this.deps.bots.setStatus(bot.id, "idle", preview || undefined);
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
      // A silent routine has nothing to tell anybody, banners included.
      if (quiet?.outcome !== "silent") this.deps.onRunFinished?.({ bot, outcome: "completed", preview });
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

  /**
   * A routine or heartbeat turn is over: publish what it said, or nothing.
   *
   * Its replies were held (`quietTexts`) so a `[SILENT]` verdict never reaches
   * the thread. A routine that speaks is announced by `routine.fired` FIRST —
   * with a timestamp taken before the replies are appended, so the origin
   * marker sorts right above them. STOP publishes nothing. Returns `null` for
   * an ordinary turn.
   */
  private deliverQuiet(
    turn: ActiveTurn,
    bot: Bot,
    state: { text: string },
    ok: boolean,
  ): { outcome: RoutineRunOutcome; published: string } | null {
    if (!turn.routineId && !turn.heartbeat) return null;
    const heldTexts = turn.publicMessagesEnabled ? turn.quietTexts ?? [] : [state.text];
    turn.quietTexts = [];
    const reply = classifyRoutineReply(turn.cancelled || turn.discarded ? [] : heldTexts);
    const outcome: RoutineRunOutcome = turn.cancelled ? "cancelled"
      : !ok ? "failed"
      : reply.silent ? "silent" : "ok";
    const texts = turn.cancelled || turn.discarded ? [] : reply.texts;
    if (texts.length && turn.routineId && turn.routine) {
      this.deps.events.publish({
        type: "routine.fired",
        routineId: turn.routineId,
        botId: bot.id,
        runId: turn.runId,
        threadId: turn.threadId,
        at: this.deps.clock.nowIso(),
        routine: turn.routine,
      });
    }
    let lastMessageId: string | undefined;
    if (turn.publicMessagesEnabled) {
      texts.forEach((text, index) => {
        const found = extractLinks(text);
        const message = this.deps.threads.append(turn.threadId, {
          role: "bot", deliveryState: "complete",
          // What the routine attached rides on its last message.
          blocks: [{ kind: "text", text }, ...(index === texts.length - 1 ? this.drainOutputs(turn) : [])],
          botId: bot.id, runId: turn.runId,
          ...(found.links.length ? { links: found.links } : {}),
        });
        lastMessageId = message.id;
        this.deps.events.publish({ type: "thread.message.created", threadId: turn.threadId, message });
        this.previewLater(turn, message, found.previewUrl);
      });
    } else if (!turn.discarded) {
      // The legacy transcript streamed into the turn's own message: a silent
      // verdict is taken back out of it, a [DONE] marker is stripped.
      const index = turn.message.blocks.findIndex((block) => block.kind === "text");
      if (index >= 0) {
        if (texts.length) turn.message.blocks[index] = { kind: "text", text: texts.join("\n\n") };
        else turn.message.blocks.splice(index, 1);
        if (texts.length) turn.message.blocks.push(...this.drainOutputs(turn));
        this.persist(turn);
      }
    }
    this.deps.runs.update(turn.runId, { outcome, ...(lastMessageId ? { messageId: lastMessageId } : {}) });
    const published = texts.join("\n\n");
    this.deps.onQuietTurnSettled?.({
      runId: turn.runId,
      botId: bot.id,
      threadId: turn.threadId,
      ...(turn.routineId ? { routineId: turn.routineId } : {}),
      heartbeat: turn.heartbeat === true,
      outcome,
      report: published,
      done: reply.done && !turn.cancelled,
    });
    return { outcome, published };
  }

  /** A reply that names a teammate hands the turn over. */
  private handoff(turn: ActiveTurn, bot: Bot, reply: string): void {
    if (turn.executionPolicy?.source === "voice" || turn.discarded || !turn.threadId.startsWith("group:") || turn.hop >= MAX_HOPS || !reply.trim()) return;
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
      const replyMessageId = turn.publicMessagesEnabled ? this.deps.runs.get(turn.runId)?.messageId : undefined;
      this.enqueue({
        threadId: turn.threadId,
        botId,
        text: reply,
        hop: turn.hop + 1,
        chainId: turn.chainId,
        fromBotId: bot.id,
        ...(replyMessageId ? { triggerMessageId: replyMessageId } : {}),
      });
    }
  }
}
