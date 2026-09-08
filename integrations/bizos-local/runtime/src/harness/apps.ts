// Local apps — the MCP servers a person adds to their own local workspace.
//
// An "app" here is one MCP server the user chose from the catalogue below (or
// typed in themselves), with its configuration and, when it needs one, its
// secret. Everything lives in `apps.json` (0600, same folder as the user's
// conversations). Each turn, `mountedServers()` turns the enabled apps into
// the per-server specs the codex and claude drivers already understand, so
// an app the user adds in the Apps tab is a tool the agent has on its next
// message — and nothing more: the approval policy (`ask`) keeps every
// write-capable server on the driver's on-request card.
//
// Product boundary: this is `local-bizos-oss`. No cloud organisation, no
// cloud credential and no BizOS-provisioned account is involved. A secret
// the user pastes here stays on this Mac, in this file, and reaches the
// server through the child ENVIRONMENT (never argv), the same way the
// session broker tokens do in `mcp-mount.ts`.
import { accessSync, constants, existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { cleanChildEnvironment } from "./child-env.js";
import type { HttpMcpServer, McpServerSpec, StdioMcpServer } from "./codex-driver.js";
import { augmentedPath, findCliCandidates } from "./env-path.js";
import { newId } from "./ids.js";
import type { Storage } from "./storage.js";

export const APPS_FILE = "apps.json";
export const MAX_LOCAL_APPS = 48;
export const MAX_NAME = 60;
export const MAX_DESCRIPTION = 600;
export const MAX_SECRET_LENGTH = 4_096;
export const MAX_ARGS = 32;
export const MAX_ARG_LENGTH = 512;

export type LocalAppTransport = "stdio" | "http";
export type LocalAppAuth = "none" | "api-key" | "oauth";
/** `auto`: the driver runs the server's tools without a card. `ask`: every
 * call raises an approval card in the thread (codex) or is refused in print
 * mode (claude, which has no card to raise). */
export type LocalAppApproval = "auto" | "ask";
export type LocalAppCategory =
  | "files"
  | "web"
  | "dev"
  | "knowledge"
  | "data"
  | "productivity"
  | "business"
  | "payments"
  | "design";

export const LOCAL_APP_CATEGORIES: ReadonlyArray<{ id: LocalAppCategory; label: string }> = [
  { id: "files", label: "Files & browser" },
  { id: "web", label: "Web & research" },
  { id: "dev", label: "Code & infrastructure" },
  { id: "knowledge", label: "Docs & memory" },
  { id: "data", label: "Data" },
  { id: "productivity", label: "Productivity" },
  { id: "business", label: "Sales & support" },
  { id: "payments", label: "Payments" },
  { id: "design", label: "Design & media" },
];

export interface LocalAppField {
  key: string;
  label: string;
  kind: "secret" | "text" | "url";
  required: boolean;
  /** stdio: the value is forwarded to the server as this environment variable. */
  env?: string;
  /** stdio: the value is appended to `args` through this template
   * (`{{value}}`). Only for CLIs with no environment alternative; it is
   * visible in a process listing, so never a secret. */
  arg?: string;
  /** http: the value is sent as `Authorization: Bearer …`. */
  bearer?: boolean;
  hint?: string;
  placeholder?: string;
}

export interface LocalAppCatalogEntry {
  id: string;
  name: string;
  blurb: string;
  category: LocalAppCategory;
  /** An Axo symbol name the desktop can draw. */
  symbol: string;
  transport: LocalAppTransport;
  auth: LocalAppAuth;
  command?: string;
  args?: string[];
  url?: string;
  fields: LocalAppField[];
  approval: LocalAppApproval;
  /** The launcher this server needs on the Mac. */
  requires?: "npx" | "uvx";
  docs?: string;
  /** The server takes the folders shared in Settings → Access as arguments. */
  sharedFolders?: boolean;
  /** Maintained by a third party, not the vendor. */
  community?: boolean;
  /** The vendor's mark, as a simple-icons slug, when it has one. */
  brand?: string;
  /** Two or three words the store filters and shows. */
  tags?: string[];
}

const npx = (pkg: string, ...rest: string[]): Pick<LocalAppCatalogEntry, "transport" | "command" | "args" | "requires"> => ({
  transport: "stdio",
  command: "npx",
  args: ["-y", pkg, ...rest],
  requires: "npx",
});

const uvx = (pkg: string, ...rest: string[]): Pick<LocalAppCatalogEntry, "transport" | "command" | "args" | "requires"> => ({
  transport: "stdio",
  command: "uvx",
  args: [pkg, ...rest],
  requires: "uvx",
});

const remote = (url: string): Pick<LocalAppCatalogEntry, "transport" | "url"> => ({ transport: "http", url });

const secretEnv = (env: string, label: string, hint?: string): LocalAppField => ({
  key: env.toLowerCase(),
  label,
  kind: "secret",
  required: true,
  env,
  ...(hint ? { hint } : {}),
});

const bearer = (label: string, hint?: string): LocalAppField => ({
  key: "token",
  label,
  kind: "secret",
  required: true,
  bearer: true,
  ...(hint ? { hint } : {}),
});

/**
 * The catalogue. Packages and URLs are the vendors' own, as published in their
 * MCP documentation; a `community` entry is maintained by someone else.
 * Keeping this list honest matters more than keeping it long: a server that
 * does not exist costs the user a failed turn, not a missing feature.
 */
export const LOCAL_APP_CATALOG: ReadonlyArray<LocalAppCatalogEntry> = [
  {
    id: "filesystem",
    tags: ["Files", "Local"],
    name: "Files",
    blurb: "Read and edit the folders you allow in Computer → File access.",
    category: "files",
    symbol: "folder",
    ...npx("@modelcontextprotocol/server-filesystem"),
    auth: "none",
    fields: [],
    approval: "ask",
    sharedFolders: true,
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "playwright",
    tags: ["Browser", "Automation"],
    name: "Browser",
    blurb: "Drive a real browser: open pages, click, fill forms, take screenshots.",
    category: "files",
    symbol: "globe",
    ...npx("@playwright/mcp@latest"),
    auth: "none",
    fields: [],
    approval: "ask",
    docs: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "fetch",
    brand: "modelcontextprotocol",
    tags: ["Web", "Read"],
    name: "Fetch",
    blurb: "Fetch a web page and hand it to the agent as readable text.",
    category: "web",
    symbol: "globe",
    ...uvx("mcp-server-fetch"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "firecrawl",
    tags: ["Scraping", "Search"],
    name: "Firecrawl",
    blurb: "Scrape, crawl and search the web with Firecrawl.",
    category: "web",
    symbol: "globe",
    ...npx("firecrawl-mcp"),
    auth: "api-key",
    fields: [secretEnv("FIRECRAWL_API_KEY", "Firecrawl API key")],
    approval: "auto",
    docs: "https://docs.firecrawl.dev/mcp",
  },
  {
    id: "exa",
    tags: ["Search"],
    name: "Exa",
    blurb: "Neural web search built for agents.",
    category: "web",
    symbol: "search",
    ...npx("exa-mcp-server"),
    auth: "api-key",
    fields: [secretEnv("EXA_API_KEY", "Exa API key")],
    approval: "auto",
    docs: "https://docs.exa.ai/reference/exa-mcp",
  },
  {
    id: "tavily",
    tags: ["Search", "Extract"],
    name: "Tavily",
    blurb: "Search and extract web content through Tavily.",
    category: "web",
    symbol: "search",
    ...npx("tavily-mcp@latest"),
    auth: "api-key",
    fields: [secretEnv("TAVILY_API_KEY", "Tavily API key")],
    approval: "auto",
    docs: "https://docs.tavily.com/documentation/mcp",
  },
  {
    id: "brave-search",
    brand: "brave",
    tags: ["Search", "News"],
    name: "Brave Search",
    blurb: "Web, news and image search from Brave.",
    category: "web",
    symbol: "search",
    ...npx("@brave/brave-search-mcp-server"),
    auth: "api-key",
    fields: [secretEnv("BRAVE_API_KEY", "Brave Search API key")],
    approval: "auto",
    docs: "https://github.com/brave/brave-search-mcp-server",
  },
  {
    id: "perplexity",
    brand: "perplexity",
    tags: ["Answers", "Search"],
    name: "Perplexity",
    blurb: "Ask Perplexity for sourced answers from the live web.",
    category: "web",
    symbol: "search",
    ...npx("server-perplexity-ask"),
    auth: "api-key",
    fields: [secretEnv("PERPLEXITY_API_KEY", "Perplexity API key")],
    approval: "auto",
    docs: "https://github.com/ppl-ai/modelcontextprotocol",
  },
  {
    id: "apify",
    tags: ["Scraping", "Automation"],
    name: "Apify",
    blurb: "Run Apify actors: scrapers for social networks, maps, marketplaces.",
    category: "web",
    symbol: "globe",
    ...remote("https://mcp.apify.com"),
    auth: "api-key",
    fields: [bearer("Apify API token")],
    approval: "ask",
    docs: "https://docs.apify.com/platform/integrations/mcp",
  },
  {
    id: "github",
    brand: "github",
    tags: ["Code", "Issues"],
    name: "GitHub",
    blurb: "Issues, pull requests, code search and repositories.",
    category: "dev",
    symbol: "connections",
    ...remote("https://api.githubcopilot.com/mcp/"),
    auth: "api-key",
    fields: [bearer("Personal access token", "A fine-grained token with only the repositories you want the agent to see.")],
    approval: "ask",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    id: "git",
    brand: "git",
    tags: ["Code", "Local"],
    name: "Git",
    blurb: "Read history, diffs and branches of local repositories.",
    category: "dev",
    symbol: "drive",
    ...uvx("mcp-server-git"),
    auth: "none",
    fields: [],
    approval: "ask",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
  },
  {
    id: "sentry",
    brand: "sentry",
    tags: ["Errors", "Monitoring"],
    name: "Sentry",
    blurb: "Errors, issues and performance data from your Sentry projects.",
    category: "dev",
    symbol: "error-circle",
    ...remote("https://mcp.sentry.dev/mcp"),
    auth: "oauth",
    fields: [],
    approval: "auto",
    docs: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    id: "vercel",
    brand: "vercel",
    tags: ["Hosting", "Deploy"],
    name: "Vercel",
    blurb: "Projects, deployments and logs on Vercel.",
    category: "dev",
    symbol: "bolt",
    ...remote("https://mcp.vercel.com"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://vercel.com/docs/mcp/vercel-mcp",
  },
  {
    id: "context7",
    tags: ["Docs", "Code"],
    name: "Context7",
    blurb: "Up-to-date documentation for the libraries the agent codes with.",
    category: "dev",
    symbol: "file",
    ...npx("@upstash/context7-mcp"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "cloudflare-docs",
    brand: "cloudflare",
    tags: ["Docs"],
    name: "Cloudflare Docs",
    blurb: "Search Cloudflare's documentation.",
    category: "dev",
    symbol: "file",
    ...remote("https://docs.mcp.cloudflare.com/mcp"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    id: "shopify-dev",
    brand: "shopify",
    tags: ["Docs", "E-commerce"],
    name: "Shopify Dev",
    blurb: "Shopify's developer docs, GraphQL schemas and Liquid reference.",
    category: "dev",
    symbol: "file",
    ...npx("@shopify/dev-mcp@latest"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://shopify.dev/docs/apps/build/devmcp",
  },
  {
    id: "memory",
    brand: "modelcontextprotocol",
    tags: ["Memory", "Graph"],
    name: "Memory",
    blurb: "A knowledge graph the agent keeps between conversations.",
    category: "knowledge",
    symbol: "cube",
    ...npx("@modelcontextprotocol/server-memory"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "sequential-thinking",
    brand: "modelcontextprotocol",
    tags: ["Reasoning"],
    name: "Sequential thinking",
    blurb: "A scratchpad for step-by-step reasoning on hard problems.",
    category: "knowledge",
    symbol: "list-bullet",
    ...npx("@modelcontextprotocol/server-sequential-thinking"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
  {
    id: "hugging-face",
    brand: "huggingface",
    tags: ["Models", "Datasets"],
    name: "Hugging Face",
    blurb: "Models, datasets, papers and Spaces on the Hub.",
    category: "knowledge",
    symbol: "cube",
    ...remote("https://huggingface.co/mcp"),
    auth: "oauth",
    fields: [],
    approval: "auto",
    docs: "https://huggingface.co/settings/mcp",
  },
  {
    id: "supabase",
    brand: "supabase",
    tags: ["Database", "Backend"],
    name: "Supabase",
    blurb: "Tables, SQL and edge functions of one Supabase project.",
    category: "data",
    symbol: "drive",
    ...npx("@supabase/mcp-server-supabase@latest"),
    auth: "api-key",
    fields: [
      secretEnv("SUPABASE_ACCESS_TOKEN", "Personal access token"),
      { key: "project_ref", label: "Project ref", kind: "text", required: true, arg: "--project-ref={{value}}" },
    ],
    approval: "ask",
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "neon",
    brand: "neon",
    tags: ["Postgres", "Database"],
    name: "Neon",
    blurb: "Postgres databases, branches and SQL on Neon.",
    category: "data",
    symbol: "drive",
    ...remote("https://mcp.neon.tech/mcp"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://neon.com/docs/ai/neon-mcp-server",
  },
  {
    id: "postgres",
    brand: "postgresql",
    tags: ["Database", "SQL"],
    name: "Postgres",
    blurb: "Query any Postgres database, read-only by default.",
    category: "data",
    symbol: "drive",
    ...uvx("postgres-mcp", "--access-mode=restricted"),
    auth: "api-key",
    fields: [secretEnv("DATABASE_URI", "Connection string", "postgresql://user:password@host:5432/db")],
    approval: "ask",
    docs: "https://github.com/crystaldba/postgres-mcp",
    community: true,
  },
  {
    id: "airtable",
    brand: "airtable",
    tags: ["Tables", "No-code"],
    name: "Airtable",
    blurb: "Bases, tables and records in Airtable.",
    category: "data",
    symbol: "grid",
    ...npx("airtable-mcp-server"),
    auth: "api-key",
    fields: [secretEnv("AIRTABLE_API_KEY", "Personal access token")],
    approval: "ask",
    docs: "https://github.com/domdomegg/airtable-mcp-server",
    community: true,
  },
  {
    id: "notion",
    brand: "notion",
    tags: ["Notes", "Wiki"],
    name: "Notion",
    blurb: "Pages, databases and comments in your Notion workspace.",
    category: "productivity",
    symbol: "file",
    ...remote("https://mcp.notion.com/mcp"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://developers.notion.com/docs/mcp",
  },
  {
    id: "linear",
    brand: "linear",
    tags: ["Issues", "Projects"],
    name: "Linear",
    blurb: "Issues, projects and cycles in Linear.",
    category: "productivity",
    symbol: "list-bullet",
    ...remote("https://mcp.linear.app/mcp"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "time",
    brand: "modelcontextprotocol",
    tags: ["Time", "Utility"],
    name: "Time",
    blurb: "The current time and timezone conversions.",
    category: "productivity",
    symbol: "clock",
    ...uvx("mcp-server-time"),
    auth: "none",
    fields: [],
    approval: "auto",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
  },
  {
    id: "hubspot",
    brand: "hubspot",
    tags: ["CRM", "Sales"],
    name: "HubSpot",
    blurb: "Contacts, companies, deals and tickets in HubSpot.",
    category: "business",
    symbol: "group",
    ...npx("@hubspot/mcp-server"),
    auth: "api-key",
    fields: [secretEnv("PRIVATE_APP_ACCESS_TOKEN", "Private app access token")],
    approval: "ask",
    docs: "https://developers.hubspot.com/mcp",
  },
  {
    id: "intercom",
    brand: "intercom",
    tags: ["Support", "Chat"],
    name: "Intercom",
    blurb: "Conversations, contacts and articles in Intercom.",
    category: "business",
    symbol: "message",
    ...remote("https://mcp.intercom.com/mcp"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://developers.intercom.com/docs/guides/mcp",
  },
  {
    id: "stripe",
    brand: "stripe",
    tags: ["Payments", "Billing"],
    name: "Stripe",
    blurb: "Customers, products, payment links and invoices in Stripe.",
    category: "payments",
    symbol: "creditcard",
    ...remote("https://mcp.stripe.com"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "paypal",
    brand: "paypal",
    tags: ["Payments"],
    name: "PayPal",
    blurb: "Invoices, orders and subscriptions in PayPal.",
    category: "payments",
    symbol: "creditcard",
    ...remote("https://mcp.paypal.com/mcp"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://developer.paypal.com/tools/mcp-server/",
  },
  {
    id: "figma",
    brand: "figma",
    tags: ["Design"],
    name: "Figma",
    blurb: "Read designs, components and variables from Figma files.",
    category: "design",
    symbol: "photo",
    ...remote("https://mcp.figma.com/mcp"),
    auth: "oauth",
    fields: [],
    approval: "auto",
    docs: "https://help.figma.com/hc/en-us/articles/32132100833559",
  },
  {
    id: "canva",
    tags: ["Design"],
    name: "Canva",
    blurb: "Create and edit designs in Canva.",
    category: "design",
    symbol: "photo",
    ...remote("https://mcp.canva.com/mcp"),
    auth: "oauth",
    fields: [],
    approval: "ask",
    docs: "https://www.canva.dev/docs/connect/canva-mcp-server-setup/",
  },
  {
    id: "elevenlabs",
    brand: "elevenlabs",
    tags: ["Voice", "Audio"],
    name: "ElevenLabs",
    blurb: "Text to speech, voices and transcription with ElevenLabs.",
    category: "design",
    symbol: "play",
    ...uvx("elevenlabs-mcp"),
    auth: "api-key",
    fields: [secretEnv("ELEVENLABS_API_KEY", "ElevenLabs API key")],
    approval: "ask",
    docs: "https://github.com/elevenlabs/elevenlabs-mcp",
  },
];

/** Server keys the harness mounts itself; an app may never shadow one. */
export const RESERVED_SERVER_NAMES: ReadonlySet<string> = new Set([
  "bizos",
  "bizos_actions",
  "bizos_computer",
  "local_team_actions",
]);

/** Environment variables an app may never set: they change WHAT runs, not
 * what the server knows. `LBZ_`/`LOCALBIZOS_` are the harness's own. */
const FORBIDDEN_ENV_NAMES: ReadonlySet<string> = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "PWD",
  "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH",
  "ELECTRON_RUN_AS_NODE", "CODEX_HOME", "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
]);

export const SERVER_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** `newId("lap")`: the prefix and twenty hex characters. */
export const APP_ID = /^lap_[a-z0-9]{6,40}$/;

export class LocalAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_local_app";
  }
}

export interface InstalledLocalApp {
  id: string;
  catalogId: string | null;
  name: string;
  /** The person's own words for it; the catalogue blurb when left empty. */
  description: string;
  /** The MCP server key the driver sees (`mcp__<serverName>__<tool>`). */
  serverName: string;
  symbol: string;
  category: LocalAppCategory;
  transport: LocalAppTransport;
  auth: LocalAppAuth;
  command?: string;
  args?: string[];
  url?: string;
  /** Literal, non-secret environment (stdio). */
  env: Record<string, string>;
  /** Secret values by environment-variable name. For an http app the single
   * key `AUTHORIZATION` holds the bearer token. Never crosses the bridge. */
  secrets: Record<string, string>;
  /** Non-secret headers (http). */
  headers: Record<string, string>;
  approval: LocalAppApproval;
  enabled: boolean;
  /** `mounted`: the harness starts/points at the server each turn. `cli`: the
   * agent's own CLI holds the OAuth session and loads the server from its
   * config — the harness only launched the sign-in. */
  authMode: "mounted" | "cli";
  sharedFolders: boolean;
  createdAt: string;
  updatedAt: string;
  lastTest?: { at: string; ok: boolean; tools: string[]; error?: string };
}

/** What the renderer and the sidecar route see: secret NAMES only. */
export type PublicLocalApp = Omit<InstalledLocalApp, "secrets"> & { secretNames: string[] };

export interface AppsFile {
  version: 1;
  apps: InstalledLocalApp[];
}

/** What a person may change about an added app, catalogue or custom. */
export interface LocalAppDetails {
  name?: string;
  description?: string;
  approval?: LocalAppApproval;
}

export interface CustomLocalAppInput {
  name: string;
  description?: string;
  transport: LocalAppTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  headers?: Record<string, string>;
  approval?: LocalAppApproval;
}

export interface LocalAppPatch {
  enabled?: boolean;
  name?: string;
  description?: string;
  approval?: LocalAppApproval;
  /** Replace or add secrets by environment-variable name; an empty string clears one. */
  secrets?: Record<string, string>;
  args?: string[];
}

export function toPublic(app: InstalledLocalApp): PublicLocalApp {
  const { secrets, ...rest } = app;
  return { ...rest, secretNames: Object.keys(secrets) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isInstalledApp(value: unknown): value is InstalledLocalApp {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && APP_ID.test(value.id)
    && typeof value.serverName === "string" && SERVER_NAME.test(value.serverName)
    && typeof value.name === "string"
    && (value.transport === "stdio" || value.transport === "http");
}

/** Read `apps.json` leniently: a damaged row is dropped, not the file. */
export function normalizeAppsFile(raw: unknown): AppsFile {
  if (!isRecord(raw) || !Array.isArray(raw.apps)) return { version: 1, apps: [] };
  const apps = raw.apps.filter(isInstalledApp).map((app): InstalledLocalApp => ({
    id: app.id,
    catalogId: typeof app.catalogId === "string" ? app.catalogId : null,
    name: app.name,
    description: typeof app.description === "string" ? app.description.slice(0, MAX_DESCRIPTION) : "",
    serverName: app.serverName,
    symbol: typeof app.symbol === "string" ? app.symbol : "cube",
    category: LOCAL_APP_CATEGORIES.some((row) => row.id === app.category) ? app.category : "productivity",
    transport: app.transport,
    auth: app.auth === "api-key" || app.auth === "oauth" ? app.auth : "none",
    ...(typeof app.command === "string" ? { command: app.command } : {}),
    ...(Array.isArray(app.args) ? { args: stringArray(app.args) } : {}),
    ...(typeof app.url === "string" ? { url: app.url } : {}),
    env: stringMap(app.env),
    secrets: stringMap(app.secrets),
    headers: stringMap(app.headers),
    approval: app.approval === "auto" ? "auto" : "ask",
    enabled: app.enabled !== false,
    authMode: app.authMode === "cli" ? "cli" : "mounted",
    sharedFolders: app.sharedFolders === true,
    createdAt: typeof app.createdAt === "string" ? app.createdAt : new Date(0).toISOString(),
    updatedAt: typeof app.updatedAt === "string" ? app.updatedAt : new Date(0).toISOString(),
    ...(isRecord(app.lastTest) && typeof app.lastTest.at === "string"
      ? {
          lastTest: {
            at: app.lastTest.at,
            ok: app.lastTest.ok === true,
            tools: stringArray(app.lastTest.tools),
            ...(typeof app.lastTest.error === "string" ? { error: app.lastTest.error } : {}),
          },
        }
      : {}),
  }));
  return { version: 1, apps };
}

// ── validation ─────────────────────────────────────────────────────────────

export function validateEnvName(name: string): string {
  const trimmed = name.trim();
  if (!ENV_NAME.test(trimmed)) throw new LocalAppError(`${name || "(empty)"} is not an environment variable name`);
  if (FORBIDDEN_ENV_NAMES.has(trimmed) || trimmed.startsWith("LBZ_") || trimmed.startsWith("LOCALBIZOS_")) {
    throw new LocalAppError(`${trimmed} cannot be set by an app`);
  }
  return trimmed;
}

export function validateEnvValue(value: string, field: string): string {
  if (typeof value !== "string") throw new LocalAppError(`${field} must be text`);
  if (value.length > MAX_SECRET_LENGTH) throw new LocalAppError(`${field} is too long`);
  if (/[\r\n\0]/.test(value)) throw new LocalAppError(`${field} cannot contain a line break`);
  return value;
}

export function validateUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new LocalAppError("that is not a URL");
  }
  if (raw.trim().length > 2_048) throw new LocalAppError("the URL is too long");
  if (url.username || url.password) throw new LocalAppError("put credentials in a header, not in the URL");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new LocalAppError("a remote app must use https (http only on this Mac)");
  }
  return url.toString();
}

export function validateArgs(args: readonly string[]): string[] {
  if (args.length > MAX_ARGS) throw new LocalAppError(`at most ${MAX_ARGS} arguments`);
  return args.map((arg) => {
    if (typeof arg !== "string" || arg.length > MAX_ARG_LENGTH || /[\r\n\0]/.test(arg)) {
      throw new LocalAppError("an argument is not plain text");
    }
    return arg;
  });
}

/** `npx` → the npx on the augmented PATH; `/usr/local/bin/foo` → itself, if
 * executable. A relative path or a shell snippet is refused: the value is
 * spawned, never interpreted. */
export function resolveCommand(command: string, environment: NodeJS.ProcessEnv = process.env): string | null {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > MAX_ARG_LENGTH || /[\s\r\n\0;&|<>$`]/.test(trimmed)) return null;
  if (isAbsolute(trimmed)) {
    try {
      accessSync(trimmed, constants.X_OK);
      return existsSync(trimmed) ? trimmed : null;
    } catch {
      return null;
    }
  }
  if (trimmed.includes("/")) return null;
  return findCliCandidates(trimmed, environment)[0] ?? null;
}

/** One line, bounded; `undefined` when there is nothing left of it. */
export function cleanName(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\r\n\u2028\u2029\0]+/g, " ").trim().slice(0, MAX_NAME).trim();
  return text || undefined;
}

/** A short paragraph, bounded; `undefined` when absent, "" when cleared. */
export function cleanDescription(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\0/g, "").trim().slice(0, MAX_DESCRIPTION).trim();
}

export function serverNameFor(name: string, taken: ReadonlySet<string>): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32) || "app";
  let candidate = base;
  for (let n = 2; taken.has(candidate) || RESERVED_SERVER_NAMES.has(candidate); n += 1) {
    candidate = `${base}_${n}`.slice(0, 40);
  }
  return candidate;
}

// ── mounting ───────────────────────────────────────────────────────────────

export const HTTP_BEARER_SECRET = "AUTHORIZATION";

function bearerEnvName(app: InstalledLocalApp): string {
  return `LBZ_APP_${app.serverName.toUpperCase()}_TOKEN`;
}

/** The per-turn spec for one enabled, mounted app. */
export function mountApp(app: InstalledLocalApp, input: { sharedDirs: readonly string[]; environment?: NodeJS.ProcessEnv }): McpServerSpec | null {
  if (!app.enabled || app.authMode !== "mounted") return null;
  const preApproved = app.approval === "auto";
  if (app.transport === "http") {
    if (!app.url) return null;
    const token = app.secrets[HTTP_BEARER_SECRET];
    const envName = bearerEnvName(app);
    const server: HttpMcpServer = {
      url: app.url,
      headers: { ...app.headers },
      ...(token ? { bearerTokenEnv: envName } : {}),
      forwarded: token ? { [envName]: token } : {},
      preApproved,
    };
    return server;
  }
  if (!app.command) return null;
  const command = resolveCommand(app.command, input.environment);
  if (!command) return null;
  const server: StdioMcpServer = {
    command,
    args: [...(app.args ?? []), ...(app.sharedFolders ? input.sharedDirs : [])],
    env: { ...app.env },
    forwarded: { ...app.secrets },
    preApproved,
  };
  return server;
}

// ── the store ──────────────────────────────────────────────────────────────

export class AppsStore {
  private cached: AppsFile;

  constructor(
    private readonly storage: Storage,
    private readonly nowIso: () => string = () => new Date().toISOString(),
    private readonly environment: () => NodeJS.ProcessEnv = () => process.env,
  ) {
    this.cached = normalizeAppsFile(this.storage.readJson<unknown>(APPS_FILE, null));
  }

  private persist(): void {
    this.storage.writeJson(APPS_FILE, this.cached);
  }

  list(): InstalledLocalApp[] {
    return this.cached.apps.map((app) => ({ ...app }));
  }

  publicList(): PublicLocalApp[] {
    return this.cached.apps.map(toPublic);
  }

  get(id: string): InstalledLocalApp | undefined {
    const found = this.cached.apps.find((app) => app.id === id);
    return found ? { ...found } : undefined;
  }

  private takenNames(exceptId?: string): Set<string> {
    return new Set(this.cached.apps.filter((app) => app.id !== exceptId).map((app) => app.serverName));
  }

  private takenSecretNames(exceptId?: string): Set<string> {
    const names = new Set<string>();
    for (const app of this.cached.apps) {
      if (app.id === exceptId || app.transport !== "stdio") continue;
      for (const name of Object.keys(app.secrets)) names.add(name);
    }
    return names;
  }

  private assertRoom(): void {
    if (this.cached.apps.length >= MAX_LOCAL_APPS) {
      throw new LocalAppError(`the local workspace is limited to ${MAX_LOCAL_APPS} apps`);
    }
  }

  private checkSecretCollisions(secrets: Record<string, string>, exceptId?: string): void {
    const taken = this.takenSecretNames(exceptId);
    for (const name of Object.keys(secrets)) {
      if (taken.has(name)) {
        throw new LocalAppError(`another app already forwards ${name}; every secret name must be unique`);
      }
    }
  }

  /** Add one catalogue app with the values its fields ask for, under the
   * name and description the person wants for it. */
  install(catalogId: string, values: Record<string, string>, details: LocalAppDetails = {}): InstalledLocalApp {
    const entry = LOCAL_APP_CATALOG.find((row) => row.id === catalogId);
    if (!entry) throw new LocalAppError("that app is not in the catalogue");
    const name = cleanName(details.name) ?? entry.name;
    const description = cleanDescription(details.description) ?? "";
    if (this.cached.apps.some((app) => app.catalogId === catalogId)) {
      throw new LocalAppError(`${entry.name} is already added`);
    }
    this.assertRoom();
    const env: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    const args = [...(entry.args ?? [])];
    for (const field of entry.fields) {
      const raw = values[field.key];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) {
        if (field.required) throw new LocalAppError(`${field.label} is required`);
        continue;
      }
      validateEnvValue(value, field.label);
      if (field.bearer) {
        secrets[HTTP_BEARER_SECRET] = value;
      } else if (field.env) {
        const name = validateEnvName(field.env);
        if (field.kind === "secret") secrets[name] = value;
        else env[name] = value;
      } else if (field.arg) {
        if (field.kind === "secret") throw new LocalAppError(`${field.label} cannot travel as an argument`);
        args.push(field.arg.replace("{{value}}", value));
      }
      if (field.kind === "url") validateUrl(value);
    }
    if (entry.transport === "stdio") this.checkSecretCollisions(secrets);
    const now = this.nowIso();
    const app: InstalledLocalApp = {
      id: newId("lap"),
      catalogId: entry.id,
      name,
      description,
      serverName: serverNameFor(entry.id, this.takenNames()),
      symbol: entry.symbol,
      category: entry.category,
      transport: entry.transport,
      auth: entry.auth,
      ...(entry.command ? { command: entry.command } : {}),
      ...(entry.transport === "stdio" ? { args: validateArgs(args) } : {}),
      ...(entry.url ? { url: entry.url } : {}),
      env,
      secrets,
      headers: {},
      approval: details.approval ?? entry.approval,
      // An OAuth app is not usable until the CLI holds a session — the
      // sign-in flips it on. Everything else works from the next turn.
      enabled: entry.auth !== "oauth",
      authMode: "mounted",
      sharedFolders: entry.sharedFolders === true,
      createdAt: now,
      updatedAt: now,
    };
    this.cached.apps.push(app);
    this.persist();
    return { ...app };
  }

  /** Add a server the user described themselves. */
  addCustom(input: CustomLocalAppInput): InstalledLocalApp {
    this.assertRoom();
    const name = cleanName(input.name);
    if (!name) throw new LocalAppError("an app needs a name");
    const description = cleanDescription(input.description) ?? "";
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.env ?? {})) {
      env[validateEnvName(key)] = validateEnvValue(value, key);
    }
    const secrets: Record<string, string> = {};
    const headers: Record<string, string> = {};
    let command: string | undefined;
    let args: string[] = [];
    let url: string | undefined;
    if (input.transport === "stdio") {
      if (!input.command || !resolveCommand(input.command, this.environment())) {
        throw new LocalAppError(`${input.command ?? "(empty)"} is not a program this Mac can run`);
      }
      command = input.command.trim();
      args = validateArgs(input.args ?? []);
      for (const [key, value] of Object.entries(input.secrets ?? {})) {
        secrets[validateEnvName(key)] = validateEnvValue(value, key);
      }
      this.checkSecretCollisions(secrets);
    } else {
      url = validateUrl(input.url ?? "");
      for (const [key, value] of Object.entries(input.headers ?? {})) {
        const header = key.trim();
        if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header)) throw new LocalAppError(`${key} is not a header name`);
        if (header.toLowerCase() === "authorization") {
          secrets[HTTP_BEARER_SECRET] = validateEnvValue(value.replace(/^Bearer\s+/i, ""), header);
        } else {
          headers[header] = validateEnvValue(value, header);
        }
      }
      const token = input.secrets?.token ?? input.secrets?.[HTTP_BEARER_SECRET];
      if (token) secrets[HTTP_BEARER_SECRET] = validateEnvValue(token, "token");
    }
    const now = this.nowIso();
    const app: InstalledLocalApp = {
      id: newId("lap"),
      catalogId: null,
      name,
      description,
      serverName: serverNameFor(name, this.takenNames()),
      symbol: input.transport === "http" ? "link" : "cube",
      category: "productivity",
      transport: input.transport,
      auth: Object.keys(secrets).length ? "api-key" : "none",
      ...(command ? { command } : {}),
      ...(input.transport === "stdio" ? { args } : {}),
      ...(url ? { url } : {}),
      env,
      secrets,
      headers,
      approval: input.approval ?? "ask",
      enabled: true,
      authMode: "mounted",
      sharedFolders: false,
      createdAt: now,
      updatedAt: now,
    };
    this.cached.apps.push(app);
    this.persist();
    return { ...app };
  }

  update(id: string, patch: LocalAppPatch): InstalledLocalApp {
    const app = this.cached.apps.find((row) => row.id === id);
    if (!app) throw new LocalAppError("that app is not added");
    if (patch.enabled !== undefined) app.enabled = patch.enabled;
    if (patch.approval !== undefined) app.approval = patch.approval;
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (!name) throw new LocalAppError("an app needs a name");
      app.name = name;
    }
    if (patch.description !== undefined) app.description = cleanDescription(patch.description) ?? "";
    if (patch.args !== undefined) {
      if (app.transport !== "stdio") throw new LocalAppError("a remote app has no arguments");
      app.args = validateArgs(patch.args);
    }
    if (patch.secrets) {
      const next = { ...app.secrets };
      for (const [rawKey, value] of Object.entries(patch.secrets)) {
        const key = app.transport === "http" ? HTTP_BEARER_SECRET : validateEnvName(rawKey);
        if (value === "") delete next[key];
        else next[key] = validateEnvValue(value, key);
      }
      if (app.transport === "stdio") this.checkSecretCollisions(next, app.id);
      app.secrets = next;
      if (app.auth === "none" && Object.keys(next).length) app.auth = "api-key";
    }
    app.updatedAt = this.nowIso();
    this.persist();
    return { ...app };
  }

  /** The CLI now holds this app's session; stop mounting it ourselves. */
  markCliManaged(id: string): InstalledLocalApp {
    const app = this.cached.apps.find((row) => row.id === id);
    if (!app) throw new LocalAppError("that app is not added");
    app.authMode = "cli";
    app.enabled = true;
    app.updatedAt = this.nowIso();
    this.persist();
    return { ...app };
  }

  recordTest(id: string, result: { ok: boolean; tools: string[]; error?: string }): InstalledLocalApp {
    const app = this.cached.apps.find((row) => row.id === id);
    if (!app) throw new LocalAppError("that app is not added");
    app.lastTest = {
      at: this.nowIso(),
      ok: result.ok,
      tools: result.tools.slice(0, 200),
      ...(result.error ? { error: result.error.slice(0, 400) } : {}),
    };
    this.persist();
    return { ...app };
  }

  remove(id: string): boolean {
    const before = this.cached.apps.length;
    this.cached.apps = this.cached.apps.filter((app) => app.id !== id);
    if (this.cached.apps.length === before) return false;
    this.persist();
    return true;
  }

  /** Every enabled, harness-mounted app as a per-turn server spec, keyed by
   * server name. An app whose launcher is missing on this Mac is skipped —
   * the thread is told by `describeMissingApps`, never by a crashed turn. */
  mountedServers(input: { sharedDirs: readonly string[] }): Record<string, McpServerSpec> {
    const servers: Record<string, McpServerSpec> = {};
    for (const app of this.cached.apps) {
      const spec = mountApp(app, { sharedDirs: input.sharedDirs, environment: this.environment() });
      if (spec) servers[app.serverName] = spec;
    }
    return servers;
  }
}

// ── the launchers this Mac has ─────────────────────────────────────────────

export interface LauncherAvailability {
  npx: boolean;
  uvx: boolean;
}

export function launcherAvailability(environment: NodeJS.ProcessEnv = process.env): LauncherAvailability {
  return {
    npx: findCliCandidates("npx", environment).length > 0,
    uvx: findCliCandidates("uvx", environment).length > 0,
  };
}

// ── probing a server: initialize, then tools/list ──────────────────────────

export interface ProbeResult {
  ok: boolean;
  tools: string[];
  serverName?: string;
  error?: string;
}

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "local-bizos", version: "0.1.0" };

function toolNames(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.tools)) return [];
  return result.tools
    .map((tool) => (isRecord(tool) && typeof tool.name === "string" ? tool.name : null))
    .filter((name): name is string => name !== null);
}

function serverInfoName(result: unknown): string | undefined {
  if (!isRecord(result) || !isRecord(result.serverInfo)) return undefined;
  return typeof result.serverInfo.name === "string" ? result.serverInfo.name : undefined;
}

function describeError(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Start a stdio server, complete the MCP handshake, list its tools, stop it. */
export function probeStdioServer(
  server: StdioMcpServer,
  options: { environment?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const base = options.environment ?? process.env;
  const environment = {
    ...cleanChildEnvironment(base as Record<string, string | undefined>, augmentedPath(base)),
    ...server.env,
    ...server.forwarded,
  };
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let stderr = "";
    let nextId = 1;
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    let child: ReturnType<typeof spawn>;
    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        child?.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      resolve(result);
    };
    const deadline = setTimeout(() => {
      finish({ ok: false, tools: [], error: `no answer after ${Math.round(timeoutMs / 1000)}s${stderr ? `: ${stderr.trim().slice(-300)}` : ""}` });
    }, timeoutMs);
    try {
      child = spawn(server.command, server.args, {
        env: environment as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ ok: false, tools: [], error: describeError(error) });
      return;
    }
    const send = (method: string, params: unknown, onResult?: (message: Record<string, unknown>) => void): void => {
      const message: Record<string, unknown> = { jsonrpc: "2.0", method, params };
      if (onResult) {
        const id = nextId++;
        message.id = id;
        pending.set(id, onResult);
      }
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        /* close settles */
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
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
        if (typeof message.id === "number" && pending.has(message.id)) {
          const handler = pending.get(message.id)!;
          pending.delete(message.id);
          handler(message);
        }
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.on("error", (error) => finish({ ok: false, tools: [], error: describeError(error) }));
    child.on("close", (code) => {
      if (!settled) {
        finish({ ok: false, tools: [], error: `the server exited (code ${code ?? "null"})${stderr ? `: ${stderr.trim().slice(-300)}` : ""}` });
      }
    });
    send(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      (reply) => {
        if (reply.error) {
          finish({ ok: false, tools: [], error: describeError(reply.error) });
          return;
        }
        const name = serverInfoName(reply.result);
        send("notifications/initialized", {});
        send("tools/list", {}, (tools) => {
          if (tools.error) {
            finish({ ok: false, tools: [], error: describeError(tools.error), ...(name ? { serverName: name } : {}) });
            return;
          }
          finish({ ok: true, tools: toolNames(tools.result), ...(name ? { serverName: name } : {}) });
        });
      },
    );
  });
}

function parseHttpBody(text: string, contentType: string): Record<string, unknown> | null {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as unknown;
        if (isRecord(parsed) && ("result" in parsed || "error" in parsed)) return parsed;
      } catch {
        /* next line */
      }
    }
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Streamable HTTP: POST initialize, then tools/list on the same session. */
export async function probeHttpServer(
  server: HttpMcpServer,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const token = server.bearerTokenEnv ? server.forwarded[server.bearerTokenEnv] : undefined;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    ...server.headers,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const call = async (method: string, params: unknown, id: number, session?: string) => {
    const response = await fetchImpl(server.url, {
      method: "POST",
      headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return {
      status: response.status,
      session: response.headers.get("mcp-session-id") ?? session,
      body: parseHttpBody(text, response.headers.get("content-type") ?? ""),
    };
  };
  try {
    const init = await call("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, 1);
    if (init.status === 401 || init.status === 403) {
      return { ok: false, tools: [], error: token ? "the token was refused" : "this app needs a sign-in first" };
    }
    if (init.status >= 400) return { ok: false, tools: [], error: `the server answered ${init.status}` };
    if (!init.body || init.body.error) {
      return { ok: false, tools: [], error: init.body?.error ? describeError(init.body.error) : "the server did not answer the handshake" };
    }
    const name = serverInfoName(init.body.result);
    await fetchImpl(server.url, {
      method: "POST",
      headers: { ...headers, ...(init.session ? { "mcp-session-id": init.session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => undefined);
    const tools = await call("tools/list", {}, 2, init.session);
    if (tools.status >= 400 || !tools.body || tools.body.error) {
      return {
        ok: false,
        tools: [],
        error: tools.body?.error ? describeError(tools.body.error) : `the server answered ${tools.status} to tools/list`,
        ...(name ? { serverName: name } : {}),
      };
    }
    return { ok: true, tools: toolNames(tools.body.result), ...(name ? { serverName: name } : {}) };
  } catch (error) {
    return { ok: false, tools: [], error: describeError(error) };
  }
}

// ── OAuth apps: the CLI signs in, then owns the server ─────────────────────

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The Terminal command that registers a remote app with the agent's own CLI
 * and starts its OAuth sign-in. The CLI stores the session in the plan's home
 * (`CODEX_HOME` / `CLAUDE_CONFIG_DIR`), loads the server itself on every
 * turn, and keeps its own approval policy for it. Claude Code has no
 * non-interactive sign-in for a remote server, so it is opened interactively
 * with the instruction to run `/mcp`.
 */
export function loginCommandFor(input: {
  provider: "codex" | "claude";
  home: string;
  serverName: string;
  url: string;
}): string {
  const url = shellSingleQuote(input.url);
  const name = shellSingleQuote(input.serverName);
  if (input.provider === "codex") {
    const prefix = `CODEX_HOME=${shellSingleQuote(input.home)}`;
    return `${prefix} codex mcp add ${name} --url ${url} && ${prefix} codex mcp login ${name}`;
  }
  const prefix = `CLAUDE_CONFIG_DIR=${shellSingleQuote(input.home)}`;
  return `${prefix} claude mcp add --transport http --scope user ${name} ${url} && echo && echo 'Type /mcp in Claude Code to sign in to ${input.serverName}, then close this window.' && ${prefix} claude`;
}
