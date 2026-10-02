// The E-commerce pack — the third row of the catalogue.
//
// The pack proper is authored in the public kit (`agency-kit/ecommerce/`:
// `template.json` in `CompanyTemplate` form, `vault/`, `skills/`, and the
// cockpit `lib/app.mjs`). When that subtree is staged, `ecommerceTemplate()`
// answers its template. When it is not — a build made before the kit was
// synced, or a test on a bare checkout — the FALLBACK below stands in: the
// same id, the same six roles, and honest notes that connect nothing. The
// fallback claims no Shopify, ads or email account; neither does the kit.
import { join } from "node:path";
import type { CompanyTemplate, TemplateBot } from "./company-os.js";
import { DEFAULT_KIT_ROOT, kitPresent, loadKit } from "./pack-kit.js";

export const ECOMMERCE_KIT_SUBDIR = "ecommerce";
export const ECOMMERCE_TEMPLATE_FILE = "template.json";

/** Where the e-commerce kit sits inside the staged kit. */
export function ecommerceKitRoot(kitRoot: string = DEFAULT_KIT_ROOT): string {
  return join(kitRoot, ECOMMERCE_KIT_SUBDIR);
}

const BOUNDARIES = "Read `../../AGENTS.md` first, then your role sheet. Work on one product at a time and record evidence with its source and date. Nothing here publishes a store, spends on ads, sends email or places an order: those stay with the person and their own accounts. A tool result is the only proof a record changed; never report a change you did not get back from a tool.";

function role(slug: string, name: string, title: string, description: string, mission: string[], extra: Partial<TemplateBot> = {}): TemplateBot {
  return {
    slug,
    name,
    title,
    description,
    instructions: `${description} ${mission.join(" ")} ${BOUNDARIES}`,
    ...extra,
  };
}

const ROLES: TemplateBot[] = [
  role("director", "Director", "Store direction and priorities",
    "Turn the owner's brief into a product-by-product plan, coordinate the team and report verified progress.",
    ["Read the profile and the open tasks, choose the next useful step, assign bounded work to peers and review their evidence."],
    { pinned: true, welcome: "Welcome. What do you want to sell, to whom, in which market, with which budget and which accounts do you already have? I will turn your answers into the first plan. No store, ad or email is connected yet; nothing has run." }),
  role("product-research", "Product Research", "Market, demand and competitors",
    "Find and qualify product opportunities with sourced evidence: demand signals, competitors, their offers and their ads.",
    ["Keep observed metrics, estimates and hypotheses labelled apart; a competitor's active ad is a signal, not a sales figure."]),
  role("store-builder", "Store Builder", "Offer, brand and storefront",
    "Shape the offer and the brand, then specify and build the storefront pages and the buying path.",
    ["Record what is a draft, what is published, and what was tested, with the storefront's real state as the only proof."]),
  role("creative", "Creative", "Creatives and copy",
    "Produce original concepts, copy and media briefs for the product's ads and pages, with provenance for every asset.",
    ["A prompt is a brief, not a rendered asset; version every deliverable and mark its approval state."]),
  role("acquisition", "Acquisition", "Launch, ads and tracking",
    "Prepare campaigns, tracking and launch checklists for the chosen channels, and read actual results when they exist.",
    ["Budgets are proposals until the person approves them; a campaign is live only when the platform says so."]),
  role("operations", "Operations", "Sourcing, logistics and metrics",
    "Cover sourcing, costs, margins, stock, fulfilment, returns and the weekly metrics that decide the next action.",
    ["Never fill an unknown cost or metric with zero; mark it unknown and name who can provide it."]),
];

const AGENTS_MD = `# How this store team works

Read \`Start here.md\`, \`Company.md\`, \`Rules.md\`, \`Autonomy.md\` and \`Team.md\`, then your own role sheet. Read only the product needed for the current task.

This folder is an empty, reusable e-commerce workspace. Fill missing facts from the owner's brief and verified sources. Never invent suppliers, prices, metrics or customers.

The dashboard installed in this app (Apps → E-commerce) is the record of products, competitors, suppliers, storefronts, creatives, campaigns, tasks, deliverables and metrics. Its JSON store under \`Apps/Ecommerce/data\` is authoritative; the Markdown dossiers under \`Products/\` are generated views of it.

A Markdown role is a specification. An agent exists only when the runtime has created an executable agent and its thread. A handoff is delivered only when a real message or task was persisted.
`;

const START_HERE = `# Start your store

This workspace describes an e-commerce business from product research to optimisation. It contains no product, no supplier and no account, and nothing is connected: no Shopify store, no ad account, no email platform.

Open the Director's chat and answer its first question. Put the answers in \`Company.md\`. Unknown details stay TODO.

The stages, each with an owner: research → competitors and ads → sourcing and unit economics → offer and brand → storefront → creatives → launch and tracking → optimisation and operations. One product at a time.
`;

/** The shipped fallback: six roles, the reading-order notes, no team group
 * (the kit decides that), no routine. */
export const ECOMMERCE_FALLBACK: CompanyTemplate = {
  id: "ecommerce",
  version: 1,
  name: "E-commerce",
  description: "An online store run A to Z with six agents: product research, store building, creatives, acquisition, operations and a director — each with its process notes and a shared dashboard.",
  folders: [
    "Agents/Director",
    "Agents/Product Research",
    "Agents/Store Builder",
    "Agents/Creative",
    "Agents/Acquisition",
    "Agents/Operations",
    "Products",
    "Knowledge/Draft",
    "Knowledge/Trusted",
    "Processes",
    "Reports/Weekly",
  ],
  notes: [
    { path: "AGENTS.md", text: AGENTS_MD },
    { path: "CLAUDE.md", text: "@AGENTS.md\n" },
    { path: "Start here.md", text: START_HERE },
    {
      path: "Company.md",
      text: "# Company\n\nStatus: unconfigured. Replace TODO from the owner's brief; do not invent defaults.\n\n- Store name: TODO\n- Owner and decision maker: TODO\n- Market and language: TODO\n- First product or niche: TODO\n- Budget and constraints: TODO\n- Existing accounts (store, ads, email): TODO — none is connected by this template\n- Actions never taken without authorization: TODO\n",
    },
    {
      path: "Rules.md",
      text: "# Working rules\n\n1. Read the current product record and its sources before asserting a fact; record source date and read date.\n2. Use TODO for unknown facts; label observations, estimates, hypotheses and decisions distinctly.\n3. One product per task; a record of another product is not evidence for this one.\n4. The dashboard's JSON is the source of truth for business records; the notes explain and link.\n5. Record authorization before publishing, spending, sending or ordering. Preparing a draft is not doing it.\n6. Honor STOP. Do not restart a stopped chain or create a recurring schedule implicitly.\n",
    },
    {
      path: "Autonomy.md",
      text: "# Autonomy\n\nDefault until the owner records different bounded permissions: research, draft, organise and report inside this workspace and the dashboard. Obtain explicit authorization before publishing a storefront, launching or changing ads, sending email, spending money or placing a supplier order. Connectors start unconfigured; no scheduled job is included.\n",
    },
    {
      path: "Team.md",
      text: `# Team\n\n| Role | Owns | Main handoff |\n|---|---|---|\n${ROLES.map((bot) => `| ${bot.name} | ${bot.title} | ${bot.description} |`).join("\n")}\n\nUse the runtime's real tools for every cross-role task; a handoff written in a note is pending until a message or task exists.\n`,
    },
    {
      path: "Processes/Stages.md",
      text: "# Stages\n\n1. Product research (Product Research): shortlist with demand signals and sources.\n2. Competitors and ads (Product Research): comparison of offers, prices, pages and angles, dated.\n3. Sourcing and unit economics (Operations): product, shipping, returns and payment costs; contribution margin; supplier quotes to confirm.\n4. Offer and brand (Store Builder): positioning, allowed claims, bundles, identity.\n5. Storefront (Store Builder): pages, buying path, tests of cart and checkout.\n6. Creatives (Creative): briefs, angles, copy, media with provenance.\n7. Launch and tracking (Acquisition): tracking checklist, campaign prepared on the person's accounts and budget.\n8. Optimisation and operations (Acquisition, Operations): reporting on real spend, tested decisions, backlog, cash and next actions.\n",
    },
    { path: "Products/README.md", text: "# Products\n\nOne folder per product, named after its dashboard id. `Dossier.md` in each is a generated view of the dashboard record; edit the record in the dashboard or through the agents' tools, not here.\n" },
    ...ROLES.flatMap((bot) => [
      { path: `Agents/${bot.name}/AGENTS.md`, text: `# ${bot.name} agent folder\n\nRead \`../../AGENTS.md\`, then \`${bot.name}.md\`, then the assigned product. Do not read unrelated products.\n` },
      { path: `Agents/${bot.name}/CLAUDE.md`, text: "@AGENTS.md\n" },
      { path: `Agents/${bot.name}/${bot.name}.md`, text: `# ${bot.name}\n\n## Mission\n\n${bot.description}\n\n## Boundaries\n\nRead \`../../Autonomy.md\`. ${BOUNDARIES}\n` },
    ]),
  ],
  bots: ROLES,
  routines: [],
};

let cached: { root: string; template: CompanyTemplate } | null = null;

/**
 * The e-commerce template: the kit's when staged, the fallback otherwise.
 * A kit template that does not carry the catalogue's id is refused — the
 * binding names `ecommerce`, and a file cannot rename it.
 */
export function ecommerceTemplate(kitRoot: string = DEFAULT_KIT_ROOT): CompanyTemplate {
  const root = ecommerceKitRoot(kitRoot);
  if (cached?.root === root) return cached.template;
  if (!kitPresent(root, ECOMMERCE_TEMPLATE_FILE)) return ECOMMERCE_FALLBACK;
  const kit = loadKit(root, ECOMMERCE_TEMPLATE_FILE, "e-commerce");
  if (kit.template.id !== ECOMMERCE_FALLBACK.id) {
    throw new Error(`the e-commerce kit's template is ${kit.template.id}, not ${ECOMMERCE_FALLBACK.id}`);
  }
  cached = { root, template: kit.template };
  return kit.template;
}

/** Test seam: forget the cached kit template. */
export function resetEcommerceTemplateCache(): void {
  cached = null;
}
