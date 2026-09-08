// The agency tools an agent of the LeadFactory pack can call.
//
// Pure data: this module is imported both by the sidecar (which serves the
// tools to Codex as dynamic tools) and by the stdio MCP twin for Claude
// (`local-team-mcp.ts`), which must stay a tiny standalone graph. The schemas
// mirror the cockpit's own validation (`agency-kit/lib/validate.mjs` and
// `onboarding.mjs`): the same enums, the same limits, so a refused call comes
// back with the cockpit's sentence rather than a silent coercion.
//
// Deliberately absent: delete, import/export, demo, connections, the
// OpenRouter generator, generic HTTP. The onboarding review is a human act in
// the dashboard and has no tool.

export const CLIENT_STATUS = ["prospect", "onboarding", "actif", "pause", "termine"] as const;
export const CAMPAIGN_CHANNELS = ["cold-email", "meta", "google", "organic"] as const;
export const CAMPAIGN_STATUS = ["draft", "ready", "active", "paused", "done"] as const;
export const DELIVERABLE_TYPES = ["brief", "cold-email", "creative-brief", "report"] as const;
export const DELIVERABLE_SOURCES = ["manual", "template", "ai"] as const;
export const AGENCY_LANGUAGES = ["fr", "en"] as const;

export const LIMITS = { short: 120, medium: 400, long: 4000, content: 40_000 } as const;

const ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
const CRUD_ACTIONS = ["list", "get", "create", "update"] as const;

const idField = (description: string) => ({ type: "string", pattern: ID_PATTERN, description });
const text = (max: number, description: string) => ({ type: "string", maxLength: max, description });
const money = (description: string) => ({ type: "number", minimum: 0, maximum: 100_000_000, description });

export const CLIENT_FIELDS = {
  company: text(LIMITS.short, "Company name. Required on create."),
  contact: text(LIMITS.short, "Main contact name."),
  email: text(LIMITS.short, "Contact email (validated by the cockpit)."),
  offer: text(LIMITS.medium, "What the client sells."),
  audience: text(LIMITS.medium, "Who the client sells to."),
  goal: text(LIMITS.medium, "The client's objective."),
  budget: money("Monthly budget in EUR, 0 when unknown."),
  notes: text(LIMITS.long, "Free notes."),
  status: { type: "string", enum: [...CLIENT_STATUS], description: "Client status; default prospect." },
} as const;

export const CAMPAIGN_FIELDS = {
  name: text(LIMITS.short, "Campaign name. Required on create."),
  channel: { type: "string", enum: [...CAMPAIGN_CHANNELS], description: "Main channel. Required on create." },
  goal: text(LIMITS.medium, "Campaign objective."),
  budget: money("Budget in EUR."),
  status: { type: "string", enum: [...CAMPAIGN_STATUS], description: "Campaign status; default draft." },
} as const;

export const TASK_FIELDS = {
  title: text(LIMITS.medium, "Task title. Required on create."),
  campaignId: { type: ["string", "null"], pattern: ID_PATTERN, description: "Campaign of the SAME client, or null." },
  done: { type: "boolean", description: "Whether the task is done." },
} as const;

export const DELIVERABLE_FIELDS = {
  type: { type: "string", enum: [...DELIVERABLE_TYPES], description: "Deliverable type. Required on create." },
  title: text(LIMITS.short, "Title. Required on create."),
  content: text(LIMITS.content, "The text of the deliverable (Markdown)."),
  campaignId: { type: ["string", "null"], pattern: ID_PATTERN, description: "Campaign of the SAME client, or null." },
  source: { type: "string", enum: [...DELIVERABLE_SOURCES], description: "Origin: 'ai' when you wrote it (then give model), 'manual' when transcribing the person's own text." },
  model: text(LIMITS.short, "Your model name; required when source is 'ai'."),
} as const;

export const AGENCY_PROFILE_FIELDS = {
  name: text(LIMITS.short, "Agency name."),
  offer: text(LIMITS.medium, "Agency offer."),
  audience: text(LIMITS.medium, "Agency target audience."),
  language: { type: "string", enum: [...AGENCY_LANGUAGES], description: "Working language." },
  contact: text(LIMITS.short, "Agency contact name."),
  email: text(LIMITS.short, "Agency contact email."),
} as const;

/** One onboarding section as `PUT /api/clients/:id/onboarding` takes it:
 * the schema itself (fields, types, required) comes from the `schema` action. */
const ONBOARDING_SECTIONS = ["company", "offer", "target", "campaign", "delivery"] as const;
const onboardingSectionSchema = { type: "object", additionalProperties: true, description: "Fields of this section, as listed by the schema action." };

function crudTool(input: {
  name: string;
  resource: string;
  idField: string;
  fields: Record<string, unknown>;
  description: string;
  requireClient: boolean;
}) {
  const properties: Record<string, unknown> = {
    action: { type: "string", enum: [...CRUD_ACTIONS], description: "list, get, create or update." },
    ...(input.requireClient ? { clientId: idField("The client this call is bounded to. Required for every action.") } : {}),
    [input.idField]: idField(`The ${input.resource} id, for get and update.`),
    data: {
      type: "object",
      description: `Fields for create and update. Unknown fields are refused.`,
      properties: input.fields,
      additionalProperties: false,
    },
  };
  return {
    name: input.name,
    description: input.description,
    inputSchema: {
      type: "object",
      properties,
      required: ["action", ...(input.requireClient ? ["clientId"] : [])],
      additionalProperties: false,
    },
  };
}

export const AGENCY_TOOL_SPECS = [
  {
    name: "agency_context",
    description: "Read the agency profile and the list of clients, or one client's full dossier (client, campaigns, tasks, deliverables, onboarding progress) when clientId is given. format 'markdown' returns the dossier as the cockpit exports it.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: idField("A client id: returns that client's dossier instead of the overview."),
        format: { type: "string", enum: ["json", "markdown"], description: "Dossier format; default json." },
      },
      additionalProperties: false,
    },
  },
  crudTool({
    name: "agency_clients",
    resource: "client",
    idField: "clientId",
    fields: CLIENT_FIELDS,
    requireClient: false,
    description: "Clients of the agency in the local cockpit: list, get, create, update. Deleting is not available to agents.",
  }),
  crudTool({
    name: "agency_campaigns",
    resource: "campaign",
    idField: "campaignId",
    fields: CAMPAIGN_FIELDS,
    requireClient: true,
    description: "Campaigns of ONE client: list, get, create, update. A campaign of another client is refused.",
  }),
  crudTool({
    name: "agency_tasks",
    resource: "task",
    idField: "taskId",
    fields: TASK_FIELDS,
    requireClient: true,
    description: "Tasks of ONE client (checklist and work items): list, get, create, update. A task or campaign of another client is refused.",
  }),
  crudTool({
    name: "agency_deliverables",
    resource: "deliverable",
    idField: "deliverableId",
    fields: DELIVERABLE_FIELDS,
    requireClient: true,
    description: "Text deliverables of ONE client (brief, cold-email, creative-brief, report): list (previews), get (full content), create, update. Nothing is sent or published by this tool.",
  }),
  {
    name: "agency_onboarding",
    description: "The client onboarding questionnaire of the cockpit. schema: the steps and fields. get: the current draft and progress. save: merge sections into the draft. submit: submit a complete questionnaire, which creates the draft campaign, the checklist and the brief. Marking it reviewed is the person's act in the dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["schema", "get", "save", "submit"] },
        clientId: idField("The client; required for get, save and submit."),
        data: {
          type: "object",
          description: "For save: sections to merge, each an object of field values as the schema lists them; optional step index.",
          properties: {
            ...Object.fromEntries(ONBOARDING_SECTIONS.map((section) => [section, onboardingSectionSchema])),
            step: { type: "integer", minimum: 0, maximum: 4, description: "Current step index." },
          },
          additionalProperties: false,
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "agency_profile_update",
    description: "Update the agency's own profile (name, offer, audience, language, contact, email) in the cockpit. Read it with agency_context.",
    inputSchema: {
      type: "object",
      properties: { data: { type: "object", properties: AGENCY_PROFILE_FIELDS, additionalProperties: false } },
      required: ["data"],
      additionalProperties: false,
    },
  },
  {
    name: "agency_list_skills",
    description: "List the agency skills embedded with this pack (name, description, reference files). Read one with agency_read_skill when the task calls for it; do not load them all.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agency_read_skill",
    description: "Read one skill's SKILL.md in full, or one of its reference files (reference = file name listed by agency_list_skills).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$", description: "Skill name, as listed." },
        reference: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$", description: "A file under the skill's references/ folder." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "agency_read_document",
    description: "Read a note of the agency vault (Processes/, Knowledge/, Clients/, Campaigns/, your role folder), or list a folder when path names one. Read-only; paths are relative to the vault root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", maxLength: 512, description: "Relative path such as 'Processes/Handoffs.md' or 'Knowledge/Draft'. Empty lists the root." },
      },
      additionalProperties: false,
    },
  },
] as const;

export type AgencyToolName = (typeof AGENCY_TOOL_SPECS)[number]["name"];

export const AGENCY_TOOL_NAMES: ReadonlySet<string> = new Set(AGENCY_TOOL_SPECS.map((tool) => tool.name));

export function isAgencyToolName(value: unknown): value is AgencyToolName {
  return typeof value === "string" && AGENCY_TOOL_NAMES.has(value);
}
