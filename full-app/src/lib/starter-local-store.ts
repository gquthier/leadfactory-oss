import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createQueryClient, LOCAL_ADMIN_ID, QUERY_METHODS } from "./starter-local-client";
import type { LocalQuery, LocalResult } from "./starter-local-client";
export { LOCAL_ADMIN_ID } from "./starter-local-client";

type Row = Record<string, any>;
export type LocalDatabase = { version: 1; tables: Record<string, Row[]> };
export type StoreOptions = { dataDir?: string };
export const LOCAL_TABLES = ["profiles", "campaigns", "campaign_team_members", "team_member_client_rates", "onboarding_responses", "client_tasks", "client_notes", "activity_logs", "ai_deliverables", "client_calls", "client_credits", "client_finance_profiles", "client_formation_access", "client_formation_progress", "client_notifications", "client_surprises", "credit_usage", "crm_ad_spend_daily", "crm_leads", "finance_entries", "formation_modules", "formations", "lead_activities", "leads", "linkedin_conversations", "linkedin_posts", "pipeline_stages", "reels_conversations", "reels_scripts", "sales_call_analyses", "scheduled_posts", "scrape_jobs", "sequence_conversations", "sequence_emails", "surprise_assets", "team_notifications", "team_resource_assignments", "team_resources"];
const tableSet = new Set(LOCAL_TABLES);
const globalState = globalThis as typeof globalThis & { __leadfactoryLocalQueues?: Map<string, Promise<unknown>> };
const queues = globalState.__leadfactoryLocalQueues ||= new Map();
const now = () => new Date().toISOString();

export function rejectSecrets(value: unknown, depth = 0): void {
  if (depth > 30) throw new Error("Données trop imbriquées");
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/password|secret|(?:^|_)token(?:$|_)|api_?key|credential|authorization|__proto__|constructor|prototype/i.test(key)) throw new Error("Les secrets et identifiants de connexion ne sont pas stockés dans le starter.");
    rejectSecrets(entry, depth + 1);
  }
}

function freshDatabase(): LocalDatabase {
  const tables: Record<string, Row[]> = Object.fromEntries(LOCAL_TABLES.map(name => [name, []]));
  tables.profiles.push({ id: LOCAL_ADMIN_ID, email: "owner@example.invalid", full_name: "Administrateur local", company: "Mon agence", role: "admin", is_super_admin: true, is_active: true, team_role: "super_admin", team_status: "active", created_at: now(), updated_at: now() });
  return { version: 1, tables };
}

async function load(path: string): Promise<LocalDatabase> {
  try {
    const db = JSON.parse(await readFile(path, "utf8"));
    if (db.version !== 1 || !db.tables || LOCAL_TABLES.some(name => !Array.isArray(db.tables[name]))) throw new Error("Format du fichier local invalide");
    rejectSecrets(db); return db;
  } catch (error: any) { if (error.code === "ENOENT") return freshDatabase(); throw error; }
}

/** One Next server process, serialized per absolute data directory; fsync+rename commits atomically. */
export async function localTransaction<T>(mutator: (db: LocalDatabase) => T | Promise<T>, options: StoreOptions = {}, write = true): Promise<T> {
  const dir = resolve(options.dataDir || process.env.LEADFACTORY_STARTER_DATA_DIR || join(process.cwd(), ".local-data"));
  const previous = queues.get(dir) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const file = join(dir, "db.json");
    const db = await load(file);
    const result = await mutator(db);
    if (write) {
      rejectSecrets(db);
      const serialized = JSON.stringify(db, null, 2);
      if (Buffer.byteLength(serialized) > 25_000_000) throw new Error("Limite locale de 25 Mo atteinte");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temporary = join(dir, `.db-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
      } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    }
    return structuredClone(result);
  });
  queues.set(dir, task);
  try { return await task; } finally { if (queues.get(dir) === task) queues.delete(dir); }
}

function splitColumns(input: string): string[] {
  let depth = 0, start = 0; const pieces: string[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "(") depth++; else if (input[i] === ")") depth--;
    else if (input[i] === "," && depth === 0) { pieces.push(input.slice(start, i).trim()); start = i + 1; }
  }
  pieces.push(input.slice(start).trim()); return pieces.filter(Boolean);
}

function project(db: LocalDatabase, table: string, row: Row, columns: string, depth = 0): Row {
  if (depth > 4) throw new Error("Relations trop imbriquées");
  const output: Row = {};
  for (const col of splitColumns(columns)) {
    if (col === "*") { Object.assign(output, row); continue; }
    const match = col.match(/^([^()]+)\((.*)\)$/s);
    if (!match) { const [alias, field] = col.split(":"); output[alias] = row[field || alias] ?? null; continue; }
    const [aliasOrTable, targetName] = match[1].split(":");
    const target = (targetName || aliasOrTable).split("!")[0];
    const alias = aliasOrTable.split("!")[0];
    let relatedTable = target, related: Row[] = [], single = false;
    if (target === "client_id" || target === "team_member_id" || target === "created_by" || target === "managed_by" || target === "profiles") {
      relatedTable = "profiles"; single = true;
      const fk = target === "profiles" ? (row.client_id ?? row.team_member_id ?? row.created_by ?? row.managed_by) : row[target];
      related = db.tables.profiles.filter(r => r.id === fk);
    } else if (target === "campaigns" && table !== "profiles") { single = true; related = db.tables.campaigns.filter(r => r.id === row.campaign_id); }
    else if (tableSet.has(target)) {
      const foreign = table === "profiles" ? "client_id" : table === "formations" ? "formation_id" : table === "campaigns" ? "campaign_id" : table.replace(/s$/, "") + "_id";
      related = db.tables[target].filter(r => r[foreign] === row.id);
    } else throw new Error(`Relation locale non prise en charge : ${target}`);
    const mapped = related.map(r => project(db, relatedTable, r, match[2], depth + 1));
    output[alias] = single ? mapped[0] ?? null : mapped;
  }
  return output;
}

function valueAt(row: Row, key: string): any { return key.split(".").reduce((value, part) => value?.[part], row); }
function condition(row: Row, method: string, args: any[]): boolean {
  const [field, expected] = args; const value = valueAt(row, String(field));
  switch (method) {
    case "eq": return value === expected;
    case "neq": return value !== expected;
    case "in": return Array.isArray(expected) && expected.includes(value);
    case "is": return expected === null ? value == null : value === expected;
    case "not": return !condition(row, expected, [field, args[2]]);
    case "gt": return value > expected; case "gte": return value >= expected;
    case "lt": return value < expected; case "lte": return value <= expected;
    case "contains": return Array.isArray(value) ? expected.every((v: any) => value.includes(v)) : Object.entries(expected).every(([k, v]) => value?.[k] === v);
    case "like": case "ilike": { const pattern = String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, "."); return new RegExp(`^${pattern}$`, method === "ilike" ? "i" : "").test(String(value ?? "")); }
    case "or": return splitColumns(String(field)).some(part => { const m = part.match(/^([\w.]+)\.(eq|neq|is|in)\.(.*)$/); if (!m) throw new Error("Filtre OR non pris en charge"); const arg = m[2] === "in" ? m[3].replace(/^\(|\)$/g, "").split(",") : m[3] === "null" ? null : m[3] === "true" ? true : m[3] === "false" ? false : m[3]; return condition(row, m[2], [m[1], arg]); });
    default: throw new Error(`Filtre non pris en charge : ${method}`);
  }
}

export async function executeLocalQuery(query: LocalQuery, options: StoreOptions = {}): Promise<LocalResult> {
  try {
    if (!query || !tableSet.has(query.table) || !Array.isArray(query.operations) || query.operations.length > 40) throw new Error("Table ou requête locale non autorisée");
    for (const op of query.operations) if (!Array.isArray(op) || !QUERY_METHODS.includes(op[0]) || !Array.isArray(op[1])) throw new Error("Opération locale non autorisée");
    const mutations = query.operations.filter(([name]) => ["insert", "update", "upsert", "delete"].includes(name));
    if (mutations.length > 1) throw new Error("Une seule mutation par requête");
    const mutation = mutations[0];
    if (mutation) {
      rejectSecrets(mutation[1]);
      if (query.table === "team_resources" && JSON.stringify(mutation[1]).includes('"body_html"')) throw new Error("Utiliser l'API ressources pour enregistrer le contenu nettoyé");
      if (mutation[0] === "update" && mutation[1][0]?.id !== undefined) throw new Error("L'identifiant d'une ligne est immuable");
    }
    return await localTransaction(db => {
      const table = db.tables[query.table];
      const filterOps = query.operations.filter(([name]) => ["eq", "neq", "in", "is", "not", "or", "gte", "gt", "lte", "lt", "like", "ilike", "contains"].includes(name));
      let rows = table.filter(row => filterOps.every(([name, args]) => condition(row, name, args)));
      if (mutation) {
        const [method, args] = mutation;
        if (["update", "delete"].includes(method) && filterOps.length === 0) throw new Error("Une mutation doit cibler explicitement ses lignes");
        if (["update", "delete"].includes(method) && query.table === "profiles" && rows.some(r => r.id === LOCAL_ADMIN_ID)) throw new Error("L'administrateur local est protégé");
        if (method === "delete") db.tables[query.table] = table.filter(r => !rows.includes(r));
        else if (method === "update") { if (!args[0] || Array.isArray(args[0]) || typeof args[0] !== "object") throw new Error("Objet requis"); rows.forEach(row => Object.assign(row, args[0], { updated_at: now() })); }
        else {
          const values = Array.isArray(args[0]) ? args[0] : [args[0]];
          if (values.length > 1000) throw new Error("Trop de lignes");
          rows = values.map(value => {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Objet requis");
            const conflict = String(args[1]?.onConflict || "id").split(",");
            const existing = method === "upsert" ? table.find(r => conflict.every(k => value[k] !== undefined && r[k] === value[k])) : undefined;
            if (existing?.id === LOCAL_ADMIN_ID || value.id === LOCAL_ADMIN_ID) throw new Error("L'administrateur local est protégé");
            if (existing) { Object.assign(existing, value, { updated_at: now() }); return existing; }
            const row = { id: randomUUID(), created_at: now(), updated_at: now(), ...value };
            if (table.some(r => r.id === row.id)) throw new Error("Identifiant déjà existant");
            table.push(row); return row;
          });
        }
      }
      const count = rows.length;
      for (const [method, args] of query.operations) {
        if (method === "order") rows.sort((a, b) => { const x = valueAt(a, args[0]), y = valueAt(b, args[0]); return (x == y ? 0 : x == null ? -1 : y == null ? 1 : x < y ? -1 : 1) * (args[1]?.ascending === false ? -1 : 1); });
        if (method === "limit") rows = rows.slice(0, Math.max(0, Math.min(10000, Number(args[0]) || 0)));
        if (method === "range") rows = rows.slice(Math.max(0, Number(args[0]) || 0), Math.min(10000, Number(args[1]) + 1));
      }
      const selection = query.operations.find(([name]) => name === "select")?.[1] || ["*"];
      const single = query.operations.some(([name]) => name === "single"), maybe = query.operations.some(([name]) => name === "maybeSingle");
      if ((single && rows.length !== 1) || (maybe && rows.length > 1)) throw new Error("Nombre de lignes inattendu");
      const projected = rows.map(row => project(db, query.table, row, selection[0] || "*"));
      return { data: selection[1]?.head ? null : single || maybe ? projected[0] ?? null : projected, error: null, count: selection[1]?.count ? count : null };
    }, options, Boolean(mutation));
  } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : "Erreur du fichier local", code: "LOCAL_STARTER" } }; }
}

export function createLocalClient(options: StoreOptions = {}): any { return createQueryClient(query => executeLocalQuery(query, options)); }
