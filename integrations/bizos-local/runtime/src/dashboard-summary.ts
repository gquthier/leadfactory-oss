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
  agents: { state: "ready" | "empty" | "error"; total: number | null; working: number | null; items: Array<{ id: string; name: string; status: "idle" | "working" | "waiting" }> };
  routines: { state: "ready" | "empty" | "error"; total: number | null; active: number | null; items: Array<{ id: string; name: string; status: "active" | "paused"; nextRunAt: string | null }> };
  email: { state: "unavailable"; reason: "no-native-email-sync" };
  finance: Finance;
}
export interface DashboardInputs {
  workspaceId: string;
  binding: () => Binding | null;
  bots: () => Promise<ReadonlyArray<{ id: string; name: string; archived: boolean; status: string }>>;
  routines: () => Promise<ReadonlyArray<{ id: string; name: string; status: string; next_run_at: string | null }>>;
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
function operations(root: string): Business {
  const claims = fixedJsonl(root, "claims"), decisions = fixedJsonl(root, "decisions"), runs = fixedJsonl(root, "runs");
  if (!claims || !decisions || !runs) return EMPTY_BUSINESS;
  if (claims.some((row) => !validOpsRow(row, "claim")) || decisions.some((row) => !validOpsRow(row, "decision")) || runs.some((row) => !validOpsRow(row, "run"))) throw new Error("invalid ops rows");
  if (new Set(runs.map((row) => row.id)).size !== runs.length) throw new Error("duplicate ops run");
  const finalClaims = latest(claims, "id"), finalDecisions = latest(decisions, "normalizedSubject");
  const active = finalClaims.filter((row) => ["CLAIMED", "IN-PROGRESS", "PR-REVIEW", "PUSHED-PROD"].includes(row.status as string));
  const pending = finalDecisions.filter((row) => row.status === "PENDING" || row.status === "WAITING");
  return { state: claims.length || decisions.length || runs.length ? "ready" : "empty", source: "ops-jsonl", updatedAt: newest([...claims, ...decisions, ...runs]),
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
  const [botResult, routineResult] = await Promise.allSettled([input.bots(), input.routines()]);
  const same = (binding: Binding | null) => JSON.stringify(binding) === JSON.stringify(start);
  if (!same(input.binding())) throw new Error("Workspace binding changed during dashboard read");
  let business = EMPTY_BUSINESS, finance = EMPTY_FINANCE;
  if (start) {
    try {
      if (start.templateId === "lead-gen-agency") business = agency(start.path);
      else if (start.templateId === "ecommerce") ({ business, finance } = ecommerce(start.path));
      else if (start.templateId === "software" || start.templateId === "service-based-business") business = operations(start.path);
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
      items: rows.slice(0, PREVIEW_LIMIT).map((bot) => ({ id: text(bot.id, 128), name: text(bot.name), status: bot.status as "idle" | "working" | "waiting" })) };
  })() : { state: "error", total: null, working: null, items: [] };
  const routines: LocalDashboardSummary["routines"] = routineResult.status === "fulfilled" &&
    routineResult.value.every((routine) => typeof routine.id === "string" && ID.test(routine.id) && typeof routine.name === "string" &&
      ["active", "paused"].includes(routine.status) && (routine.next_run_at === null || date(routine.next_run_at) !== null)) ? (() => {
    const rows = routineResult.value;
    return { state: rows.length ? "ready" : "empty", total: rows.length, active: rows.filter((routine) => routine.status === "active").length,
      items: rows.slice(0, PREVIEW_LIMIT).map((routine) => ({ id: text(routine.id, 128), name: text(routine.name), status: routine.status as "active" | "paused", nextRunAt: routine.next_run_at })) };
  })() : { state: "error", total: null, active: null, items: [] };
  return { version: 1, workspaceId: input.workspaceId, templateId: start?.templateId ?? null, generatedAt: new Date().toISOString(),
    business, agents, routines, email: { state: "unavailable", reason: "no-native-email-sync" }, finance };
}
