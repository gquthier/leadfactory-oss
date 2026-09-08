// The model catalogue the Runtime settings offer.
//
// Static rows are the floor (they match what codex-cli 0.144 ships), and
// `model/list` over the app-server is asked for the live subscription
// catalogue when the CLI is there — the list changes more often than this
// app ships.
import { cleanChildEnvironment } from "./child-env.js";
import { augmentedPath } from "./env-path.js";
import { killCliTree, spawnCli } from "./procs.js";

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelCatalog {
  default: string;
  options: ModelOption[];
  /** `live` once the installed CLI answered `model/list`; `static` while the
   * shipped floor is all we have. The Runtime card says which, rather than
   * showing a list the CLI may not accept. */
  source: "live" | "static";
}

/** What may be handed to a CLI as `--model`. Shared with the Claude
 * catalogue: an id that fails this is a string we would put on a command
 * line without knowing what it is. */
export const MODEL_ID = /^[\w][\w./:+-]*$/;

export const STATIC_CODEX_MODELS: ModelCatalog = {
  default: "gpt-5.6-sol",
  source: "static",
  options: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  ],
};

interface CatalogRow {
  id?: unknown;
  displayName?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
}

export function catalogFromRows(rows: CatalogRow[]): ModelCatalog | null {
  const options: ModelOption[] = [];
  const seen = new Set<string>();
  let defaultModel: string | null = null;
  for (const row of rows) {
    if (row.hidden === true || typeof row.id !== "string" || !MODEL_ID.test(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    options.push({
      id: row.id,
      label: typeof row.displayName === "string" && row.displayName.trim() ? row.displayName : row.id,
    });
    if (row.isDefault === true) defaultModel = row.id;
  }
  const first = options[0];
  if (!first) return null;
  return {
    default: defaultModel && seen.has(defaultModel) ? defaultModel : first.id,
    options,
    source: "live",
  };
}

/** Ask the installed CLI for the catalogue it can actually use. Resolves
 * `null` on any failure — the caller keeps the static rows. */
export function readCodexModelCatalog(
  cli: string,
  environment: NodeJS.ProcessEnv = process.env,
  timeoutMs = 8_000,
): Promise<ModelCatalog | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(cli, ["app-server"], {
        cwd: environment.HOME ?? process.cwd(),
        // Same stripped environment as a turn: this spawn used to hand the
        // raw parent environment over, so a present `OPENAI_API_KEY` moved
        // billing off the ChatGPT plan on every `codexStatus()` call.
        env: cleanChildEnvironment(environment, augmentedPath(environment)) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    let buffer = "";
    let nextId = 1;
    const rows: CatalogRow[] = [];
    const cursors = new Set<string>();
    const pending = new Map<number, "initialize" | "models">();

    const finish = (catalog: ModelCatalog | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killCliTree(child);
      resolve(catalog);
    };
    const send = (message: unknown): void => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish(null);
      }
    };
    const ask = (method: string, params: unknown, kind: "initialize" | "models"): void => {
      const id = nextId++;
      pending.set(id, kind);
      send({ jsonrpc: "2.0", id, method, params });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
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
        const kind = pending.get(message.id as number);
        if (!kind) continue;
        pending.delete(message.id as number);
        if (message.error) {
          finish(null);
          return;
        }
        if (kind === "initialize") {
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          ask("model/list", { cursor: null, limit: 100 }, "models");
          continue;
        }
        const page = (message.result ?? {}) as { data?: unknown; nextCursor?: unknown };
        if (Array.isArray(page.data)) rows.push(...(page.data as CatalogRow[]));
        const cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
        if (cursor && !cursors.has(cursor)) {
          cursors.add(cursor);
          ask("model/list", { cursor, limit: 100 }, "models");
          continue;
        }
        finish(catalogFromRows(rows));
      }
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    ask("initialize", { clientInfo: { name: "localbizos", version: "1" } }, "initialize");
  });
}

export async function resolveModelCatalog(
  cli: string | null,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ModelCatalog> {
  if (!cli) return STATIC_CODEX_MODELS;
  try {
    return (await readCodexModelCatalog(cli, environment)) ?? STATIC_CODEX_MODELS;
  } catch {
    return STATIC_CODEX_MODELS;
  }
}
