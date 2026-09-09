// Composition root for the local runtime. Everything Electron-specific is
// injected, so the whole harness runs under vitest with no Electron at all.
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import {
  AccessError,
  AccessStore,
  type AccessPolicy,
  assertModeAllowed,
  canonicalizeSharedPath,
  defaultAccessPolicy,
  defaultSuggestions,
  deniedDirectories,
  displayPath,
  type FolderTicket,
  FolderTickets,
  labelForPath,
  WRITE_SHEET_LIMIT,
  WRITE_SHEET_WINDOW_MS,
} from "./access.js";
import { BotStore } from "./bots.js";
import { startComputerBroker, type ComputerBroker } from "../computer/broker.js";
import type { ComputerHost } from "../computer/host.js";
import { ComputerManager, type ComputerEvent } from "../computer/manager.js";
import { NativeComputerBackend } from "../computer/native.js";
import type { ComputerState } from "../computer/types.js";
import { systemClock, type Clock } from "./clock.js";
import { DeviceAgent, TASK_TIMEOUT_MS } from "./device-agent.js";
import { codexCandidates, codexPathForId, probeCodexStatus, requireCodexPath } from "./codex-status.js";
import { resolveModelCatalog, STATIC_CODEX_MODELS, type ModelCatalog } from "./codex-models.js";
import { resolveClaudeModelCatalog, STATIC_CLAUDE_MODELS } from "./claude-models.js";
import { probeClaudeStatus, requireClaudePath } from "./claude-status.js";
import { resolveCursorModelCatalog, STATIC_CURSOR_MODELS } from "./cursor-models.js";
import {
  CursorCliMissingError,
  probeCursorStatus,
  requireCursorPath,
  resolveCursorPath,
} from "./cursor-status.js";
import { approvalKey, Dispatcher, type DispatchDependencies } from "./dispatch.js";
import { EventBus, runFinishNotification, type NotificationSink } from "./events.js";
import { GroupStore } from "./groups.js";
import { openCliLogin } from "./login-launcher.js";
import {
  buildMcpServers,
  describeMissingTools,
  describeToolsStatus,
  resolveMcpLauncher,
  type McpLauncher,
  type ToolsStatus,
} from "./mcp-mount.js";
import { PlanRegistry, MAX_PLAN_LABEL } from "./plan-registry.js";
import { failoverCooldownUntil, failoverPlan as routeFailover, resolvePlan } from "./plan-router.js";
import type { PlanProvider, PublicPlan } from "./plan-types.js";
import { RoutineStore } from "./routines.js";
import { RunStore } from "./runs.js";
import { Scheduler } from "./scheduler.js";
import { defaultSettingsPolicy, PERMISSION_POLICIES, SettingsError, SettingsStore } from "./settings.js";
import { startSessionBroker, type SessionBroker } from "./session-broker.js";
import { Storage, DIRECTORY_MODE, safeFileName } from "./storage.js";
import { ThreadStore } from "./threads.js";
import type { CodexDynamicTool, StdioMcpServer } from "./codex-driver.js";
import { isHttpMcpServer } from "./codex-driver.js";
import {
  BrainError,
  createFolder,
  createNote,
  openEntry,
  readNote,
  renameEntry,
  scanVault,
  trashEntry,
  writeNote,
  type BrainNoteContent,
  type BrainOpenMode,
  type BrainRoot,
  type BrainScan,
} from "./brain.js";
import {
  AGENTS_DIRECTORY,
  agentFolderName,
  COMPANY_OS,
  completeTemplateVault,
  ensureAgentFolder,
  isAgentFolder,
  seedTemplateVault,
  TEMPLATE_FILE,
  validateTemplate,
  type TemplateBot,
  type TemplateState,
  type VaultSeed,
} from "./company-os.js";
import {
  bindingConflict,
  describeUnavailable,
  holdsTemplate,
  installationStatus,
  installationVaultDir,
  isTemplateId,
  legacyCompanyOsInstallation,
  lstatOrNull,
  managedVaultRoots,
  readTemplateRegistry,
  readWorkspaceBinding,
  refuseSymlink,
  summarize,
  TEMPLATE_IDS,
  templateOf,
  vaultPathOf,
  vaultRootId,
  VAULTS_DIRECTORY,
  writeTemplateRegistry,
  writeWorkspaceBinding,
  type PendingInstallation,
  type TemplateId,
  type TemplateInstallation,
  type TemplateRegistry,
  type TemplateSummary,
  type WorkspaceBinding,
  type WorkspaceTemplateProjection,
} from "./templates.js";
import { AGENCY_TOOLS_INSTRUCTIONS } from "./agency-tools.js";
import { COMMERCE_TOOLS_INSTRUCTIONS } from "./commerce-tools.js";
import { LEGACY_AGENCY_DIRECTORY, legacyAgencyVaultPath } from "./agency.js";
import type { PackInstallation } from "./pack.js";
import { newId, newMessageId } from "./ids.js";
import { readCodexUsage } from "./codex-usage.js";
import { readClaudeUsage } from "./claude-usage.js";

/** How long a plan's reported usage is trusted before the CLI is asked again. */
const USAGE_CACHE_MS = 5 * 60_000;
import {
  codexModelProviderFor,
  INFERENCE_PRESETS,
  InferenceError,
  InferenceStore,
  probeInferenceProvider,
  toPublicProvider,
  type InferenceProbe,
  type InferenceProviderInput,
  type InferenceProviderPatch,
  type PublicInferenceProvider,
} from "./inference.js";
import {
  AppsStore,
  LOCAL_APP_CATALOG,
  LocalAppError,
  launcherAvailability,
  loginCommandFor,
  mountApp,
  probeHttpServer,
  probeStdioServer,
  toPublic as publicApp,
  type CustomLocalAppInput,
  type LocalAppDetails,
  type LocalAppPatch,
  type ProbeResult,
  type PublicLocalApp,
} from "./apps.js";
import type { LocalArchitectureManifest } from "./prompt.js";
import {
  threadIdForTarget,
  type AccessGrantRequest,
  type AccessGrantPatch,
  type AccessMode,
  type AccessScope,
  type AccessSettings,
  type AccessState,
  type AskAnswer,
  type Attachment,
  type Bot,
  type CodexCandidate,
  type CodexStatus,
  type CreateBotInput,
  type CreateRoutineInput,
  type DeviceAgentState,
  type DeviceCapabilities,
  type MessageBlock,
  type Group,
  type PermissionPolicy,
  type ProductEvent,
  type Routine,
  type Run,
  type RuntimeSettings,
  type ThreadMessage,
  type ThreadSnapshot,
  type FolderSuggestion,
  type PickedFolder,
  type ThreadTarget,
  type UpdateBotInput,
  targetForThreadId,
} from "./types.js";

/** How long a live model catalogue is trusted before the CLI is asked again. */
export const MODEL_CACHE_MS = 10 * 60_000;

/** What "always allow this agent on this host" is remembered as. It is an
 * ordinary approval key, so everything that already lists, counts and revokes
 * approvals covers it without knowing what a computer is. */
export function computerHostKey(botId: string, host: string): string {
  return approvalKey(botId, "computer", "computer_act", host);
}

/** The dedicated thread a remote task lands in, and the line that opens it.
 * A task the user cannot read afterwards is a back door, not a feature. */
export const REMOTE_TASKS_THREAD = "Remote tasks";
export const REMOTE_TASK_NOTE = "Task from BizOS admin";
/** The heartbeat asks for the CLI every minute; probing it every time would
 * spawn a `codex --version` per minute for a line of text nobody reads that
 * often. */
export const DEVICE_CAPABILITY_CACHE_MS = 10 * 60_000;

export interface HarnessOptions {
  /** `<userData>/localbizos` — every file the runtime owns lives here. */
  rootDir: string;
  /** Origin of the BizOS web app this window is showing. */
  baseUrl: string;
  /** The Electron partition's cookies for `baseUrl`, as a Cookie header. */
  readSessionCookie(): Promise<string>;
  /** Name shown to the bots as their employer. */
  orgName(): string;
  execPath: string;
  packaged: boolean;
  /** The RunAsNode fuse is off in packaged builds; see `resolveMcpLauncher`. */
  runAsNodeAvailable: boolean;
  /** Absolute path to the compiled `bizos-mcp.mjs`. */
  mcpScriptPath: string;
  environment?: NodeJS.ProcessEnv;
  clock?: Clock;
  notifications?: NotificationSink;
  /** The home folder Access is anchored on. Injected so a test can point it
   * at a scratch directory. */
  homeDir?: string;
  /** Folder shortcuts offered in Settings → Access, resolved in the main
   * process with `app.getPath`. */
  folderSuggestions?: FolderSuggestion[];
  /** The NATIVE folder picker. A path never comes from the renderer, so
   * without this the app simply has no way to add a folder. */
  pickFolder?(): Promise<string | null>;
  /**
   * The NATIVE confirmation for "let my agents read any file in my home
   * folder". A boolean crossing the bridge is not consent: a compromised page
   * could send `true` on its own. The main process asks, in a system dialog,
   * and only its answer turns this on. Without it, the toggle refuses to arm
   * rather than arming on the renderer's word.
   */
  confirmFullDiskRead?(): Promise<boolean>;
  /**
   * The NATIVE confirmation for turning a folder into one the agents can WRITE.
   *
   * Same reasoning as `confirmFullDiskRead`, for the hole that was left open:
   * the picker's own sheet describes READING, and `mode` travelled from the
   * renderer as a free string — so `grant({folderId:"documents",
   * mode:"read-write"})` or `update(id,{mode:"read-write"})` handed a
   * compromised page a durable writable root with nothing on screen. Every path
   * into `read-write` now asks here, with the folder named. Without it, the
   * elevation is refused rather than taken on the renderer's word.
   */
  confirmWriteAccess?(input: { path: string; display: string }): Promise<boolean>;
  /**
   * Absolute folders no grant may ever cover, on top of the built-in list —
   * `app.getPath("userData")`, which is where the user's live session cookie,
   * `settings.json` and every transcript live.
   */
  deniedDirs?: string[];
  /** Test seam handed straight to the dispatcher. */
  startTurn?: DispatchDependencies["startTurn"];
  retryScale?: number;
  /** The build's version, as this machine reports it to the device registry. */
  appVersion?: string;
  /** This machine's host name. Injected so a test can name it. */
  hostname?(): string;
  /** The `fetch` the device agent talks to BizOS with. */
  fetchImpl?: typeof fetch;
  /** `false` keeps the device agent built but never started — the unit tests
   * that only exercise bots and threads have no server to register with. */
  devices?: boolean;
  /**
   * Called whenever the DURABLE settings change, and once on `start()`.
   *
   * It exists for exactly one thing today: `nativeTheme.themeSource`. The title
   * bar, the menu bar and every native sheet are drawn by macOS, not by the
   * page, so the main process has to be told which theme the window is in — and
   * it has to be told the moment the renderer changes it, not on the next
   * launch. Anything else that has to follow the settings from outside the
   * renderer hangs here too, rather than growing a second channel.
   */
  onSettingsChanged?(settings: RuntimeSettings): void;
  /**
   * The Electron primitives an agent's computer is made of.
   *
   * Absent ⇒ there is no computer: `computer.get()` answers `backend: "none"`,
   * the `bizos_computer` tools are not mounted, and the panel says "Computers
   * run on the desktop app". That is the honest answer for the cloud runtime and
   * for every unit test, and it is why this is an option rather than an import.
   */
  computerHost?: ComputerHost;
  /** Optional local-only team tool. It is never mounted by cloud composition. */
  localTeamMcp?(input: { bot: Bot; threadId: string; runId: string }): StdioMcpServer | null;
  /** Optional local-only host tools. They never enter the cloud composition. */
  localTeamTools?(input: { bot: Bot; threadId: string; runId: string }): CodexDynamicTool[];
  /** Called for completed, failed and cancelled local runs. */
  onLocalRunSettled?(runId: string): void;
  /** Called the moment a local run is asked to STOP, before the CLI settles. */
  onLocalRunStopped?(runId: string): void;
  /** Factual local runtime manifest injected into the agent prompt. */
  localArchitecture?(input: {
    bot: Bot;
    threadId: string;
    workspaceDir: string;
    sandbox: RuntimeSettings["local"]["sandbox"];
    peers: Bot[];
  }): LocalArchitectureManifest;
}

/** Where the list of agents that have a computer is kept. Their partitions
 * outlive the process; without this the panel forgets they exist. */
export const COMPUTERS_FILE = "computers.json";

/** Where a template is installed: a managed vault this app makes, or an
 * existing vault the person chose (its real path, resolved server-side). */
interface InstallTarget {
  rootId: string;
  path: string;
  managed: boolean;
  label: string;
}

/** `lstat` that answers `null` for anything it cannot examine. */
function lstatOrNullQuiet(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** What `templates.apply` answers: the vault to open, and whether this call
 * made it or found it. `bots` is slug → roster id for the agents that exist. */
export interface TemplateApplyResult {
  id: TemplateId;
  rootId: string;
  created: boolean;
  vault: VaultSeed;
  bots: Record<string, string>;
  groupId?: string;
}

/** What `runtime.models()` answers — the bridge contract, not the internal
 * catalogue shape. `source` is the honest part: the renderer can say
 * whether this list came from the CLI or from what we shipped. `provider`
 * says which family the ids belong to when multi-plan is active. */
export interface ModelsResponse {
  models: Array<{ id: string; label: string; isDefault?: boolean }>;
  source: "live" | "static";
  provider?: PlanProvider;
}

export class LocalBizosHarness {
  readonly storage: Storage;
  readonly events = new EventBus();
  private readonly clock: Clock;
  private readonly settingsStore: SettingsStore;
  private readonly botStore: BotStore;
  private readonly groupStore: GroupStore;
  private readonly threadStore: ThreadStore;
  private readonly routineStore: RoutineStore;
  private readonly runStore: RunStore;
  private readonly accessStore: AccessStore;
  private readonly accessPolicy: AccessPolicy;
  /** Single-use tickets from the native picker — see `FolderTickets`. */
  private readonly folderTickets = new FolderTickets();
  /** One WRITE sheet on screen at a time, and no more of them than a person
   * asks — see `consentToWrite` and `WRITE_SHEET_LIMIT`. */
  private writeSheetOpen = false;
  private readonly writeSheetsAsked: number[] = [];
  private readonly homeDir: string;
  private readonly dispatcher: Dispatcher;
  private readonly scheduler: Scheduler;
  private readonly launcher: McpLauncher | null;
  private readonly deviceAgent: DeviceAgent;
  private deviceCapabilityCache: { at: number; value: DeviceCapabilities } | null = null;
  private sessionCookie = "";
  private broker: SessionBroker | null = null;
  private brokerStarting: Promise<SessionBroker | null> | null = null;
  private catalog: { at: number; value: ModelCatalog } | null = null;
  /** The Claude list is per ACCOUNT, not per machine: two plans on this Mac
   * can be entitled to different models, so the cache is keyed by the
   * config directory whose token answered. */
  private claudeCatalog: { at: number; key: string; value: ModelCatalog } | null = null;
  /** The Cursor list is the machine account's — there is only one, so this
   * one is keyed by nothing but its age. */
  private cursorCatalog: { at: number; value: ModelCatalog } | null = null;
  private readonly computerManager: ComputerManager;
  private readonly computerListeners = new Set<(event: ComputerEvent) => void>();
  private computerBroker: ComputerBroker | null = null;
  private computerBrokerStarting: Promise<ComputerBroker | null> | null = null;
  private readonly planRegistry: PlanRegistry;
  private readonly appsStore: AppsStore;
  private readonly inferenceStore: InferenceStore;

  constructor(private readonly options: HarnessOptions) {
    this.clock = options.clock ?? systemClock;
    this.storage = new Storage(options.rootDir);
    this.settingsStore = new SettingsStore(
      this.storage,
      defaultSettingsPolicy(
        [homedir(), this.storage.layout.root],
        this.environment(),
        options.homeDir ?? homedir(),
        options.deniedDirs ?? [],
      ),
    );
    this.botStore = new BotStore(this.storage, this.clock);
    this.botStore.resetTransient();
    this.groupStore = new GroupStore(this.storage, this.clock);
    this.threadStore = new ThreadStore(this.storage, this.clock);
    this.routineStore = new RoutineStore(this.storage, this.clock);
    this.runStore = new RunStore(this.storage, this.clock);
    this.planRegistry = new PlanRegistry(this.storage);
    this.appsStore = new AppsStore(this.storage, () => this.clock.nowIso(), () => this.environment());
    this.inferenceStore = new InferenceStore(this.storage, () => this.clock.nowIso());
    this.homeDir = options.homeDir ?? homedir();
    this.accessPolicy = defaultAccessPolicy(this.homeDir, options.deniedDirs ?? []);
    this.accessStore = new AccessStore({
      read: () => this.settingsStore.get().access,
      write: (value) => void this.settingsStore.setAccess(value),
      policy: this.accessPolicy,
      nowIso: () => this.clock.nowIso(),
      newId: () => `acc_${this.clock.now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      journal: (entry) =>
        this.storage.appendNdjson(join(this.storage.layout.nativeDir, "access.ndjson"), entry),
    });
    this.launcher = resolveMcpLauncher({
      scriptPath: options.mcpScriptPath,
      execPath: options.execPath,
      packaged: options.packaged,
      runAsNodeAvailable: options.runAsNodeAvailable,
      ...(options.environment ? { environment: options.environment } : {}),
    });

    this.dispatcher = new Dispatcher({
      bots: this.botStore,
      groups: this.groupStore,
      threads: this.threadStore,
      runs: this.runStore,
      events: this.events,
      clock: this.clock,
      storage: this.storage,
      settings: () => this.settingsStore.get(),
      orgName: () => options.orgName(),
      // Re-validated at THIS moment, not when it was saved: a symlink can be
      // repointed between the two, and anything that can write `settings.json`
      // had the same door. It throws; `launch` turns that into a failed turn
      // with the sentence in the thread.
      codexPath: () =>
        requireCodexPath(this.settingsStore.get().local.codexPath, this.environment(), {
          packaged: options.packaged,
        }),
      claudePath: () => requireClaudePath(undefined, this.environment(), { packaged: options.packaged }),
      cursorPath: () => requireCursorPath(undefined, this.environment(), { packaged: options.packaged }),
      resolvePlan: ({ cursorKey, preferredProvider, botPlanId }) =>
        resolvePlan({
          plans: this.planRegistry.list(),
          routing: this.planRegistry.routing(),
          cursorKey,
          ...(preferredProvider ? { preferredProvider } : {}),
          ...(botPlanId ? { botPlanId } : {}),
          nowMs: this.clock.now().getTime(),
        }),
      planProviderOf: (planId) => this.planRegistry.get(planId)?.provider ?? null,
      inferenceProviderById: (id) => {
        const provider = this.inferenceStore.get(id);
        return provider ? codexModelProviderFor(provider) : null;
      },
      failoverPlan: ({ cursorKey, failedPlanId, preferredProvider }) =>
        routeFailover({
          plans: this.planRegistry.list(),
          routing: this.planRegistry.routing(),
          cursorKey,
          failedPlanId,
          cooldownUntilIso: failoverCooldownUntil(this.clock.now().getTime()),
          markCooldown: (id, until) => this.planRegistry.markCooldown(id, until),
          clearPin: (key) => this.planRegistry.clearPin(key),
          ...(preferredProvider ? { preferredProvider } : {}),
          nowMs: this.clock.now().getTime(),
        }),
      pinPlan: (cursorKey, planId) => this.planRegistry.setPin(cursorKey, planId),
      touchPlan: (planId) => this.planRegistry.touch(planId, this.clock.nowIso()),
      inferenceProvider: () => {
        const id = this.settingsStore.get().local.inferenceProviderId;
        if (!id) return null;
        const provider = this.inferenceStore.get(id);
        return provider ? codexModelProviderFor(provider) : null;
      },
      mcpServers: (bot, context) => {
        const access = this.settingsStore.get().access;
        const cloudTools = buildMcpServers({
          launcher: this.launcher,
          baseUrl: options.baseUrl,
          sessionCookie: this.sessionCookie,
          broker: this.broker,
          workspaceDir: this.workspaceFor(bot),
          sharedDirs: this.accessStore.readableRootsFor(bot.id),
          ...(access.fullDiskRead ? { fullDiskReadRoot: this.homeDir } : {}),
          deniedDirs: deniedDirectories(this.homeDir, this.options.deniedDirs ?? []),
          autoApproveReads: this.settingsStore.get().local.autoApproveReads,
          // One token per spawn, bound to THIS bot. There is nothing in the
          // child's environment that could name another agent's machine.
          ...(this.computerBroker && options.computerHost
            ? { computer: { url: this.computerBroker.url, token: this.computerBroker.issue(bot.id) } }
            : {}),
        });
        const localTeam = options.localTeamMcp?.({ bot, ...context });
        // The user's own apps go first so a harness server always wins the
        // key on a collision (the store refuses reserved names anyway).
        const apps = this.appsStore.mountedServers({ sharedDirs: this.accessStore.readableRootsFor(bot.id) });
        return { ...apps, ...cloudTools, ...(localTeam ? { local_team_actions: localTeam } : {}) };
      },
      ...(options.localTeamTools ? { dynamicTools: (bot: Bot, context: { threadId: string; runId: string }) =>
        options.localTeamTools!({ bot, ...context }) } : {}),
      ...(options.onLocalRunSettled ? { onRunSettled: (runId: string) => options.onLocalRunSettled!(runId) } : {}),
      ...(options.onLocalRunStopped ? { onRunStopped: (runId: string) => options.onLocalRunStopped!(runId) } : {}),
      workspaceFor: (bot) => this.workspaceFor(bot),
      // Only a build with a machine tells its bots they have one.
      hasComputer: () => Boolean(options.computerHost),
      sharedAccess: (bot) => ({
        folders: this.accessStore
          .forBot(bot.id)
          .map((grant) => ({ path: grant.path, mode: grant.mode })),
        fullDiskRead: this.settingsStore.get().access.fullDiskRead,
      }),
      ...(options.localArchitecture ? {
        localArchitecture: ({ bot, threadId }: { bot: Bot; threadId: string }) => options.localArchitecture!({
          bot,
          threadId,
          workspaceDir: this.workspaceFor(bot),
          sandbox: this.settingsStore.get().local.sandbox,
          peers: this.botStore.list().filter((candidate) => !candidate.archived && candidate.id !== bot.id),
        }),
      } : {}),
      onRunFinished: ({ bot, outcome, preview }) => this.notifyRunFinished(bot, outcome, preview),
      // The scheduler owns both halves: it hands the routine's mutex back and
      // clears `running`, but only for the run that actually holds it.
      onRoutineIdle: (routineId, runId) => this.scheduler.settle(routineId, runId),
      ...(options.startTurn ? { startTurn: options.startTurn } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.retryScale ? { retryScale: options.retryScale } : {}),
    });

    // The computer, and the three things that decide whether it may be used.
    // `approvalKey(bot, "computer", "computer_act", host)` puts a remembered
    // host in the SAME approvals file as every other standing grant, so
    // Settings → Approvals lists it and `bots.clearApprovals` revokes it with
    // no extra code on either side.
    this.computerManager = new ComputerManager({
      approvals: {
        hasActiveTurn: (botId) => this.dispatcher.hasActiveTurn(botId),
        isRemembered: (botId, host) => this.dispatcher.isRemembered(computerHostKey(botId, host)),
        ask: ({ botId, host }) =>
          this.dispatcher.askLocally({
            botId,
            summary: `Allow ${this.botStore.get(botId)?.name ?? "this agent"} to act on ${host}?`,
            detailText: `${host} · this computer is signed in there, so anything it does happens as you.`,
            approvalKey: computerHostKey(botId, host),
          }),
      },
      workspaceFor: (botId) => {
        const bot = this.botStore.get(botId);
        return bot ? this.workspaceFor(bot) : this.storage.workspacePath(botId);
      },
      nowIso: () => this.clock.nowIso(),
      now: () => this.clock.now().getTime(),
      publish: (event) => {
        for (const listener of [...this.computerListeners]) {
          try {
            listener(event);
          } catch {
            // One bad subscriber must not stop the rest of the fan-out.
          }
        }
      },
      provisioned: {
        read: () => this.storage.readJson<string[]>(COMPUTERS_FILE, []),
        write: (botIds) => this.storage.writeJson(COMPUTERS_FILE, botIds),
      },
      ...(options.computerHost
        ? {
            backend: new NativeComputerBackend({
              host: options.computerHost,
              workspaceFor: (botId) => {
                const bot = this.botStore.get(botId);
                return bot ? this.workspaceFor(bot) : this.storage.workspacePath(botId);
              },
              nowIso: () => this.clock.nowIso(),
              now: () => this.clock.now().getTime(),
              onFrame: (botId, frame) => this.computerManager.onFrame(botId, frame),
              onStateChanged: (botId) => this.computerManager.publishStatus(botId),
            }),
          }
        : {}),
    });

    this.scheduler = new Scheduler({
      routines: this.routineStore,
      clock: this.clock,
      // A scheduled fire refreshes the session first. The Supabase token
      // rotates roughly hourly; without this every routine that fired more
      // than an hour after launch was told "this Mac's BizOS session is
      // signed out" by every tool it reached for.
      fire: async ({ routine, missed }) => {
        await this.refreshSessionCookie();
        const bot = this.botStore.get(routine.botId);
        if (!bot) return undefined;
        return this.dispatcher.runRoutine({
          botId: routine.botId,
          routineId: routine.id,
          prompt: missed
            ? `${routine.prompt}\n\n(This routine was due while Local BizOS was closed; it is running now, late.)`
            : routine.prompt,
        });
      },
    });

    // The device agent is BUILT here and STARTED in `start()`: a harness a
    // test constructs without starting must not reach for the network.
    this.deviceAgent = new DeviceAgent({
      baseUrl: options.baseUrl,
      appVersion: options.appVersion ?? "0.0.0",
      platform: process.platform,
      hostname: options.hostname ?? (() => hostname()),
      storage: this.storage,
      clock: this.clock,
      fetch: options.fetchImpl ?? ((input, init) => fetch(input, init)),
      readSessionCookie: () => options.readSessionCookie(),
      capabilities: () => this.deviceCapabilities(),
      runTask: (prompt) => this.runRemoteTask(prompt),
    });
  }

  private environment(): NodeJS.ProcessEnv {
    return this.options.environment ?? process.env;
  }

  /** The bot's codex cwd. Created here: spawning into a directory that does
   * not exist answers ENOENT, which used to be reported as "codex isn't
   * installed" — a setup error for a perfectly good installation. */
  private workspaceFor(bot: Bot): string {
    // The bot's own folder (Agent settings) wins over the global working
    // directory; the folder was checked when it was chosen, and the spawn
    // failure names it if it has gone since.
    if (bot.workspacePath) return bot.workspacePath;
    const configured = this.settingsStore.get().local.workingDir;
    if (!configured) return this.storage.workspacePath(bot.id);
    const path = join(configured, bot.id);
    try {
      mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE });
    } catch {
      // A folder the user moved or unmounted: the spawn failure below will
      // name it, which is more useful than failing here.
    }
    return path;
  }

  private notifyRunFinished(bot: Bot, outcome: "completed" | "failed", preview: string): void {
    const sink = this.options.notifications;
    if (!sink) return;
    const notice = runFinishNotification(
      { botName: bot.name, notifyOnFinish: bot.notifyOnFinish, outcome, preview },
      sink.isFocused(),
    );
    if (notice) sink.show(notice);
  }

  /** The loopback broker that hands the session to the tool servers. Started
   * lazily and at most once; every path that needs a cookie goes through
   * `refreshSessionCookie`, so it is always listening before a turn mounts. */
  private async ensureBroker(): Promise<SessionBroker | null> {
    if (this.broker) return this.broker;
    if (!this.brokerStarting) {
      this.brokerStarting = startSessionBroker()
        .then((broker) => {
          this.broker = broker;
          return broker;
        })
        .catch(() => null);
    }
    return this.brokerStarting;
  }

  /** The loopback broker the `bizos_computer` tools reach the machine through.
   * Started at most once, and only when this build has a machine at all. */
  private async ensureComputerBroker(): Promise<ComputerBroker | null> {
    if (!this.options.computerHost) return null;
    if (this.computerBroker) return this.computerBroker;
    if (!this.computerBrokerStarting) {
      this.computerBrokerStarting = startComputerBroker({ manager: this.computerManager })
        .then((broker) => {
          this.computerBroker = broker;
          return broker;
        })
        .catch(() => null);
    }
    return this.computerBrokerStarting;
  }

  /** Called before every turn: the Electron session's cookies are the
   * user's live BizOS credentials and they rotate. The cookie is kept here,
   * in the main process, and handed out only as one-shot broker tokens — it
   * never enters the environment of `codex` or of any tool server. */
  private async refreshSessionCookie(): Promise<void> {
    await this.ensureBroker();
    await this.ensureComputerBroker();
    try {
      this.sessionCookie = await this.options.readSessionCookie();
    } catch {
      this.sessionCookie = "";
    }
  }

  async start(): Promise<void> {
    // Before anything else: the window is about to be created, and it should be
    // created in the theme this machine last chose.
    this.options.onSettingsChanged?.(this.settingsStore.get());
    await this.seedPlansFromMachine();
    await this.refreshSessionCookie();
    this.scheduler.start();
    if (this.options.devices !== false) this.deviceAgent.start();
  }

  /** Import ~/.codex, ~/.claude and the machine's Cursor account as
   * connected plans when the registry is empty. */
  private async seedPlansFromMachine(): Promise<void> {
    if (this.planRegistry.list().length > 0) return;
    const env = this.environment();
    const home = this.homeDir;
    // In PARALLEL: this runs inside `start()`, before the window is usable,
    // and three CLI probes one after another is three CLI start-ups of
    // waiting for a screen that has nothing to show yet.
    const settle = async <T>(work: Promise<T>): Promise<T | null> => {
      try {
        return await work;
      } catch {
        return null;
      }
    };
    const [codex, claude] = await Promise.all([
      settle(probeCodexStatus(undefined, env, undefined, { packaged: this.options.packaged })),
      settle(
        probeClaudeStatus(undefined, env, undefined, {
          packaged: this.options.packaged,
          configDir: join(home, ".claude"),
        }),
      ),
    ]);
    const claudeEmailHint = claude?.emailHint;
    this.planRegistry.seedFromMachine({
      nowIso: this.clock.nowIso(),
      homeDir: home,
      codexAuthenticated: codex?.found === true && codex.authenticated === true,
      claudeAuthenticated: claude?.found === true && claude.authenticated === true,
      ...(claudeEmailHint ? { claudeEmailHint } : {}),
    });
    const active = this.planRegistry.getActive();
    if (active) {
      this.settingsStore.set({
        local: { activePlanId: active.id, provider: active.provider },
      });
    }
    // BEHIND the launch, not in front of it. The Cursor CLI is a single
    // ~500 MB bundle and one start-up costs the best part of a second; the
    // window is waiting on `start()`, and a plan row that appears a moment
    // later is better than a launch that stalls for it. `plans.list()` waits
    // on it, so Settings never draws a list that is missing this row.
    this.importMachineCursorPlan();
  }

  private cursorSeed: Promise<void> | null = null;

  /**
   * Import the machine's Cursor account, once, on the same first run the
   * other two families are imported on. Self-guarded twice, because the
   * probe is awaited in between: a second Cursor row would be the SAME
   * account (its token is one Keychain item per Mac, not one per folder).
   */
  private importMachineCursorPlan(): void {
    if (this.cursorSeed) return;
    this.cursorSeed = (async () => {
      if (this.planRegistry.list().some((plan) => plan.provider === "cursor")) return;
      const status = await probeCursorStatus(undefined, this.environment(), undefined, {
        packaged: this.options.packaged,
      });
      if (status.found !== true || status.authenticated !== true) return;
      if (this.planRegistry.list().some((plan) => plan.provider === "cursor")) return;
      this.planRegistry.createReferencing({
        provider: "cursor",
        label: "Cursor",
        homePath: join(this.homeDir, ".cursor"),
        status: "connected",
        ...(status.emailHint ? { emailHint: status.emailHint } : {}),
        createdAt: this.clock.nowIso(),
      });
    })().catch(() => undefined);
  }

  stop(): void {
    // Awaited nowhere: `stop()` is called from `before-quit`, and a last
    // heartbeat that cannot reach the server must not delay a quit.
    void this.deviceAgent.stop();
    this.scheduler.stop();
    this.dispatcher.stopAll();
    this.events.clear();
    void this.broker?.close();
    this.broker = null;
    this.brokerStarting = null;
    this.computerManager.stop();
    this.computerListeners.clear();
    void this.computerBroker?.close();
    this.computerBroker = null;
    this.computerBrokerStarting = null;
  }

  /** Why the tool surface is missing, or `null` when it is mounted. */
  toolsUnavailableReason(): string | null {
    return describeMissingTools(this.launcher, this.options.baseUrl);
  }

  /** A bot row as the renderer sees it: the store's fields plus the counts
   * only the dispatcher knows. */
  private decorate(bot: Bot): Bot {
    return { ...bot, approvalsRemembered: this.dispatcher.approvalsFor(bot.id) };
  }

  /**
   * A shortcut (`Desktop`, `Documents`, `Downloads`) as the permission it
   * stands for. It is a ticket like the picker's: the main process resolved
   * the path with `app.getPath`, and what tapping the row means is READ, for
   * every agent — the same thing the row itself says.
   */
  private shortcutTicket(folderId: string): FolderTicket | null {
    const match = this.accessState().suggestions.find(
      (suggestion) => suggestion.folderId === folderId,
    );
    return match ? { path: match.path, mode: "read", scope: "all" } : null;
  }

  /**
   * The one gate into `read-write`, wherever the request came from.
   *
   * `read` passes silently — it is what the picker's own dialog described, and
   * asking twice for the same thing teaches people to click through sheets. A
   * folder that is ALREADY writable passes too: re-saving a label or a scope
   * must not re-ask a question that was answered. Everything else is a native
   * `dialog.showMessageBox` in the main process, and `false` (or a build with
   * no way to ask) means the grant simply does not change.
   */
  private async consentToWrite(
    path: string,
    mode: AccessMode,
    current?: AccessMode,
  ): Promise<boolean> {
    if (mode !== "read-write" || current === "read-write") return true;
    const already = this.settingsStore
      .get()
      .access.grants.find((grant) => grant.path === path && grant.mode === "read-write");
    if (already) return true;
    const confirm = this.options.confirmWriteAccess;
    if (!confirm) throw new AccessError("this build cannot ask for that permission");
    // A sheet is modal, and both roads to here (`access.grant`,
    // `access.update`) are bridge calls a renderer can make in a loop. Without
    // these two limits it stacks native dialogs the user has to dismiss one by
    // one — and an Allow meant for one folder lands on another. A second
    // question raised while one is open is REFUSED, never queued: by the time a
    // queued one appeared, the reader would be answering about a folder they
    // are no longer looking at.
    if (this.writeSheetOpen) {
      const refusal = "another folder is already waiting for your answer — answer that one first";
      console.warn(`Local BizOS: refused a write question for ${path}: ${refusal}`);
      throw new AccessError(refusal);
    }
    if (!this.takeWriteSheet()) {
      const refusal =
        `that is more than ${WRITE_SHEET_LIMIT} write questions in ` +
        `${WRITE_SHEET_WINDOW_MS / 1000} seconds — try again in a moment`;
      console.warn(`Local BizOS: refused a write question for ${path}: ${refusal}`);
      throw new AccessError(refusal);
    }
    this.writeSheetOpen = true;
    try {
      return (await confirm({ path, display: displayPath(path, this.homeDir) })) === true;
    } finally {
      this.writeSheetOpen = false;
    }
  }

  /** The injected clock, never `Date.now()`: this window has to be crossable
   * from a test that does not sleep. */
  private takeWriteSheet(): boolean {
    const now = this.clock.now().getTime();
    while (this.writeSheetsAsked.length && this.writeSheetsAsked[0]! <= now - WRITE_SHEET_WINDOW_MS) {
      this.writeSheetsAsked.shift();
    }
    if (this.writeSheetsAsked.length >= WRITE_SHEET_LIMIT) return false;
    this.writeSheetsAsked.push(now);
    return true;
  }

  private accessState(): AccessState {
    const access: AccessSettings = this.settingsStore.get().access;
    const policy = this.accessPolicy;
    const offered = this.options.folderSuggestions?.length
      ? this.options.folderSuggestions
      : defaultSuggestions(this.homeDir);
    // A shortcut the rules would refuse is not offered: a row that fails the
    // moment it is tapped is worse than one that was never drawn. This is
    // also what drops `~/Desktop` on a Mac that has none.
    const suggestions: FolderSuggestion[] = [];
    for (const suggestion of offered) {
      try {
        suggestions.push({
          folderId: suggestion.folderId,
          path: canonicalizeSharedPath(suggestion.path, policy),
          label: suggestion.label,
        });
      } catch {
        // Not there, outside the home folder, or never shared.
      }
    }
    return {
      ...access,
      suggestions,
      denied: deniedDirectories(this.homeDir, this.options.deniedDirs ?? []),
      home: this.homeDir,
    };
  }

  /** Say it in the thread of every bot the grant reaches. A permission the
   * user cannot see anywhere except a settings screen is a permission they
   * will forget they gave. */
  private announceAccess(scope: AccessScope, text: string): void {
    for (const bot of this.botStore.list()) {
      // An archived bot has no thread anybody is reading; it hears about the
      // folder in its persona the moment it is brought back.
      if (bot.archived || !(scope === "all" || scope.includes(bot.id))) continue;
      const threadId = threadIdForTarget({ botId: bot.id });
      const message = this.threadStore.append(threadId, { role: "system", blocks: [{ kind: "meta", text }] });
      this.events.publish({ type: "thread.message.created", threadId, message });
    }
  }

  // ── bridge surface ────────────────────────────────────────────────────

  readonly runtime = {
    getSettings: async (): Promise<RuntimeSettings> => this.settingsStore.get(),
    /**
     * Who answers the next turns. `auto` lets the router pick the best
     * connected plan (any family unless one is preferred); `plan` pins one;
     * `provider` hands every turn to an external endpoint through codex.
     */
    setInference: async (input: {
      source: "auto" | "plan" | "provider";
      planId?: string;
      providerId?: string;
      provider?: PlanProvider;
    }): Promise<RuntimeSettings> => {
      // A choice made here beats the plan a thread was started under: the
      // sticky pins go, and the next turn resumes nothing it should not.
      this.planRegistry.clearAllPins();
      // The model belongs to a family; a new family starts from its own default.
      const before = this.settingsStore.get().local.provider;
      const defaults: Record<PlanProvider, string> = {
        codex: STATIC_CODEX_MODELS.default,
        claude: STATIC_CLAUDE_MODELS.default,
        cursor: STATIC_CURSOR_MODELS.default,
      };
      const modelFor = (family: PlanProvider | undefined): { model?: string } =>
        family && family !== before ? { model: defaults[family] } : {};
      if (input.source === "auto") {
        this.planRegistry.setActive(null);
        this.settingsStore.set({
          local: { activePlanId: null, inferenceProviderId: null, provider: input.provider, ...modelFor(input.provider) },
        });
      } else if (input.source === "plan") {
        if (!input.planId) throw new SettingsError("planId is required");
        const plan = this.planRegistry.setActive(input.planId);
        if (!plan) throw new SettingsError("unknown plan");
        this.settingsStore.set({
          local: { activePlanId: plan.id, provider: plan.provider, inferenceProviderId: null, ...modelFor(plan.provider) },
        });
      } else {
        if (!input.providerId || !this.inferenceStore.get(input.providerId)) throw new SettingsError("unknown provider");
        this.settingsStore.set({ local: { inferenceProviderId: input.providerId } });
      }
      this.catalog = null;
      return this.settingsStore.get();
    },
    /**
     * The ONE permission switch, for every agent at once.
     *
     * `skip-all` is the dangerous mode the Settings screen warns about: Claude
     * runs with `--dangerously-skip-permissions`, codex with
     * `approvalPolicy: "never"` and a `dangerFullAccess` sandbox, and any
     * request that still reaches the harness is auto-accepted. It is global
     * ON PURPOSE — a per-bot version would be a promise the CLIs cannot keep.
     */
    setPermissions: async (input: { permissions: PermissionPolicy }): Promise<RuntimeSettings> => {
      if (!PERMISSION_POLICIES.includes(input?.permissions)) {
        throw new SettingsError('permissions must be "ask" or "skip-all"');
      }
      return this.settingsStore.set({ local: { permissions: input.permissions } });
    },
    /**
     * The patch names a codex binary by opaque `codexId`, never by path: the
     * MAIN process turns that id back into a canonical path. A `codexPath` in a
     * patch is refused at the IPC edge — a renderer that can name a program is
     * a renderer that can run one.
     */
    setSettings: async (patch: unknown): Promise<RuntimeSettings> => {
      const local = (patch as { local?: Record<string, unknown> } | null)?.local;
      let resolved: Record<string, unknown> | undefined = local;
      if (local && "codexId" in local) {
        const { codexId, ...rest } = local;
        const chosen =
          codexId === null || codexId === undefined || codexId === ""
            ? undefined
            : (codexPathForId(String(codexId), this.environment()) ?? undefined);
        if (codexId && !chosen) {
          throw new SettingsError("that is not one of the codex installations this Mac has");
        }
        if (chosen) {
          // The IDENTITY check, here because it costs a spawn: whatever is
          // about to become `codexPath` must answer `codex-cli` to `--version`.
          const status = await probeCodexStatus(chosen, this.environment(), undefined, {
            packaged: this.options.packaged,
          });
          if (!status.found) throw new SettingsError(status.error ?? `${chosen} is not the codex CLI`);
        }
        resolved = { ...rest, codexPath: chosen ?? "" };
      }
      const next = this.settingsStore.set(
        resolved === local ? patch : { ...(patch as Record<string, unknown>), local: resolved },
      );
      this.catalog = null;
      this.options.onSettingsChanged?.(next);
      if (next.mode === "local") await this.refreshSessionCookie();
      return next;
    },
    /** What a TURN would do, not what some other codex would answer: the saved
     * path is re-validated first, so "Test connection" names the real reason
     * when a binary moved or a link was repointed under it. */
    codexStatus: async (): Promise<CodexStatus> => {
      const configured = this.settingsStore.get().local.codexPath;
      try {
        requireCodexPath(configured, this.environment(), { packaged: this.options.packaged });
      } catch (error) {
        return {
          found: false,
          path: configured ?? "codex",
          error: error instanceof Error ? error.message : "codex could not be resolved",
        };
      }
      return probeCodexStatus(configured, this.environment(), undefined, {
        packaged: this.options.packaged,
      });
    },
    /** The codex installations this Mac has. The renderer picks FROM this
     * list; it never names a path of its own, because a named path is a
     * program this app would run outside any sandbox.
     *
     * The shape is the bridge contract's `CodexCandidate[]`, verbatim. It used
     * to answer `{candidates, active}`, which the renderer's `Array.isArray`
     * guard dropped without a word: the "Codex binary" picker offered nothing
     * but "Auto", on a Mac that had codex installed (F9 proof, 2026-09-02).
     * WHICH binary is in use is `codexStatus().path`, on the same card, so it
     * is not repeated here. */
    codexCandidates: async (): Promise<CodexCandidate[]> => codexCandidates(this.environment()),
    /** Asked ON DEMAND, with a 10-minute cache. It used to be probed inside
     * every `codexStatus()` call, which spawned a second `codex app-server`
     * each time the Runtime card was opened. */
    models: async (): Promise<ModelsResponse> => {
      const settings = this.settingsStore.get();
      const provider: PlanProvider =
        this.planRegistry.getActive()?.provider ?? settings.local.provider ?? "codex";
      return this.modelsFor(provider);
    },
    /** Every family at once, for a chooser that lets a bot pick its plan. */
    modelCatalogs: async (): Promise<Record<PlanProvider, ModelsResponse>> => ({
      codex: await this.modelsFor("codex"),
      claude: await this.modelsFor("claude"),
      cursor: await this.modelsFor("cursor"),
    }),
    toolsStatus: async (): Promise<ToolsStatus> => describeToolsStatus(this.launcher, this.options.baseUrl),
  };

  private async modelsFor(provider: PlanProvider): Promise<ModelsResponse> {
    const settings = this.settingsStore.get();
    {
      if (provider === "claude") {
        const now = this.clock.now().getTime();
        const configDir = this.claudePlanConfigDir();
        const key = configDir ?? "";
        if (!this.claudeCatalog || this.claudeCatalog.key !== key || now - this.claudeCatalog.at > MODEL_CACHE_MS) {
          this.claudeCatalog = {
            at: now,
            key,
            value: await resolveClaudeModelCatalog({
              ...(configDir ? { configDir } : {}),
              homeDir: this.homeDir,
              environment: this.environment(),
            }),
          };
        }
        const catalog = this.claudeCatalog.value;
        return {
          models: catalog.options.map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.id === catalog.default ? { isDefault: true } : {}),
          })),
          source: catalog.source,
          provider: "claude",
        };
      }
      if (provider === "cursor") {
        const now = this.clock.now().getTime();
        if (!this.cursorCatalog || now - this.cursorCatalog.at > MODEL_CACHE_MS) {
          const cli = resolveCursorPath(undefined, this.environment(), { packaged: this.options.packaged });
          this.cursorCatalog = {
            at: now,
            value: await resolveCursorModelCatalog({ cli, environment: this.environment() }),
          };
        }
        const catalog = this.cursorCatalog.value;
        return {
          models: catalog.options.map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.id === catalog.default ? { isDefault: true } : {}),
          })),
          source: catalog.source,
          provider: "cursor",
        };
      }
      const now = this.clock.now().getTime();
      if (!this.catalog || now - this.catalog.at > MODEL_CACHE_MS) {
        const status = await probeCodexStatus(
          settings.local.codexPath,
          this.environment(),
          undefined,
          { packaged: this.options.packaged },
        );
        const value =
          status.found && status.path
            ? await resolveModelCatalog(status.path, this.environment())
            : STATIC_CODEX_MODELS;
        this.catalog = { at: now, value };
      }
      const catalog = this.catalog.value;
      return {
        models: catalog.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.id === catalog.default ? { isDefault: true } : {}),
        })),
        source: catalog.source,
        provider: "codex",
      };
    }
  }

  /** Whose Claude account answers for the catalogue and the usage bars: the
   * plan the user made active, else the first signed-in one, else the CLI's
   * own `~/.claude`. */
  private claudePlanConfigDir(): string | undefined {
    const activeId = this.settingsStore.get().local.activePlanId ?? this.planRegistry.routing().activePlanId ?? null;
    const active = activeId ? this.planRegistry.get(activeId) : undefined;
    if (active?.provider === "claude" && active.configDir) return active.configDir;
    return this.planRegistry
      .list()
      .find((plan) => plan.provider === "claude" && plan.status === "connected" && plan.configDir)?.configDir;
  }

  /** Apps tab (local mode): the MCP servers the user adds to this workspace. */
  readonly apps = {
    catalog: async () => ({
      catalog: LOCAL_APP_CATALOG,
      launchers: launcherAvailability(this.environment()),
    }),
    list: async (): Promise<PublicLocalApp[]> => this.appsStore.publicList(),
    install: async (catalogId: string, values: Record<string, string>, details: LocalAppDetails = {}): Promise<PublicLocalApp> =>
      publicApp(this.appsStore.install(catalogId, values, details)),
    addCustom: async (input: CustomLocalAppInput): Promise<PublicLocalApp> =>
      publicApp(this.appsStore.addCustom(input)),
    update: async (id: string, patch: LocalAppPatch): Promise<PublicLocalApp> =>
      publicApp(this.appsStore.update(id, patch)),
    remove: async (id: string): Promise<{ removed: boolean }> => ({ removed: this.appsStore.remove(id) }),
    /** Start the server (or call the remote one), complete the MCP handshake
     * and list its tools — the same thing the agent's next turn will do. */
    test: async (id: string): Promise<ProbeResult & { app: PublicLocalApp }> => {
      const app = this.appsStore.get(id);
      if (!app) throw new LocalAppError("that app is not added");
      let result: ProbeResult;
      if (app.authMode === "cli") {
        result = {
          ok: false,
          tools: [],
          error: "This app is signed in through the agent's CLI, which loads it on its own. Ask the agent what tools it has.",
        };
      } else {
        const sharedDirs = this.settingsStore.get().access.grants.map((grant) => grant.path);
        const spec = mountApp({ ...app, enabled: true }, { sharedDirs, environment: this.environment() });
        if (!spec) {
          result = {
            ok: false,
            tools: [],
            error: app.transport === "stdio"
              ? `${app.command ?? "the launcher"} was not found on this Mac`
              : "the app has no address",
          };
        } else if (isHttpMcpServer(spec)) {
          result = await probeHttpServer(spec);
        } else {
          result = await probeStdioServer(spec, { environment: this.environment() });
        }
      }
      const recorded = this.appsStore.recordTest(id, result);
      return { ...result, app: publicApp(recorded) };
    },
    /** Register a remote app with the active plan's CLI and open its OAuth
     * sign-in in a Terminal window. From then on the CLI owns the server. */
    login: async (id: string): Promise<{ started: boolean; provider: PlanProvider; serverName: string; app: PublicLocalApp }> => {
      const app = this.appsStore.get(id);
      if (!app) throw new LocalAppError("that app is not added");
      if (app.transport !== "http" || !app.url) throw new LocalAppError("only a remote app can sign in");
      const settings = this.settingsStore.get();
      const plan = settings.local.activePlanId ? this.planRegistry.get(settings.local.activePlanId) : undefined;
      const provider: PlanProvider = plan?.provider ?? settings.local.provider ?? "codex";
      if (provider === "cursor") {
        // The Cursor CLI would register the server in the person's OWN global
        // Cursor configuration, for every project they open — not in a home
        // this app owns. Until there is a scope this app can undo, it refuses
        // rather than writing there behind their back.
        throw new LocalAppError("signing an app in through the Cursor CLI is not supported yet — use a ChatGPT or Claude Code plan for this app");
      }
      const home = (provider === "codex" ? plan?.codexHome : plan?.configDir)
        ?? join(this.homeDir, provider === "codex" ? ".codex" : ".claude");
      const { started } = openCliLogin({
        shellCommand: loginCommandFor({ provider, home, serverName: app.serverName, url: app.url }),
      });
      const updated = started ? this.appsStore.markCliManaged(id) : app;
      return { started, provider, serverName: app.serverName, app: publicApp(updated) };
    },
  };

  /** Settings → Plans & usage: external API-key providers (OpenRouter, Ollama, any OpenAI-compatible API). */
  readonly inference = {
    list: async (): Promise<{ providers: PublicInferenceProvider[]; presets: typeof INFERENCE_PRESETS }> => ({
      providers: this.inferenceStore.publicList(),
      presets: INFERENCE_PRESETS,
    }),
    add: async (input: InferenceProviderInput): Promise<PublicInferenceProvider> =>
      toPublicProvider(this.inferenceStore.add(input)),
    update: async (id: string, patch: InferenceProviderPatch): Promise<PublicInferenceProvider> =>
      toPublicProvider(this.inferenceStore.update(id, patch)),
    remove: async (id: string): Promise<{ removed: boolean }> => {
      const removed = this.inferenceStore.remove(id);
      if (removed && this.settingsStore.get().local.inferenceProviderId === id) {
        this.settingsStore.set({ local: { inferenceProviderId: null } });
      }
      return { removed };
    },
    /** Lists the endpoint's models with the stored key — what a turn will be able to use. */
    test: async (id: string): Promise<InferenceProbe & { provider: PublicInferenceProvider }> => {
      const provider = this.inferenceStore.get(id);
      if (!provider) throw new InferenceError("that provider is not added");
      const result = await probeInferenceProvider(provider);
      return { ...result, provider: toPublicProvider(this.inferenceStore.recordTest(id, result)) };
    },
  };

  /** The second brain's own folder: the Company OS by default, the agents'
   * working folder, and what Apps → Second brain opens first. */
  private brainDir(): string {
    return join(this.storage.layout.root, "brain");
  }

  /** A folder a bot may work in: absolute, and a directory on this Mac now. */
  private requireFolder(folder: string): void {
    if (!isAbsolute(folder)) throw new SettingsError("the folder must be an absolute path");
    let stat: ReturnType<typeof statSync> | null = null;
    try {
      stat = statSync(folder);
    } catch {
      stat = null;
    }
    if (!stat?.isDirectory()) throw new SettingsError("that folder does not exist on this Mac");
  }

  /** `<stateRoot>/vaults/` — one managed vault per template created from the catalogue. */
  private vaultsDir(): string {
    return join(this.storage.layout.root, VAULTS_DIRECTORY);
  }

  /** The binding, read strictly; a damaged file is the sentence the caller shows. */
  private bindingOf(): WorkspaceBinding | null {
    return readWorkspaceBinding(this.storage);
  }

  /** The binding, or `null` when it cannot be read — for the paths that
   * must not fail on it (deleting an agent, listing folders to trash into). */
  private bindingOrNull(): WorkspaceBinding | null {
    try {
      return this.bindingOf();
    } catch (error) {
      console.warn(`Local BizOS: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** A managed binding is one whose vault this app made: `vault:<templateId>`. */
  private static managedBinding(binding: WorkspaceBinding): boolean {
    return binding.rootId === vaultRootId(binding.templateId);
  }

  /** Every vault this app made agent folders in: the brain, each managed
   * vault whose folder is really there — the vault of an application still
   * in progress included when `pending` asks for it — the vault of an older
   * agency installation, and the bound vault. A damaged registry hides the
   * managed ones and says so; it never hides the brain. */
  private managedVaults(options: { pending?: boolean } = {}): BrainRoot[] {
    const brain: BrainRoot = { id: "brain", label: "Second brain", path: this.brainDir(), writable: true };
    const binding = this.bindingOrNull();
    const bound: BrainRoot[] = binding && !LocalBizosHarness.managedBinding(binding)
      ? [{ id: binding.rootId, label: binding.label, path: binding.path, writable: true }]
      : [];
    const legacyAgency = legacyAgencyVaultPath(this.storage.layout.root);
    const agency: BrainRoot[] = lstatOrNullQuiet(legacyAgency)?.isDirectory() && !bound.some((root) => root.path === legacyAgency)
      ? [{ id: "agency", label: "Agency", path: legacyAgency, writable: true }]
      : [];
    try {
      return [brain, ...managedVaultRoots(this.storage, readTemplateRegistry(this.storage, binding), undefined, options), ...agency, ...bound];
    } catch (error) {
      console.warn(`Local BizOS: ${error instanceof Error ? error.message : String(error)}`);
      return [brain, ...agency, ...bound];
    }
  }

  /** The roots an UNBOUND workspace offers: the brain when it exists, the
   * agents' workspaces, the managed vaults, an older agency vault, and every
   * shared folder — the legacy list, minus a brain that was never made. */
  private unboundRoots(): BrainRoot[] {
    const [brain, ...rest] = this.managedVaults();
    return [
      ...(lstatOrNullQuiet(brain!.path)?.isDirectory() ? [brain!] : []),
      { id: "workspaces", label: "Agent workspaces", path: this.storage.layout.workspacesDir, writable: true },
      ...rest,
      ...this.settingsStore.get().access.grants.map((grant) => ({
        id: grant.id,
        label: grant.label,
        path: grant.path,
        writable: grant.mode === "read-write",
      })),
    ];
  }

  /** The vaults a template may be bound to: every writable root that is a
   * real folder right now — never the agents' workspaces, never a link. */
  private candidateVaults(): BrainRoot[] {
    return this.unboundRoots().filter((root) => {
      if (root.id === "workspaces" || root.writable === false) return false;
      const stats = lstatOrNullQuiet(root.path);
      return Boolean(stats?.isDirectory()) && !stats!.isSymbolicLink();
    });
  }

  /** The installation behind a catalogue id: the registry's, else the legacy
   * `template.json` for the Company OS when that one is complete. */
  private installationOf(registry: TemplateRegistry, id: TemplateId): TemplateInstallation | null {
    const listed = registry.installations[id];
    if (listed) return listed;
    if (id === COMPANY_OS.id) return legacyCompanyOsInstallation(this.storage, this.brainDir(), this.botStore.list());
    return null;
  }

  /** Read, change, write — with no `await` in between, so two templates
   * applied at once cannot each write back a registry missing the other. */
  private updateRegistry(mutate: (registry: TemplateRegistry) => void): TemplateRegistry {
    const registry = readTemplateRegistry(this.storage);
    mutate(registry);
    writeTemplateRegistry(this.storage, registry);
    return registry;
  }

  private applyResultOf(installation: TemplateInstallation, created: boolean): TemplateApplyResult {
    const bots = Object.fromEntries(
      Object.entries(installation.bots).filter(([, botId]) => this.botStore.get(botId) !== undefined),
    );
    return {
      id: installation.id,
      rootId: installation.rootId,
      created,
      vault: installation.vault,
      bots,
      ...(installation.groupId ? { groupId: installation.groupId } : {}),
    };
  }

  /** The pack's tool instructions, appended to a template agent's own so it
   * knows exactly the tools the runtime grants it — nothing for the Company OS. */
  private static instructionsFor(id: TemplateId, row: TemplateBot): string {
    const tools = id === "lead-gen-agency" ? AGENCY_TOOLS_INSTRUCTIONS : id === "ecommerce" ? COMMERCE_TOOLS_INSTRUCTIONS : null;
    return tools ? `${row.instructions.trim()}\n\n${tools}`.slice(0, 6000) : row.instructions;
  }

  /** The older agency installation's journal (`agency/install.json`), when
   * the person bound that vault: its bots by slug and its team, to adopt. */
  private legacyAgencyJournal(): { bots: Record<string, string>; groupId?: string } | null {
    const raw = this.storage.readJson<unknown>(join(LEGACY_AGENCY_DIRECTORY, "install.json"), null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const bots = record.bots && typeof record.bots === "object" && !Array.isArray(record.bots)
      ? Object.fromEntries(Object.entries(record.bots as Record<string, unknown>).filter(([, id]) => typeof id === "string" && id)) as Record<string, string>
      : {};
    return { bots, ...(typeof record.groupId === "string" && record.groupId ? { groupId: record.groupId } : {}) };
  }

  /**
   * In an EXISTING vault, the bot a template row already has: the older
   * agency installation's, by its journal; else the roster bot whose working
   * folder IS this row's role folder in that vault. Adopted, never remade —
   * and never claimed twice within one application.
   */
  private adoptableBot(target: InstallTarget, row: TemplateBot, claimed: Set<string>): Bot | undefined {
    const roster = this.botStore.list().filter((bot) => !bot.archived && !claimed.has(bot.id));
    if (target.rootId === "agency") {
      const legacyId = this.legacyAgencyJournal()?.bots[row.slug];
      const legacy = legacyId ? roster.find((bot) => bot.id === legacyId) : undefined;
      if (legacy) return legacy;
    }
    const folder = join(target.path, AGENTS_DIRECTORY, agentFolderName(row.name));
    return roster.find((bot) => bot.workspacePath === folder);
  }

  /**
   * Apply a catalogue template into its vault and put its agents in the
   * roster — resumably. The vault is a MANAGED one this app makes
   * (`vaults/<id>/`, seeded whole into a staging folder and renamed into
   * place) or an EXISTING one the person chose (its missing notes written,
   * nothing there rewritten). The order is the module comment of
   * `templates.ts`: validate the pack, refuse anything already at a managed
   * vault's path that no journal accounts for, then for every effect write
   * its identity to the journal FIRST (the staging folder, each agent's id,
   * each welcome's message id, the team's id), do it, mark it done. A second
   * attempt after a crash — even one between an effect and its mark — finds
   * what exists by the id it wrote down, finishes the rest, and creates
   * nothing twice. In an existing vault, an agent that already works from
   * its role folder is adopted rather than made again.
   */
  private async applyTemplate(id: TemplateId, target: InstallTarget): Promise<TemplateApplyResult> {
    const template = templateOf(id);
    validateTemplate(template);
    const registry = readTemplateRegistry(this.storage);
    const existing = this.installationOf(registry, id);
    if (existing) {
      if (existing.rootId !== target.rootId || LocalBizosHarness.comparableVaultPath(installationVaultDir(this.storage, existing)) !== LocalBizosHarness.comparableVaultPath(target.path)) {
        throw new BrainError(`This template is already installed in ${existing.rootId}. Choose its existing vault to adopt it.`, "exists");
      }
      // "Open" comes through here too: an installation whose vault is gone
      // or replaced answers a sentence, never another folder.
      const status = installationStatus(this.storage, existing);
      if (status !== "ready") throw describeUnavailable(template, existing, status);
      completeTemplateVault(target.path, template);
      return this.applyResultOf(existing, false);
    }

    const vaultDir = target.path;
    const vaultName = target.managed ? vaultPathOf(id) : target.label;
    const journal = (patch: Partial<PendingInstallation>): PendingInstallation => {
      const updated = this.updateRegistry((current) => {
        const row: PendingInstallation = current.pending[id] ?? {
          id,
          version: template.version,
          startedAt: this.clock.nowIso(),
          bots: {},
          welcomes: {},
        };
        current.pending[id] = { ...row, ...patch };
      });
      return updated.pending[id]!;
    };
    let pending: PendingInstallation | undefined = registry.pending[id];
    let vault: VaultSeed;
    if (target.managed) {
      const vaults = this.vaultsDir();
      refuseSymlink(vaults, `${VAULTS_DIRECTORY}/`);
      refuseSymlink(vaultDir, vaultPathOf(id));
      const vaultStats = lstatOrNull(vaultDir, vaultPathOf(id));
      if (vaultStats && !vaultStats.isDirectory()) {
        throw new BrainError(`${vaultPathOf(id)} exists and is not a folder`, "exists");
      }
      if (vaultStats && !pending?.vault) {
        // A folder is there and the journal never marked it ours. Only one
        // story allows it: this application had started seeding a staging
        // folder, renamed it into place, and crashed before the mark — and
        // then the folder holds the pack, every note and folder of it. Any
        // other folder is somebody's, whatever it holds.
        if (!pending?.staging || !holdsTemplate(vaultDir, template)) {
          throw new BrainError(
            `a folder is already at ${vaultPathOf(id)} and this app did not make it — move it away first`,
            "exists",
          );
        }
        pending = journal({ vault: "seeded", staging: undefined });
      }
      // The journal exists BEFORE the first effect: from here on, a folder at
      // `vaults/<id>` is accounted for.
      if (!pending) pending = journal({});

      if (!vaultStats) {
        mkdirSync(vaults, { recursive: true, mode: DIRECTORY_MODE });
        // A staging folder a previous attempt left half-written is not
        // resumed: it is removed and seeding starts over, whole.
        if (pending.staging) rmSync(join(vaults, pending.staging), { recursive: true, force: true });
        const staging = `.${id}.staging-${process.pid}-${randomBytes(4).toString("hex")}`;
        pending = journal({ staging, vault: undefined });
        const stagingDir = join(vaults, staging);
        try {
          seedTemplateVault(stagingDir, template);
          refuseSymlink(vaultDir, vaultPathOf(id));
          renameSync(stagingDir, vaultDir);
        } catch (error) {
          rmSync(stagingDir, { recursive: true, force: true });
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST" || code === "ENOTEMPTY") {
            throw new BrainError(`a folder appeared at ${vaultPathOf(id)} while it was being created`, "exists");
          }
          throw error;
        }
        pending = journal({ vault: "seeded", staging: undefined });
      }
      vault = "seeded";
    } else {
      // The person's vault: it must be a real folder now, and it is never
      // rewritten — only what the pack has and the folder lacks is written.
      refuseSymlink(vaultDir, vaultName);
      const vaultStats = lstatOrNull(vaultDir, vaultName);
      if (!vaultStats?.isDirectory()) throw new BrainError(`${vaultName} is not a folder on this Mac`, "not_found");
      if (!pending) pending = journal({});
      if (!pending.vault) pending = journal({ vault: completeTemplateVault(vaultDir, template) });
      vault = pending.vault === "seeded" ? "seeded" : "kept";
    }

    // The agents, one at a time. Each id is journaled before the agent is
    // created with THAT id, so a crash after the roster persisted it and
    // before the mark still leaves one agent, found by id on the retry. An
    // agent the journal names that the person deleted (`bots.remove` marks
    // it) is left alone: a retry is not a reason to bring it back.
    const bots: Record<string, string> = {};
    const claimed = new Set<string>();
    const agents = join(vaultDir, AGENTS_DIRECTORY);
    refuseSymlink(agents, `${vaultName}/${AGENTS_DIRECTORY}`);
    for (const row of template.bots) {
      let planned = pending.bots[row.slug];
      if (planned?.removed) continue;
      if (!planned) {
        const adopted = target.managed ? undefined : this.adoptableBot(target, row, claimed);
        planned = adopted ? { id: adopted.id, created: true } : { id: newId("bot"), created: false };
        pending = journal({
          bots: { ...pending.bots, [row.slug]: planned },
          // An adopted agent has been greeting the person already, in its own
          // words: no welcome is added to its chat.
          ...(adopted ? { welcomes: { ...pending.welcomes, [row.slug]: { id: "adopted", posted: true } } } : {}),
        });
      }
      let bot = this.botStore.get(planned.id);
      if (!bot) {
        if (planned.created) continue; // created, then deleted by the person before `bots.remove` could mark it
        const folderName = agentFolderName(row.name);
        const seededFolder = join(agents, folderName);
        refuseSymlink(seededFolder, `${vaultName}/${AGENTS_DIRECTORY}/${folderName}`);
        const workspacePath = existsSync(seededFolder)
          ? seededFolder
          : ensureAgentFolder(vaultDir, { name: row.name, title: row.title, description: row.description }).path;
        bot = await this.spawnBot(
          {
            name: row.name,
            title: row.title,
            description: row.description,
            instructions: LocalBizosHarness.instructionsFor(id, row),
            ...(row.thinking ? { thinking: row.thinking } : {}),
            workspacePath,
          },
          planned.id,
        );
      }
      claimed.add(bot.id);
      if (!planned.created) {
        // The rest of the agent's state, then the mark. Re-done on a retry
        // that found the agent already persisted; setting a pin twice is
        // the same pin.
        if (row.pinned) this.botStore.update(bot.id, { pinned: true });
        pending = journal({ bots: { ...pending.bots, [row.slug]: { ...planned, created: true } } });
      }
      bots[row.slug] = bot.id;
    }
    for (const row of template.bots) {
      const botId = bots[row.slug];
      if (!botId || !row.welcome) continue;
      let welcome = pending.welcomes[row.slug];
      if (welcome?.posted) continue;
      if (!welcome) {
        welcome = { id: newMessageId(), posted: false };
        pending = journal({ welcomes: { ...pending.welcomes, [row.slug]: welcome } });
      }
      // The bot's first words, on the record before the person opens the
      // chat — an immutable public message, no run behind it. Appended under
      // the journaled id, and only when that id is not in the thread yet.
      const threadId = threadIdForTarget({ botId });
      let message = this.threadStore.get(threadId, welcome.id);
      if (!message) {
        message = this.threadStore.append(threadId, {
          id: welcome.id,
          role: "bot",
          deliveryState: "complete",
          botId,
          blocks: [{ kind: "text", text: row.welcome }],
        });
      }
      this.botStore.update(botId, { unread: true });
      this.botStore.setStatus(botId, "idle", row.welcome);
      pending = journal({ welcomes: { ...pending.welcomes, [row.slug]: { ...welcome, posted: true } } });
      this.events.publish({ type: "thread.message.created", threadId, message });
    }

    // The team, when the pack has one: the same journal-first id. A team the
    // person deleted is not remade. In an older agency vault, the team that
    // installation made is adopted, whether or not this pack asks for one.
    let groupId: string | undefined;
    const memberIds = template.bots.map((row) => bots[row.slug]).filter((botId): botId is string => Boolean(botId));
    const legacyGroup = target.rootId === "agency" ? this.legacyAgencyJournal()?.groupId : undefined;
    const adoptedGroup = legacyGroup ? this.groupStore.get(legacyGroup) : undefined;
    if (adoptedGroup && !adoptedGroup.archived) {
      if (!pending.group) pending = journal({ group: { id: adoptedGroup.id, created: true } });
      groupId = pending.group?.id;
    } else if (template.team && memberIds.length > 1) {
      let planned = pending.group;
      if (!planned) {
        planned = { id: newId("grp"), created: false };
        pending = journal({ group: planned });
      }
      let group = this.groupStore.get(planned.id);
      if (!group && !planned.created) {
        group = this.groupStore.create({ name: template.team.name, memberIds }, planned.id);
        this.events.publish({ type: "group.created", group });
      }
      if (!planned.created) pending = journal({ group: { ...planned, created: true } });
      groupId = group?.id;
    }
    // A template's routines are NOT created: nothing scheduled comes from a
    // catalogue row.

    const installation: TemplateInstallation = {
      id,
      version: template.version,
      rootId: target.rootId,
      vaultPath: target.managed ? vaultPathOf(id) : target.path,
      appliedAt: this.clock.nowIso(),
      vault,
      bots,
      ...(groupId ? { groupId } : {}),
      routineIds: [],
    };
    this.updateRegistry((current) => {
      current.installations[id] = installation;
      delete current.pending[id];
    });
    return this.applyResultOf(installation, true);
  }

  /** The install target a binding names. */
  private targetOf(binding: WorkspaceBinding): InstallTarget {
    return {
      rootId: binding.rootId,
      path: binding.path,
      managed: LocalBizosHarness.managedBinding(binding),
      label: binding.label,
    };
  }

  /**
   * Resolves what `bind` was asked for, BEFORE anything is written: `new`
   * (or the managed root's own id) is `vaults/<templateId>` — refused when a
   * folder this app did not make is already there; anything else must be
   * one of the writable vaults this workspace offers, by id, resolved here
   * to a real folder — never a path a caller sent.
   */
  private static comparableVaultPath(path: string): string {
    try { return realpathSync(path); } catch { return path; }
  }

  private resolveTarget(templateId: TemplateId, rootId: string): InstallTarget {
    const template = templateOf(templateId);
    if (rootId === "new" || rootId === vaultRootId(templateId)) {
      const vaults = this.vaultsDir();
      refuseSymlink(vaults, `${VAULTS_DIRECTORY}/`);
      const vaultDir = join(vaults, templateId);
      refuseSymlink(vaultDir, vaultPathOf(templateId));
      const registry = readTemplateRegistry(this.storage);
      const stats = lstatOrNull(vaultDir, vaultPathOf(templateId));
      if (stats && !registry.installations[templateId] && !registry.pending[templateId]?.vault
        && !(registry.pending[templateId]?.staging && stats.isDirectory() && holdsTemplate(vaultDir, template))) {
        throw new BrainError(`a folder is already at ${vaultPathOf(templateId)} and this app did not make it — move it away first`, "exists");
      }
      return { rootId: vaultRootId(templateId), path: vaultDir, managed: true, label: template.name };
    }
    if (rootId.startsWith("vault:")) {
      throw new BrainError("a managed vault belongs to its own template; choose 'new' for a new managed vault", "not_found");
    }
    const root = this.candidateVaults().find((candidate) => candidate.id === rootId);
    if (!root) throw new BrainError("that folder is not a vault this workspace can be bound to", "not_found");
    let path: string;
    try {
      path = realpathSync(root.path);
    } catch {
      throw new BrainError(`${root.label} is not a folder this Mac can read`, "not_found");
    }
    return { rootId: root.id, path, managed: false, label: root.label };
  }

  /** Bind and apply, one at a time: two binds at once cannot both win, and
   * a second apply of the same template joins the first. */
  private bindChain: Promise<unknown> = Promise.resolve();

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.bindChain.then(work, work);
    this.bindChain = next.catch(() => undefined);
    return next;
  }

  /** Bind (or confirm the binding) and install (or resume) — the one door. */
  private async bindAndApply(templateId: TemplateId, rootId: string): Promise<TemplateApplyResult> {
    return this.serialized(async () => {
      let binding = this.bindingOf();
      if (binding) {
        if (!LocalBizosHarness.sameBinding(binding, templateId, rootId)) throw bindingConflict(binding, templateId, rootId);
      } else {
        const target = this.resolveTarget(templateId, rootId);
        const installed = this.installationOf(readTemplateRegistry(this.storage), templateId);
        if (installed && (installed.rootId !== target.rootId || LocalBizosHarness.comparableVaultPath(installationVaultDir(this.storage, installed)) !== LocalBizosHarness.comparableVaultPath(target.path))) {
          throw new BrainError(`This template is already installed in ${installed.rootId}. Choose its existing vault to adopt it.`, "exists");
        }
        const fresh: WorkspaceBinding = {
          version: 1,
          templateId,
          rootId: target.rootId,
          label: target.label,
          path: target.path,
          boundAt: this.clock.nowIso(),
        };
        // Persisted BEFORE the first effect; exclusively, so a binding
        // another process wrote a moment ago is read back and compared.
        if (!writeWorkspaceBinding(this.storage, fresh)) {
          binding = this.bindingOf();
          if (!binding || !LocalBizosHarness.sameBinding(binding, templateId, rootId)) {
            throw binding ? bindingConflict(binding, templateId, rootId) : new BrainError("the binding could not be written", "exists");
          }
        } else {
          binding = fresh;
        }
      }
      return this.applyTemplate(binding.templateId, this.targetOf(binding));
    });
  }

  /** The same request as the binding: its template, and its root (or `new`
   * when the binding is the managed vault `new` would make). */
  private static sameBinding(binding: WorkspaceBinding, templateId: string, rootId: string | undefined): boolean {
    if (binding.templateId !== templateId) return false;
    if (rootId === undefined || rootId === binding.rootId) return true;
    return rootId === "new" && LocalBizosHarness.managedBinding(binding);
  }

  /**
   * The workspace's template and vault — chosen once, then pinned.
   *
   * `get` lists the catalogue, the vaults a template could be bound to, and
   * the binding when there is one. `bind` writes the binding (before any
   * effect, exclusively), installs the template into that vault — a managed
   * vault made whole, or an existing vault completed with the pack's missing
   * notes and its agents adopted where they already work — and answers the
   * same projection. The same request again is idempotent; any other
   * template or root is refused (409). Nothing here unbinds: that is the
   * person's deliberate act on `workspace-binding.json`.
   */
  readonly workspaceTemplate = {
    current: (): WorkspaceBinding | null => this.bindingOf(),
    get: async (): Promise<WorkspaceTemplateProjection> => {
      const binding = this.bindingOf();
      return {
        binding: binding ? { templateId: binding.templateId, rootId: binding.rootId, label: binding.label, path: binding.path } : null,
        templates: TEMPLATE_IDS.map((id) => {
          const template = templateOf(id);
          return { id, name: template.name, description: template.description ?? "" };
        }),
        vaults: binding
          ? [{ rootId: binding.rootId, label: binding.label, path: binding.path, writable: true }]
          : this.candidateVaults().map((root) => ({ rootId: root.id, label: root.label, path: root.path, writable: true })),
        canBind: binding === null,
      };
    },
    bind: async (input: { templateId: string; rootId: string }): Promise<WorkspaceTemplateProjection> => {
      if (!isTemplateId(input.templateId)) throw new BrainError("that template is not in the catalogue", "not_found");
      if (typeof input.rootId !== "string" || !input.rootId.trim()) throw new BrainError("rootId is required: 'new' or a vault id");
      await this.bindAndApply(input.templateId, input.rootId.trim());
      return this.workspaceTemplate.get();
    },
    /** For the packs: what the registry holds for a template. */
    installation: (id: TemplateId): PackInstallation => {
      const registry = readTemplateRegistry(this.storage);
      const installation = this.installationOf(registry, id);
      if (installation) {
        return {
          status: "ready",
          bots: Object.fromEntries(Object.entries(installation.bots).filter(([, botId]) => this.botStore.get(botId) !== undefined)),
          groupId: installation.groupId ?? null,
          rootId: installation.rootId,
          vaultPath: installationVaultDir(this.storage, installation),
        };
      }
      const pending = registry.pending[id];
      const binding = this.bindingOf();
      return {
        status: pending ? "installing" : "none",
        bots: pending ? Object.fromEntries(Object.entries(pending.bots).filter(([, row]) => row.created && !row.removed && this.botStore.get(row.id)).map(([slug, row]) => [slug, row.id])) : {},
        groupId: pending?.group?.created ? pending.group.id : null,
        rootId: binding?.templateId === id ? binding.rootId : "",
        vaultPath: binding?.templateId === id ? binding.path : "",
      };
    },
    /** For the packs: bind + install, then the installation. */
    install: async (id: TemplateId, rootId: string): Promise<PackInstallation> => {
      await this.bindAndApply(id, rootId);
      return this.workspaceTemplate.installation(id);
    },
  };

  /**
   * Templates: the Company OS a legacy workspace started as, and the
   * catalogue Apps → Second brain offers.
   *
   * `ensureDefault` runs at launch. On a BOUND workspace it resumes an
   * installation a crash interrupted, and nothing else. On an unbound
   * workspace that already has a brain folder it keeps the legacy behaviour
   * (the Company OS seeded there once, the CEO made on an empty roster,
   * `template.json` remembering it). On a NEW workspace — no brain, no
   * `template.json`, no binding — it does nothing: the person chooses a
   * template and a vault in the app rather than getting a business model
   * installed for them.
   *
   * `list` and `apply` are the catalogue; `apply` goes through the binding.
   */
  readonly templates = {
    current: async (): Promise<TemplateState | null> => this.storage.readJson<TemplateState | null>(TEMPLATE_FILE, null),
    ensureDefault: async (): Promise<{ id: string; vault: VaultSeed | "deferred"; bots: number; applied: boolean }> => {
      const binding = this.bindingOf();
      if (binding) {
        const registry = readTemplateRegistry(this.storage, binding);
        if (registry.pending[binding.templateId]) await this.bindAndApply(binding.templateId, binding.rootId);
        const installation = this.workspaceTemplate.installation(binding.templateId);
        return { id: binding.templateId, vault: "kept", bots: Object.keys(installation.bots).length, applied: false };
      }
      const template = COMPANY_OS;
      const brainDir = this.brainDir();
      refuseSymlink(brainDir, "brain");
      const existing = await this.templates.current();
      if (!existing && !existsSync(brainDir)) {
        return { id: template.id, vault: "deferred", bots: 0, applied: false };
      }
      const vault = seedTemplateVault(brainDir, template);
      if (existing?.id === template.id) {
        return { id: existing.id, vault, bots: Object.keys(existing.bots).length, applied: false };
      }
      const bots: Record<string, string> = {};
      let groupId: string | undefined;
      const routineIds: string[] = [];
      if (vault === "seeded" && this.botStore.list().length === 0) {
        for (const row of template.bots) {
          // The template may have written the agent's folder with its own
          // role sheet; that folder is the bot's, not a namesake's.
          const seededFolder = join(brainDir, AGENTS_DIRECTORY, row.name);
          const bot = await this.bots.create({
            name: row.name,
            title: row.title,
            description: row.description,
            instructions: row.instructions,
            ...(row.thinking ? { thinking: row.thinking } : {}),
            ...(existsSync(seededFolder) ? { workspacePath: seededFolder } : {}),
          });
          if (row.pinned) this.botStore.update(bot.id, { pinned: true });
          if (row.welcome) {
            // The bot's first words, on the record before the person opens the
            // chat — an immutable public message, no run behind it, so a
            // workspace without a provider still greets them.
            this.threadStore.append(threadIdForTarget({ botId: bot.id }), {
              role: "bot",
              deliveryState: "complete",
              botId: bot.id,
              blocks: [{ kind: "text", text: row.welcome }],
            });
            this.botStore.update(bot.id, { unread: true });
            this.botStore.setStatus(bot.id, "idle", row.welcome);
          }
          bots[row.slug] = bot.id;
        }
        const memberIds = template.bots.map((row) => bots[row.slug]).filter((id): id is string => Boolean(id));
        if (template.team && memberIds.length > 1) {
          groupId = (await this.groups.create({ name: template.team.name, memberIds })).id;
        }
        for (const routine of template.routines) {
          const botId = bots[routine.bot];
          if (!botId) continue;
          const created = await this.routines.create({
            botId,
            name: routine.name,
            prompt: routine.prompt,
            trigger: routine.trigger,
            enabled: routine.enabled,
          });
          routineIds.push(created.id);
        }
      }
      const state: TemplateState = {
        id: template.id,
        version: template.version,
        appliedAt: this.clock.nowIso(),
        vault,
        bots,
        ...(groupId ? { groupId } : {}),
        routineIds,
      };
      this.storage.writeJson(TEMPLATE_FILE, state);
      return { id: state.id, vault, bots: Object.keys(bots).length, applied: true };
    },
    /** The catalogue, with what is already on this Mac and which row the workspace is bound to. */
    list: async (): Promise<{ templates: TemplateSummary[] }> => {
      const binding = this.bindingOf();
      const registry = readTemplateRegistry(this.storage, binding);
      const roster = this.botStore.list();
      return {
        templates: TEMPLATE_IDS.map((id) => ({
          ...summarize(this.storage, templateOf(id), this.installationOf(registry, id), roster),
          ...(binding?.templateId === id ? { bound: true } : {}),
        })),
      };
    },
    /**
     * Create a template's vault and agents, or answer the installation that
     * exists — through the binding: an unbound workspace is bound to this
     * template (`rootId`, default `new`); a bound one answers its own
     * installation and refuses any other template or root.
     */
    apply: async (id: string, rootId?: string): Promise<TemplateApplyResult> => {
      if (!isTemplateId(id)) throw new BrainError("that template is not in the catalogue", "not_found");
      const binding = this.bindingOf();
      if (binding && !LocalBizosHarness.sameBinding(binding, id, rootId)) throw bindingConflict(binding, id, rootId);
      return this.bindAndApply(id, rootId ?? binding?.rootId ?? "new");
    },
  };

  /** The root a scan opens when none is named: the bound vault, else the brain. */
  private defaultRootId(): string {
    return this.bindingOrNull()?.rootId ?? "brain";
  }

  /** Apps tab (local mode): the second brain — the workspace's notes as a
   * graph, as a folder, and as something the person edits. */
  readonly brain = {
    /** The folders a vault can be. BOUND: the pinned vault, and nothing
     * else — a root id outside it is refused on every route, not merely
     * hidden. UNBOUND: the brain when it exists, the agents' workspaces,
     * the managed vaults, an older agency vault, and every shared folder.
     *
     * Writability comes from the SAME grant the agents obey: a folder shared
     * `read` is read-only here too, and the folders this app owns are
     * always writable. */
    roots: async (): Promise<BrainRoot[]> => {
      const binding = this.bindingOf();
      if (binding) return [{ id: binding.rootId, label: binding.label, path: binding.path, writable: true }];
      return this.unboundRoots();
    },
    scan: async (rootId?: string): Promise<BrainScan & { roots: BrainRoot[]; home: string }> => {
      const root = await this.brain.vault(rootId ?? this.defaultRootId());
      return { ...scanVault(root, () => this.clock.now()), roots: await this.brain.roots(), home: this.homeDir };
    },
    note: async (rootId: string, id: string): Promise<BrainNoteContent> =>
      readNote(await this.brain.vault(rootId), id),
    createNote: async (rootId: string, folder: string, name?: string): Promise<{ id: string; title: string }> =>
      createNote(await this.brain.writableVault(rootId), folder, name),
    createFolder: async (rootId: string, folder: string, name: string): Promise<{ path: string }> =>
      createFolder(await this.brain.writableVault(rootId), folder, name),
    writeNote: async (rootId: string, id: string, text: string): Promise<{ id: string; bytes: number; modifiedAt: string }> =>
      writeNote(await this.brain.writableVault(rootId), id, text),
    rename: async (rootId: string, path: string, name: string): Promise<{ path: string; id?: string }> =>
      renameEntry(await this.brain.writableVault(rootId), path, name),
    trash: async (rootId: string, path: string): Promise<{ trashed: string }> =>
      trashEntry(await this.brain.writableVault(rootId), path),
    /** Hand the entry to the Finder, its default app, or Obsidian. Reading a
     * folder is not writing it, so a read-only vault still opens. */
    open: async (rootId: string, path: string, mode: BrainOpenMode): Promise<{ ok: true }> =>
      openEntry(await this.brain.vault(rootId), path, mode),
    /** The root behind an id, or the same refusal for "not shared" and
     * "never existed": a renderer learns nothing by guessing ids. */
    vault: async (rootId: string): Promise<BrainRoot> => {
      const root = (await this.brain.roots()).find((candidate) => candidate.id === rootId);
      if (!root) throw new BrainError("that folder is not shared with your agents", "not_found");
      if (root.id.startsWith("vault:")) refuseSymlink(join(this.storage.layout.root, "vaults"), "vaults");
      refuseSymlink(root.path, "vault");
      if (!existsSync(root.path) || !lstatSync(root.path).isDirectory()) throw new BrainError("the selected vault is unavailable", "not_found");
      return root;
    },
    writableVault: async (rootId: string): Promise<BrainRoot> => {
      const root = await this.brain.vault(rootId);
      if (root.writable === false) throw new BrainError(`${root.label} is shared read-only`, "read_only");
      return root;
    },
  };

  private usageRefreshes = new Map<string, Promise<void>>();

  /** The same refresh, off the caller's path: a list must never wait on a CLI. */
  private refreshCodexUsageInBackground(planId: string): void {
    if (this.usageRefreshes.has(planId)) return;
    const pending = this.refreshCodexUsage(planId)
      .catch(() => undefined)
      .finally(() => this.usageRefreshes.delete(planId));
    this.usageRefreshes.set(planId, pending);
  }

  /** Ask the codex CLI for a plan's real limits, and remember the answer on the plan. */
  private async refreshCodexUsage(planId: string): Promise<void> {
    const plan = this.planRegistry.get(planId);
    if (!plan || plan.provider !== "codex") return;
    let cli: string;
    try {
      cli = requireCodexPath(this.settingsStore.get().local.codexPath, this.environment(), { packaged: this.options.packaged });
    } catch {
      return;
    }
    const usage = await readCodexUsage({
      cli,
      ...(plan.codexHome ? { codexHome: plan.codexHome } : {}),
      environment: this.environment(),
      nowIso: () => this.clock.nowIso(),
    });
    if (usage) this.planRegistry.update(planId, { usage });
  }

  /** Same, for a Claude plan: one HTTPS round-trip, off the caller's path. */
  private refreshClaudeUsageInBackground(planId: string): void {
    if (this.usageRefreshes.has(planId)) return;
    const pending = this.refreshClaudeUsage(planId)
      .catch(() => undefined)
      .finally(() => this.usageRefreshes.delete(planId));
    this.usageRefreshes.set(planId, pending);
  }

  /** Ask Anthropic for a Claude plan's real windows, and remember the answer.
   * Nothing is written when the account has no usable token: the plan keeps
   * the row `claude auth status` gave it rather than losing its subscription
   * name to a network hiccup. */
  private async refreshClaudeUsage(planId: string): Promise<void> {
    const plan = this.planRegistry.get(planId);
    if (!plan || plan.provider !== "claude") return;
    const usage = await readClaudeUsage({
      ...(plan.configDir ? { configDir: plan.configDir } : {}),
      homeDir: this.homeDir,
      environment: this.environment(),
      nowIso: () => this.clock.nowIso(),
    });
    if (usage) this.planRegistry.update(planId, { usage });
  }

  /**
   * Connect the machine's Cursor account.
   *
   * ONE per Mac, on purpose. `CURSOR_CONFIG_DIR` moves the CLI's settings,
   * chats and projects, but on macOS its OAuth token lives in the login
   * Keychain under a FIXED service (domain `"cursor"` →
   * `cursor-access-token`, account `cursor-user`), so a second directory
   * would still be the same account with a second row in the list. A second
   * POST therefore answers the plan that already exists — re-opening its
   * sign-in when it is not connected — instead of creating a duplicate.
   */
  private async connectCursorPlan(label?: string): Promise<{ planId: string; loginStarted: boolean }> {
    // Missing binary → `cli_missing`, which the bridge turns into a 400 the
    // desktop prints verbatim.
    const cli = requireCursorPath(undefined, this.environment(), { packaged: this.options.packaged });
    const status = await probeCursorStatus(undefined, this.environment(), undefined, {
      packaged: this.options.packaged,
    });
    if (!status.found) throw new CursorCliMissingError();
    const signedIn = status.authenticated === true;

    const existing = this.planRegistry.list().find((plan) => plan.provider === "cursor");
    const plan =
      existing ??
      this.planRegistry.createReferencing({
        provider: "cursor",
        label: label?.slice(0, MAX_PLAN_LABEL) ?? "Cursor",
        homePath: join(this.homeDir, ".cursor"),
        status: signedIn ? "connected" : "disconnected",
        ...(status.emailHint ? { emailHint: status.emailHint } : {}),
      });
    if (existing) {
      this.planRegistry.update(plan.id, {
        status: signedIn ? "connected" : "disconnected",
        ...(status.emailHint ? { emailHint: status.emailHint } : {}),
      });
    }
    if (signedIn) return { planId: plan.id, loginStarted: false };
    // The browser dance needs a TTY: the same Terminal window the other two
    // families get. Nothing here waits on it — `plans.test` is what confirms
    // the sign-in afterwards.
    const started = openCliLogin({ shellCommand: `${shellSingleQuote(cli)} login` });
    return { planId: plan.id, loginStarted: started.started };
  }

  /** Settings → Plans: connect / disconnect / test OAuth accounts. */
  readonly plans = {
    list: async (): Promise<PublicPlan[]> => {
      await this.seedPlansFromMachine();
      // The Cursor import runs behind `start()`; a list must not draw before
      // it has finished, or the row would appear on the second refresh.
      await this.cursorSeed;
      return this.planRegistry.publicList();
    },
    /**
     * Real usage, refreshed when older than five minutes: one short
     * app-server round-trip per signed-in codex plan, one HTTPS call per
     * signed-in Claude plan, started here and read on the next list. Called
     * by the routes a Settings page uses, never by a list itself: a list
     * must answer at once, CLI or no CLI.
     */
    refreshUsage: async (): Promise<void> => {
      const nowMs = this.clock.now().getTime();
      for (const plan of this.planRegistry.list()) {
        if (plan.status !== "connected") continue;
        const at = plan.usage ? Date.parse(plan.usage.at) : 0;
        if (Number.isFinite(at) && nowMs - at < USAGE_CACHE_MS) continue;
        if (plan.provider === "codex") this.refreshCodexUsageInBackground(plan.id);
        else if (plan.provider === "claude") this.refreshClaudeUsageInBackground(plan.id);
        // Cursor: the CLI reports no window at all, and this app makes no
        // network call of its own to invent one. `usage.windows` stays empty.
      }
    },
    connect: async (input: {
      provider: PlanProvider;
      label?: string;
      importDefault?: boolean;
    }): Promise<{ planId: string; loginStarted: boolean }> => {
      const provider = input.provider;
      if (provider === "cursor") return this.connectCursorPlan(input.label);
      if (input.importDefault) {
        const home = join(this.homeDir, provider === "codex" ? ".codex" : ".claude");
        const env = this.environment();
        // Already imported once: the same sign-in is one plan, not two rows.
        const existing = this.planRegistry
          .list()
          .find((plan) => plan.provider === provider && (plan.codexHome ?? plan.configDir) === home);
        if (existing) {
          const check = await this.plans.test(existing.id);
          if (!check.ok) throw new SettingsError(`the default ${provider === "codex" ? "ChatGPT" : "Claude Code"} plan on this Mac is not signed in`);
          return { planId: existing.id, loginStarted: false };
        }
        if (provider === "codex") {
          const status = await probeCodexStatus(undefined, { ...env, CODEX_HOME: home }, undefined, {
            packaged: this.options.packaged,
          });
          if (!status.found || !status.authenticated) {
            throw new SettingsError("the default ChatGPT plan on this Mac is not signed in");
          }
        } else {
          const status = await probeClaudeStatus(undefined, env, undefined, {
            packaged: this.options.packaged,
            configDir: home,
          });
          if (!status.found || !status.authenticated) {
            throw new SettingsError("the default Claude Code plan on this Mac is not signed in");
          }
          const plan = this.planRegistry.createReferencing({
            provider: "claude",
            label: input.label ?? "Claude Code",
            homePath: home,
            status: "connected",
            ...(status.emailHint ? { emailHint: status.emailHint } : {}),
          });
          // The bars are one HTTPS call away; the card should not wait on it.
          this.refreshClaudeUsageInBackground(plan.id);
          return { planId: plan.id, loginStarted: false };
        }
        const plan = this.planRegistry.createReferencing({
          provider: "codex",
          label: input.label ?? "ChatGPT",
          homePath: home,
          status: "connected",
        });
        return { planId: plan.id, loginStarted: false };
      }

      const plan = this.planRegistry.create({
        provider,
        ...(input.label ? { label: input.label.slice(0, MAX_PLAN_LABEL) } : {}),
        status: "disconnected",
      });
      const envPrefix =
        provider === "codex"
          ? `CODEX_HOME=${shellSingleQuote(plan.codexHome!)}`
          : `CLAUDE_CONFIG_DIR=${shellSingleQuote(plan.configDir!)}`;
      const loginCmd =
        provider === "codex" ? "codex login" : "claude auth login --claudeai";
      const started = openCliLogin({ shellCommand: `${envPrefix} ${loginCmd}` });
      return { planId: plan.id, loginStarted: started.started };
    },
    disconnect: async (planId: string): Promise<{ removed: boolean }> => {
      const removed = this.planRegistry.remove(planId);
      if (removed && this.settingsStore.get().local.activePlanId === planId) {
        this.settingsStore.set({ local: { activePlanId: null } });
      }
      return { removed };
    },
    test: async (planId: string): Promise<{ ok: boolean; reason?: string }> => {
      const plan = this.planRegistry.get(planId);
      if (!plan) return { ok: false, reason: "unknown plan" };
      const env = this.environment();
      if (plan.provider === "codex") {
        const status = await probeCodexStatus(
          undefined,
          { ...env, ...(plan.codexHome ? { CODEX_HOME: plan.codexHome } : {}) },
          undefined,
          { packaged: this.options.packaged },
        );
        const ok = status.found === true && status.authenticated === true;
        if (ok) {
          this.planRegistry.update(planId, { status: "connected" });
          await this.refreshCodexUsage(planId);
        } else {
          this.planRegistry.update(planId, { status: "disconnected" });
        }
        return { ok, ...(ok ? {} : { reason: status.error ?? "not signed in" }) };
      }
      if (plan.provider === "cursor") {
        const cursor = await probeCursorStatus(undefined, env, undefined, { packaged: this.options.packaged });
        const signedIn = cursor.found === true && cursor.authenticated === true;
        this.planRegistry.update(planId, {
          status: signedIn ? "connected" : "disconnected",
          ...(signedIn && cursor.emailHint ? { emailHint: cursor.emailHint } : {}),
          // Cursor publishes no usage window through the CLI, so the row is
          // the subscription name and no bars — the desktop hides the group.
          ...(signedIn
            ? {
                usage: {
                  at: this.clock.nowIso(),
                  planType: cursor.planType ?? null,
                  email: null,
                  reached: false,
                  windows: [],
                },
              }
            : {}),
        });
        // A new account may be entitled to a different list.
        if (signedIn) this.cursorCatalog = null;
        return { ok: signedIn, ...(signedIn ? {} : { reason: cursor.error ?? "not signed in" }) };
      }
      const status = await probeClaudeStatus(undefined, env, undefined, {
        packaged: this.options.packaged,
        ...(plan.configDir ? { configDir: plan.configDir } : {}),
      });
      const ok = status.found === true && status.authenticated === true;
      if (ok) {
        this.planRegistry.update(planId, {
          status: "connected",
          ...(status.emailHint ? { emailHint: status.emailHint } : {}),
          // Claude Code names the subscription but not its windows, so this
          // row is the floor: the plan and no bars. The OAuth usage call
          // right below replaces it whenever the account answers.
          usage: {
            at: this.clock.nowIso(),
            planType: status.planType ?? null,
            email: null,
            reached: false,
            windows: plan.usage?.windows ?? [],
          },
        });
        await this.refreshClaudeUsage(planId);
      } else {
        this.planRegistry.update(planId, { status: "disconnected" });
      }
      return { ok, ...(ok ? {} : { reason: status.error ?? "not signed in" }) };
    },
    setActive: async (planId: string | null): Promise<PublicPlan | null> => {
      const plan = this.planRegistry.setActive(planId);
      this.settingsStore.set({
        local: {
          activePlanId: planId,
          ...(plan ? { provider: plan.provider } : {}),
        },
      });
      this.catalog = null;
      // The Claude list belongs to the account that answered; a new active
      // plan is a new account. Cursor has one account per Mac, but a new
      // active plan is still a good moment to stop trusting a cached list.
      this.claudeCatalog = null;
      this.cursorCatalog = null;
      return plan ? this.planRegistry.publicList().find((row) => row.id === plan.id) ?? null : null;
    },
  };

  /** Settings → Access.
   *
   * Every call answers the WHOLE state, so the screen can never drift from
   * what is persisted, and every change is announced twice: in the thread of
   * each bot it applies to (the user reads it where they talk to them) and
   * in `native/access.ndjson` (it outlives the window). */
  readonly access = {
    list: async (): Promise<AccessState> => this.accessState(),
    /** The native picker, in the main process. There is deliberately no way
     * to hand this a path: a renderer that can name a folder is a renderer
     * that can name `~/.ssh`. It answers a single-use NONCE bound to what the
     * user chose in the system dialog; `grant` takes that, never a path. */
    pickFolder: async (): Promise<PickedFolder | null> => {
      const pick = this.options.pickFolder;
      if (!pick) throw new AccessError("this build cannot open a folder picker");
      const picked = await pick();
      if (!picked) return null;
      const path = canonicalizeSharedPath(picked, this.accessPolicy);
      return {
        folderId: "",
        path,
        label: labelForPath(path),
        // The ticket carries the WHOLE permission the sheet described, not just
        // the folder: that dialog said "your agents will be able to read what is
        // in this folder", so what it authorises is `read`, for everyone. Asking
        // for more when the nonce is spent is a second question, below.
        nonce: this.folderTickets.issue({ path, mode: "read", scope: "all" }),
      };
    },
    /**
     * Share the folder a NONCE stands for, or the folder a known-folder ID
     * stands for. Never a path.
     *
     * `grant({path, mode})` was a privileged call taking a string: a renderer
     * that never opened a dialog could give itself `~/Documents` read-write,
     * durably, with nothing on screen. Now the only two ways in are a ticket
     * the native dialog just issued, and a shortcut whose path the MAIN process
     * resolves with `app.getPath`.
     */
    grant: async (request: AccessGrantRequest): Promise<AccessState> => {
      const ticket =
        "nonce" in request
          ? this.folderTickets.redeem(request.nonce)
          : this.shortcutTicket(request.folderId);
      if (!ticket) {
        throw new AccessError(
          "nonce" in request
            ? "that folder choice has expired — pick the folder again"
            : "that is not one of the folders this Mac offers",
        );
      }
      // The ticket is the floor. A request that asks for no mode gets what the
      // native dialog described; a request that asks for MORE is an elevation
      // and pays for it below.
      const mode = request.mode ?? ticket.mode;
      const path = canonicalizeSharedPath(ticket.path, this.accessPolicy);
      // Refused whatever anyone answers (`~/.local/bin` read-write is an
      // arbitrary program at the next launch) — so it is refused BEFORE the
      // question, rather than after wasting the user's decision.
      assertModeAllowed(path, mode, this.accessPolicy);
      if (!(await this.consentToWrite(path, mode))) return this.accessState();
      const grant = this.accessStore.grant({
        path,
        ...(request.label === undefined ? {} : { label: request.label }),
        mode,
        ...(request.scope === undefined ? { scope: ticket.scope } : { scope: request.scope }),
      });
      this.announceAccess(
        grant.scope,
        `You shared ${displayPath(grant.path, this.homeDir)} (${grant.mode}).`,
      );
      return this.accessState();
    },
    update: async (id: string, patch: AccessGrantPatch): Promise<AccessState> => {
      // Read first: "share read, then flip it to read & write" is the same door
      // as granting read-write outright, and it used to be the unlocked one.
      const before = this.settingsStore.get().access.grants.find((row) => row.id === id);
      if (!before) throw new AccessError("that shared folder is gone");
      if (patch.mode !== undefined) {
        assertModeAllowed(before.path, patch.mode, this.accessPolicy);
        if (!(await this.consentToWrite(before.path, patch.mode, before.mode))) {
          return this.accessState();
        }
      }
      const grant = this.accessStore.update(id, patch);
      this.announceAccess(
        grant.scope,
        `${displayPath(grant.path, this.homeDir)} is now shared ${grant.mode}.`,
      );
      return this.accessState();
    },
    revoke: async (id: string): Promise<AccessState> => {
      const revoked = this.accessStore.revoke(id);
      if (revoked) {
        this.announceAccess(
          revoked.scope,
          `You stopped sharing ${displayPath(revoked.path, this.homeDir)}.`,
        );
      }
      return this.accessState();
    },
    /** Turning it ON is confirmed in a NATIVE dialog, in the main process.
     * Turning it off is not a question: taking access away needs no permission. */
    setFullDiskRead: async (enabled: boolean): Promise<AccessState> => {
      if (enabled === true) {
        const confirm = this.options.confirmFullDiskRead;
        if (!confirm) throw new AccessError("this build cannot ask for that permission");
        if (!(await confirm())) return this.accessState();
      }
      const next = this.accessStore.setFullDiskRead(enabled === true);
      this.announceAccess(
        "all",
        next.fullDiskRead
          ? "You let your agents read any file in your home folder."
          : "You turned off full-disk reading.",
      );
      return this.accessState();
    },
  };

  // ── devices ───────────────────────────────────────────────────────────

  /** What this machine reports about itself, on a 10-minute cache for the one
   * expensive part (probing the CLI costs a spawn; the heartbeat runs every
   * minute). */
  private async deviceCapabilities(): Promise<DeviceCapabilities> {
    const settings = this.settingsStore.get();
    const now = this.clock.now().getTime();
    if (!this.deviceCapabilityCache || now - this.deviceCapabilityCache.at > DEVICE_CAPABILITY_CACHE_MS) {
      const status = await probeCodexStatus(settings.local.codexPath, this.environment(), undefined, {
        packaged: this.options.packaged,
      }).catch(() => ({ found: false }) as CodexStatus);
      this.deviceCapabilityCache = {
        at: now,
        value: { codex: { found: status.found, version: status.version ?? null } },
      };
    }
    return {
      ...this.deviceCapabilityCache.value,
      localRuntime: settings.mode === "local",
      accessGrants: settings.access.grants.length,
      remoteTasks: this.deviceAgent.state().remoteTasksEnabled,
    };
  }

  /** The bot and the dedicated thread a remote task runs in.
   *
   * The thread is a GROUP called "Remote tasks" with exactly one member: that
   * is what makes it a turn of the default bot AND a thread of its own, using
   * the primitives the app already has rather than a second kind of thread
   * nothing else in the shell knows how to draw. A member that was deleted is
   * re-seated; a member that is still there is kept, so the conversation stays
   * with whoever has been answering these. */
  private remoteTaskTarget(): { bot: Bot; group: Group } {
    const roster = this.botStore.list().filter((candidate) => !candidate.archived);
    const existing = this.groupStore.list().find((group) => group.name === REMOTE_TASKS_THREAD);
    const seatedId = existing?.memberIds.find((id) => roster.some((candidate) => candidate.id === id));
    const seated = seatedId ? roster.find((candidate) => candidate.id === seatedId) : undefined;
    let bot = seated ?? roster[0];
    if (!bot) {
      bot = this.botStore.create({
        name: "Remote",
        title: "Runs the tasks a BizOS admin sends to this Mac",
      });
      this.events.publish({ type: "bot.spawned", bot });
    }
    if (!existing) {
      const group = this.groupStore.create({ name: REMOTE_TASKS_THREAD, memberIds: [bot.id] });
      this.events.publish({ type: "group.created", group });
      return { bot, group };
    }
    if (seated) return { bot, group: existing };
    const group = this.groupStore.update(existing.id, { memberIds: [bot.id] });
    this.events.publish({ type: "group.updated", group });
    return { bot, group };
  }

  /**
   * One remote task = one turn, in the "Remote tasks" thread, opened by a
   * system line saying where it came from.
   *
   * Approvals are NOT bypassed: the turn runs under this Mac's own approval
   * mode, so a command that needs a person still draws its card in the app. If
   * nobody is there to answer it, the task ends `failed: needs approval` after
   * fifteen minutes rather than hanging forever — the admin who sent it learns
   * that the machine asked and nobody was in front of it.
   */
  private async runRemoteTask(prompt: string): Promise<{ status: "done" | "failed"; result: string }> {
    await this.refreshSessionCookie();
    const { group } = this.remoteTaskTarget();
    const threadId = threadIdForTarget({ groupId: group.id });
    const note = this.threadStore.append(threadId, {
      role: "system",
      blocks: [{ kind: "meta", text: REMOTE_TASK_NOTE }],
    });
    this.events.publish({ type: "thread.message.created", threadId, message: note });
    const waiting = this.awaitRemoteRun(threadId, prompt);
    try {
      const { runIds } = this.dispatcher.send({ groupId: group.id }, { text: prompt });
      const runId = runIds[0];
      if (!runId) {
        waiting.abandon();
        return { status: "failed", result: "no agent on this Mac picked the task up" };
      }
      waiting.bind(runId);
    } catch (error) {
      waiting.abandon();
      return { status: "failed", result: error instanceof Error ? error.message : String(error) };
    }
    return waiting.result;
  }

  /**
   * Watch one run to its end and hand back what the agent actually said.
   *
   * The full reply is accumulated from the STREAMING updates rather than read
   * off the thread at the end: `Dispatcher.splitReply` moves everything after
   * the first paragraph into delayed chat bubbles before `run.completed` is
   * published, so the message on disk at that moment holds a fraction of the
   * answer. The longest text seen for the run is the whole of it.
   */
  private awaitRemoteRun(
    threadId: string,
    prompt: string,
  ): { bind(runId: string): void; abandon(): void; result: Promise<{ status: "done" | "failed"; result: string }> } {
    let runId: string | null = null;
    let best = "";
    let asked = false;
    let settle: ((value: { status: "done" | "failed"; result: string }) => void) | null = null;
    const result = new Promise<{ status: "done" | "failed"; result: string }>((resolve) => {
      settle = resolve;
    });
    const finish = (status: "done" | "failed", text: string): void => {
      if (!settle) return;
      const resolve = settle;
      settle = null;
      cancelTimer();
      unsubscribeAll();
      resolve({ status, result: text.slice(0, 4000) });
    };
    const unsubscribe = this.events.subscribe((event) => {
      const eventRunId = (event as { runId?: unknown }).runId;
      if (!runId || typeof eventRunId !== "string" || eventRunId !== runId) return;
      if (event.type === "thread.ask") {
        asked = true;
        return;
      }
      if (event.type === "run.completed") {
        finish("done", best || this.remoteTaskTail(threadId, runId) || "(the agent finished without writing anything)");
      } else if (event.type === "run.failed") {
        finish("failed", event.error ?? "the task failed on this Mac");
      } else if (event.type === "run.cancelled") {
        finish("failed", "the task was stopped on this Mac");
      }
    });
    const streams = this.events.subscribe((event) => {
      if (event.type !== "thread.message.created" && event.type !== "thread.message.updated") return;
      if (event.threadId !== threadId || event.message.role !== "bot") return;
      if (!runId || event.message.runId !== runId) return;
      const text = textOfBlocks(event.message.blocks);
      if (text.length > best.length) best = text;
    });
    const cancelTimer = this.clock.setTimeout(() => {
      // Stop the WORK, not just the report. Reporting a timeout while the turn
      // kept running left a codex process, its tool calls and its writes going
      // on a machine whose owner had already been told the task was over.
      const target = targetForThreadId(threadId);
      if (target) this.dispatcher.stop(target);
      finish("failed", asked ? "needs approval" : `the task did not finish in 15 minutes: ${prompt.slice(0, 80)}`);
    }, TASK_TIMEOUT_MS);
    const unsubscribeAll = (): void => {
      unsubscribe();
      streams();
    };
    return {
      bind: (id: string) => {
        runId = id;
      },
      abandon: () => {
        cancelTimer();
        unsubscribeAll();
        settle = null;
      },
      result,
    };
  }

  /** The last thing the bot wrote for this run, straight off the thread — the
   * fallback when no streaming update was seen at all. */
  private remoteTaskTail(threadId: string, runId: string): string {
    const target = targetForThreadId(threadId);
    if (!target) return "";
    const messages = this.threadStore.snapshot(target).messages;
    const last = [...messages].reverse().find((message) => message.role === "bot" && message.runId === runId);
    return last ? textOfBlocks(last.blocks) : "";
  }

  /** Settings → Devices, the half only this machine knows: whether it is
   * registered, under which name, and whether its owner armed remote tasks.
   * The rest of the fleet comes from `GET /api/devices`. */
  readonly devices = {
    status: async (): Promise<DeviceAgentState> => this.deviceAgent.state(),
    /** Heartbeat NOW. The screen calls this right after the toggle so the
     * machine learns its new permission in the same second rather than at the
     * next minute. */
    refresh: async (): Promise<DeviceAgentState> => {
      await this.deviceAgent.tick();
      return this.deviceAgent.state();
    },
  };

  readonly bots = {
    list: async (): Promise<Bot[]> => this.botStore.list().map((bot) => this.decorate(bot)),
    /**
     * A new agent works from its own folder in the second brain,
     * `Agents/<Name>/`, created here with its role sheet — unless the person
     * chose a folder, which then has to exist. Either way the folder is
     * decided at creation and shown in the agent's settings, where it can
     * be changed.
     */
    create: async (input: CreateBotInput): Promise<Bot> => this.spawnBot(input),
    update: async (id: string, patch: UpdateBotInput): Promise<Bot> => {
      if (patch.workspacePath) this.requireFolder(patch.workspacePath);
      if (patch.planId && !this.planRegistry.get(patch.planId)) throw new SettingsError("unknown plan");
      if (patch.providerId && !this.inferenceStore.get(patch.providerId)) throw new SettingsError("unknown provider");
      // One answer source per bot: choosing a plan clears a provider and back.
      const exclusive: UpdateBotInput =
        patch.planId ? { ...patch, providerId: "" } : patch.providerId ? { ...patch, planId: "" } : patch;
      const bot = this.botStore.update(id, exclusive);
      if (bot.archived) this.events.publish({ type: "bot.archived", botId: bot.id });
      return this.decorate(bot);
    },
    remove: async (id: string): Promise<void> => {
      const bot = this.botStore.get(id);
      this.dispatcher.stop({ botId: id });
      // Deleting a bot deletes the bot: its transcript, its raw tee, its
      // codex resume cursor, its standing approvals and its workspace. A
      // "deleted" bot whose folder and cursor survived came back with every
      // memory intact the moment the name was reused.
      this.dispatcher.clearThread({ botId: id });
      this.dispatcher.clearApprovals(id);
      // Its computer too: the browser is destroyed and the fact that it had one
      // is forgotten, so a reused id cannot inherit a logged-in browser.
      this.computerManager.forget(id);
      if (bot) {
        this.storage.removeDirectory(join(this.storage.layout.workspacesDir, safeFileName(bot.id)));
        // Its folder in the second brain is not erased: it holds notes the
        // person may want back, so it goes to the vault's trash the way a
        // note does. Only a folder this app made under `Agents/` — in the
        // brain or in a template's vault; a folder the person chose is
        // theirs and stays where it is.
        if (bot.workspacePath) {
          const vault = this.managedVaults({ pending: true }).find((candidate) => isAgentFolder(candidate.path, bot.workspacePath!));
          if (vault) {
            try {
              trashEntry(vault, `${AGENTS_DIRECTORY}/${basename(bot.workspacePath)}`);
            } catch {
              /* already gone, or already in the trash */
            }
          }
        }
      }
      // An agent a template is still creating: the journal learns it was
      // deleted on purpose, so the template's retry does not bring it back.
      this.forgetTemplateBot(id);
      this.botStore.remove(id);
      this.groupStore.removeMember(id);
      this.routineStore.removeForBot(id);
      this.threadStore.clear({ botId: id });
      this.events.publish({ type: "bot.deleted", botId: id });
    },
    duplicate: async (id: string): Promise<Bot> => {
      const bot = this.botStore.duplicate(id);
      this.events.publish({ type: "bot.spawned", bot });
      return this.decorate(bot);
    },
    setAvatar: async (id: string, avatar: { dataUrl: string } | { url: string } | null): Promise<Bot> =>
      this.decorate(this.botStore.setAvatar(id, avatar)),
    /** Take back every "always allow" this bot was given. */
    clearApprovals: async (id: string): Promise<{ cleared: number }> => ({
      cleared: this.dispatcher.clearApprovals(id),
    }),
  };

  /** Mark, in every journal that names it, a bot the person deleted. Best
   * effort: a damaged registry must not stop a delete. */
  private forgetTemplateBot(botId: string): void {
    try {
      const registry = readTemplateRegistry(this.storage);
      const names = Object.values(registry.pending).some((row) =>
        row && Object.values(row.bots).some((planned) => planned.id === botId),
      );
      if (!names) return;
      this.updateRegistry((current) => {
        for (const row of Object.values(current.pending)) {
          if (!row) continue;
          for (const [slug, planned] of Object.entries(row.bots)) {
            if (planned.id === botId) row.bots[slug] = { ...planned, removed: true };
          }
        }
      });
    } catch (error) {
      console.warn(`Local BizOS: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The one way a bot is made, for the person's "New agent" and for a
   * template alike: `id` is the template's journaled id — see
   * `BotStore.create` — and absent for everyone else.
   */
  private async spawnBot(input: CreateBotInput, id?: string): Promise<Bot> {
    let workspacePath = input.workspacePath?.trim();
    if (workspacePath) {
      this.requireFolder(workspacePath);
    } else if (this.settingsStore.get().local.workingDir) {
      // The person chose a working directory for every agent in Settings:
      // that choice stands, and `workspaceFor` puts the bot under it.
      workspacePath = undefined;
    } else {
      // A bound workspace: the agent's folder goes in the pinned vault, so a
      // peer recruited during a pack's mission works from the same vault as
      // the pack. Unbound: the legacy brain, seeded if it is not there yet.
      const binding = this.bindingOf();
      const vaultDir = binding ? binding.path : this.brainDir();
      if (binding) {
        this.requireFolder(vaultDir);
      } else {
        seedTemplateVault(vaultDir, COMPANY_OS);
      }
      workspacePath = ensureAgentFolder(vaultDir, {
        name: input.name,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
      }).path;
    }
    const bot = this.botStore.create({ ...input, ...(workspacePath ? { workspacePath } : {}) }, id);
    this.events.publish({ type: "bot.spawned", bot });
    return this.decorate(bot);
  }


  readonly groups = {
    list: async (): Promise<Group[]> => this.groupStore.list(),
    create: async (input: { name: string; memberIds: string[] }): Promise<Group> => {
      const group = this.groupStore.create(input);
      this.events.publish({ type: "group.created", group });
      return group;
    },
    update: async (
      id: string,
      patch: Partial<{ name: string; memberIds: string[]; pinned: boolean; archived: boolean }>,
    ): Promise<Group> => {
      const group = this.groupStore.update(id, patch);
      this.events.publish({ type: "group.updated", group });
      return group;
    },
    remove: async (id: string): Promise<void> => {
      this.dispatcher.clearThread({ groupId: id });
      this.groupStore.remove(id);
      this.threadStore.clear({ groupId: id });
    },
  };

  readonly threads = {
    get: async (target: ThreadTarget): Promise<ThreadSnapshot> =>
      this.threadStore.snapshot(target, this.dispatcher.activeRunIds(threadIdForTarget(target))),
    messages: async (
      target: ThreadTarget,
      before?: string,
    ): Promise<{ messages: ThreadMessage[]; olderCursor: string | null }> =>
      this.threadStore.page(target, before),
    after: async (target: ThreadTarget, after: string, limit?: number) =>
      this.threadStore.pageAfter(target, after, limit),
    message: async (target: ThreadTarget, messageId: string): Promise<ThreadMessage | undefined> =>
      this.threadStore.get(threadIdForTarget(target), messageId),
    send: async (
      target: ThreadTarget,
      input: { text: string; mentionBotIds?: string[]; attachments?: Attachment[]; replyToMessageId?: string; role?: "user" | "system" },
    ): Promise<{ runIds: string[] }> => {
      await this.refreshSessionCookie();
      return this.dispatcher.send(target, input);
    },
    stop: async (target: ThreadTarget): Promise<void> => this.dispatcher.stop(target),
    clear: async (target: ThreadTarget): Promise<void> => {
      this.dispatcher.clearThread(target);
      this.threadStore.clear(target);
    },
    markRead: async (target: ThreadTarget): Promise<void> => this.threadStore.markRead(target),
    markUnread: async (target: ThreadTarget): Promise<void> => this.threadStore.markUnread(target),
    answer: async (input: { runId: string; askId: string; answer: AskAnswer }): Promise<void> =>
      this.dispatcher.answer(input),
  };

  readonly routines = {
    list: async (botId?: string): Promise<Routine[]> => this.routineStore.list(botId),
    create: async (input: CreateRoutineInput): Promise<Routine> => {
      const routine = this.routineStore.create(input);
      this.scheduler.stop();
      this.scheduler.start();
      return this.routineStore.get(routine.id)!;
    },
    update: async (id: string, patch: Partial<CreateRoutineInput> & { enabled?: boolean }): Promise<Routine> => {
      const routine = this.routineStore.update(id, patch);
      this.scheduler.stop();
      this.scheduler.start();
      return this.routineStore.get(routine.id)!;
    },
    remove: async (id: string): Promise<void> => this.routineStore.remove(id),
    /** The same path a scheduled fire takes, bookkeeping included — running
     * a routine by hand used to skip `lastRunAt`, `nextRunAt` and the
     * one-off disarm entirely. */
    runNow: async (id: string): Promise<{ runId: string }> => {
      const started = await this.scheduler.runNow(id);
      if (!started) throw new Error("that routine's bot is gone");
      return started;
    },
  };

  checkpointTask(scope: { botId: string; threadId: string; runId: string }, raw: unknown) {
    return this.dispatcher.checkpointTask(scope, raw);
  }

  readonly runs = {
    get: async (id: string): Promise<Run | undefined> => this.runStore.get(id),
    list: async (input?: { limit?: number }): Promise<Run[]> => this.runStore.list(input?.limit ?? 50),
  };

  /**
   * The agent's computer, as the panel and the viewer window see it.
   *
   * Deliberately NOT part of `ProductEvent`: a thumbnail once a second is not a
   * position in a transcript, and pushing it through the thread reducer would
   * re-render the conversation on every tick. It has its own channel, and
   * `subscribeComputer` is the only door onto it.
   */
  readonly computer = {
    get: async (botId: string): Promise<ComputerState> => this.computerManager.state(botId),
    setUp: async (botId: string): Promise<ComputerState> => this.computerManager.setUp(botId),
    /** The panel is on screen: refresh its thumbnail. Off screen, nothing ticks. */
    watch: async (botId: string, on: boolean): Promise<void> => {
      this.computerManager.watch(botId, on);
    },
    takeControl: async (botId: string): Promise<ComputerState> => this.computerManager.takeControl(botId),
    giveBack: async (botId: string): Promise<ComputerState> => this.computerManager.giveBack(botId),
  };

  /** The manager itself, for the pieces of the main process that need more than
   * the bridge does — the viewer window's frame feed. */
  get computerManagerRef(): ComputerManager {
    return this.computerManager;
  }

  subscribeComputer(listener: (event: ComputerEvent) => void): () => void {
    this.computerListeners.add(listener);
    return () => {
      this.computerListeners.delete(listener);
    };
  }

  subscribe(listener: (event: ProductEvent) => void): () => void {
    return this.events.subscribe(listener);
  }
}

/** Quote a path for a shell one-liner opened in Terminal.app. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Every text block of a message, joined the way a person reads them. Steps,
 * cards and asks are deliberately left out: they belong to the turn's record,
 * not to the sentence an admin asked for. */
function textOfBlocks(blocks: MessageBlock[]): string {
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
