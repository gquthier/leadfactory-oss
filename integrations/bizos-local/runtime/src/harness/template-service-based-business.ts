// A practical operating vault for a service company. The payload is data:
// the generic template installer creates the six persistent agents, their
// shared group and their working folders. No external account or schedule is
// created by importing this module.
import type { CompanyTemplate, TemplateBot, TemplateNote } from "./company-os.js";
import { OPS_SCRIPT } from "./template-ops-script.js";

type Role = Pick<TemplateBot, "slug" | "name" | "title" | "description"> & {
  owns: string;
  workflow: readonly string[];
  writes: string;
  escalates: string;
};

const ROLES: readonly Role[] = [
  {
    slug: "business-director",
    name: "Business Director",
    title: "Business direction and coordination",
    description: "Turns the owner's facts and priorities into an operating plan, assigns work in the team thread and keeps company decisions explicit.",
    owns: "company direction, priorities, cross-role coordination and the accuracy of the shared operating picture",
    workflow: [
      "Read the current brief, Company.md, Mission.md, NOW.md and Decisions.md; leave unknown facts as TODO.",
      "Choose the smallest useful outcome, name its owner and acceptance check, and coordinate it in the existing team thread.",
      "Read back the produced artifact or record, update NOW.md and record only decisions the owner actually made.",
    ],
    writes: "Company.md, Mission.md, NOW.md, Decisions.md and a dated report under Reports/",
    escalates: "conflicting priorities, material commitments, publication, spend and any action beyond the configured scope",
  },
  {
    slug: "sales",
    name: "Sales",
    title: "Qualification and proposals",
    description: "Qualifies opportunities against the real offer, prepares evidence-based proposals and keeps the next commercial action explicit.",
    owns: "qualification, discovery records, proposal drafts and commercial follow-up before a client is won",
    workflow: [
      "Read Company.md, the relevant client record and Processes/Qualification.md; separate supplied facts from assumptions.",
      "Complete the qualification record, prepare the proposal from Processes/Proposal.md and label every price, scope and proof source.",
      "Hand a signed or explicitly approved engagement to Client Success in the existing team thread with the client and project paths.",
    ],
    writes: "client records under Clients/, proposal deliverables under Deliverables/ and commercial status in NOW.md",
    escalates: "discounts, contractual promises, unverified claims, external sending and any commitment not already authorized",
  },
  {
    slug: "client-success",
    name: "Client Success",
    title: "Onboarding and client continuity",
    description: "Owns clean onboarding, expectations, approvals and the continuity of each active client relationship.",
    owns: "onboarding, client inputs, communication plans, expectation tracking and follow-up coordination",
    workflow: [
      "Read the approved proposal and Processes/Onboarding.md, then open or complete the client and project records without overwriting human notes.",
      "List missing access, inputs, owners, milestones and approval boundaries; unknowns remain TODO rather than invented facts.",
      "Coordinate Delivery in the team thread and keep a dated client-facing update as a draft until sending is authorized and executed.",
    ],
    writes: "Clients/, Projects/, client updates in Deliverables/ and follow-up records in Reports/",
    escalates: "scope ambiguity, missing approval, relationship risk, sensitive data and any outbound communication not in scope",
  },
  {
    slug: "delivery",
    name: "Delivery",
    title: "Service delivery",
    description: "Produces the contracted work from verified inputs and makes progress, dependencies and acceptance criteria inspectable.",
    owns: "execution plans, work products, project progress and delivery evidence",
    workflow: [
      "Read the project record, approved scope and Processes/Delivery.md; identify dependencies before changing an artifact.",
      "Produce the deliverable in its named folder, preserving user edits and keeping sources or calculations beside the work.",
      "Verify the acceptance checklist, then ask Quality in the current team thread for an independent review before client delivery.",
    ],
    writes: "Projects/, Deliverables/, working evidence in knowledge/draft/ and dated progress in Reports/",
    escalates: "scope changes, blocked dependencies, irreversible operations, publication and spend",
  },
  {
    slug: "quality",
    name: "Quality",
    title: "Quality assurance",
    description: "Reviews deliverables against scope, evidence and acceptance criteria, recording concrete defects without inventing completion.",
    owns: "quality gates, evidence review, defect records and release recommendations",
    workflow: [
      "Read the project scope, the artifact and Processes/Quality assurance.md; do not rely on the producing agent's summary alone.",
      "Check completeness, accuracy, links, calculations, permissions and client-specific constraints with observable evidence.",
      "Record pass, fail or blocked with exact findings; return defects to Delivery in the current team thread and never self-certify a fix you did not inspect.",
    ],
    writes: "quality sections in Deliverables/, issue lists in Projects/ and review reports under Reports/",
    escalates: "material factual uncertainty, compliance questions, missing evidence and a requested release that fails its gate",
  },
  {
    slug: "operations",
    name: "Operations",
    title: "Operations, records and billing follow-up",
    description: "Keeps the operating records usable, prepares billing follow-up and maintains processes without claiming an unconfigured system is connected.",
    owns: "record hygiene, process maintenance, capacity visibility, billing preparation and operational reporting",
    workflow: [
      "Read NOW.md, active client and project records, and Processes/Follow-up and billing.md; reconcile identifiers and dates.",
      "Use scripts/ops.mjs only for its documented local record operations, inspect the result and preserve manual notes.",
      "Prepare follow-up or billing records as drafts; schedule or send only through an actually available mechanism and within the user's configured scope.",
    ],
    writes: "bus/, state/, Processes/, Reports/ and billing or follow-up fields in the relevant client and project record",
    escalates: "money movement, invoice issuance, external sending, account access and discrepancies that cannot be resolved from records",
  },
];

function roleSheet(role: Role): string {
  return `# ${role.name} — ${role.title}

## Responsibility

You own ${role.owns}. You work from observed files and tool results. A draft, requested operation or model statement is not proof that an external action happened.

## Run workflow

${role.workflow.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Records

Write to ${role.writes}. Link the client, project or deliverable identifier in every handoff so another teammate can continue without guessing.

## Boundaries

Escalate ${role.escalates}. Internal recruitment for an authorized mission does not require a separate approval, but it creates only a local teammate; it never grants accounts, files, publication rights or spending authority.
`;
}

function agentPointer(role: Role): string {
  return `# ${role.name} agent folder

Read \`../../AGENTS.md\` first, then \`${role.name}.md\`, then only the client, project, process and deliverable needed for the current task. The shared company brain is two levels above this folder. Coordinate a teammate only in a team chat that contains both agents.
`;
}

const AGENT_NOTES: TemplateNote[] = ROLES.flatMap((role) => [
  { path: `Agents/${role.name}/AGENTS.md`, text: agentPointer(role) },
  { path: `Agents/${role.name}/CLAUDE.md`, text: "@AGENTS.md\n" },
  { path: `Agents/${role.name}/${role.name}.md`, text: roleSheet(role) },
]);

const COMMON_INSTRUCTIONS = `Your working folder is inside the company's bound second brain. Read ../../AGENTS.md, then your role sheet, then the scoped records needed for the task. Preserve human edits, mark unknown facts TODO and verify artifacts by reading them back.

Use the existing native mechanisms truthfully: in a team chat, @Name can hand work to a member of that current group. A direct chat cannot silently hand work to the preinstalled group; tell the user to open the team chat when collaboration is needed. When recruit_agent or manage_agent is actually present, Codex and Claude may create or manage a persistent local teammate for the authorized mission. Cursor receives no injected team tools. Never narrate a delegation, send, payment, publication, schedule or account connection that the runtime did not record.`;

const BOTS: TemplateBot[] = ROLES.map((role, index) => ({
  slug: role.slug,
  name: role.name,
  title: role.title,
  description: role.description,
  instructions: `${COMMON_INSTRUCTIONS}\n\n${roleSheet(role)}`,
  ...(index === 0 ? {
    pinned: true,
    welcome: "Welcome. Before we operate, tell me: What services do you sell, who buys them, in which market and language, what outcome do you deliver, which tools do you already use, what is the first priority, and which actions require your approval? I will record only what you provide, keep unknowns as TODO, and coordinate specialists in the Service Business Team chat when real collaboration is needed.",
  } : {}),
}));

const ROOT_NOTES: TemplateNote[] = [
  {
    path: "AGENTS.md",
    text: `# Service-based Business — shared operating context

This vault is the company's shared second brain. Every agent starts in \`Agents/<Name>/\` and reads this file, then \`Start here.md\`, \`Mission.md\`, \`Company.md\`, \`Rules.md\`, \`Environment.md\`, \`Knowledge map.md\`, \`Team.md\`, \`NOW.md\` and its own role sheet.

Work from observed records. Keep clients separated. Preserve existing notes. Label assumptions and leave unknown facts as TODO. Store raw or unverified learning in \`knowledge/draft/\`; promote a fact to \`knowledge/trusted/\` only with a source and review date.

Use the complete path: qualification → proposal → onboarding → delivery → quality assurance → follow-up and billing. A stage moves only when its checklist has observable evidence. Internal handoffs happen in an existing team chat with an @Name mention. A direct message has no automatic route into the preinstalled team.

External communication, publication, spending, account changes and legally meaningful commitments follow the user's configured scope and runtime permissions. Reading a process never authorizes them.
`,
  },
  { path: "CLAUDE.md", text: "@AGENTS.md\n" },
  {
    path: "Start here.md",
    text: `# Start here

The Business Director's first brief asks the owner:

1. What services do you sell?
2. Who buys them, in which market and language?
3. What measurable outcome do you deliver?
4. What is included, excluded, priced and promised today?
5. Which tools and accounts already exist and are actually configured?
6. What is the first priority?
7. Which actions require approval before execution?

Record the answers in \`Company.md\` and \`Mission.md\`; keep every missing answer as TODO. Put the smallest useful next outcome in \`NOW.md\`. Delegate only through native mechanisms that are actually present: use the Service Business Team chat and mention the relevant member, or use \`recruit_agent\` when that tool is mounted. Never claim a direct-message handoff reached the team.
`,
  },
  {
    path: "Mission.md",
    text: `# Mission

## Purpose

TODO: why this service business exists and whom it serves.

## Outcome

TODO: the measurable client outcome, time horizon and evidence.

## Current focus

TODO: one priority, its owner, deadline and acceptance check.
`,
  },
  {
    path: "Company.md",
    text: `# Company

- Legal or trading name: TODO
- Owner and preferred form of address: TODO
- Services: TODO
- Ideal clients: TODO
- Markets and languages: TODO
- Offer, scope and exclusions: TODO
- Pricing and commercial terms: TODO
- Proof and constraints: TODO
- Existing tools and accounts: TODO — a named tool is not connected until verified
- Actions allowed without asking: TODO
- Actions requiring approval: TODO
`,
  },
  {
    path: "Rules.md",
    text: `# Rules

## Evidence and scope

- Inspect the real file or tool result before claiming an outcome. Preserve human edits and client boundaries.
- Drafting is not sending. Preparation is not publication. A requested payment or operation is not an executed one.
- Internal recruitment through \`recruit_agent\` is authorized for an in-scope mission; the owner does not approve each creation. \`manage_agent\` is limited to a teammate in the current group or one the agent recruited. These tools are injected for Codex and Claude when available; Cursor has no injected team tools.
- @Name handoff works only in the current team chat. There is no native send from a CEO or director DM into an existing group. Direct the user to the team chat instead of pretending the handoff ran.
- One chain is limited to 4 hops and 12 turns with no revisit of an agent. STOP cancels the active chain.
- An in-progress checkpoint may continue automatically for at most three additional turns. Denied input, STOP, failure, blocked status and interrupted runs do not recover automatically; a restart preserves records but does not replay work.

## Authority

- Agents may read, draft, analyze, organize records and recruit a bounded local specialist for the authorized mission.
- Sending, publication, spending, account changes and binding commitments follow the scope and approval settings the owner actually configured.
- \`schedule_routine\` creates a real schedule only after the tool confirms it. The runtime and Mac must be running and awake when it fires. This template installs no routines.
`,
  },
  {
    path: "Environment.md",
    text: `# Environment

This is Local BizOS OSS in a user-owned vault. The six roster entries are persistent executable agents created by the installer, not characters described by Markdown. Codex and Claude can receive native recruitment and management tools; Cursor does not receive injected tools.

No CRM is configured, no payment system is configured, and no contact channel is configured by this template. Record a connector only after its real status is observed. A remote personal model remains a remote provider.

Routines run only while the local runtime is available and the Mac is awake. There is no continuously available service promise. This template creates zero routines and makes no external call during installation.
`,
  },
  {
    path: "Knowledge map.md",
    text: `# Knowledge map

- \`Company.md\`: owner-supplied business facts and authority.
- \`Mission.md\` and \`NOW.md\`: direction and current work.
- \`Clients/\`: one scoped record per client.
- \`Projects/\`: contracted outcomes, milestones and status.
- \`Deliverables/\`: artifacts and acceptance evidence.
- \`Processes/\`: operating checklists.
- \`Reports/\`: dated internal or client-facing reports.
- \`knowledge/draft/\`: unverified research and working knowledge.
- \`knowledge/trusted/\`: sourced, reviewed facts.
- \`bus/\`: local handoff and event records used by the operations helper.
- \`state/\`: local operational state used by the operations helper.
- \`scripts/ops.mjs\`: shared local operations helper. Read its output; do not infer success from invocation alone.
`,
  },
  {
    path: "Team.md",
    text: `# Team

- Business Director — direction, priorities and team coordination.
- Sales — qualification and proposals.
- Client Success — onboarding, expectations and relationship continuity.
- Delivery — production and delivery evidence.
- Quality — independent acceptance review.
- Operations — records, process hygiene and billing follow-up.

The installer creates these six agents and the Service Business Team group. To collaborate, open that team chat and mention @Name. A handoff is complete only when the runtime persisted the message and resulting run. In a direct agent chat, ask the user to use the team chat; do not claim the group received anything.
`,
  },
  {
    path: "NOW.md",
    text: `# NOW

- Priority: TODO
- Owner: TODO
- Client or project: TODO
- Next observable outcome: TODO
- Acceptance check: TODO
- Blockers: none recorded
- Last verified: TODO
`,
  },
  {
    path: "Decisions.md",
    text: `# Decisions

| Date | Decision | Owner | Scope | Evidence |
|---|---|---|---|---|
| TODO | TODO | TODO | TODO | TODO |
`,
  },
];

const PROCESS_NOTES: TemplateNote[] = [
  {
    path: "Processes/Qualification.md",
    text: `# Qualification

1. Create or open the client record; capture source and date.
2. Record problem, desired outcome, urgency, decision process, stakeholders, budget range, constraints and current alternative. Unknowns stay TODO.
3. Check fit against the real service scope, capacity, market and exclusions in Company.md.
4. Record evidence and risks. Do not invent contact details, authority or budget.
5. Decide: qualified, nurture, disqualified or blocked. Add the next action, owner and date; external outreach remains a draft until authorized and executed.
`,
  },
  {
    path: "Processes/Proposal.md",
    text: `# Proposal

1. Start from a qualified client record and verified discovery notes.
2. State the client situation, outcome, scope, exclusions, milestones, responsibilities, acceptance criteria, price, payment assumptions and validity period.
3. Link every proof claim and mark legal, tax or compliance review where applicable.
4. Quality-check names, calculations, dates and consistency with Company.md.
5. Save the proposal under Deliverables/ as draft. Sending or signing is a separate external action and must be observed before the stage changes.
`,
  },
  {
    path: "Processes/Onboarding.md",
    text: `# Onboarding

1. Confirm an approved engagement; link its evidence rather than treating a draft proposal as signed.
2. Create the client and project records. Capture contacts only when supplied or sourced with permission.
3. Record goals, scope, exclusions, milestones, owners, communication rhythm, access required, data sensitivity and approval boundaries.
4. List missing inputs and access without requesting credentials in notes.
5. Hold a kickoff only through an available channel. Record decisions, next actions and owners; then hand Delivery the exact project path in the team chat.
`,
  },
  {
    path: "Processes/Delivery.md",
    text: `# Delivery

1. Read the approved scope, project record, dependencies and acceptance criteria.
2. Break the outcome into milestones with an owner, due date and observable check.
3. Produce artifacts under Deliverables/ and keep working evidence or sources beside them.
4. Preserve manual edits; never overwrite an existing artifact during a retry.
5. Read back the artifact, update project status from observed progress and request Quality review in the current team chat.
`,
  },
  {
    path: "Processes/Quality assurance.md",
    text: `# Quality assurance

1. Review the source scope and acceptance criteria before the producer's summary.
2. Inspect the actual artifact, links, calculations, sources, client names, dates, permissions and required formats.
3. Record each finding with severity, location, evidence and required correction.
4. Mark pass only when every blocking criterion is observed. Blocked is not failed; name the missing evidence.
5. After a correction, inspect the changed artifact again. A passed draft is still not sent or published.
`,
  },
  {
    path: "Processes/Follow-up and billing.md",
    text: `# Follow-up and billing

1. Confirm delivery and acceptance evidence in the project and deliverable records.
2. Prepare a follow-up record: outcome, open questions, next value milestone, owner and date.
3. Prepare billing data from the approved commercial terms; reconcile client, amount, tax assumptions, milestone and due date.
4. Do not claim an invoice was issued, a payment collected or a reminder sent without the configured system's result.
5. Record the observed status and exception. Escalate disputes, missing terms, overdue risk or money movement to the owner.
`,
  },
];

const RECORD_NOTES: TemplateNote[] = [
  {
    path: "Clients/Client template.md",
    text: `# Client — TODO

- Client id: TODO
- Status: prospect | active | paused | completed | lost
- Source and date: TODO
- Contacts supplied or publicly sourced: TODO
- Problem and desired outcome: TODO
- Scope and exclusions: TODO
- Approval boundaries: TODO
- Risks and sensitive data: TODO
- Active project ids: TODO
- Next action / owner / date: TODO
`,
  },
  {
    path: "Projects/Project template.md",
    text: `# Project — TODO

- Project id: TODO
- Client id: TODO
- Approved source: TODO
- Outcome and acceptance criteria: TODO
- Scope / exclusions: TODO
- Milestones / owners / dates: TODO
- Dependencies and access: TODO
- Status: planned | active | blocked | quality-review | complete
- Deliverable ids: TODO
- Last verified result: TODO
`,
  },
  {
    path: "Deliverables/Deliverable template.md",
    text: `# Deliverable — TODO

- Deliverable id: TODO
- Client / project ids: TODO
- Requested outcome: TODO
- Artifact path: TODO
- Sources and calculations: TODO
- Acceptance checklist: TODO
- Quality status and reviewer: TODO
- External delivery status: draft | approved | delivered (evidence: TODO)
`,
  },
  {
    path: "Reports/Report template.md",
    text: `# Report — TODO date

- Period: TODO
- Client / project: TODO
- Outcomes observed: TODO
- Work completed with evidence paths: TODO
- Work not completed: TODO
- Risks and blockers: TODO
- Decisions needed: TODO
- Next action / owner / date: TODO
`,
  },
  { path: "bus/README.md", text: "# Local operations bus\n\nAppend-only local handoff or event records created by the documented operations helper belong here. A file is evidence of a local record, not proof of an external send.\n" },
  { path: "state/README.md", text: "# Local operations state\n\nLocal indexes and checkpoints created by scripts/ops.mjs belong here. Preserve unknown fields and human notes; inspect command output and resulting files before reporting success.\n" },
  { path: "scripts/README.md", text: "# Scripts\n\nops.mjs is the shared local operations helper. It does not connect a CRM, payment provider or communication channel. Run only documented commands and verify the resulting record.\n" },
  { path: "scripts/ops.mjs", text: OPS_SCRIPT },
];

export const SERVICE_BASED_BUSINESS: CompanyTemplate = {
  id: "service-based-business",
  version: 1,
  name: "Service-based Business",
  description: "A service company operating system for sales, onboarding, delivery, quality, client success and operations in one shared local vault.",
  folders: [
    ...ROLES.map((role) => `Agents/${role.name}`),
    "Clients",
    "Projects",
    "Deliverables",
    "Processes",
    "Reports",
    "knowledge/draft",
    "knowledge/trusted",
    "bus",
    "state",
    "scripts",
  ],
  notes: [...ROOT_NOTES, ...PROCESS_NOTES, ...RECORD_NOTES, ...AGENT_NOTES],
  bots: BOTS,
  team: { name: "Service Business Team" },
  routines: [],
};
