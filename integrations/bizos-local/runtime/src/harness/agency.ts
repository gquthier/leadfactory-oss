// The LeadFactory agency pack — `pack.ts` with the agency cockpit and the
// `agency_*` tools. Its data lives in the bound vault at
// `Apps/LeadFactory/data`; an installation an older build made under
// `<runtime root>/agency/` is adopted when the person binds that vault
// (`rootId: "agency"`): its bots by their role folders, its store moved
// whole into the vault, nothing duplicated.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AGENCY_PROFILE_FIELDS,
  AGENCY_TOOL_SPECS,
  CAMPAIGN_FIELDS,
  CLIENT_FIELDS,
  DELIVERABLE_FIELDS,
  isAgencyToolName,
  TASK_FIELDS,
} from "./agency-tools.js";
import { DEFAULT_KIT_ROOT, isRecord, PackError } from "./pack-kit.js";
import { MAX_LIST_ITEMS, PackService, recordMarkdown, type CallContext, type PackInstallation, type PackServiceOptions } from "./pack.js";

export { PackService, PackError } from "./pack.js";

/** Where an older build kept the pack: `<runtime root>/agency/{data,vault,install.json}`. */
export const LEGACY_AGENCY_DIRECTORY = "agency";
export function legacyAgencyVaultPath(rootDir: string): string {
  return join(rootDir, LEGACY_AGENCY_DIRECTORY, "vault");
}

export const AGENCY_TEMPLATE_FILE = "templates/lead-gen-agency.company-template.json";
export const AGENCY_APP_DIR = "Apps/LeadFactory";

const PREVIEW_CHARS = 300;

export interface AgencyServiceOptions extends PackServiceOptions {
  kitRoot?: string;
}

export class AgencyService extends PackService {
  constructor(options: AgencyServiceOptions) {
    super({
      templateId: "lead-gen-agency",
      kitRoot: options.kitRoot ?? DEFAULT_KIT_ROOT,
      templateFile: AGENCY_TEMPLATE_FILE,
      what: "agency",
      appDir: AGENCY_APP_DIR,
      dossierDir: "Clients",
      // A literal specifier: the packaging graph walks it.
      loadApp: () => import("../agency-kit/lib/app.mjs"),
      toolSpecs: AGENCY_TOOL_SPECS,
      fallback: { id: "lead-gen-agency", name: "Lead Gen Agency", version: 0 },
    }, options);
  }

  protected override isToolName(name: unknown): boolean {
    return isAgencyToolName(name);
  }

  /** The older layout's store, moved into the vault the person bound. */
  protected override adoptLegacyData(installation: PackInstallation, dataDir: string): void {
    if (installation.rootId !== "agency") return;
    const legacy = join(this.host.rootDir, LEGACY_AGENCY_DIRECTORY, "data");
    if (!existsSync(join(legacy, "db.json"))) return;
    this.moveFolder(legacy, dataDir);
  }

  protected override dispatch(ctx: CallContext, name: string, args: Record<string, unknown>): Promise<unknown> | unknown {
    switch (name) {
      case "agency_context": return this.context(ctx, args);
      case "agency_clients": return this.clients(ctx, args);
      case "agency_campaigns": return this.related(ctx, "campaigns", "campaignId", CAMPAIGN_FIELDS, args);
      case "agency_tasks": return this.related(ctx, "tasks", "taskId", TASK_FIELDS, args);
      case "agency_deliverables": return this.related(ctx, "deliverables", "deliverableId", DELIVERABLE_FIELDS, args);
      case "agency_onboarding": return this.onboarding(ctx, args);
      case "agency_profile_update": return this.profileUpdate(ctx, args);
      case "agency_dashboard": return this.dashboard(ctx, args);
      case "agency_list_skills": return this.listSkills();
      case "agency_read_skill": return this.readSkill(args);
      case "agency_read_document": return this.readDocument(args);
      default: throw new PackError(`unknown agency tool: ${String(name)}`, "unknown_tool", 404);
    }
  }

  private summary(item: unknown): Record<string, unknown> {
    if (!isRecord(item)) return {};
    const { onboarding, ...rest } = item;
    return {
      ...rest,
      ...(isRecord(onboarding) ? { onboardingStatus: onboarding.status ?? null } : onboarding === null ? { onboardingStatus: null } : {}),
    };
  }

  private preview(item: unknown): Record<string, unknown> {
    if (!isRecord(item)) return {};
    const content = typeof item.content === "string" ? item.content : "";
    return { ...item, content: content.slice(0, PREVIEW_CHARS), contentLength: content.length, contentTruncated: content.length > PREVIEW_CHARS };
  }

  private async context(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const clientId = this.optionalId(args.clientId, "clientId");
    if (!clientId) {
      const [agency, clients] = await Promise.all([this.api(ctx, "GET", "/agency"), this.api(ctx, "GET", "/clients")]);
      const list = Array.isArray(clients) ? clients : [];
      return {
        agency,
        clients: list.slice(0, MAX_LIST_ITEMS).map((client) => {
          const record = isRecord(client) ? client : {};
          return { id: record.id, company: record.company, status: record.status, updatedAt: record.updatedAt };
        }),
        clientsCount: list.length,
      };
    }
    if (args.format === "markdown") {
      const text = await this.apiText(ctx, `/clients/${encodeURIComponent(clientId)}/dossier.md`);
      return { clientId, format: "markdown", markdown: text.slice(0, 60_000), truncated: text.length > 60_000 };
    }
    const dossier = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
    const client = isRecord(dossier.client) ? dossier.client : {};
    const deliverables = Array.isArray(dossier.deliverables) ? dossier.deliverables : [];
    return {
      client: this.summary(client),
      onboarding: isRecord(client.onboarding)
        ? { status: client.onboarding.status ?? null, step: client.onboarding.step ?? null, submittedAt: client.onboarding.submittedAt ?? null, reviewedAt: client.onboarding.reviewedAt ?? null }
        : null,
      campaigns: dossier.campaigns ?? [],
      tasks: dossier.tasks ?? [],
      deliverables: deliverables.map((item) => this.preview(item)),
    };
  }

  private async clients(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const action = this.action(args.action, ["list", "get", "create", "update"]);
    if (action === "list") {
      const clients = await this.api(ctx, "GET", "/clients");
      const list = Array.isArray(clients) ? clients : [];
      return { resource: "clients", count: list.length, items: list.slice(0, MAX_LIST_ITEMS).map((item) => this.summary(item)) };
    }
    if (action === "create") {
      const created = await this.api(ctx, "POST", "/clients", this.data(args.data, CLIENT_FIELDS, true)) as Record<string, unknown>;
      await this.mirrorClient(ctx, String(created.id));
      return { resource: "client", id: created.id, updatedAt: created.updatedAt, item: this.summary(created) };
    }
    const clientId = this.requireId(args.clientId, "clientId");
    if (action === "get") {
      const dossier = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
      return { resource: "client", id: clientId, item: this.summary(dossier.client) };
    }
    const updated = await this.api(ctx, "PATCH", `/clients/${encodeURIComponent(clientId)}`, this.data(args.data, CLIENT_FIELDS, true)) as Record<string, unknown>;
    await this.mirrorClient(ctx, clientId);
    return { resource: "client", id: clientId, updatedAt: updated.updatedAt, item: this.summary(updated) };
  }

  /** The client-bounded resources. Every path checks that the record — and
   * any campaign it names — belongs to `clientId`; otherwise it is refused. */
  private async related(
    ctx: CallContext,
    resource: "campaigns" | "tasks" | "deliverables",
    idField: string,
    fields: Record<string, unknown>,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const action = this.action(args.action, ["list", "get", "create", "update"]);
    const clientId = this.requireId(args.clientId, "clientId");
    const singular = resource.slice(0, -1);
    const ownedBy = (item: unknown): item is Record<string, unknown> => isRecord(item) && item.clientId === clientId;
    const dossier = async () => {
      const found = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
      const rows = found[resource];
      return Array.isArray(rows) ? rows.filter(ownedBy) : [];
    };
    const refuse = (id: string) => new PackError(`${singular} ${id} does not belong to client ${clientId}`, "other_client", 403);
    const assertCampaign = async (campaignId: unknown) => {
      if (campaignId === undefined || campaignId === null) return;
      const id = this.requireId(campaignId, "campaignId");
      const found = await this.api(ctx, "GET", `/clients/${encodeURIComponent(clientId)}`) as Record<string, unknown>;
      const campaigns = Array.isArray(found.campaigns) ? found.campaigns : [];
      if (!campaigns.some((row) => isRecord(row) && row.id === id)) throw new PackError(`campaign ${id} does not belong to client ${clientId}`, "other_client", 403);
    };
    if (action === "list") {
      const items = await dossier();
      return {
        resource,
        clientId,
        count: items.length,
        items: items.slice(0, MAX_LIST_ITEMS).map((item) => (resource === "deliverables" ? this.preview(item) : item)),
      };
    }
    if (action === "create") {
      const data = this.data(args.data, fields, true);
      await assertCampaign(data.campaignId);
      const created = await this.api(ctx, "POST", `/${resource}`, { ...data, clientId }) as Record<string, unknown>;
      await this.mirrorClient(ctx, clientId);
      return { resource: singular, id: created.id, clientId, updatedAt: created.updatedAt, item: created };
    }
    const id = this.requireId(args[idField], idField);
    const existing = (await dossier()).find((item) => item.id === id);
    if (!existing) throw refuse(id);
    if (action === "get") return { resource: singular, id, clientId, item: existing };
    const data = this.data(args.data, fields, true);
    if ("campaignId" in data) await assertCampaign(data.campaignId);
    const updated = await this.api(ctx, "PATCH", `/${resource}/${encodeURIComponent(id)}`, data) as Record<string, unknown>;
    await this.mirrorClient(ctx, clientId);
    return { resource: singular, id, clientId, updatedAt: updated.updatedAt, item: updated };
  }

  private async onboarding(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const action = this.action(args.action, ["schema", "get", "save", "submit"]);
    if (action === "schema") return this.api(ctx, "GET", "/onboarding/schema");
    const clientId = this.requireId(args.clientId, "clientId");
    const path = `/clients/${encodeURIComponent(clientId)}/onboarding`;
    if (action === "get") return { clientId, ...(await this.api(ctx, "GET", path) as Record<string, unknown>) };
    if (action === "save") {
      const allowed = { company: true, offer: true, target: true, campaign: true, delivery: true, step: true };
      const data = this.data(args.data, allowed, true);
      const saved = { clientId, ...(await this.api(ctx, "PUT", path, data) as Record<string, unknown>) };
      await this.mirrorClient(ctx, clientId);
      return saved;
    }
    const result = await this.api(ctx, "POST", `${path}/submit`) as Record<string, unknown>;
    await this.mirrorClient(ctx, clientId);
    const brief = isRecord(result.brief) ? result.brief : {};
    return {
      clientId,
      onboarding: result.onboarding,
      progress: result.progress,
      campaign: result.campaign,
      brief: { id: brief.id, title: brief.title, type: brief.type },
      tasks: result.tasks,
      client: this.summary(result.client),
    };
  }

  private async profileUpdate(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const data = this.data(args.data, AGENCY_PROFILE_FIELDS, true);
    const updated = await this.api(ctx, "PUT", "/agency", data) as Record<string, unknown>;
    return { resource: "agency", updatedAt: updated.updatedAt, item: updated };
  }

  private async dashboard(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const action = this.action(args.action, ["get", "update"]);
    if (action === "get") return { resource: "dashboard", config: await this.api(ctx, "GET", "/dashboard") };
    if (!isRecord(args.config)) throw new PackError("config must be an object", "invalid_arguments");
    return { resource: "dashboard", config: await this.api(ctx, "PUT", "/dashboard", args.config) };
  }

  // ── the mirror: Clients/<id>/Dossier.md and Clients/Index.md ──

  /** After a write: the client's dossier as the cockpit exports it, plus the
   * index. Best effort — a mirror that cannot be written never fails the
   * write it follows; the JSON stays authoritative. */
  private async mirrorClient(ctx: CallContext, clientId: string): Promise<void> {
    try {
      const text = await this.apiText(ctx, `/clients/${encodeURIComponent(clientId)}/dossier.md`);
      this.writeGenerated(`Clients/${clientId}/Dossier.md`, text);
      const clients = await this.api(ctx, "GET", "/clients");
      this.writeIndex(Array.isArray(clients) ? clients : []);
    } catch (error) {
      if (ctx.signal.aborted) return;
      this.log(`agency mirror (${clientId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writeIndex(clients: unknown[]): void {
    const rows = this.mirrorable(clients).map((client) => `| [[Clients/${client.id}/Dossier|${cellText(client.company)}]] | ${cellText(client.status)} | ${cellText(client.contact)} | ${cellText(client.updatedAt)} |`);
    this.writeGenerated("Clients/Index.md", `# Clients\n\nGenerated from the LeadFactory dashboard (Apps → Agency). ${rows.length} client(s).\n\n| Client | Status | Contact | Updated |\n|---|---|---|---|\n${rows.join("\n")}\n`);
  }

  protected override async mirrorAll(): Promise<void> {
    if (!this.vaultDir()) return;
    const clients = await this.serviceGet("/clients");
    const list = this.mirrorable(Array.isArray(clients) ? clients : []);
    this.pruneDossiers(Array.isArray(clients) ? clients : []);
    for (const client of list) {
      const text = await this.serviceGet(`/clients/${encodeURIComponent(client.id)}/dossier.md`);
      this.writeGenerated(`Clients/${client.id}/Dossier.md`, typeof text === "string" ? text : recordMarkdown(String(client.company ?? client.id), client));
    }
    this.writeIndex(list);
  }
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 120);
}
