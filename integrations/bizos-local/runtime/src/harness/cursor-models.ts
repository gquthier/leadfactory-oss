// The Cursor model catalogue offered in Runtime settings.
//
// The shipped rows are the floor. The real list is the account's own:
// `cursor-agent models` prints exactly what this subscription may run, and
// the CLI refuses `--model` for anything else. There is no JSON format for
// that command (2026.09.02), so the human list is parsed:
//
//   Available models
//
//   gpt-5 - GPT-5 (current, default)
//   sonnet-4-thinking - Sonnet 4 Thinking
//   …
//
//   Tip: use --model <id> …
//
// Colour codes are stripped first; the header, the blank lines and the Tip
// footer are dropped; the id is the token before " - ", and the trailing
// "(current, default)" marker names the account's own default. Anything that
// is not a plain model id (a parameterized `id[context=1m]` override, a
// sentence) is refused rather than put on a command line.
import { cursorChildEnvironment, CURSOR_PROBE_TIMEOUT_MS } from "./cursor-status.js";
import { augmentedPath } from "./env-path.js";
import { execCli } from "./procs.js";
import type { CliRunner } from "./claude-status.js";
import { MODEL_ID, type ModelCatalog, type ModelOption } from "./codex-models.js";

/** The floor: what the CLI's own `--help` names, plus `auto` (the CLI's
 * default routing). Replaced by the account's real list the moment
 * `cursor-agent models` answers. */
export const STATIC_CURSOR_MODELS: ModelCatalog = {
  default: "auto",
  source: "static",
  options: [
    { id: "auto", label: "Auto" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "sonnet-4-thinking", label: "Sonnet 4 Thinking" },
    { id: "claude-opus-4-8", label: "Opus 4.8" },
  ],
};

const ANSI = /\u001b\[[0-9;]*m/g;
/** "(current)", "(default)", "(current, default)" — the CLI's own markers. */
const MARKER = /\s*\((current|default)(,\s*(current|default))*\)\s*$/i;

/** The `cursor-agent models` output → the picker's catalogue. `null` when
 * nothing in it is a model id (not signed in, an error, a changed format). */
export function catalogFromCursorModels(output: string): ModelCatalog | null {
  const options: ModelOption[] = [];
  const seen = new Set<string>();
  let defaultModel: string | null = null;
  for (const rawLine of output.replace(ANSI, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^available models\b/i.test(line) || /^tip:/i.test(line) || /^no models available/i.test(line)) continue;
    const marker = MARKER.exec(line)?.[0] ?? "";
    const body = marker ? line.slice(0, line.length - marker.length) : line;
    const id = (body.split(" - ")[0] ?? "").trim();
    if (!id || !MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const rest = body.slice(id.length).replace(/^\s*-\s*/, "").trim();
    options.push({ id, label: rest || id });
    if (/default/i.test(marker) && !defaultModel) defaultModel = id;
  }
  const first = options[0];
  if (!first) return null;
  return {
    default: defaultModel ?? (seen.has("auto") ? "auto" : first.id),
    options,
    source: "live",
  };
}

/** Ask the CLI what this account may actually run. `null` when the CLI is
 * missing, not signed in, or slow — the caller keeps the shipped rows. */
export async function readCursorModelCatalog(input: {
  cli: string;
  environment?: NodeJS.ProcessEnv;
  run?: CliRunner;
  timeoutMs?: number;
}): Promise<ModelCatalog | null> {
  const environment = cursorChildEnvironment(
    input.environment ?? process.env,
    augmentedPath(input.environment),
  ) as NodeJS.ProcessEnv;
  const run = input.run ?? execCli;
  const output = await new Promise<string | null>((resolve) => {
    try {
      run(
        input.cli,
        ["models"],
        { timeout: input.timeoutMs ?? CURSOR_PROBE_TIMEOUT_MS, env: environment },
        (error, stdout, stderr) => resolve(error ? null : `${stdout}\n${stderr}`),
      );
    } catch {
      resolve(null);
    }
  });
  if (output === null) return null;
  return catalogFromCursorModels(output);
}

export async function resolveCursorModelCatalog(input: {
  cli: string;
  environment?: NodeJS.ProcessEnv;
  run?: CliRunner;
  timeoutMs?: number;
}): Promise<ModelCatalog> {
  try {
    return (await readCursorModelCatalog(input)) ?? STATIC_CURSOR_MODELS;
  } catch {
    return STATIC_CURSOR_MODELS;
  }
}
