// "Smart choice" (Choix intelligent): before a local turn starts, estimate how
// hard the request is and hand it to a model the owner ALREADY HAS on this
// Mac — a Codex (ChatGPT) or Claude Code plan. The BizOS cloud plan is never
// a candidate: it has its own contract (`bizos-inference.ts`).
//
// Two classifiers, one answer:
//   1. TypeSafe (`POST /v1/systemone`, a Score question over three levels),
//      when the owner stored a key. Only a short excerpt of the owner's own
//      message leaves the Mac: at most 600 characters, secrets masked by the
//      same `redactSecretsInText` the protocol tee uses. Never the BizOS
//      system prompt, the organization's instructions or an attachment.
//   2. A local heuristic (length, expected tools, "analyse / code / strategy"
//      versus "read / summarize / rephrase", attachments). It answers when
//      there is no key, and whenever TypeSafe fails or takes longer than
//      1.5 s. A turn is never blocked by the classifier.
//
// The owner's preference (Economy / Balanced / Best intelligence) shifts the
// thresholds; it never invents a model. The model comes from the plan's own
// catalog (live when the CLI answered, the shipped floor otherwise).
import { redactSecretsInText } from "./redact.js";
import type { PlanProvider } from "./plan-types.js";
import type { ReasoningEffort } from "./types.js";

export type SmartLevel = "simple" | "medium" | "hard";
export type SmartPreference = "economy" | "balanced" | "best";
export type SmartFamily = Extract<PlanProvider, "codex" | "claude">;

export const SMART_LEVELS: readonly SmartLevel[] = ["simple", "medium", "hard"];
export const SMART_PREFERENCES: readonly SmartPreference[] = ["economy", "balanced", "best"];
export const SMART_FAMILIES: readonly SmartFamily[] = ["codex", "claude"];
export const DEFAULT_SMART_PREFERENCE: SmartPreference = "balanced";

export const CLASSIFIER_EXCERPT_MAX = 600;
export const CLASSIFIER_TIMEOUT_MS = 1_500;
export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_MODEL = "jev-latest";
/** A stored key is sent as a bearer token and nowhere else. */
export const TYPESAFE_KEY = /^[A-Za-z0-9._~+/=-]{16,512}$/;

// ── the excerpt ──────────────────────────────────────────────────────────

/** What may leave the Mac: the owner's words, secrets masked, whitespace
 * folded, at most 600 characters. Masking happens BEFORE the cut, so a key
 * straddling the boundary is never sent half-visible. */
export function classifierExcerpt(text: string): string {
  const masked = redactSecretsInText(text ?? "");
  return masked.replace(/\s+/g, " ").trim().slice(0, CLASSIFIER_EXCERPT_MAX);
}

// ── the local heuristic ──────────────────────────────────────────────────

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Words that ask for real reasoning. Matched on folded text, word starts. */
const HARD_WORDS = [
  "analyse", "analyze", "analysis", "strategi", "strategy", "architectur", "algorith",
  "code", "coder", "programm", "debug", "bug", "refactor", "implement", "migration", "migrer",
  "sql", "compare", "comparai", "audit", "optimis", "optimiz", "business plan", "modele financier",
  "financial model", "due diligence", "recherche approfondie", "deep research", "demontre", "prove",
  "conceptio", "concois", "design", "diagnosti", "raisonn", "reason", "complex", "etape par etape",
  "step by step", "plan detaille", "detailed plan", "roadmap", "pricing", "prevision", "forecast",
];
/** Words that ask for a light touch: read, summarize, rephrase, translate. */
const SIMPLE_WORDS = [
  "lis ", "lire", "read", "resume", "resumer", "summar", "reformul", "rephrase", "rewrite", "traduis",
  "tradui", "translate", "corrige l'orthographe", "fix the typo", "orthographe", "typo", "liste ",
  "c'est quoi", "what is", "definis", "define", "bonjour", "salut", "merci", "hello", "thanks",
  "thank you", "extrais", "extract", "recapitul", "tl;dr", "raccourcis", "shorten",
];
/** Words that ask for real writing: a draft is never "simple", even short. */
const WRITE_WORDS = [
  "redige", "ecris", "write", "draft", "email", "e-mail", "mail ", "post ", "article", "propose",
  "idees", "ideas", "brainstorm", "plan ", "script", "pitch", "annonce", "landing",
];
/** Words that ask for a tool (recruitment, web, image, computer). */
const TOOL_WORDS = [
  "recrute", "recruit", "cree un agent", "create an agent", "cherche sur le web", "search the web",
  "navigue", "browse", "genere une image", "generate an image", "ordinateur", "computer",
  "envoie un email", "send an email", "planifie", "schedule",
];

function hits(text: string, words: readonly string[]): string[] {
  const found: string[] = [];
  for (const word of words) {
    const at = text.indexOf(word);
    if (at < 0) continue;
    // A word start: "code" must not fire on "Barcode" or "encode".
    if (at > 0 && /[a-z0-9]/.test(text[at - 1]!)) continue;
    found.push(word.trim());
  }
  return found;
}

export interface HeuristicInput {
  text: string;
  /** How many files ride with the turn (their content is never read here). */
  attachments?: number;
}

export interface Classification {
  /** 0 = simple … 2 = hard, probability-weighted for TypeSafe. */
  score: number;
  source: "typesafe" | "heuristic";
  reason: string;
  confidence?: number;
  /** Set when TypeSafe was tried and the heuristic answered instead. */
  fallback?: string;
  typesafeModel?: string;
  inputTokens?: number;
  latencyMs?: number;
}

export function heuristicClassification(input: HeuristicInput): Classification {
  const text = fold(input.text ?? "");
  const hard = hits(text, HARD_WORDS);
  const simple = hits(text, SIMPLE_WORDS);
  const tools = hits(text, TOOL_WORDS);
  const writing = hits(`${text} `, WRITE_WORDS);
  const length = (input.text ?? "").trim().length;
  const attachments = Math.max(0, input.attachments ?? 0);
  let score = 1;
  const reasons: string[] = [];
  if (hard.length) {
    score += Math.min(1, 0.6 * hard.length);
    reasons.push(`difficile : ${hard.slice(0, 3).join(", ")}`);
  }
  if (simple.length) {
    score -= Math.min(1, 0.6 * simple.length);
    reasons.push(`simple : ${simple.slice(0, 3).join(", ")}`);
  }
  if (/```|traceback|exception:|stack trace|at [\w.$]+\(/i.test(input.text ?? "")) {
    score += 0.6;
    reasons.push("code collé");
  }
  if (length > 2_000) {
    score += 0.5;
    reasons.push("message très long");
  } else if (length > 800) {
    score += 0.3;
    reasons.push("message long");
  } else if (length < 60 && !hard.length) {
    score -= 0.4;
    reasons.push("message court");
  }
  if (writing.length && !simple.length) {
    score = Math.max(score, 1);
    reasons.push(`rédaction : ${writing[0]}`);
  }
  if (tools.length) {
    // A tool call needs a model that follows a protocol: never the smallest.
    score = Math.max(score, 1);
    reasons.push(`outil attendu : ${tools[0]}`);
  }
  if (attachments > 0) {
    // Reading a file is the textbook cheap task; a file with a hard ask stays hard.
    if (!hard.length) score -= 0.2;
    reasons.push(`${attachments} pièce${attachments > 1 ? "s" : ""} jointe${attachments > 1 ? "s" : ""}`);
  }
  score = Math.min(2, Math.max(0, score));
  return {
    score: Math.round(score * 100) / 100,
    source: "heuristic",
    reason: reasons.length ? reasons.join(" · ") : "sans signal particulier",
  };
}

// ── TypeSafe ──────────────────────────────────────────────────────────────

const LEVEL_RUBRIC = [
  "Simple: read, summarize, rephrase, translate or extract; a short factual answer; small talk. A small fast model does it well.",
  "Medium: write or edit a normal document, email, post or plan; moderate reasoning; a small code change; one tool call.",
  "Hard: deep multi-step analysis, strategy, architecture, complex code or debugging, research across many constraints. Needs a frontier model.",
];

export class ClassifierError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ClassifierError";
  }
}

/** One Score question, the excerpt as `state`. Throws `ClassifierError`. */
export async function typesafeClassification(input: {
  excerpt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<Classification> {
  const now = input.now ?? Date.now;
  const started = now();
  const body = JSON.stringify({
    model: TYPESAFE_MODEL,
    state: { user_request: input.excerpt },
    questions: {
      difficulty: {
        type: "score",
        instructions:
          "How much reasoning does an AI assistant need to answer `user_request` well? Judge the thinking required, not the length. The request may be in French.",
        criteria: LEVEL_RUBRIC,
      },
    },
  });
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? CLASSIFIER_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new ClassifierError(name === "TimeoutError" || name === "AbortError" ? "typesafe_timeout" : "typesafe_unreachable");
  }
  if (!response.ok) {
    const code =
      response.status === 401 || response.status === 403 ? "typesafe_unauthorized"
      : response.status === 402 ? "typesafe_no_credits"
      : response.status === 429 || response.status === 529 ? "typesafe_busy"
      : `typesafe_http_${response.status}`;
    throw new ClassifierError(code);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ClassifierError("typesafe_malformed");
  }
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const answers = record.answers && typeof record.answers === "object" ? (record.answers as Record<string, unknown>) : {};
  const answer = answers.difficulty && typeof answers.difficulty === "object" ? (answers.difficulty as Record<string, unknown>) : {};
  const score = answer.score;
  if (answer.type !== "score" || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 2) {
    throw new ClassifierError("typesafe_malformed");
  }
  const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : undefined;
  const usage = record.usage && typeof record.usage === "object" ? (record.usage as Record<string, unknown>) : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  return {
    score: Math.round(score * 100) / 100,
    source: "typesafe",
    reason: `TypeSafe ${score.toFixed(2)}/2${confidence !== undefined ? ` (confiance ${confidence.toFixed(2)})` : ""}`,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(typeof record.model === "string" ? { typesafeModel: record.model.slice(0, 40) } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    latencyMs: now() - started,
  };
}

/** TypeSafe when a key exists, the heuristic otherwise or on ANY failure. */
export async function classifyTurn(input: {
  text: string;
  attachments?: number;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<Classification> {
  const heuristic = heuristicClassification({ text: input.text, attachments: input.attachments ?? 0 });
  const excerpt = classifierExcerpt(input.text);
  if (!input.apiKey) return { ...heuristic, fallback: "no_key" };
  if (!excerpt) return { ...heuristic, fallback: "empty_request" };
  try {
    return await typesafeClassification({
      excerpt,
      apiKey: input.apiKey,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
  } catch (error) {
    return { ...heuristic, fallback: error instanceof ClassifierError ? error.code : "typesafe_failed" };
  }
}

// ── score → level ─────────────────────────────────────────────────────────

/** How far each preference moves the two thresholds (0.67 and 1.34). */
const PREFERENCE_BIAS: Record<SmartPreference, number> = { economy: -0.35, balanced: 0, best: 0.35 };

export function levelForScore(score: number, preference: SmartPreference = DEFAULT_SMART_PREFERENCE): SmartLevel {
  const shifted = score + (PREFERENCE_BIAS[preference] ?? 0);
  if (shifted < 0.67) return "simple";
  if (shifted < 1.34) return "medium";
  return "hard";
}

// ── level → model, on what the owner really has ─────────────────────────

export interface CatalogOption {
  id: string;
  label: string;
  isDefault?: boolean;
}

export interface SmartCandidate {
  planId: string;
  family: SmartFamily;
  /** Lower first, as `plan-router.comparePlanPriority` orders them. */
  priority: number;
  /** The account said its window is used up. */
  usageReached: boolean;
  /** Fullest usage window in percent, when the CLI reported one. */
  usedPct: number | null;
}

export interface SmartModel {
  model: string;
  label: string;
  effort?: ReasoningEffort;
}

const FAST = /(^|[-_.])(luna|mini|nano|lite|flash|spark|haiku|small)([-_.]|$)/i;
const MID = /(^|[-_.])(sol|terra|sonnet|medium)([-_.]|$)/i;
const FRONTIER = /(^|[-_.])(astra|opus|fable|pro|max|ultra)([-_.]|$)/i;

/** "gpt-6-astra" → "gpt-6": the generation a tier is looked up in first. */
function generation(id: string): string {
  const cut = id.lastIndexOf("-");
  return cut > 0 ? id.slice(0, cut) : id;
}

function cleanLabel(label: string): string {
  return label.replace(/\s*\((latest|dernier)\)\s*$/i, "").trim() || label;
}

const CODEX_EFFORT: Record<SmartLevel, ReasoningEffort> = { simple: "low", medium: "medium", hard: "xhigh" };
const CLAUDE_EFFORT: Record<SmartLevel, ReasoningEffort> = { simple: "low", medium: "medium", hard: "high" };
const CLAUDE_ALIAS: Record<SmartLevel, string> = { simple: "haiku", medium: "sonnet", hard: "opus" };

/**
 * Codex: the frontier model the CLI marks as default for hard work, the
 * workhorse of the same generation for medium work, and the fast one for
 * simple work — each with a reasoning effort to match. Claude: Opus, Sonnet,
 * Haiku through the CLI's own aliases. A tier the catalog lacks falls back to
 * the catalog's default rather than to a name this account may not run.
 */
export function modelForLevel(family: SmartFamily, level: SmartLevel, options: readonly CatalogOption[]): SmartModel | null {
  const usable = options.filter((option) => option.id);
  if (!usable.length) return null;
  const fallback = usable.find((option) => option.isDefault) ?? usable[0]!;
  if (family === "claude") {
    const alias = CLAUDE_ALIAS[level];
    const pick =
      usable.find((option) => option.id === alias) ??
      usable.find((option) => option.id.startsWith(`claude-${alias}-`)) ??
      fallback;
    return { model: pick.id, label: cleanLabel(pick.label), effort: CLAUDE_EFFORT[level] };
  }
  const frontier = usable.find((option) => option.isDefault) ?? usable.find((option) => FRONTIER.test(option.id)) ?? fallback;
  const sameGeneration = usable.filter((option) => generation(option.id) === generation(frontier.id));
  const find = (pattern: RegExp): CatalogOption | undefined =>
    sameGeneration.find((option) => pattern.test(option.id)) ?? usable.find((option) => pattern.test(option.id));
  const pick = level === "hard" ? frontier : level === "medium" ? (find(MID) ?? frontier) : (find(FAST) ?? find(MID) ?? frontier);
  return { model: pick.id, label: cleanLabel(pick.label), effort: CODEX_EFFORT[level] };
}

/**
 * Which plan answers: the owner's preferred family when one of its plans is
 * healthy, otherwise any healthy plan whose account still has room, the
 * emptiest window first. A plan whose window is full is used only when no
 * other one is left (its CLI may still bill credits; the owner chose it).
 */
export function chooseCandidate(candidates: readonly SmartCandidate[], preferred?: PlanProvider | null): SmartCandidate | null {
  if (!candidates.length) return null;
  const ordered = [...candidates].sort((a, b) => {
    if (a.usageReached !== b.usageReached) return a.usageReached ? 1 : -1;
    const aPreferred = preferred && a.family === preferred ? 0 : 1;
    const bPreferred = preferred && b.family === preferred ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const aUsed = a.usedPct ?? 50;
    const bUsed = b.usedPct ?? 50;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return a.priority - b.priority;
  });
  return ordered[0] ?? null;
}

// ── the decision and its record ──────────────────────────────────────────

export interface SmartDecision {
  planId: string;
  family: SmartFamily;
  model: string;
  /** "Sonnet", "GPT-6-Luna": what the grey line under the reply names. */
  label: string;
  effort?: ReasoningEffort;
  level: SmartLevel;
  score: number;
  preference: SmartPreference;
  source: Classification["source"];
  reason: string;
  fallback?: string;
  confidence?: number;
  latencyMs?: number;
  inputTokens?: number;
  catalog: "live" | "static";
}

export interface SmartDecisionRecord extends SmartDecision {
  at: string;
  runId: string;
  threadId: string;
}

export const SMART_DECISIONS_FILE = "smart-routing.json";
export const SMART_KEY_FILE = "smart-routing-key.json";
export const MAX_SMART_DECISIONS = 300;

export function isSmartPreference(value: unknown): value is SmartPreference {
  return SMART_PREFERENCES.includes(value as SmartPreference);
}
