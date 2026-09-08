// Domain contract for the Local BizOS runtime.
//
// This file is the main-process mirror of `src/lib/localbizos/types.ts` in
// the renderer (lot 1). The preload bridge (`window.localbizos`) speaks
// exactly these shapes, so any change here is a change to the renderer's
// contract — keep the two in step.

export type RuntimeMode = "cloud" | "local";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type SandboxMode = "read-only" | "workspace-write";

/** Whether a CLI still asks before it acts. `ask` is the product: every
 * permission request becomes an approval card. `skip-all` is the dangerous
 * global escape hatch — nobody is asked, for ANY agent, Claude or Codex. */
export type PermissionPolicy = "ask" | "skip-all";

/** Light, dark, or whatever this Mac is set to. Mirrors
 * `src/lib/localbizos/theme.ts` — the renderer's name for the same three. */
export type ThemePreference = "system" | "light" | "dark";

export type PlanProviderSetting = "codex" | "claude" | "cursor";

export interface LocalRuntimeSettings {
  codexPath?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sandbox: SandboxMode;
  workingDir?: string;
  autoApproveReads: boolean;
  /** Global permission policy for every agent — mirror in the renderer's
   * `src/lib/localbizos/types.ts` and keep the two in step. */
  permissions?: PermissionPolicy;
  /** Which connected plan answers new turns. Opaque `pln_…` id, or null. */
  activePlanId?: string | null;
  /** Preferred CLI family when resolving among connected plans. */
  provider?: PlanProviderSetting;
  /** An external API-key provider (Settings → Plans & usage) that answers
   * turns instead of a plan, through codex's `model_providers`. `null` or
   * absent means the plans do. */
  inferenceProviderId?: string | null;
}

export interface RuntimeSettings {
  mode: RuntimeMode;
  local: LocalRuntimeSettings;
  /** How this app should look. It is persisted HERE rather than left to the
   * window's `localStorage` because the MAIN process is the one that needs it:
   * `nativeTheme.themeSource` paints the title bar, the menus and every sheet
   * the OS draws on our behalf, and none of those can read a web page's
   * storage. The renderer keeps a copy in `localStorage` purely so the next
   * launch paints the right colour before this file has been read. */
  appearance: { theme: ThemePreference };
  /** What the user shared with their agents (Settings → Access). Persisted
   * in the same 0600 `settings.json`; it is never written through
   * `runtime.setSettings`, only through the `access` calls. */
  access: AccessSettings;
}

/** `read` means the folder is named to the bot and readable by the BizOS
 * document tool; `read-write` additionally puts it in the codex sandbox's
 * writable roots. Nothing else distinguishes them — see
 * `docs/architecture/05-infra-devops-security.md`. */
export type AccessMode = "read" | "read-write";

/** `"all"` is every bot; a list is exactly those bot ids. */
export type AccessScope = "all" | string[];

export interface AccessGrant {
  id: string;
  /** Canonical (`realpath`ed) absolute path. */
  path: string;
  label: string;
  mode: AccessMode;
  scope: AccessScope;
  grantedAt: string;
}

export interface AccessSettings {
  grants: AccessGrant[];
  /** Lets the BizOS document tool read anywhere in the home folder, minus
   * the folders no grant can ever cover. */
  fullDiskRead: boolean;
}

/** A folder shortcut the app offers without granting anything.
 *
 * `folderId` is what the renderer sends back to `access.grantKnown`: the MAIN
 * process resolves the id to a path with `app.getPath`, so tapping "Documents"
 * cannot become "share `/Users/ada`" by editing one string in a compromised
 * page. */
export interface FolderSuggestion {
  folderId: string;
  path: string;
  label: string;
}

/** What the native picker hands back. `nonce` is single-use and bound to the
 * canonical path the user actually chose in the system dialog; `access.grant`
 * takes the nonce and nothing else. */
export interface PickedFolder extends FolderSuggestion {
  nonce: string;
}

/** Everything Settings → Access draws, in one answer. */
export interface AccessState extends AccessSettings {
  suggestions: FolderSuggestion[];
  /** Folders the app refuses to share, whatever the user picks. */
  denied: string[];
  /** The home folder, so the screen can say `~/Documents` the way the
   * Finder does instead of a full path nobody reads. */
  home: string;
}

/** What `AccessStore.grant` takes — INSIDE the main process, after a path has
 * been proved to come from the picker or from a known-folder id. It is not
 * what crosses the bridge; see `AccessGrantRequest`. */
export interface AccessGrantInput {
  path: string;
  label?: string;
  mode?: AccessMode;
  scope?: AccessScope;
}

/**
 * What crosses the BRIDGE. There is no `path`.
 *
 * A renderer that can name a folder can name `~/.ssh`, and `grant({path})`
 * accepted exactly that: a compromised page could hand itself a durable
 * read-write grant with no dialog and no click. So a grant now names either the
 * `nonce` the native picker just issued, or the `folderId` of a shortcut the
 * main process resolves itself.
 */
export type AccessGrantRequest =
  | { nonce: string; label?: string; mode?: AccessMode; scope?: AccessScope }
  | { folderId: string; label?: string; mode?: AccessMode; scope?: AccessScope };

export type AccessGrantPatch = Partial<Pick<AccessGrant, "label" | "mode" | "scope">>;

/** One codex installation the main process found and vetted. Mirrors
 * `CodexCandidate` in the renderer's bridge contract
 * (`src/lib/localbizos/bridge.ts`) — the picker programs against THAT, so this
 * is the shape `runtime.codexCandidates()` must answer with. */
export interface CodexCandidate {
  /** Opaque and stable for a canonical path. The picker sends THIS back — a
   * free-text path from the renderer is a program this app would spawn. */
  id: string;
  path: string;
  version?: string;
}

export interface CodexStatus {
  found: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  error?: string;
}

export type AvatarKind = "procedural" | "upload" | "generated";
export type BotStatus = "idle" | "working" | "waiting";

export interface Bot {
  id: string;
  name: string;
  title?: string;
  description?: string;
  instructions?: string;
  color: string;
  avatarUrl?: string;
  avatarKind: AvatarKind;
  model?: string;
  thinking?: ReasoningEffort;
  /** Where this bot's turns run, when the person chose a folder. Absolute. */
  workspacePath?: string;
  /** The plan this bot answers with, when pinned to one. */
  planId?: string;
  /** The external API-key provider this bot answers with, when pinned to one. */
  providerId?: string;
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  sectionId?: string;
  notifyOnFinish: boolean;
  status: BotStatus;
  lastMessagePreview?: string;
  /** Where the bot sits in the roster. Persisted, so a drag-to-reorder
   * survives a reload instead of springing back. */
  sortOrder: number;
  /** How many "always allow" decisions are remembered for this bot. Derived
   * at the bridge from `approvals.json`, never persisted on the row — it is
   * what makes `bots.clearApprovals` an honest, visible affordance. */
  approvalsRemembered?: number;
  createdAt: string;
}

export interface CreateBotInput {
  name: string;
  title?: string;
  description?: string;
  instructions?: string;
  color?: string;
  model?: string;
  thinking?: ReasoningEffort;
  workspacePath?: string;
  planId?: string;
  providerId?: string;
  sectionId?: string;
  notifyOnFinish?: boolean;
}

export type UpdateBotInput = Partial<
  Omit<CreateBotInput, "name"> & {
    name: string;
    pinned: boolean;
    archived: boolean;
    unread: boolean;
    avatarKind: AvatarKind;
    sortOrder: number;
  }
>;

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  lastMessagePreview?: string;
  createdAt: string;
}

export type ThreadTarget = { botId: string } | { groupId: string };

export interface Attachment {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  dataUrl?: string;
  url?: string;
}

export interface StepItem {
  id: string;
  label: string;
  state: "running" | "done" | "failed";
}

export interface AskChoice {
  value: string;
  label: string;
}

export type MessageBlock =
  | { kind: "text"; text: string; streaming?: boolean }
  | { kind: "card"; title: string; body?: string; href?: string }
  | {
      kind: "ask";
      askId: string;
      runId: string;
      requestType: "permission" | "question";
      tool: string;
      /** The QUESTION, as a sentence a person answers: "Allow Vega to run an
       * operation in BizOS?". Written by `approvalTitle`, never by the CLI. */
      summary: string;
      /** The technical truth behind it — tool + arguments, the command, the
       * files — for the card's collapsed "Details". */
      detailText?: string;
      choices?: AskChoice[];
      /** `expired` is NOT `answered`: nobody denied this, the window closed.
       * Rendering the two the same way told the user they had refused
       * something they never saw. */
      status: AskStatus;
      answered?: { kind: AskAnsweredKind; at: string };
    }
  | { kind: "meta"; text: string }
  | { kind: "progress"; phase: string; detail?: string }
  | { kind: "steps"; items: StepItem[] }
  | { kind: "subagent"; name: string; summary?: string; state: "running" | "done" | "failed" }
  | { kind: "image"; url: string; alt?: string }
  | { kind: "file"; name: string; url?: string; mimeType?: string }
  | { kind: "handoff"; fromBotId: string; toBotId: string; reason?: string }
  | { kind: "bot_message_sent"; toBotId: string; preview?: string }
  | { kind: "bot_message_received"; fromBotId: string; preview?: string };

export type AskStatus = "pending" | "answered" | "expired";

/** Every way an ask block can end, as the harness records it. The renderer
 * labels exactly these — no other value ever reaches a transcript. */
export type AskAnsweredKind = "allow_once" | "allow_always" | "deny" | "text" | "choice" | "expired";

export type MessageRole = "user" | "bot" | "system";

export interface ThreadMessage {
  /** Control records stay private; completed public text is immutable. */
  deliveryState?: "control" | "complete";
  id: string;
  threadId: string;
  seq: number;
  role: MessageRole;
  blocks: MessageBlock[];
  botId?: string;
  replyToMessageId?: string;
  runId?: string;
  thumbsUp?: boolean;
  createdAt: string;
}

export interface ThreadSnapshot {
  threadId: string;
  target: ThreadTarget;
  messages: ThreadMessage[];
  olderCursor: string | null;
  activeRunIds: string[];
  unread: boolean;
  updatedAt: string;
}

export type RunState = "queued" | "working" | "waiting_input" | "completed" | "failed" | "cancelled";

export interface Run {
  id: string;
  threadId: string;
  botId: string;
  state: RunState;
  startedAt: string;
  endedAt?: string;
  error?: string;
  messageId?: string;
  routineId?: string;
  task?: import("./task.js").TaskCheckpoint;
}

export type RoutineFrequency = "once" | "daily" | "interval";

/** The only triggers that exist.
 *
 * There is no `webhook`: nothing in this app ever listened for one, so a
 * webhook routine was persisted, drawn as armed, and never fired. A shape
 * the runtime cannot honour is not a feature, it is a lie with a toggle. */
export type RoutineTrigger =
  /** `at` is a full ISO instant, and it must be in the future when set. */
  | { kind: "schedule"; frequency: "once"; at: string }
  /** `time` is HH:MM local; `weekdays` 0 = Sunday … 6 = Saturday. */
  | { kind: "schedule"; frequency: "daily"; time: string; weekdays?: number[] }
  | { kind: "schedule"; frequency: "interval"; everyMinutes: number };

export interface Routine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  trigger: RoutineTrigger;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  running: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateRoutineInput {
  botId: string;
  name: string;
  prompt: string;
  trigger: RoutineTrigger;
  enabled?: boolean;
}

/** What a person can send back. `expired` is absent on purpose: it is an
 * outcome the runtime records, never a decision the user makes. */
export type AskAnswer =
  | { kind: "allow_once" }
  | { kind: "allow_always" }
  | { kind: "deny" }
  | { kind: "text"; text: string }
  | { kind: "choice"; value: string };

export type ProductEvent =
  | { type: "thread.message.created"; threadId: string; message: ThreadMessage }
  | { type: "thread.message.updated"; threadId: string; message: ThreadMessage }
  | { type: "thread.progress"; threadId: string; messageId: string; phase: string; detail?: string }
  | { type: "thread.ask"; threadId: string; messageId: string; runId: string; askId: string }
  | { type: "thread.meta"; threadId: string; messageId: string; text: string }
  | { type: "thread.subagent"; threadId: string; messageId: string; name: string; state: string }
  | { type: "run.started"; runId: string; threadId: string; botId: string }
  | { type: "run.waiting_input"; runId: string; threadId: string; botId: string }
  | { type: "run.completed"; runId: string; threadId: string; botId: string }
  | { type: "run.failed"; runId: string; threadId: string; botId: string; error?: string }
  | { type: "run.cancelled"; runId: string; threadId: string; botId: string }
  | { type: "agent.tool.called"; threadId: string; runId: string; tool: string }
  | { type: "routine.fired"; routineId: string; botId: string; runId: string }
  | { type: "bot.spawned"; bot: Bot }
  | { type: "bot.archived"; botId: string }
  | { type: "bot.deleted"; botId: string }
  | { type: "group.created"; group: Group }
  | { type: "group.updated"; group: Group };

export interface BridgeError {
  code: string;
  message: string;
}

export function threadIdForTarget(target: ThreadTarget): string {
  return "botId" in target ? `bot:${target.botId}` : `group:${target.groupId}`;
}

export function targetForThreadId(threadId: string): ThreadTarget | null {
  if (threadId.startsWith("bot:")) return { botId: threadId.slice(4) };
  if (threadId.startsWith("group:")) return { groupId: threadId.slice(6) };
  return null;
}

// ── Appareils (Settings → Devices, F11) ─────────────────────────────────

/** Ce que la table `local_devices` accepte. Une plateforme exotique est rangée
 * sous `linux` par `devicePlatform()` plutôt que de faire échouer un
 * enregistrement. */
export type DevicePlatform = "darwin" | "win32" | "linux" | "ios" | "android";

/** Ce que la machine dit d'elle-même à chaque battement. Tout est optionnel :
 * une capacité absente veut dire « on ne sait pas », jamais « non ». */
export interface DeviceCapabilities {
  localRuntime?: boolean;
  codex?: { found?: boolean; version?: string | null };
  accessGrants?: number;
  remoteTasks?: boolean;
  /** Dernier battement d'une app qui se ferme proprement. */
  shuttingDown?: boolean;
}

/** Ce que l'écran Devices sait de CETTE machine — l'autre moitié (le reste du
 * parc) vient de `GET /api/devices`. `remoteTasksEnabled` est celui que le
 * dernier battement a rapporté, pas celui qu'on croyait avoir. */
export interface DeviceAgentState {
  registered: boolean;
  deviceId: string | null;
  name: string;
  platform: DevicePlatform;
  appVersion: string;
  remoteTasksEnabled: boolean;
  /** Dernier battement RÉUSSI, ou `null` si aucun. */
  lastSeenAt: string | null;
  /** Une tâche distante tourne en ce moment sur cette machine. */
  busy: boolean;
  error?: string;
}
