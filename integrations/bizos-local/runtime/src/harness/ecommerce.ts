// The E-commerce pack — `pack.ts` with the store cockpit
// (`agency-kit/ecommerce/lib/app.mjs`) and the `commerce_*` tools. Its data
// lives in the bound vault at `Apps/Ecommerce/data`; its dossiers under
// `Products/<id>/Dossier.md`.
//
// The cockpit owns the schema (`GET /api/schema`) and validates every body
// and every cross-record link; this service hands the schema to the agent,
// refuses a field the schema does not list, and keeps everything under the
// run's capability. Installing the template connects no store, no ad account
// and no email platform; the cockpit's records describe what the person
// decides to connect, on their own accounts.
import {
  COMMERCE_COLLECTIONS,
  COMMERCE_TOOL_SPECS,
  isCommerceCollection,
  isCommerceToolName,
  MAX_DASHBOARD_CONFIG_CHARS,
  type CommerceCollection,
} from "./commerce-tools.js";
import { DEFAULT_KIT_ROOT, isRecord, PackError } from "./pack-kit.js";
import { MAX_LIST_ITEMS, PackService, recordMarkdown, type CallContext, type PackServiceOptions } from "./pack.js";
import { ecommerceKitRoot, ECOMMERCE_TEMPLATE_FILE } from "./template-ecommerce.js";

export const ECOMMERCE_APP_DIR = "Apps/Ecommerce";

/** The schema as the cockpit publishes it (`CONTRACT.md`): collections with
 * their fields, links to other collections, the profile's fields, the
 * dashboard's config description. Anything else is passed through unread. */
interface CommerceSchema {
  collections: Partial<Record<CommerceCollection, { fields?: Record<string, unknown>; links?: Record<string, string>; label?: string }>>;
  profile?: { fields?: Record<string, unknown> };
  dashboard?: unknown;
}

export interface EcommerceServiceOptions extends PackServiceOptions {
  kitRoot?: string;
}

export class EcommerceService extends PackService {
  private schema: CommerceSchema | null = null;

  constructor(options: EcommerceServiceOptions) {
    super({
      templateId: "ecommerce",
      kitRoot: ecommerceKitRoot(options.kitRoot ?? DEFAULT_KIT_ROOT),
      templateFile: ECOMMERCE_TEMPLATE_FILE,
      what: "e-commerce",
      appDir: ECOMMERCE_APP_DIR,
      dossierDir: "Products",
      // A literal specifier: the packaging graph walks it.
      loadApp: () => import("../agency-kit/ecommerce/lib/app.mjs"),
      toolSpecs: COMMERCE_TOOL_SPECS,
      fallback: { id: "ecommerce", name: "E-commerce", version: 0 },
    }, options);
  }

  protected override isToolName(name: unknown): boolean {
    return isCommerceToolName(name);
  }

  protected override dispatch(ctx: CallContext, name: string, args: Record<string, unknown>): Promise<unknown> | unknown {
    switch (name) {
      case "commerce_context": return this.context(ctx);
      case "commerce_schema": return this.schemaTool(ctx, args);
      case "commerce_records": return this.records(ctx, args);
      case "commerce_profile_update": return this.profileUpdate(ctx, args);
      case "commerce_dashboard": return this.dashboard(ctx, args);
      case "commerce_list_skills": return this.listSkills();
      case "commerce_read_skill": return this.readSkill(args);
      case "commerce_read_document": return this.readDocument(args);
      default: throw new PackError(`unknown e-commerce tool: ${String(name)}`, "unknown_tool", 404);
    }
  }

  /** The cockpit's schema, read once per cockpit instance. A schema without
   * the expected shape is kept as-is for the agent and not used to refuse. */
  private async loadSchema(ctx: CallContext): Promise<CommerceSchema> {
    if (this.schema) return this.schema;
    const raw = await this.api(ctx, "GET", "/schema");
    const fieldMap = (value: unknown): Record<string, unknown> => {
      if (!Array.isArray(value)) throw new PackError("the cockpit field schema is invalid", "invalid_schema", 503);
      return Object.fromEntries(value.map(field => {
        if (!isRecord(field) || typeof field.name !== "string") throw new PackError("the cockpit field schema is invalid", "invalid_schema", 503);
        return [field.name, field];
      }));
    };
    const collections: CommerceSchema["collections"] = {};
    if (isRecord(raw) && isRecord(raw.collections)) {
      for (const name of COMMERCE_COLLECTIONS) {
        const entry = raw.collections[name];
        if (!isRecord(entry)) continue;
        collections[name] = {
          fields: fieldMap(entry.fields),
          ...(isRecord(entry.links) ? { links: entry.links as Record<string, string> } : {}),
          ...(typeof entry.label === "string" ? { label: entry.label } : {}),
        };
      }
    }
    this.schema = {
      collections,
      ...(isRecord(raw) && isRecord(raw.profile) ? { profile: { fields: fieldMap(raw.profile.fields) } } : {}),
      ...(isRecord(raw) && raw.dashboard !== undefined ? { dashboard: raw.dashboard } : {}),
    };
    return this.schema;
  }

  private collection(value: unknown): CommerceCollection {
    if (!isCommerceCollection(value)) throw new PackError(`collection must be one of ${COMMERCE_COLLECTIONS.join(", ")}`, "invalid_arguments");
    return value;
  }

  private async context(ctx: CallContext): Promise<unknown> {
    const [profile, dashboard, state, schema] = await Promise.all([
      this.api(ctx, "GET", "/profile"),
      this.api(ctx, "GET", "/dashboard"),
      this.api(ctx, "GET", "/state"),
      this.loadSchema(ctx),
    ]);
    const counts = Object.fromEntries(COMMERCE_COLLECTIONS.map((name) => {
      const rows = isRecord(state) ? state[name] : undefined;
      return [name, Array.isArray(rows) ? rows.length : 0];
    }));
    const collections = Object.fromEntries(COMMERCE_COLLECTIONS.map((name) => {
      const entry = schema.collections[name];
      return [name, { fields: entry?.fields ? Object.keys(entry.fields) : [], links: entry?.links ?? {} }];
    }));
    return { profile, dashboard, counts, collections };
  }

  private async schemaTool(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const raw = await this.api(ctx, "GET", "/schema");
    await this.loadSchema(ctx);
    if (args.collection === undefined) return raw;
    const name = this.collection(args.collection);
    const entry = isRecord(raw) && isRecord(raw.collections) ? raw.collections[name] : undefined;
    if (!entry) throw new PackError(`the cockpit publishes no schema for ${name}`, "not_found", 404);
    return { collection: name, schema: entry };
  }

  private async records(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const name = this.collection(args.collection);
    const action = this.action(args.action, ["list", "get", "create", "update"]);
    const schema = await this.loadSchema(ctx);
    const fields = schema.collections[name]?.fields ?? null;
    if (action === "list") {
      const productId = this.optionalId(args.productId, "productId");
      const rows = await this.api(ctx, "GET", `/${name}`);
      const list = (Array.isArray(rows) ? rows : []).filter((row) => !productId || (isRecord(row) && (row.productId === productId || (Array.isArray(row.productIds) && row.productIds.includes(productId)))));
      return { collection: name, count: list.length, items: list.slice(0, MAX_LIST_ITEMS) };
    }
    if (action === "create") {
      const created = await this.api(ctx, "POST", `/${name}`, this.data(args.data, fields, true)) as Record<string, unknown>;
      await this.mirrorAfter(ctx, name, created);
      return { collection: name, id: created.id, item: created };
    }
    const id = this.requireId(args.id, "id");
    if (action === "get") {
      return { collection: name, id, item: await this.api(ctx, "GET", `/${name}/${encodeURIComponent(id)}`) };
    }
    const updated = await this.api(ctx, "PATCH", `/${name}/${encodeURIComponent(id)}`, this.data(args.data, fields, true)) as Record<string, unknown>;
    await this.mirrorAfter(ctx, name, updated);
    return { collection: name, id, item: updated };
  }

  private async profileUpdate(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const schema = await this.loadSchema(ctx);
    const updated = await this.api(ctx, "PUT", "/profile", this.data(args.data, schema.profile?.fields ?? null, true));
    return { resource: "profile", item: updated };
  }

  /** The dashboard's declarative configuration. JSON only, bounded: a config
   * is data the cockpit validates and renders, never code it runs. */
  private async dashboard(ctx: CallContext, args: Record<string, unknown>): Promise<unknown> {
    const action = this.action(args.action, ["get", "update"]);
    if (action === "get") return { resource: "dashboard", config: await this.api(ctx, "GET", "/dashboard") };
    const config = args.config;
    if (!isRecord(config)) throw new PackError("config must be an object", "invalid_arguments");
    const text = JSON.stringify(config);
    if (text.length > MAX_DASHBOARD_CONFIG_CHARS) throw new PackError(`config is longer than ${MAX_DASHBOARD_CONFIG_CHARS} characters`, "invalid_arguments");
    if (/<script|javascript:|\bon[a-z]+\s*=/i.test(text)) throw new PackError("config is configuration, not code: scripts and handlers are refused", "invalid_arguments");
    return { resource: "dashboard", config: await this.api(ctx, "PUT", "/dashboard", config) };
  }

  // ── the mirror: Products/<id>/Dossier.md and Products/Index.md ──

  /** After a write: the product the record belongs to (itself, or the one
   * it links to through `productId`) gets its dossier rewritten. Best effort. */
  private async mirrorAfter(ctx: CallContext, collection: CommerceCollection, record: Record<string, unknown>): Promise<void> {
    try {
      const productId = collection === "products" ? record.id : record.productId;
      if (typeof productId !== "string") return;
      const state = await this.api(ctx, "GET", "/state");
      this.mirrorProduct(isRecord(state) ? state : {}, productId);
      this.writeIndex(isRecord(state) && Array.isArray(state.products) ? state.products : []);
    } catch (error) {
      if (ctx.signal.aborted) return;
      this.log(`e-commerce mirror (${collection}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private mirrorProduct(state: Record<string, unknown>, productId: string): void {
    const products = this.mirrorable(Array.isArray(state.products) ? state.products : []);
    const product = products.find((row) => row.id === productId);
    if (!product) return;
    const title = typeof product.name === "string" && product.name.trim() ? product.name.trim() : product.id;
    let body = recordMarkdown(title, product);
    for (const name of COMMERCE_COLLECTIONS) {
      if (name === "products") continue;
      const rows = this.mirrorable(Array.isArray(state[name]) ? state[name] as unknown[] : []).filter((row) => (row.productId === productId || (Array.isArray(row.productIds) && row.productIds.includes(productId))));
      if (!rows.length) continue;
      body += `\n## ${name[0]!.toUpperCase()}${name.slice(1)} (${rows.length})\n\n| id | name / title | status | updated |\n|---|---|---|---|\n`;
      body += rows.map((row) => `| ${row.id} | ${cellText(row.name ?? row.title)} | ${cellText(row.status)} | ${cellText(row.updatedAt)} |`).join("\n");
      body += "\n";
    }
    this.writeGenerated(`Products/${productId}/Dossier.md`, body);
  }

  private writeIndex(products: unknown[]): void {
    const rows = this.mirrorable(products).map((product) => `| [[Products/${product.id}/Dossier|${cellText(product.name ?? product.id)}]] | ${cellText(product.status)} | ${cellText(product.updatedAt)} |`);
    this.writeGenerated("Products/Index.md", `# Products\n\nGenerated from the E-commerce dashboard (Apps → E-commerce). ${rows.length} product(s).\n\n| Product | Status | Updated |\n|---|---|---|\n${rows.join("\n")}\n`);
  }

  protected override async mirrorAll(): Promise<void> {
    if (!this.vaultDir()) return;
    const state = await this.serviceGet("/state");
    if (!isRecord(state)) return;
    this.pruneDossiers(Array.isArray(state.products) ? state.products : []);
    const products = this.mirrorable(Array.isArray(state.products) ? state.products : []);
    for (const product of products) this.mirrorProduct(state, product.id);
    this.writeIndex(products);
  }
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 120);
}
