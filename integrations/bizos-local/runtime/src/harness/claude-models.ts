// The Claude Code model catalogue offered in Runtime settings.
//
// The shipped rows are the floor. The real list is the account's own:
// `GET /v1/models?limit=1000` under the plan's OAuth token answers exactly
// what this subscription may run, which is why the picker used to top out at
// "Opus 4.5" on a Mac whose plan had had Opus 5 and Fable 5.1 for months.
//
// Short aliases (`opus`, `sonnet`, `fable`, `haiku`) are what the CLI calls
// "alias for the latest model": they keep working across releases, so they
// lead the list, and the dated ids follow, newest first.
import { anthropicOauthGet, readClaudeOauth } from "./claude-credentials.js";
import { MODEL_ID, type ModelCatalog, type ModelOption } from "./codex-models.js";

/** Families the CLI accepts as a bare alias, in the order the picker shows. */
const ALIAS_FAMILIES = ["opus", "sonnet", "fable", "haiku"] as const;
type AliasFamily = (typeof ALIAS_FAMILIES)[number];
const FAMILY_OF_ID = /^claude-(fable|opus|sonnet|haiku)-/;
const ALIAS_LABEL: Record<AliasFamily, string> = {
  opus: "Opus (latest)",
  sonnet: "Sonnet (latest)",
  fable: "Fable (latest)",
  haiku: "Haiku (latest)",
};

export const STATIC_CLAUDE_MODELS: ModelCatalog = {
  default: "opus",
  source: "static",
  options: [
    { id: "opus", label: ALIAS_LABEL.opus },
    { id: "sonnet", label: ALIAS_LABEL.sonnet },
    { id: "fable", label: ALIAS_LABEL.fable },
    { id: "haiku", label: ALIAS_LABEL.haiku },
    { id: "claude-fable-5-1", label: "Fable 5.1" },
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** "Claude Opus 5" → "Opus 5". The family is already the row's own word. */
function labelOf(row: Record<string, unknown>, id: string): string {
  const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (!displayName) return id;
  const stripped = displayName.replace(/^claude\s+/i, "").trim();
  return stripped || displayName;
}

/** The `/v1/models` rows → the picker's catalogue, newest first, aliases on
 * top. `null` when nothing in the answer is a Claude model id. */
export function catalogFromModelsApi(rows: unknown[]): ModelCatalog | null {
  const versioned: Array<{ id: string; label: string; createdAt: number; family: AliasFamily | null }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id.startsWith("claude-") || !MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
    const family = FAMILY_OF_ID.exec(id)?.[1] as AliasFamily | undefined;
    versioned.push({
      id,
      label: labelOf(row, id),
      createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
      family: family ?? null,
    });
  }
  if (versioned.length === 0) return null;
  versioned.sort((left, right) => right.createdAt - left.createdAt);

  const families = new Set(versioned.map((row) => row.family).filter((family): family is AliasFamily => family !== null));
  const aliases: ModelOption[] = ALIAS_FAMILIES.filter((family) => families.has(family)).map((family) => ({
    id: family,
    label: ALIAS_LABEL[family],
  }));
  const options: ModelOption[] = [...aliases, ...versioned.map((row) => ({ id: row.id, label: row.label }))];
  const first = options[0];
  if (!first) return null;
  return {
    default: families.has("opus") ? "opus" : first.id,
    options,
    source: "live",
  };
}

/** Ask this plan's account what it may actually run. `null` without a usable
 * token, or on any refusal — the caller keeps the shipped rows. */
export async function readClaudeModelCatalog(input: {
  configDir?: string;
  homeDir: string;
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ModelCatalog | null> {
  const oauth = await readClaudeOauth({
    ...(input.configDir ? { configDir: input.configDir } : {}),
    homeDir: input.homeDir,
    ...(input.environment ? { environment: input.environment } : {}),
  });
  if (!oauth) return null;
  const body = await anthropicOauthGet({
    path: "/v1/models?limit=1000",
    accessToken: oauth.accessToken,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  if (!isRecord(body) || !Array.isArray(body.data)) return null;
  return catalogFromModelsApi(body.data);
}

export async function resolveClaudeModelCatalog(input: {
  configDir?: string;
  homeDir: string;
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ModelCatalog> {
  try {
    return (await readClaudeModelCatalog(input)) ?? STATIC_CLAUDE_MODELS;
  } catch {
    return STATIC_CLAUDE_MODELS;
  }
}
