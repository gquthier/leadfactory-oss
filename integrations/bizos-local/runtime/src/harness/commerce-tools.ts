// The commerce tools an agent of the E-commerce pack can call.
//
// Pure data, like `agency-tools.ts`: imported by the sidecar (dynamic tools
// for Codex) and by the stdio MCP twin for Claude. The cockpit
// (`agency-kit/ecommerce/lib/app.mjs`) owns the record schema and validates
// every body; `commerce_schema` hands that schema to the agent verbatim so
// no field is guessed, and the service refuses a field the schema does not
// list before the cockpit is asked.
//
// Deliberately absent: delete, import/export, generic HTTP, the filesystem.
// Nothing here publishes a store, spends on ads, sends email or orders stock.

export const COMMERCE_COLLECTIONS = [
  "products",
  "competitors",
  "suppliers",
  "storefronts",
  "creatives",
  "campaigns",
  "tasks",
  "deliverables",
  "metrics",
] as const;
export type CommerceCollection = (typeof COMMERCE_COLLECTIONS)[number];

export function isCommerceCollection(value: unknown): value is CommerceCollection {
  return typeof value === "string" && (COMMERCE_COLLECTIONS as readonly string[]).includes(value);
}

const ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
const RECORD_ACTIONS = ["list", "get", "create", "update"] as const;

/** The dashboard config an agent may write: JSON, bounded, no code. */
export const MAX_DASHBOARD_CONFIG_CHARS = 64_000;

export const COMMERCE_TOOL_SPECS = [
  {
    name: "commerce_context",
    description: "Read the store profile, the record counts per collection and the dashboard's current configuration, plus the list of collections and their fields (short form). Start here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "commerce_schema",
    description: "The exact record schema of the cockpit: every collection, its fields (type, required, enum, limits) and its links to other collections. Pass collection to read one. Use these field names verbatim in commerce_records.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", enum: [...COMMERCE_COLLECTIONS], description: "One collection, or omit for all." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "commerce_records",
    description: "Records of one collection (products, competitors, suppliers, storefronts, creatives, campaigns, tasks, deliverables, metrics): list, get, create, update. Fields come from commerce_schema; an unknown field is refused. Links to another record (productId, campaignId…) are validated by the cockpit. Deleting is not available to agents.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", enum: [...COMMERCE_COLLECTIONS] },
        action: { type: "string", enum: [...RECORD_ACTIONS], description: "list, get, create or update." },
        id: { type: "string", pattern: ID_PATTERN, description: "The record id, for get and update." },
        data: { type: "object", description: "Fields for create and update, named as commerce_schema lists them.", additionalProperties: true },
        productId: { type: "string", pattern: ID_PATTERN, description: "For list: only the records linked to this product." },
      },
      required: ["collection", "action"],
      additionalProperties: false,
    },
  },
  {
    name: "commerce_profile_update",
    description: "Update the store's own profile (name, market, language, positioning… as commerce_schema lists under profile). Read it with commerce_context.",
    inputSchema: {
      type: "object",
      properties: { data: { type: "object", additionalProperties: true, description: "Profile fields as the schema lists them." } },
      required: ["data"],
      additionalProperties: false,
    },
  },
  {
    name: "commerce_dashboard",
    description: "The dashboard's declarative configuration (which widgets, which metrics, which order): get, or update with a typed JSON config the cockpit validates. Configuration only — no code, no script.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "update"] },
        config: { type: "object", additionalProperties: true, description: "For update: the full configuration object, as commerce_schema describes under dashboard." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "commerce_list_skills",
    description: "List the e-commerce skills embedded with this pack (name, description, reference files). Read one with commerce_read_skill when the task calls for it; do not load them all.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "commerce_read_skill",
    description: "Read one skill's SKILL.md in full, or one of its reference files (reference = file name listed by commerce_list_skills).",
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
    name: "commerce_read_document",
    description: "Read a note of the store vault (Processes/, Knowledge/, Products/, your role folder), or list a folder when path names one. Read-only; paths are relative to the vault root; the dashboard's data folder is not readable here.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", maxLength: 512, description: "Relative path such as 'Processes/Stages.md' or 'Products'. Empty lists the root." },
      },
      additionalProperties: false,
    },
  },
] as const;

export type CommerceToolName = (typeof COMMERCE_TOOL_SPECS)[number]["name"];

export const COMMERCE_TOOL_NAMES: ReadonlySet<string> = new Set(COMMERCE_TOOL_SPECS.map((tool) => tool.name));

export function isCommerceToolName(value: unknown): value is CommerceToolName {
  return typeof value === "string" && COMMERCE_TOOL_NAMES.has(value);
}

/** What every agent of the pack is told about its tools — appended to the
 * pack's own instructions at install, naming exactly what the runtime grants. */
export const COMMERCE_TOOLS_INSTRUCTIONS = `## Runtime tools (Local BizOS)
Your dashboard is the E-commerce cockpit installed in this app (Apps → E-commerce). You reach its records only through these tools, granted to each of your runs and revoked when the run ends or is stopped:
- commerce_context — the store profile, record counts and the dashboard configuration.
- commerce_schema — the exact fields of every collection; read it before writing a record.
- commerce_records — list, get, create, update records of one collection: products, competitors, suppliers, storefronts, creatives, campaigns, tasks, deliverables, metrics.
- commerce_profile_update — the store's own profile.
- commerce_dashboard — read or update the dashboard's declarative configuration (JSON, no code).
- commerce_list_skills, commerce_read_skill — the e-commerce skills (SKILL.md, then its references). Read the one skill the task calls for, not all of them.
- commerce_read_document — a note of the store vault (Processes/, Knowledge/, Products/, your role folder).
Rules: work on one product at a time and link every record to its productId. Nothing here publishes a storefront, launches or changes ads, sends email, spends money or orders stock: those stay with the person and their own accounts, none of which this template connects. A tool result is the only proof that a change happened; never report a change you did not get back from a tool.`;
