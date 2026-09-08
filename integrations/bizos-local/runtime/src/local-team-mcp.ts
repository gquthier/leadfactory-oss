import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENCY_TOOL_SPECS, isAgencyToolName } from "./harness/agency-tools.js";

type Json = Record<string, unknown>;
type TeamCall = (input: Json) => Promise<unknown>;

const MAX_RESULT_CHARS = 16_000;
/** Skills and documents are read whole; a SKILL.md is longer than a result card. */
const MAX_AGENCY_RESULT_CHARS = 64_000;

/**
 * Which tool families this server offers, from its OWN argv (`--toolset=team,agency`).
 * `team` is always there. `agency` is added by the sidecar only for the
 * agents of the installed agency pack — and listing is not granting: the
 * sidecar re-checks the calling agent on every `/agency` call.
 */
export function toolsetsFromArgv(argv: readonly string[]): Set<string> {
  const flag = argv.find((argument) => argument.startsWith("--toolset="));
  const names = (flag ? flag.slice("--toolset=".length) : "team").split(",").map((name) => name.trim()).filter(Boolean);
  return new Set(["team", ...names]);
}

export const LOCAL_TEAM_TOOL_SPECS = [{
  name: "recruit_agent",
  description: "Autonomously create one persistent Local BizOS teammate for this active mission. The new agent gets its own DM and joins this team; from a DM, a new two-agent team thread is created.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short teammate name." },
      title: { type: "string", description: "Concrete role, such as Research lead." },
      mission: { type: "string", description: "Bounded responsibility and operating instructions." },
    },
    required: ["name", "title", "mission"],
    additionalProperties: false,
  },
}, {
  name: "schedule_routine",
  description: "Create a routine on this Mac: a prompt the runtime sends to an agent on a schedule, in that agent's own chat. The owner is you unless owner_agent_id names a teammate, who then becomes responsible for it. The person sees every routine in Apps → Routines and can pause, resume or run it.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short routine name, such as Morning digest." },
      prompt: { type: "string", description: "What the owner is asked to do each time it runs." },
      frequency: { type: "string", enum: ["daily", "interval", "once"], description: "daily at a time (optionally on some weekdays), every N minutes, or once at an instant." },
      time: { type: "string", description: "HH:MM local time, for daily." },
      weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0 = Sunday … 6 = Saturday, for daily; every day when omitted." },
      every_minutes: { type: "integer", minimum: 1, description: "Minutes between runs, for interval." },
      at: { type: "string", description: "ISO instant, for once." },
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
      mission: { type: "string", description: "Optional updated bounded responsibility." },
      active: { type: "boolean", description: "true activates/reactivates; false suspends without deleting history." },
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
}] as const;

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

async function callEndpoint(path: string, input: Json): Promise<unknown> {
  const origin = requireEnvironment("LOCALBIZOS_TEAM_ORIGIN");
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${await sessionToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
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
/** One endpoint for every agency tool: `{ tool, arguments }`. */
const callAgency: TeamCall = (input) => callEndpoint("/api/internal/local-team/agency", input);

function textResult(value: unknown, isError = false, max = MAX_RESULT_CHARS): Json {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text: text.slice(0, max) }],
    ...(isError ? { isError: true } : {}),
  };
}

export interface LocalTeamMcpOptions {
  /** The agency invoker, when this server was mounted with the `agency`
   * toolset; `null` (the default) lists and routes the team tools only. */
  agency?: TeamCall | null;
}

export async function handleLocalTeamMessage(
  message: Json,
  invokeRecruit: TeamCall = callRecruit,
  invokeManage: TeamCall = callManage,
  invokeSchedule: TeamCall = callSchedule,
  invokeCheckpoint: TeamCall = callCheckpoint,
  options: LocalTeamMcpOptions = {},
): Promise<Json | null> {
  const invokeAgency = options.agency ?? null;
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
    const teamTools = LOCAL_TEAM_TOOL_SPECS.map((tool) => ({
      ...tool,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
    const agencyTools = invokeAgency
      ? AGENCY_TOOL_SPECS.map((tool) => ({
        ...tool,
        annotations: {
          readOnlyHint: tool.name === "agency_context" || tool.name.startsWith("agency_list") || tool.name.startsWith("agency_read"),
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      }))
      : [];
    return reply({ tools: [...teamTools, ...agencyTools] });
  }
  if (method === "tools/call") {
    try {
      if (params.name === "recruit_agent") return reply(textResult(await invokeRecruit((params.arguments ?? {}) as Json)));
      if (params.name === "manage_agent") return reply(textResult(await invokeManage((params.arguments ?? {}) as Json)));
      if (params.name === "schedule_routine") return reply(textResult(await invokeSchedule((params.arguments ?? {}) as Json)));
      if (params.name === "checkpoint_task") return reply(textResult(await invokeCheckpoint((params.arguments ?? {}) as Json)));
      if (invokeAgency && isAgencyToolName(params.name)) {
        return reply(textResult(await invokeAgency({ tool: params.name, arguments: params.arguments ?? {} }), false, MAX_AGENCY_RESULT_CHARS));
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
  serveLocalTeam(process.stdin, { agency: toolsets.has("agency") ? callAgency : null });
}
