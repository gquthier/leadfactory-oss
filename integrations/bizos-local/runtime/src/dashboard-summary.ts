/** Read-only, bounded projection of the current Local BizOS workspace.
 * The sidecar owns the binding. A caller cannot choose a source path, and this
 * reader never starts a cockpit or its Store (which would create a lock). */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

type State = "ready" | "empty" | "unavailable" | "error";
type Binding = { templateId: string; rootId: string; path: string };
type Metric = { key: string; label: string; value: number };
type Item = { id: string; title: string; status: string; updatedAt: string | null };
type Business = { state: State; source: "agency-cockpit" | "ecommerce-cockpit" | "ops-jsonl" | null; updatedAt: string | null; metrics: Metric[]; items: Item[] };
type Finance = { state: State; source: "manual-ecommerce" | null; currency: string | null; period: "all-recorded"; revenue: number | null; adSpend: number | null; orders: number | null; updatedAt: string | null };
export interface LocalDashboardSummary {
  version: 1;
  workspaceId: string;
  templateId: string | null;
  generatedAt: string;
  business: Business;
  agents: { state: "ready" | "empty" | "error"; total: number | null; working: number | null; waiting: number | null;
    items: Array<{ id: string; name: string; status: "idle" | "working" | "waiting"; threadId: string | null; task: string | null }> };
  routines: { state: "ready" | "empty" | "error"; total: number | null; active: number | null; items: Array<{ id: string; name: string; status: "active" | "paused"; nextRunAt: string | null }> };
  email: { state: "unavailable"; reason: "no-native-email-sync" };
  finance: Finance;
  activity: Activity;
  plan: PlanSummary;
  mode: { permissions: string | null; inference: string | null };
  setup: { steps: Array<{ key: SetupKey; done: boolean }> };
  attention: Attention;
}
export type AttentionItem = {
  id: string;
  kind: "question" | "approval" | "decision" | "failure";
  agentName: string | null;
  title: string;
  body: string | null;
  threadId: string | null;
  /** The ask to answer through POST /api/collaboration/runs/{runId}/approval. */
  approvalId: string | null;
  runId: string | null;
  choices: Array<{ value: string; label: string }> | null;
  at: string | null;
};
type Attention = { state: "ready" | "empty" | "error"; items: AttentionItem[] };
type Activity = {
  state: "ready" | "empty" | "error";
  tokensToday: number | null; tokensMonth: number | null; monthComplete: boolean;
  runsToday: number | null; running: number | null; queued: number | null;
  current: { title: string; threadId: string | null } | null;
  lastFailure: { title: string; at: string; threadId: string | null } | null;
};
type PlanSummary = {
  state: "ready" | "empty" | "error";
  label: string | null; provider: string | null; status: string | null;
  usedPct: number | null; window: string | null; resetsAt: string | null;
};
type SetupKey = "plan" | "company" | "team" | "routines" | "firstTask";
/** The run fields the dashboard reads. `runs()` answers newest first. */
export type DashboardRun = { id?: string; error?: unknown; threadId: string; botId: string; state: string; startedAt: string; endedAt?: string;
  task?: { objective?: unknown } | null; usage?: { inputTokens?: unknown; outputTokens?: unknown } | null };
export type DashboardPlan = { id: string; provider: string; label: string; status: string;
  quota?: { window?: unknown; usedPct?: unknown; resetsAt?: unknown } | null;
  usage?: { windows?: ReadonlyArray<{ label?: unknown; usedPct?: unknown; resetsAt?: unknown }> } | null };
export type DashboardSettings = { permissions?: unknown; activePlanId?: unknown; inferenceProviderId?: unknown };
export type DashboardAsk = { askId: string; requestType: string; summary: string; choices?: ReadonlyArray<{ value: string; label: string }>; createdAt?: string };
export type DashboardProvider = { id: string; kind: string; label: string };
export interface DashboardInputs {
  workspaceId: string;
  binding: () => Binding | null;
  bots: () => Promise<ReadonlyArray<{ id: string; name: string; archived: boolean; status: string }>>;
  routines: () => Promise<ReadonlyArray<{ id: string; name: string; status: string; next_run_at: string | null }>>;
  /** Newest first, at most `runLimit` rows. Absent means unknown, never zero. */
  runs?: () => Promise<ReadonlyArray<DashboardRun>>;
  runLimit?: number;
  /** Internal `bot:…`/`chat:…`/`group:…` id to the id the collaboration API serves. */
  publicThreadId?: (threadId: string) => string | null;
  plans?: () => Promise<ReadonlyArray<DashboardPlan>>;
  providers?: () => Promise<ReadonlyArray<DashboardProvider>>;
  settings?: () => Promise<DashboardSettings | null>;
  /** Internal run id to the id the collaboration API serves. */
  publicRunId?: (runId: string) => string | null;
  /** The pending ask blocks of a run, read from its thread. */
  pendingAsks?: (run: DashboardRun) => Promise<ReadonlyArray<DashboardAsk>>;
  now?: () => Date;
}

const EMPTY_BUSINESS: Business = { state: "unavailable", source: null, updatedAt: null, metrics: [], items: [] };
const EMPTY_FINANCE: Finance = { state: "unavailable", source: null, currency: null, period: "all-recorded", revenue: null, adSpend: null, orders: null, updatedAt: null };
const PREVIEW_LIMIT = 8;
const DB_LIMIT = 20_000_000;
const LOG_LIMIT = 10_000_000;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CURRENCIES = new Set(["EUR", "USD", "GBP", "CHF", "CAD"]);
const CLIENT_STATUSES = new Set(["prospect", "onboarding", "actif", "pause", "termine"]);
const CAMPAIGN_STATUSES = new Set(["draft", "ready", "active", "paused", "done"]);
const COMMERCE_TASK_STATUSES = new Set(["todo", "doing", "done", "blocked"]);
const PRODUCT_STATUSES = new Set(["idea", "researching", "validated", "rejected", "launched"]);
const CLAIM_STATUSES = new Set(["CLAIMED", "IN-PROGRESS", "PR-REVIEW", "PUSHED-PROD", "DONE", "RELEASED"]);
const DECISION_STATUSES = new Set(["PENDING", "DECIDED", "IN-PROGRESS", "DONE", "WAITING", "REJECTED"]);
const RUN_OUTCOMES = new Set(["PASSED", "FAILED", "INCOMPLETE"]);

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max = 160): string { return typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : ""; }
function date(value: unknown): string | null { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; }
function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function newest(rows: ReadonlyArray<Record<string, unknown>>): string | null {
  return rows.map((row) => date(row.updatedAt) ?? date(row.at) ?? date(row.date)).filter((value): value is string => value !== null).sort().at(-1) ?? null;
}
function metric(key: string, label: string, value: number): Metric { return { key, label, value }; }
function idsAndRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => !record(row) || typeof row.id !== "string" || !ID.test(row.id))) throw new Error("invalid collection");
  if (new Set(value.map((row) => row.id)).size !== value.length) throw new Error("duplicate collection id");
  return value;
}

/** Fixed segments only. Check every directory and use O_NOFOLLOW on the file
 * so a symlink, including a swapped final link, cannot escape the binding. */
function fixedFile(root: string, segments: readonly string[], limit: number): string | null {
  const directories: string[] = [];
  let current = root;
  for (const segment of ["", ...segments.slice(0, -1)]) {
    if (segment) current = join(current, segment);
    directories.push(current);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe source directory");
  }
  const target = join(current, segments.at(-1)!);
  let fd: number;
  try { fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error("invalid source file");
    // Revalidate the opened inode against a canonical path in the bound
    // vault. O_NOFOLLOW protects the final file; these checks also detect an
    // intermediate directory replaced while the file was being opened.
    const assertBoundFile = () => {
      for (const directory of directories) {
        const entry = lstatSync(directory);
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("unsafe source directory");
      }
      if (realpathSync(target) !== join(realpathSync(root), ...segments)) throw new Error("source escaped bound vault");
      const currentFile = statSync(target);
      if (!currentFile.isFile() || currentFile.dev !== stat.dev || currentFile.ino !== stat.ino) throw new Error("source changed during read");
      for (const directory of directories) {
        const entry = lstatSync(directory);
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("unsafe source directory");
      }
    };
    assertBoundFile();
    const chunks: Buffer[] = [];
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let size = 0, bytes = 0;
    while ((bytes = readSync(fd, chunk, 0, Math.min(chunk.length, limit + 1 - size), null)) > 0) {
      size += bytes;
      if (size > limit) throw new Error("source file too large");
      chunks.push(Buffer.from(chunk.subarray(0, bytes)));
    }
    assertBoundFile();
    return Buffer.concat(chunks).toString("utf8");
  } finally { closeSync(fd); }
}
function fixedJson(root: string, segments: readonly string[], limit = DB_LIMIT): Record<string, unknown> | null {
  const raw = fixedFile(root, segments, limit);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed) || parsed.version !== 1) throw new Error("invalid source data");
  return parsed;
}
function fixedJsonl(root: string, name: "claims" | "decisions" | "runs"): Record<string, unknown>[] | null {
  const raw = fixedFile(root, ["state", `${name}.jsonl`], LOG_LIMIT);
  if (raw === null) return null;
  return raw.split("\n").filter((line) => line.trim()).map((line) => {
    const value: unknown = JSON.parse(line);
    if (!record(value)) throw new Error("invalid ops row");
    return value;
  });
}
function item(row: Record<string, unknown>, titleKey: string, status: string): Item {
  return { id: text(row.id, 128), title: text(row[titleKey], 160), status, updatedAt: date(row.updatedAt) ?? date(row.at) };
}
function recent(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => String(b.updatedAt ?? b.at ?? "").localeCompare(String(a.updatedAt ?? a.at ?? "")));
}
function latest(rows: Record<string, unknown>[], key: string): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  const revisions = new Set<string>();
  for (const row of rows) {
    const id = row[key] as string;
    const revisionKey = `${id}\u0000${row.revision}`;
    if (revisions.has(revisionKey)) throw new Error("duplicate ops revision");
    revisions.add(revisionKey);
    const previous = byKey.get(id);
    if (!previous || (row.revision as number) > (previous.revision as number)) byKey.set(id, row);
  }
  return [...byKey.values()];
}
function agency(root: string): Business {
  const db = fixedJson(root, ["Apps", "LeadFactory", "data", "db.json"]);
  if (!db) return EMPTY_BUSINESS;
  const clients = idsAndRows(db.clients), campaigns = idsAndRows(db.campaigns), tasks = idsAndRows(db.tasks), deliverables = idsAndRows(db.deliverables);
  if (tasks.some((row) => typeof row.title !== "string" || typeof row.done !== "boolean" || typeof row.clientId !== "string") ||
      clients.some((row) => !CLIENT_STATUSES.has(row.status as string) || typeof row.company !== "string") ||
      campaigns.some((row) => !CAMPAIGN_STATUSES.has(row.status as string) || typeof row.name !== "string" || typeof row.clientId !== "string")) throw new Error("invalid agency rows");
  const open = tasks.filter((row) => !row.done);
  return { state: clients.length || campaigns.length || tasks.length || deliverables.length ? "ready" : "empty", source: "agency-cockpit",
    updatedAt: newest([...clients, ...campaigns, ...tasks, ...deliverables]),
    metrics: [metric("clients", "Clients", clients.length), metric("activeClients", "Clients actifs", clients.filter((row) => row.status === "actif").length),
      metric("campaigns", "Campagnes", campaigns.length), metric("activeCampaigns", "Campagnes actives déclarées", campaigns.filter((row) => row.status === "active").length),
      metric("openTasks", "Tâches ouvertes", open.length), metric("completedTasks", "Tâches terminées", tasks.length - open.length), metric("deliverables", "Livrables", deliverables.length)],
    items: [...recent(open).map((row) => item(row, "title", "open")),
      ...recent(tasks.filter((row) => row.done)).map((row) => item(row, "title", "done"))].slice(0, PREVIEW_LIMIT) };
}
function ecommerce(root: string): { business: Business; finance: Finance } {
  const db = fixedJson(root, ["Apps", "Ecommerce", "data", "db.json"]);
  if (!db) return { business: EMPTY_BUSINESS, finance: EMPTY_FINANCE };
  const products = idsAndRows(db.products), campaigns = idsAndRows(db.campaigns), tasks = idsAndRows(db.tasks);
  if (products.some((row) => typeof row.name !== "string" || !PRODUCT_STATUSES.has(row.status as string)) ||
      campaigns.some((row) => typeof row.name !== "string" || !CAMPAIGN_STATUSES.has(row.status as string)) ||
      tasks.some((row) => typeof row.title !== "string" || !COMMERCE_TASK_STATUSES.has(row.status as string))) throw new Error("invalid ecommerce rows");
  const open = tasks.filter((row) => row.status !== "done");
  const business: Business = { state: products.length || campaigns.length || tasks.length ? "ready" : "empty", source: "ecommerce-cockpit",
    updatedAt: newest([...products, ...campaigns, ...tasks]),
    metrics: [metric("products", "Produits", products.length), metric("campaigns", "Campagnes", campaigns.length), metric("openTasks", "Tâches ouvertes", open.length), metric("completedTasks", "Tâches terminées", tasks.length - open.length)],
    items: [...recent(open.filter((row) => row.status === "blocked")), ...recent(open.filter((row) => row.status !== "blocked")),
      ...recent(tasks.filter((row) => row.status === "done"))].slice(0, PREVIEW_LIMIT).map((row) => item(row, "title", text(row.status, 40))) };
  try {
    const metrics = idsAndRows(db.metrics);
    if (!record(db.profile) || !CURRENCIES.has(db.profile.currency as string)) throw new Error("invalid ecommerce currency");
    const currency = db.profile.currency as string;
    if (!metrics.length) return { business, finance: { ...EMPTY_FINANCE, state: "empty", source: "manual-ecommerce", currency } };
    let revenue = 0, adSpend = 0, orders = 0;
    for (const row of metrics) {
      if (row.source !== "manual" || !calendarDate(row.date) ||
          ![row.revenue, row.spend].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000) ||
          ![row.orders, row.returns].every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000)) throw new Error("invalid manual metric");
      revenue += row.revenue as number; adSpend += row.spend as number; orders += row.orders as number;
    }
    if (![revenue, adSpend, orders].every((value) => Number.isSafeInteger(Math.round(value * 100)))) throw new Error("manual metric total too large");
    return { business, finance: { state: "ready", source: "manual-ecommerce", currency, period: "all-recorded",
      revenue: Math.round(revenue * 100) / 100, adSpend: Math.round(adSpend * 100) / 100, orders, updatedAt: newest(metrics) } };
  } catch {
    return { business, finance: { ...EMPTY_FINANCE, state: "error" } };
  }
}
function validOpsRow(row: Record<string, unknown>, kind: "claim" | "decision" | "run"): boolean {
  if (row.kind !== kind || typeof row.id !== "string" || !ID.test(row.id) || !date(row.at)) return false;
  if (kind === "claim") return Number.isInteger(row.revision) && (row.revision as number) >= 1 && typeof row.scope === "string" &&
    typeof row.normalizedScope === "string" && typeof row.owner === "string" && typeof row.run === "string" && CLAIM_STATUSES.has(row.status as string);
  if (kind === "decision") return Number.isInteger(row.revision) && (row.revision as number) >= 1 && typeof row.subject === "string" &&
    typeof row.normalizedSubject === "string" && typeof row.by === "string" && DECISION_STATUSES.has(row.status as string) &&
    (typeof row.value === "string" || record(row.value));
  return typeof row.agent === "string" && typeof row.run === "string" && typeof row.trigger === "string" &&
    Array.isArray(row.actions) && row.actions.every((action) => typeof action === "string") && typeof row.result === "string" &&
    RUN_OUTCOMES.has(row.outcome as string) && record(row.evidence) && typeof row.evidence.path === "string" &&
    typeof row.evidence.sha256 === "string" && typeof row.cost === "string" && typeof row.next === "string";
}
type PendingDecision = { id: string; subject: string; by: string; at: string | null };
function operations(root: string): Business & { decisions?: PendingDecision[] } {
  const claims = fixedJsonl(root, "claims"), decisions = fixedJsonl(root, "decisions"), runs = fixedJsonl(root, "runs");
  if (!claims || !decisions || !runs) return EMPTY_BUSINESS;
  if (claims.some((row) => !validOpsRow(row, "claim")) || decisions.some((row) => !validOpsRow(row, "decision")) || runs.some((row) => !validOpsRow(row, "run"))) throw new Error("invalid ops rows");
  if (new Set(runs.map((row) => row.id)).size !== runs.length) throw new Error("duplicate ops run");
  const finalClaims = latest(claims, "id"), finalDecisions = latest(decisions, "normalizedSubject");
  const active = finalClaims.filter((row) => ["CLAIMED", "IN-PROGRESS", "PR-REVIEW", "PUSHED-PROD"].includes(row.status as string));
  const pending = finalDecisions.filter((row) => row.status === "PENDING" || row.status === "WAITING");
  return { decisions: recent(pending).map((row) => ({ id: text(row.id, 128), subject: text(row.subject, 160), by: text(row.by, 80), at: date(row.updatedAt) ?? date(row.at) })),
    state: claims.length || decisions.length || runs.length ? "ready" : "empty", source: "ops-jsonl", updatedAt: newest([...claims, ...decisions, ...runs]),
    metrics: [metric("activeClaims", "Chantiers actifs", active.length), metric("completedClaims", "Chantiers terminés", finalClaims.filter((row) => row.status === "DONE").length),
      metric("pendingDecisions", "Décisions en attente", pending.length), metric("recordedReports", "Rapports enregistrés", runs.length),
      metric("failedReports", "Rapports en échec", runs.filter((row) => row.outcome === "FAILED").length)],
    items: [...recent(pending).map((row) => item(row, "subject", text(row.status, 40))),
      ...recent(active).map((row) => item(row, "scope", text(row.status, 40))),
      ...recent(finalClaims.filter((row) => row.status === "DONE")).map((row) => item(row, "scope", "DONE")),
      ...recent(runs).map((row) => ({ id: text(row.id, 128), title: "Rapport enregistré", status: text(row.outcome, 40), updatedAt: date(row.at) }))]
      .slice(0, PREVIEW_LIMIT) };
}

export async function readLocalDashboardSummary(input: DashboardInputs): Promise<LocalDashboardSummary> {
  const current = input.binding();
  const start = current ? { ...current } : null;
  const missing = () => Promise.reject(new Error("source not wired"));
  const [botResult, routineResult, runResult, planResult, providerResult, settingsResult] = await Promise.allSettled([
    input.bots(), input.routines(), input.runs ? input.runs() : missing(), input.plans ? input.plans() : missing(),
    input.providers ? input.providers() : missing(), input.settings ? input.settings() : missing()]);
  const same = (binding: Binding | null) => JSON.stringify(binding) === JSON.stringify(start);
  if (!same(input.binding())) throw new Error("Workspace binding changed during dashboard read");
  let business = EMPTY_BUSINESS, finance = EMPTY_FINANCE;
  let decisions: PendingDecision[] = [];
  if (start) {
    try {
      if (start.templateId === "lead-gen-agency") business = agency(start.path);
      else if (start.templateId === "ecommerce") ({ business, finance } = ecommerce(start.path));
      else if (start.templateId === "software" || start.templateId === "service-based-business") {
        const { decisions: pending, ...ops } = operations(start.path);
        business = ops; decisions = pending ?? [];
      }
    } catch {
      business = { ...EMPTY_BUSINESS, state: "error" };
      if (start.templateId === "ecommerce") finance = { ...EMPTY_FINANCE, state: "error" };
    }
  }
  if (!same(input.binding())) throw new Error("Workspace binding changed during dashboard read");
  const agents: LocalDashboardSummary["agents"] = botResult.status === "fulfilled" &&
    botResult.value.every((bot) => typeof bot.id === "string" && ID.test(bot.id) && typeof bot.name === "string" &&
      typeof bot.archived === "boolean" && ["idle", "working", "waiting"].includes(bot.status)) ? (() => {
    const rows = botResult.value.filter((bot) => !bot.archived);
    return { state: rows.length ? "ready" : "empty", total: rows.length, working: rows.filter((bot) => bot.status === "working").length,
      waiting: rows.filter((bot) => bot.status === "waiting").length,
      items: rows.slice(0, PREVIEW_LIMIT).map((bot) => ({ id: text(bot.id, 128), name: text(bot.name), status: bot.status as "idle" | "working" | "waiting", threadId: null as string | null, task: null as string | null })) };
  })() : { state: "error", total: null, working: null, waiting: null, items: [] };
  const routines: LocalDashboardSummary["routines"] = routineResult.status === "fulfilled" &&
    routineResult.value.every((routine) => typeof routine.id === "string" && ID.test(routine.id) && typeof routine.name === "string" &&
      ["active", "paused"].includes(routine.status) && (routine.next_run_at === null || date(routine.next_run_at) !== null)) ? (() => {
    const rows = routineResult.value;
    return { state: rows.length ? "ready" : "empty", total: rows.length, active: rows.filter((routine) => routine.status === "active").length,
      items: rows.slice(0, PREVIEW_LIMIT).map((routine) => ({ id: text(routine.id, 128), name: text(routine.name), status: routine.status as "active" | "paused", nextRunAt: routine.next_run_at })) };
  })() : { state: "error", total: null, active: null, items: [] };
  const now = input.now ? input.now() : new Date();
  const botNames = new Map(agents.state === "error" ? [] : (botResult.status === "fulfilled" ? botResult.value : []).map((bot) => [bot.id, text(bot.name)] as const));
  const runs = runResult.status === "fulfilled" && Array.isArray(runResult.value) && runResult.value.every(validRun) ? runResult.value : null;
  const activity = runs ? activityOf(runs, input.runLimit ?? 200, now, botNames, input.publicThreadId ?? (() => null)) : EMPTY_ACTIVITY;
  const settings = settingsResult.status === "fulfilled" && record(settingsResult.value) ? settingsResult.value as DashboardSettings : null;
  const plans = planResult.status === "fulfilled" && Array.isArray(planResult.value) && planResult.value.every(validPlan) ? planResult.value : null;
  const providers = providerResult.status === "fulfilled" && Array.isArray(providerResult.value) && providerResult.value.every(validProvider) ? providerResult.value : null;
  const activeProvider = settings && typeof settings.inferenceProviderId === "string" && providers
    ? providers.find((row) => row.id === settings.inferenceProviderId) ?? null : null;
  const plan = plans && providers && settings ? planOf(plans, activeProvider, settings) : EMPTY_PLAN;
  const mode = {
    permissions: settings ? (settings.permissions === "skip-all" ? "skip-all" : settings.permissions === undefined || settings.permissions === "ask" ? "ask" : null) : null,
    inference: settings ? (settings.inferenceProviderId == null ? "plan" : activeProvider ? text(activeProvider.kind, 40) || null : null) : null,
  };
  const steps: Array<{ key: SetupKey; done: boolean }> = [
    { key: "plan", done: Boolean((plans ?? []).some((row) => row.status === "connected") || (providers ?? []).length > 0) },
    { key: "company", done: start !== null },
    { key: "team", done: (agents.total ?? 0) > 1 },
    { key: "routines", done: (routines.active ?? 0) > 0 },
    { key: "firstTask", done: Boolean(runs?.some((run) => run.state === "completed")) },
  ];
  const publicThread = (threadId: string) => { try { return input.publicThreadId ? input.publicThreadId(threadId) : null; } catch { return null; } };
  const publicRun = (runId: string | undefined) => { try { return runId && input.publicRunId ? input.publicRunId(runId) : null; } catch { return null; } };
  const objective = (run: DashboardRun) => text(run.task?.objective, 160) || null;
  const newestFirst = (rows: ReadonlyArray<DashboardRun>) => [...rows].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  for (const agent of agents.items) {
    agent.threadId = publicThread(`bot:${agent.id}`);
    if (agent.status !== "idle" && runs) {
      const live = newestFirst(runs.filter((run) => run.botId === agent.id && (run.state === "working" || run.state === "waiting_input")))[0];
      agent.task = live ? objective(live) : null;
    }
  }
  const attention = await attentionOf({ runs, decisions, now, botNames, bots: botResult.status === "fulfilled" ? botResult.value : [],
    publicThread, publicRun, objective, pendingAsks: input.pendingAsks, businessOk: business.state !== "error" });
  return { version: 1, workspaceId: input.workspaceId, templateId: start?.templateId ?? null, generatedAt: now.toISOString(),
    business, agents, routines, email: { state: "unavailable", reason: "no-native-email-sync" }, finance,
    activity, plan, mode, setup: { steps }, attention };
}

const EMPTY_ACTIVITY: Activity = { state: "error", tokensToday: null, tokensMonth: null, monthComplete: false,
  runsToday: null, running: null, queued: null, current: null, lastFailure: null };
const EMPTY_PLAN: PlanSummary = { state: "error", label: null, provider: null, status: null, usedPct: null, window: null, resetsAt: null };
const RUN_STATES = new Set(["queued", "working", "waiting_input", "completed", "failed", "cancelled"]);

function validRun(value: unknown): value is DashboardRun {
  return record(value) && typeof value.threadId === "string" && typeof value.botId === "string" &&
    typeof value.state === "string" && RUN_STATES.has(value.state) && date(value.startedAt) !== null &&
    (value.endedAt === undefined || date(value.endedAt) !== null);
}
function validPlan(value: unknown): value is DashboardPlan {
  return record(value) && typeof value.id === "string" && typeof value.provider === "string" &&
    typeof value.label === "string" && typeof value.status === "string";
}
function validProvider(value: unknown): value is DashboardProvider {
  return record(value) && typeof value.id === "string" && typeof value.kind === "string" && typeof value.label === "string";
}
function tokens(run: DashboardRun): number {
  const input = count(run.usage?.inputTokens), output = count(run.usage?.outputTokens);
  return (input ?? 0) + (output ?? 0);
}
function count(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function percent(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null; }
/** A plan label is shown as a name; one that is an e-mail address is not. */
function safeLabel(value: unknown): string | null { const label = text(value, 80); return label && !label.includes("@") ? label : null; }

function activityOf(runs: ReadonlyArray<DashboardRun>, limit: number, now: Date, botNames: ReadonlyMap<string, string>,
  publicThreadId: (threadId: string) => string | null): Activity {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const started = (run: DashboardRun) => Date.parse(run.startedAt);
  // The history keeps the newest `limit` runs. When it is full, anything
  // older than its oldest row may have been dropped.
  const oldest = runs.length ? Math.min(...runs.map(started)) : Number.POSITIVE_INFINITY;
  const full = runs.length >= limit;
  const covers = (from: number) => !full || oldest < from;
  const today = runs.filter((run) => started(run) >= dayStart);
  const month = runs.filter((run) => started(run) >= monthStart);
  const title = (run: DashboardRun) => text(run.task?.objective, 160) || botNames.get(run.botId) || "";
  const thread = (run: DashboardRun) => { try { return publicThreadId(run.threadId); } catch { return null; } };
  const live = runs.filter((run) => run.state === "working" || run.state === "waiting_input");
  const newest = (rows: DashboardRun[]) => [...rows].sort((a, b) => started(b) - started(a))[0];
  const current = newest(live) ?? newest(runs.filter((run) => run.state === "queued"));
  const failed = newest(runs.filter((run) => run.state === "failed" && Date.parse(run.endedAt ?? run.startedAt) >= now.getTime() - 86_400_000));
  return {
    state: runs.length ? "ready" : "empty",
    tokensToday: covers(dayStart) ? today.reduce((sum, run) => sum + tokens(run), 0) : null,
    tokensMonth: month.reduce((sum, run) => sum + tokens(run), 0),
    monthComplete: covers(monthStart),
    runsToday: covers(dayStart) ? today.length : null,
    running: live.length,
    queued: runs.filter((run) => run.state === "queued").length,
    current: current ? { title: title(current), threadId: thread(current) } : null,
    lastFailure: failed ? { title: title(failed), at: failed.endedAt ?? failed.startedAt, threadId: thread(failed) } : null,
  };
}

function planOf(plans: ReadonlyArray<DashboardPlan>, provider: DashboardProvider | null, settings: DashboardSettings): PlanSummary {
  if (provider) return { state: "ready", label: safeLabel(provider.label), provider: text(provider.kind, 40) || null,
    status: "connected", usedPct: null, window: null, resetsAt: null };
  const active = plans.find((row) => row.id === settings.activePlanId) ?? plans.find((row) => row.status === "connected") ?? plans[0];
  if (!active) return { ...EMPTY_PLAN, state: "empty" };
  const windows = (Array.isArray(active.usage?.windows) ? active.usage.windows : [])
    .map((row) => ({ label: text(row.label, 40) || null, usedPct: percent(row.usedPct), resetsAt: date(row.resetsAt) }))
    .filter((row) => row.usedPct !== null)
    .sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0));
  const top = windows[0];
  const quota = active.quota && percent(active.quota.usedPct) !== null
    ? { label: text(active.quota.window, 20) || null, usedPct: percent(active.quota.usedPct), resetsAt: date(active.quota.resetsAt) } : null;
  const usage = top ?? quota;
  return { state: "ready", label: safeLabel(active.label), provider: text(active.provider, 40) || null, status: text(active.status, 40) || null,
    usedPct: usage?.usedPct ?? null, window: usage?.label ?? null, resetsAt: usage?.resetsAt ?? null };
}

const ATTENTION_LIMIT = 5;
async function attentionOf(input: {
  runs: ReadonlyArray<DashboardRun> | null; decisions: PendingDecision[]; now: Date; botNames: ReadonlyMap<string, string>;
  bots: ReadonlyArray<{ id: string; name: string; archived: boolean }>;
  publicThread: (threadId: string) => string | null; publicRun: (runId: string | undefined) => string | null;
  objective: (run: DashboardRun) => string | null;
  pendingAsks?: (run: DashboardRun) => Promise<ReadonlyArray<DashboardAsk>>; businessOk: boolean;
}): Promise<Attention> {
  if (!input.runs || !input.pendingAsks || !input.businessOk) return { state: "error", items: [] };
  const items: AttentionItem[] = [];
  const waiting = input.runs.filter((run) => run.state === "waiting_input");
  const asked = await Promise.allSettled(waiting.map((run) => input.pendingAsks!(run)));
  if (asked.some((result) => result.status === "rejected")) return { state: "error", items: [] };
  waiting.forEach((run, index) => {
    const result = asked[index];
    if (!result || result.status !== "fulfilled") return;
    for (const ask of result.value) {
      if (typeof ask.askId !== "string" || !ask.askId) continue;
      const question = ask.requestType === "question";
      items.push({ id: `ask:${text(ask.askId, 64)}`, kind: question ? "question" : "approval",
        agentName: input.botNames.get(run.botId) || null,
        title: input.objective(run) ?? input.botNames.get(run.botId) ?? "",
        body: text(ask.summary, 280) || null, threadId: input.publicThread(run.threadId),
        approvalId: text(ask.askId, 64), runId: input.publicRun(run.id),
        choices: Array.isArray(ask.choices) && ask.choices.length
          ? ask.choices.filter((choice) => typeof choice?.value === "string" && typeof choice?.label === "string")
            .map((choice) => ({ value: text(choice.value, 80), label: text(choice.label, 80) })) : null,
        at: date(ask.createdAt) ?? run.startedAt });
    }
  });
  const live = input.bots.filter((bot) => !bot.archived);
  const ceo = live.find((bot) => bot.name.trim().toLowerCase() === "ceo");
  for (const decision of input.decisions) {
    const owner = live.find((bot) => bot.name.trim().toLowerCase() === decision.by.trim().toLowerCase() || bot.id === decision.by) ?? null;
    const thread = owner ?? ceo ?? null;
    items.push({ id: `decision:${decision.id}`, kind: "decision", agentName: owner ? text(owner.name) : null,
      title: decision.subject, body: null, threadId: thread ? input.publicThread(`bot:${thread.id}`) : null,
      approvalId: null, runId: null, choices: null, at: decision.at });
  }
  const since = input.now.getTime() - 86_400_000;
  for (const run of input.runs) {
    const ended = Date.parse(run.endedAt ?? run.startedAt);
    if (run.state !== "failed" || ended < since) continue;
    items.push({ id: `failure:${text(run.id ?? `${run.botId}-${run.startedAt}`, 128)}`, kind: "failure",
      agentName: input.botNames.get(run.botId) || null, title: input.objective(run) ?? input.botNames.get(run.botId) ?? "",
      body: text(run.error, 280) || null, threadId: input.publicThread(run.threadId), approvalId: null,
      runId: input.publicRun(run.id), choices: null, at: run.endedAt ?? run.startedAt });
  }
  const rank = { question: 0, approval: 0, decision: 1, failure: 2 } as const;
  items.sort((a, b) => rank[a.kind] - rank[b.kind] || String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const top = items.slice(0, ATTENTION_LIMIT);
  return { state: top.length ? "ready" : "empty", items: top };
}
