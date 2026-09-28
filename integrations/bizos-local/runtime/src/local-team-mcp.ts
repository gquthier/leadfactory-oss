import { localComputerEnabled, assertLocalComputerEnabled } from "./computer/release.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENCY_TOOL_SPECS, isAgencyToolName } from "./harness/agency-tools.js";
import { COMMERCE_TOOL_SPECS, isCommerceToolName } from "./harness/commerce-tools.js";
import { COMPUTER_TOOL_SPECS, isComputerToolName } from "./computer/tools.js";
import { CONTINUITY_MCP_OPERATIONS, PUBLISH_CONVERSATION_ARTIFACT, READ_CONVERSATION_ARTIFACT, READ_CONVERSATION_ARCHIVE } from "./continuity-tools.js";

type Json = Record<string, unknown>;
type TeamCall = (input: Json) => Promise<unknown>;

const MAX_RESULT_CHARS = 16_000;
/** Skills and documents are read whole; a SKILL.md is longer than a result card. */
const MAX_PACK_RESULT_CHARS = 64_000;

/**
 * Which tool families this server offers, from its OWN argv
 * (`--toolset=team,agency` or `--toolset=team,commerce`). `team` is always
 * there. `agency` / `commerce` are added by the sidecar only for the agents
 * of the installed pack — and listing is not granting: the sidecar re-checks
 * the calling agent on every `/pack` call.
 */
export function toolsetsFromArgv(argv: readonly string[]): Set<string> {
  const flag = argv.find((argument) => argument.startsWith("--toolset="));
  const names = (flag ? flag.slice("--toolset=".length) : "team").split(",").map((name) => name.trim()).filter(Boolean);
  return new Set(["team", ...names]);
}

/** Shared by every cloud tool description: what the machine is, and the manners. */
const CLOUD_NOTE = "Cloud computer (Linux, shared by the user's agents; your folder and Chrome profile there are yours alone). Wake it when you need it, sleep it when done.";
const CLOUD_TOOL_NAMES = new Set(["cloud_computer_wake", "cloud_computer_sleep", "cloud_computer_status", "cloud_computer_run", "cloud_browser_fetch"]);

export const CONTINUITY_TOOL_SPECS = [PUBLISH_CONVERSATION_ARTIFACT, {
  name: "list_accessible_computers", description: "List physical BizOS installations granted to this conversation agent. Presence and runtimes are declarations; an offline machine cannot supply files or CLI.", inputSchema: {type:"object",properties:{},additionalProperties:false},
}, READ_CONVERSATION_ARCHIVE, READ_CONVERSATION_ARTIFACT];
export const CONTEXT_TOOL_SPECS = [{
  name: "list_context_directory",
  description: "List one bounded page of entries in the selected local project folder. Read-only, relative to that folder; no recursive scan. Follow the opaque nextCursor only when useful; it expires after five minutes and is consumed once. An empty page may have a continuation.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative folder path, or empty for the selected root." }, cursor: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
}, {
  name: "read_context_file",
  description: "Read up to 8192 bytes from one file in the selected local context, read-only. Paths are relative to the selected folder; for a single selected file use its exact displayed name. PDF and binary data are raw base64 byte pages, not parsed text.",
  inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 }, maxBytes: { type: "integer", minimum: 1, maximum: 8192 } }, required: ["path"], additionalProperties: false },
}] as const;
export const LOCAL_TEAM_TOOL_SPECS = [{
  name: "recruit_agent",
  description: "Create or reuse one persistent Local BizOS specialist for this active mission, add it to the durable company team, and dispatch a real initial native-plan task in the current mission chain. Use role_slug for an installed blueprint. When no blueprint fits or the role catalog is empty, supply name, title, description, context and initial_task without role_slug to create a custom specialist directly; the catalog is not required.",
  inputSchema: {
    type: "object",
    properties: {
      role_slug: { type: "string", description: "Optional role slug from the bound company vault's Roles index." },
      name: { type: "string", description: "Short teammate name." },
      title: { type: "string", description: "Concrete role, such as Research lead." },
      description: { type: "string", description: "Short stable role description." },
      instructions: { type: "string", description: "Optional bounded operating instructions; a role blueprint remains intact." },
      context: { type: "string", description: "Bounded company/task context appended to the agent's actual instructions." },
      mission: { type: "string", description: "Legacy bounded responsibility field; prefer description/context." },
      initial_task: { type: "string", description: "Concrete first task dispatched as a real native-plan child run." },
      avatar_data_url: { type: "string", description: "Optional canonical PNG/JPEG/WebP base64 data URL, at most 32768 characters." },
      avatar_prompt: { type: "string", maxLength: 2000, description: "Optional explicit user visual request for this avatar. Never put business context or system instructions here." },
    },
    anyOf: [
      { required: ["role_slug"] },
      { required: ["name", "title"] },
    ],
    additionalProperties: false,
  },
}, {
  name: "schedule_routine",
  description: "Create a routine on this Mac yourself — no confirmation question — whenever the person asks you to watch, remind, follow up, check back or ping them later. A short-lived watch (a delivery, a deploy, a reply, today's meeting) MUST have an end: set `until`. Write `prompt` to your future self as an intent (what to check, what counts as news, what they already know), not as an order to the person. It fires in your own direct chat; when nothing is new you will answer [SILENT] and nothing is shown. The result gives nextRunAt and endsAt: announce it in one short line. Routines cannot be created from a routine or heartbeat run. The owner is you unless owner_agent_id names a teammate; the person sees and edits every routine in Settings → Routines (Réglages → Routines).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short routine name, such as Colis Chronopost or Morning digest." },
      prompt: { type: "string", description: "Intent to your future self: what to check each run, and what would be worth telling the person." },
      frequency: { type: "string", enum: ["daily", "interval", "once"], description: "daily at a time (optionally on some weekdays), every N minutes, or once at an instant." },
      time: { type: "string", description: "HH:MM local time, for daily." },
      weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0 = Sunday … 6 = Saturday, for daily; every day when omitted." },
      every_minutes: { type: "integer", minimum: 5, maximum: 10080, description: "Minutes between runs, from 5 to 10080, for interval." },
      at: { type: "string", description: "ISO instant, for once." },
      until: { type: "string", description: "ISO instant when this watch ends (required in spirit for anything short-lived). It never runs after it and then stops by itself." },
      owner_agent_id: { type: "string", description: "Optional teammate agent id (from the manifest or a recruitment result) who owns the routine instead of you." },
    },
    required: ["name", "prompt", "frequency"],
    additionalProperties: false,
  },
}, {
  name: "manage_agent",
  description: "Update, activate, or suspend an existing teammate in this active local team. It cannot delete an agent, grant files, elevate permissions, or change cloud state.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Persistent local agent id from the runtime manifest or a recruitment result." },
      name: { type: "string", description: "Optional updated teammate name." },
      title: { type: "string", description: "Optional updated role." },
      description: { type: "string", description: "Optional updated public description." },
      instructions: { type: "string", description: "Optional bounded assignment instructions; preserved separately from a role blueprint." },
      context: { type: "string", description: "Optional bounded assignment context." },
      mission: { type: "string", description: "Optional updated bounded responsibility." },
      active: { type: "boolean", description: "true activates/reactivates; false suspends without deleting history." },
      avatar_data_url: { type: ["string", "null"], description: "Canonical PNG/JPEG/WebP data URL, or null to reset to the procedural avatar." },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },
}, {
  name: "checkpoint_task",
  description: "Save this active mission's objective, observable progress and next step. Use before multi-step work and before ending. in_progress can resume automatically; blocked stops; completed requires evidence from results you actually verified. Evidence is agent-reported, not independently certified.",
  inputSchema: {
    type: "object",
    properties: {
      objective: { type: "string", maxLength: 2000 },
      status: { type: "string", enum: ["in_progress", "blocked", "completed"] },
      summary: { type: "string", maxLength: 2000 },
      next_step: { type: "string", maxLength: 2000 },
      evidence: { type: "array", maxItems: 12, items: { type: "string", maxLength: 1000 } },
    },
    required: ["objective", "status", "summary", "next_step", "evidence"],
    additionalProperties: false,
  },
}, {
  name: "send_to_chat",
  description: "Put files or images from your workspace into this chat, attached to your next message (same message as your text, in order). Use it to show a screenshot or an image you made, or to hand over a report, sheet, PDF or any file — never paste a file's contents or its path in prose instead. Files must be inside your workspace; they stay where they are (save what you produce under outputs/YYYY-MM-DD/ of the company workspace). Up to 10 per call. Give each image a short alt text in the person's language; never label an image \"Generated\".",
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path, or relative to your workspace folder." },
            alt: { type: "string", maxLength: 200, description: "For an image: what it shows, one short sentence in the person's language." },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
      caption: { type: "string", maxLength: 2000, description: "Optional: the text to send with the files if you write nothing else afterwards." },
    },
    required: ["files"],
    additionalProperties: false,
  },
}, {
  name: "offer_quick_replies",
  description: "Offer 1 to 4 short answers the person can tap under your next message (same message as your text). Use it when the natural next step is a choice — \"Oui\" / \"Autre nom…\", \"Une agence\" / \"Des services\" — never for open questions. Each answer is a few words in the person's language; the latest call replaces the previous one for that message. Do not repeat the answers in prose.",
  inputSchema: {
    type: "object",
    properties: {
      choices: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 40 }, description: "Short tappable answers, in order." },
    },
    required: ["choices"],
    additionalProperties: false,
  },
}, {
  name: "propose_company_name",
  description: "Propose one name for the person's company, shown as a card under your next message with a button to accept it or choose another. One good name, 1 to 48 characters, no explanation inside the name. The person decides; nothing is renamed by this call.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 48, description: "The proposed company name." },
    },
    required: ["name"],
    additionalProperties: false,
  },
}, {
  name: "cloud_computer_wake",
  description: `${CLOUD_NOTE} Wake it (created the first time); the other cloud tools also wake it by themselves.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}, {
  name: "cloud_computer_sleep",
  description: `${CLOUD_NOTE} Put it to sleep when you are done: the disk, your folder and your Chrome cookies are kept, running processes stop.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}, {
  name: "cloud_computer_status",
  description: `${CLOUD_NOTE} Is it awake or asleep, and when it will sleep by itself.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}, {
  name: "cloud_computer_run",
  description: `${CLOUD_NOTE} Run a bash command in your own folder there and get stdout, stderr and the exit code.`,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", maxLength: 20000, description: "Bash command, run from your own folder on the cloud computer." },
      timeout_seconds: { type: "integer", minimum: 1, maximum: 600, description: "Wait at most this long (default 120)." },
    },
    required: ["command"],
    additionalProperties: false,
  },
}, {
  name: "cloud_browser_fetch",
  description: `${CLOUD_NOTE} Open a URL in headless Chrome with your own profile (your cookies and logins persist) and get the page title and text.`,
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", maxLength: 4000, description: "Absolute http(s) URL." } },
    required: ["url"],
    additionalProperties: false,
  },
}] as const;

export function isCloudToolName(name: unknown): boolean {
  return typeof name === "string" && CLOUD_TOOL_NAMES.has(name);
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

let sessionPromise: Promise<string> | null = null;
function sessionToken(): Promise<string> {
  sessionPromise ??= (async () => {
    const origin = requireEnvironment("LOCALBIZOS_TEAM_ORIGIN");
    const ticket = requireEnvironment("LBZ_LOCAL_TEAM_TICKET");
    delete process.env.LBZ_LOCAL_TEAM_TICKET;
    const response = await fetch(new URL("/api/internal/local-team/exchange", origin), {
      method: "POST",
      headers: { authorization: `Bearer ${ticket}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Local team capability exchange failed (${response.status})`);
    const body = await response.json() as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) throw new Error("Local team capability exchange returned no token");
    return body.token;
  })();
  return sessionPromise;
}

async function callEndpoint(path: string, input: Json, timeoutMs = 15_000): Promise<unknown> {
  const origin = requireEnvironment("LOCALBIZOS_TEAM_ORIGIN");
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${await sessionToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

const callRecruit: TeamCall = (input) => callEndpoint("/api/internal/local-team/recruit", input);
const callManage: TeamCall = (input) => callEndpoint("/api/internal/local-team/manage", input);
const callSchedule: TeamCall = (input) => callEndpoint("/api/internal/local-team/routine", input);
const callCheckpoint: TeamCall = (input) => callEndpoint("/api/internal/local-team/checkpoint", input);
const callSend: TeamCall = (input) => callEndpoint("/api/internal/local-team/send", input);
const callQuickReplies: TeamCall = (input) => callEndpoint("/api/internal/local-team/quick-replies", input);
const callProposeName: TeamCall = (input) => callEndpoint("/api/internal/local-team/propose-name", input);
/** One endpoint for every pack tool: `{ tool, arguments }`. */
const callPack: TeamCall = (input) => callEndpoint("/api/internal/local-team/pack", input);
/** One endpoint for the cloud computer tools: `{ tool, arguments }`. A wake
 * plus a 600 s command can take far longer than a team call. */
const callCloud: TeamCall = (input) => callEndpoint("/api/internal/local-team/cloud", input, 15 * 60_000);

/** The agent's own computer: `{ tool, arguments }` → `{ ok, text, image? }`.
 * A wake of the cloud computer plus a slow page can take minutes. */
const callComputer: TeamCall = (input) => callEndpoint("/api/internal/local-team/computer", input, 30 * 60_000);

/** A computer answer as MCP content: the words, then the screenshot as an
 * image block the model sees. */
export function computerResult(value: unknown): Json {
  const answer = (value ?? {}) as { ok?: unknown; text?: unknown; error?: unknown; image?: { mimeType?: unknown; data?: unknown } };
  if (answer.ok !== true) return textResult(String(answer.error ?? "the computer refused that"), true);
  const image = answer.image && typeof answer.image.data === "string" && answer.image.data
    ? [{ type: "image", data: answer.image.data, mimeType: String(answer.image.mimeType ?? "image/jpeg") }]
    : [];
  return { content: [{ type: "text", text: String(answer.text ?? "").slice(0, MAX_RESULT_CHARS) }, ...image] };
}

function textResult(value: unknown, isError = false, max = MAX_RESULT_CHARS): Json {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text: text.slice(0, max) }],
    ...(isError ? { isError: true } : {}),
  };
}
function continuityResult(value: unknown): Json {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length > MAX_PACK_RESULT_CHARS)
    throw new Error("Conversation tool result exceeds 64,000 characters. Request a smaller page; the result was not truncated or returned as success.");
  return { content: [{ type: "text", text }] };
}

export interface LocalTeamMcpOptions {
  context?: TeamCall;
  continuity?(tool: string, input: Json): Promise<unknown>;
  /** The pack invoker, when this server was mounted with the `agency` or
   * `commerce` toolset; `null` (the default) lists and routes the team tools only. */
  pack?: TeamCall | null;
  /** Which pack's specs to list: `agency`, `commerce`, or none. */
  toolsets?: ReadonlySet<string>;
  /** The cloud computer invoker (defaults to the sidecar route). */
  cloud?: TeamCall;
  /** The agent's own computer (`--toolset=…,computer`; defaults to the sidecar route). */
  computer?: TeamCall;
  /** `send_to_chat` (defaults to the sidecar route). */
  send?: TeamCall;
  /** `offer_quick_replies` / `propose_company_name` (default to the sidecar routes). */
  quickReplies?: TeamCall;
  proposeName?: TeamCall;
}

const READ_ONLY_TOOL = /^(agency|commerce)_(context|schema|list_|read_)/;

export async function handleLocalTeamMessage(
  message: Json,
  invokeRecruit: TeamCall = callRecruit,
  invokeManage: TeamCall = callManage,
  invokeSchedule: TeamCall = callSchedule,
  invokeCheckpoint: TeamCall = callCheckpoint,
  options: LocalTeamMcpOptions = {},
): Promise<Json | null> {
  const invokePack = options.pack ?? null;
  const invokeContext = options.context ?? ((input: Json) => callEndpoint("/api/internal/local-team/context", input));
  const invokeCloud = options.cloud ?? callCloud;
  const invokeComputer = options.computer ?? callComputer;
  const invokeSend = options.send ?? callSend;
  const invokeQuickReplies = options.quickReplies ?? callQuickReplies;
  const invokeProposeName = options.proposeName ?? callProposeName;
  const toolsets = options.toolsets ?? new Set(invokePack ? ["team", "agency", "commerce"] : ["team"]);
  const id = message.id;
  const method = message.method;
  const params = (message.params ?? {}) as Json;
  const reply = (result: unknown): Json => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return reply({
      protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "local_bizos_team", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    const teamTools = LOCAL_TEAM_TOOL_SPECS.filter(tool => localComputerEnabled() || !isCloudToolName(tool.name)).filter(tool => !toolsets.has("continuity") || !["recruit_agent","cloud_computer_run","schedule_routine"].includes(tool.name)).map((tool) => ({
      ...tool,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: isCloudToolName(tool.name) },
    }));
    const packTools = invokePack
      ? [
        ...(toolsets.has("agency") ? AGENCY_TOOL_SPECS : []),
        ...(toolsets.has("commerce") ? COMMERCE_TOOL_SPECS : []),
      ].map((tool) => ({
        ...tool,
        annotations: { readOnlyHint: READ_ONLY_TOOL.test(tool.name), destructiveHint: false, idempotentHint: false, openWorldHint: false },
      }))
      : [];
    const computerTools = localComputerEnabled() && toolsets.has("computer")
      ? COMPUTER_TOOL_SPECS.map((tool) => ({
        ...tool,
        annotations: { readOnlyHint: tool.name === "computer_observe", destructiveHint: false, idempotentHint: false, openWorldHint: true },
      }))
      : [];
    return reply({ tools: [...teamTools, ...packTools, ...computerTools, ...(toolsets.has("context") && !toolsets.has("continuity") ? CONTEXT_TOOL_SPECS.map(tool => ({...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }})) : []), ...(toolsets.has("continuity") ? CONTINUITY_TOOL_SPECS : [])] });
  }
  if (method === "tools/call") {
    try {
      if (isCloudToolName(params.name) || isComputerToolName(params.name)) assertLocalComputerEnabled();
      if (params.name === "recruit_agent") return reply(textResult(await invokeRecruit((params.arguments ?? {}) as Json)));
      if (params.name === "manage_agent") return reply(textResult(await invokeManage((params.arguments ?? {}) as Json)));
      if (params.name === "schedule_routine") return reply(textResult(await invokeSchedule((params.arguments ?? {}) as Json)));
      if (toolsets.has("continuity")) {
        const operation = Object.entries(CONTINUITY_MCP_OPERATIONS).find(([,name]) => name === params.name)?.[0];
        if (operation) return reply(continuityResult(await (options.continuity
          ? options.continuity(String(params.name), (params.arguments ?? {}) as Json)
          : callEndpoint(`/api/internal/local-team/${operation}`, (params.arguments ?? {}) as Json))));
      }
      if (params.name === "checkpoint_task") return reply(textResult(await invokeCheckpoint((params.arguments ?? {}) as Json)));
      if (toolsets.has("context") && !toolsets.has("continuity") && CONTEXT_TOOL_SPECS.some(tool => tool.name === params.name)) return reply(textResult(await invokeContext({ tool: params.name, arguments: params.arguments ?? {} }), false, MAX_PACK_RESULT_CHARS));
      if (params.name === "send_to_chat") return reply(textResult(await invokeSend((params.arguments ?? {}) as Json)));
      if (params.name === "offer_quick_replies") return reply(textResult(await invokeQuickReplies((params.arguments ?? {}) as Json)));
      if (params.name === "propose_company_name") return reply(textResult(await invokeProposeName((params.arguments ?? {}) as Json)));
      if (isCloudToolName(params.name)) return reply(textResult(await invokeCloud({ tool: params.name, arguments: params.arguments ?? {} })));
      if (toolsets.has("computer") && isComputerToolName(params.name)) {
        return reply(computerResult(await invokeComputer({ tool: params.name, arguments: params.arguments ?? {} })));
      }
      if (invokePack && ((toolsets.has("agency") && isAgencyToolName(params.name)) || (toolsets.has("commerce") && isCommerceToolName(params.name)))) {
        return reply(textResult(await invokePack({ tool: params.name, arguments: params.arguments ?? {} }), false, MAX_PACK_RESULT_CHARS));
      }
      return reply(textResult(`Unknown tool: ${String(params.name)}`, true));
    } catch (error) {
      return reply(textResult(error instanceof Error ? error.message : String(error), true));
    }
  }
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${String(method)}` } };
}

export function serveLocalTeam(input: NodeJS.ReadableStream, options: LocalTeamMcpOptions = {}): void {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      void (async () => {
        let response: Json | null;
        try {
          response = await handleLocalTeamMessage(JSON.parse(line) as Json, undefined, undefined, undefined, undefined, options);
        } catch (error) {
          response = { jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } };
        }
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Consume the forwarded one-shot ticket at the server's first breath. The
  // codex process may retain the now-useless string; it never receives the
  // scoped session token returned to this MCP child.
  // A failed exchange must not take the server down before it has answered
  // `tools/list`; the first call retries it, and reports the failure there.
  void sessionToken().catch(() => {
    sessionPromise = null;
  });
  const toolsets = toolsetsFromArgv(process.argv.slice(2));
  serveLocalTeam(process.stdin, { pack: toolsets.has("agency") || toolsets.has("commerce") ? callPack : null, toolsets });
}
