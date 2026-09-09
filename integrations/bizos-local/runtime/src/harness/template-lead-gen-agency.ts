// The Lead Gen Agency pack — a second template in the built-in catalogue.
//
// Converted ONCE, by hand-run script, from leadfactory-oss
// `templates/lead-gen-agency.company-template.json` (version 1); this
// module is the shipped copy and the JSON is not read at runtime. It is a flat
// TypeScript module on purpose: electron-builder ships `dist/harness/*.js`
// and the desktop's stager follows JS imports, so a JSON file beside the code
// would never reach an installed app.
//
// Faithful to the pack: 6 agents, 41 notes, 12 folders, no
// routine, one welcome (the Agency Director's), and NO team group — the pack's
// own `Team.md` says so deliberately. Nothing here connects a tool or names a
// client: the notes are an empty, reusable agency workspace.
import type { CompanyTemplate } from "./company-os.js";

export const LEAD_GEN_AGENCY: CompanyTemplate = {
  id: "lead-gen-agency",
  version: 1,
  name: "Lead Gen Agency",
  description: "A lead generation agency: a director, acquisition, onboarding, a strategist, a creative and an account manager, each with its process notes.",
  folders: [
    "Agents/Account Manager",
    "Agents/Acquisition",
    "Agents/Agency Director",
    "Agents/Creative",
    "Agents/Onboarding",
    "Agents/Strategist",
    "Campaigns/Campaign template",
    "Clients/Client template",
    "Knowledge/Draft",
    "Knowledge/Trusted",
    "Processes",
    "Reports/Daily",
  ],
  notes: [
    {
      path: "AGENTS.md",
      text: `# How this agency works

Read \`Start here.md\`, \`Company.md\`, \`Rules.md\`, \`Autonomy.md\`, \`Team.md\`, then \`Knowledge map.md\`. Read your own role sheet and only the client or campaign needed for the current task.

This folder is an empty, reusable agency workspace. Fill missing facts from the owner's brief and verified sources. Never import the originating agency's clients, accounts, pricing, results or private instructions.

For each task: identify its client and objective, inspect the relevant sources, produce the requested artifact, record evidence and missing inputs, then hand off to the next role. Preserve client boundaries. Do not treat another client's material as reusable evidence.

A Markdown role is a specification. An agent exists only when the chosen runtime has created an executable agent and its thread. A handoff is delivered only when a real message or task was persisted. If that capability is unavailable, write the handoff as pending.

Write drafts in the relevant client/campaign folder. Append actual owner decisions to \`Decisions.md\`. Add dated facts with source links to \`Knowledge/Draft/\`; verified status requires supporting evidence. Update \`NOW.md\` after completed work.

See \`Autonomy.md\` for actions requiring the owner's authorization. No schedule, external account or runtime is activated by reading this folder.
`,
    },
    {
      path: "Agents/Account Manager/AGENTS.md",
      text: `# Account Manager agent folder

Read \`../../AGENTS.md\`, then \`Account Manager.md\`, then the assigned client and campaign. Do not read unrelated private client folders.
`,
    },
    {
      path: "Agents/Account Manager/Account Manager.md",
      text: `# Account Manager

## Mission

Keep client progress, feedback, reporting and next decisions clear.

## One run

1. Read Processes/Client relationship.md and this client's current status.
2. Prepare sourced progress reports and communication drafts for the agreed cadence.
3. Route feedback and scope questions, record actual communication, and keep the next action assigned.

## Definition of done

A concise, evidence-backed client update or report and an assigned follow-up.

## Boundaries

Read \`../../Autonomy.md\`. Work only on the assigned client and campaign. Preserve source dates and evidence; keep hypotheses labeled. External sending, publication, spending and client-system changes require the relevant authorization. Honor STOP and runtime limits.

## Outputs

Client and campaign deliverables go in their dedicated folders. Working research goes in \`../../Knowledge/Draft/\`. Handoffs follow \`../../Processes/Handoffs.md\`; report only actions actually executed.
`,
    },
    {
      path: "Agents/Account Manager/CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Agents/Acquisition/AGENTS.md",
      text: `# Acquisition agent folder

Read \`../../AGENTS.md\`, then \`Acquisition.md\`, then the assigned client and campaign. Do not read unrelated private client folders.
`,
    },
    {
      path: "Agents/Acquisition/Acquisition.md",
      text: `# Acquisition

## Mission

Research suitable prospects, prepare relevant outreach and qualify actual responses.

## One run

1. Read Company.md and Processes/Acquisition.md; confirm the ICP and offer.
2. Research fit with source links, prepare original outreach drafts and record uncertainties.
3. Hand qualified opportunities and discovery questions to the Agency Director.

## Definition of done

A source-backed prospect brief and reviewable outreach sequence; sending remains pending unless authorized.

## Boundaries

Read \`../../Autonomy.md\`. Work only on the assigned client and campaign. Preserve source dates and evidence; keep hypotheses labeled. External sending, publication, spending and client-system changes require the relevant authorization. Honor STOP and runtime limits.

## Outputs

Client and campaign deliverables go in their dedicated folders. Working research goes in \`../../Knowledge/Draft/\`. Handoffs follow \`../../Processes/Handoffs.md\`; report only actions actually executed.
`,
    },
    {
      path: "Agents/Acquisition/CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Agents/Agency Director/AGENTS.md",
      text: `# Agency Director agent folder

Read \`../../AGENTS.md\`, then \`Agency Director.md\`, then the assigned client and campaign. Do not read unrelated private client folders.
`,
    },
    {
      path: "Agents/Agency Director/Agency Director.md",
      text: `# Agency Director

## Mission

Turn the owner brief into scoped priorities, coordinate the team and report verified progress.

## One run

1. Read the agency brief, current work and owner decisions.
2. Choose the next useful outcome; assign bounded work to available peers with the handoff contract.
3. Review artifact quality and evidence, resolve scope questions with the owner, and update NOW.md.

## Definition of done

An actionable plan or reviewed deliverable, with evidence, owner and next action.

## Boundaries

Read \`../../Autonomy.md\`. Work only on the assigned client and campaign. Preserve source dates and evidence; keep hypotheses labeled. External sending, publication, spending and client-system changes require the relevant authorization. Honor STOP and runtime limits.

## Outputs

Client and campaign deliverables go in their dedicated folders. Working research goes in \`../../Knowledge/Draft/\`. Handoffs follow \`../../Processes/Handoffs.md\`; report only actions actually executed.
`,
    },
    {
      path: "Agents/Agency Director/CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Agents/Creative/AGENTS.md",
      text: `# Creative agent folder

Read \`../../AGENTS.md\`, then \`Creative.md\`, then the assigned client and campaign. Do not read unrelated private client folders.
`,
    },
    {
      path: "Agents/Creative/CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Agents/Creative/Creative.md",
      text: `# Creative

## Mission

Produce original creative concepts, copy and available media assets from an approved brief.

## One run

1. Read the client brand requirements, evidence and campaign creative brief.
2. Draft concepts and copy; generate assets only with configured tools and record provenance.
3. Check readability, message, offer, dimensions and destinations; return versioned deliverables for review.

## Definition of done

A checked creative pack with real artifact paths, generation status and approval status.

## Boundaries

Read \`../../Autonomy.md\`. Work only on the assigned client and campaign. Preserve source dates and evidence; keep hypotheses labeled. External sending, publication, spending and client-system changes require the relevant authorization. Honor STOP and runtime limits.

## Outputs

Client and campaign deliverables go in their dedicated folders. Working research goes in \`../../Knowledge/Draft/\`. Handoffs follow \`../../Processes/Handoffs.md\`; report only actions actually executed.
`,
    },
    {
      path: "Agents/Onboarding/AGENTS.md",
      text: `# Onboarding agent folder

Read \`../../AGENTS.md\`, then \`Onboarding.md\`, then the assigned client and campaign. Do not read unrelated private client folders.
`,
    },
    {
      path: "Agents/Onboarding/CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Agents/Onboarding/Onboarding.md",
      text: `# Onboarding

## Mission

Turn an agreed engagement into a complete, isolated client brief ready for delivery.

## One run

1. Read Processes/Client onboarding.md and the agreed scope.
2. Collect essential inputs, document assets and access status without storing secrets.
3. Prepare a kickoff summary and hand the delivery brief to Strategist with blockers and owners.

## Definition of done

A complete client brief, access checklist and delivery handoff with gaps explicitly marked.

## Boundaries

Read \`../../Autonomy.md\`. Work only on the assigned client and campaign. Preserve source dates and evidence; keep hypotheses labeled. External sending, publication, spending and client-system changes require the relevant authorization. Honor STOP and runtime limits.

## Outputs

Client and campaign deliverables go in their dedicated folders. Working research goes in \`../../Knowledge/Draft/\`. Handoffs follow \`../../Processes/Handoffs.md\`; report only actions actually executed.
`,
    },
    {
      path: "Agents/Strategist/AGENTS.md",
      text: `# Strategist agent folder

Read \`../../AGENTS.md\`, then \`Strategist.md\`, then the assigned client and campaign. Do not read unrelated private client folders.
`,
    },
    {
      path: "Agents/Strategist/CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Agents/Strategist/Strategist.md",
      text: `# Strategist

## Mission

Translate a client offer and audience research into a testable campaign and creative brief.

## One run

1. Read the client brief and Processes/Campaign delivery.md.
2. Research the market and audience with sources; separate evidence from hypotheses.
3. Write strategy, measurement plan and creative brief, then hand production to Creative.

## Definition of done

A source-backed strategy and testable creative brief tied to one client and campaign.

## Boundaries

Read \`../../Autonomy.md\`. Work only on the assigned client and campaign. Preserve source dates and evidence; keep hypotheses labeled. External sending, publication, spending and client-system changes require the relevant authorization. Honor STOP and runtime limits.

## Outputs

Client and campaign deliverables go in their dedicated folders. Working research goes in \`../../Knowledge/Draft/\`. Handoffs follow \`../../Processes/Handoffs.md\`; report only actions actually executed.
`,
    },
    {
      path: "Autonomy.md",
      text: `# Autonomy

Default behavior until the owner records different bounded permissions:

- Read the files and sources explicitly available to this workspace; research, draft, organize and report within the authorized project.
- Collaborate with executable peers through the runtime's actual tools, subject to its limits and permissions. Writing an agent description is not recruitment or execution.
- Ask for missing inputs only when they block a useful next action. Continue independent preparation when possible.
- Obtain explicit authorization before sending outreach or client messages, publishing creatives or pages, launching/changing ads, spending money, or changing external client data.

Record a standing authorization with: actor, client, action, system, limits, expiry or revocation conditions, and evidence of the owner's instruction. A broad ambition to grow the agency is not permission for every external action.

Connectors and routines start unconfigured. No scheduled jobs are included in this template. A provider configured by the user may run remotely; this workspace makes no offline-inference promise.
`,
    },
    {
      path: "CLAUDE.md",
      text: `@AGENTS.md
`,
    },
    {
      path: "Campaigns/Campaign template/Campaign.md",
      text: `# Campaign — template

- Campaign ID: TODO
- Client ID: TODO
- Owner: TODO
- Objective and success metric: TODO
- Channel: TODO
- Audience / ICP: TODO
- Offer and approved claims: TODO
- State: draft
- Dates and timezone: TODO
- Budget, if applicable: not configured
- Measurement source: TODO
- Strategy and evidence: TODO
- Creative / sequence / page references: TODO
- Approval record: none
- Launch record and platform state: not launched
- Actual results and period: unknown
- Next action: complete the brief
`,
    },
    {
      path: "Campaigns/Campaign template/Creative brief.md",
      text: `# Creative brief

- Client/campaign IDs: TODO
- Objective, channel and placement: TODO
- Audience and observed problem: TODO, with source
- Main message and call to action: TODO
- Offer details and evidence: TODO
- Format, dimensions, duration and language: TODO
- Brand references and asset provenance: TODO
- Constraints / exclusions: TODO
- Concepts to explore: TODO
- Acceptance criteria: TODO
- Deliverables and version links: none
- Quality review: pending
- Client/owner approval: pending
`,
    },
    {
      path: "Campaigns/Campaign template/Launch checklist.md",
      text: `# Launch checklist

All items start pending. Do not infer completion from the presence of this file.

- Correct client and destination account verified: pending
- Offer, links and contact path checked: pending
- Creative quality and claim evidence reviewed: pending
- Tracking and test conversion/lead verified where applicable: pending
- Targeting, dates, exclusions and budget recorded: pending
- Owner authorization for the exact external action recorded: pending
- Required platform access available: pending
- Launch executed through the configured tool: not launched
- Actual platform state and identifiers verified: pending
- Monitoring owner and next check agreed: pending
`,
    },
    {
      path: "Clients/Client template/Brief.md",
      text: `# Client brief — template

Copy this folder for a real client. This is not a sample customer.

- Client ID and name: TODO
- Account owner and contact reference: TODO
- Agreed service, scope and exclusions: TODO
- Offer, audience and market: TODO
- Brand voice and assets: TODO
- Claims allowed, with evidence: TODO
- Success metric, baseline and reporting period: TODO
- Constraints and required approvals: TODO
- Agreed dates and communication cadence: TODO
- Source of agreement and brief: TODO

## Readiness

- Essential inputs received: TODO
- Access status (no secrets): TODO
- Missing item / owner / next step: TODO
- Ready for strategy: no
`,
    },
    {
      path: "Clients/Client template/Reporting.md",
      text: `# Reporting

- Client and campaign IDs: TODO
- Period and timezone: TODO
- Data source and read date: TODO
- Metric definitions: TODO
- Actual values: unknown
- Comparison period and limitations: TODO
- Deliverables completed: TODO, with links
- Interpretation / hypotheses: TODO
- Proposed decisions: TODO
- Owner decisions: TODO, with source
- Next action / owner / date: TODO

Never fill an unavailable metric with zero. Label projections separately from measured results.
`,
    },
    {
      path: "Clients/Client template/Status.md",
      text: `# Client status

- Client ID: TODO
- Account manager: TODO
- Current stage: not started
- Active campaign IDs: none
- Last completed deliverable and evidence: none
- Pending approval: TODO
- Current blocker: TODO
- Next action / owner / date: TODO
- Latest client feedback and source: TODO

Update from actual work and communication. A copied template does not indicate an onboarded client.
`,
    },
    {
      path: "Company.md",
      text: `# Company

Status: unconfigured. Replace TODO from the owner's brief; do not invent defaults.

- Agency name: TODO
- Owner and decision maker: TODO
- Target customer and market: TODO
- Offer and scope: TODO
- Outcome and how it will be measured: TODO
- Language and tone: TODO
- Pricing and payment terms: TODO
- Delivery capacity and responsibilities: TODO
- Current priority: TODO
- Existing tools and systems of record: TODO
- Actions never taken without authorization: TODO
- Evidence supporting claims we may use: TODO

Client-specific facts belong in that client's folder, not in this shared agency context.
`,
    },
    {
      path: "Connectors.md",
      text: `# Tools and sources of truth

Nothing is connected by this template. Choose only the tools the agency actually needs.

| Capability | Chosen tool / account | Source of truth | Allowed actions | Setup status |
|---|---|---|---|---|
| Client and campaign management | TODO | TODO | TODO | Not configured |
| Research | TODO | Source-linked research notes | TODO | Not configured |
| Outreach | TODO | TODO | Draft until sending authorized | Not configured |
| Creative generation | TODO | Versioned assets + provenance | TODO | Not configured |
| Advertising | TODO | Platform campaign/report data | Read or change as authorized | Not configured |
| Client communication | TODO | TODO | Draft until sending authorized | Not configured |

For each connected tool record the client's account reference, owner, granted scope, and revocation method. Store credentials outside this folder. Each user supplies their own provider or platform account; paid services are not included.

Skills may require particular tools. Consult the repository's skills/dependency documentation before execution. A missing tool produces a missing-capability report, not a claim that an action succeeded.
`,
    },
    {
      path: "Decisions.md",
      text: `# Decisions

No owner decisions recorded yet.

Append real decisions only:

| Date | Decision maker | Decision and scope | Source / authorization | Review or expiry |
|---|---|---|---|---|

Proposals remain in working notes until the owner decides. Do not interpret sample content as authorization.
`,
    },
    {
      path: "Knowledge map.md",
      text: `# Knowledge map

| Need | Read |
|---|---|
| Agency offer and current scope | \`Company.md\`, \`Mission.md\`, \`NOW.md\` |
| Boundaries and owner decisions | \`Rules.md\`, \`Autonomy.md\`, \`Decisions.md\` |
| Who does the work | \`Team.md\`, \`Agents/<Name>/<Name>.md\` |
| Prospecting and sales preparation | \`Processes/Acquisition.md\` |
| New client | \`Processes/Client onboarding.md\`, the client's \`Brief.md\` |
| Campaign research and production | \`Processes/Campaign delivery.md\`, the campaign's \`Campaign.md\` |
| Client reporting and retention | \`Processes/Client relationship.md\` |
| Dependencies and systems | \`Connectors.md\` |

\`Knowledge/Draft/\` contains dated research and hypotheses. \`Knowledge/Trusted/\` contains verified, scoped facts with sources, source dates and read dates. A historical verified fact can become stale; check freshness before reuse. Neither folder grants new access to client systems.
`,
    },
    {
      path: "Mission.md",
      text: `# Mission

Help the agency win suitable clients and deliver the agreed lead-generation service through documented work, clear client communication and measured results.

The owner defines the offer, commercial commitments, risk limits and success criteria in \`Company.md\`. The team prepares and executes only the work authorized within those boundaries.

First success: one defined client or prospect project, one complete brief, one useful deliverable and an explicit next step. Generated assets and drafts are outputs; they are not proof of leads, revenue or campaign performance.
`,
    },
    {
      path: "NOW.md",
      text: `# Now

Status: waiting for the agency owner's brief.

- Objective: TODO
- Active client/campaign: TODO
- Last completed result and artifact: none yet
- Evidence / verification: none yet
- Current blocker or missing input: agency brief
- Next action: answer the question in \`Start here.md\`
- Owner: Agency Director

Update after actual completed work, with a date and links to the outputs.
`,
    },
    {
      path: "Processes/Acquisition.md",
      text: `# Acquisition: from ICP to a qualified opportunity

Owner: Acquisition. Inputs: agency offer, market, capacity, approved sources, outreach constraints. Output: a qualified pipeline and prepared outreach; no sending is implied.

1. Define the ideal customer, buying trigger, disqualifiers and why the offer fits. Ask the Director to resolve a missing offer before promising outcomes.
2. Research candidate businesses from permitted sources. Record source URL, date and a relevant business reason. Do not invent contact details or buying intent.
3. Qualify each opportunity against the ICP. Keep prospect data in a private workspace, outside the reusable template repository.
4. Draft a short email sequence with a specific reason for contacting this business, one useful proposition and a clear next step. Keep evidence separate from personalization guesses.
5. Check facts, intended recipient, duplicates, existing opt-outs and the configured outreach platform's requirements. Obtain the required authorization before enabling a send.
6. Classify actual replies: interested, question, not now, negative or opt-out. Prepare the next response or discovery brief. Do not mark a meeting or deal won without evidence.
7. Hand a qualified opportunity to the Director with need, fit, evidence, open questions and the proposed next conversation.

Done: research is sourced, draft sequence is reviewable, each prospect has a state and next action, and sending is either explicitly authorized/executed with evidence or clearly pending.
`,
    },
    {
      path: "Processes/Campaign delivery.md",
      text: `# Campaign delivery

Owners: Strategist for strategy; Creative for creative production; Director for coordination. Inputs: client brief, scope, evidence, permitted tools and campaign objective.

1. Create a campaign record linked to exactly one client. Set objective, channel, responsible person, draft state and measurement source.
2. Research the audience, offer, objections and market. Record sources and distinguish observations from hypotheses.
3. Write a strategy: audience, angle, offer, funnel or outreach path, measurement plan and a small set of testable hypotheses. Budget is a proposal until approved.
4. Hand Creative a brief containing format, channel, key message, evidence, brand requirements, exclusions and acceptance criteria.
5. Produce copy/concepts and, when a configured tool supports it, real image/video assets. Record generation tool, inputs and output paths. A prompt is a creative brief, not a rendered asset.
6. Review every deliverable: readable layout, correct offer, supported claims, asset provenance, destinations and client fit. Save feedback and versions.
7. Prepare the launch checklist and approval packet. Launch only through authorized connected tools with explicit parameters and evidence of the resulting platform state.
8. Read actual campaign data for the agreed period. Propose changes based on the observed funnel and sample, with limitations stated; apply only within authorized scope.

Done for preparation: complete strategy and versioned, checked deliverables. Done for launch: actual campaign/page state verified. Done for a performance report: dated source data, calculated metrics and decisions linked to evidence.
`,
    },
    {
      path: "Processes/Client onboarding.md",
      text: `# Client onboarding

Owner: Onboarding. Trigger: the Director confirms an agreed engagement and its scope. Output: a complete client brief and kickoff handoff.

1. Create a dedicated client folder from \`Clients/Client template/\`; assign a stable client identifier in the chosen management system.
2. Record the actual agreed service, deliverables, exclusions, owners, dates and approval process. Link the agreement; do not create a new commercial commitment.
3. Collect audience, offer, brand assets, approved claims, prior results with sources, constraints and client preferences.
4. List required account access. Request the smallest useful scope through the chosen platform; never ask for secrets to be pasted into notes.
5. Define the success metric, baseline, measurement period and reporting source. Keep unavailable values marked unknown.
6. Prepare a kickoff summary for the client and a handoff to Strategist. Sending the summary requires the appropriate authorization.
7. Mark onboarding ready only when essential inputs exist; assign optional gaps an owner and next step.

Done: delivery can start from a scoped brief with known dependencies. An access checklist marked TODO is not proof that a connector works.
`,
    },
    {
      path: "Processes/Client relationship.md",
      text: `# Client relationship and reporting

Owner: Account Manager. Inputs: agreed scope, current tasks, approved deliverables, actual measurement data and client feedback.

1. Review the client's agreed cadence and current campaign state. Separate completed work, pending approvals and blockers.
2. Draft a concise update: what was delivered, what the data shows, what decision is needed, and the next action with its owner/date.
3. Report observed metrics for a named period and source. Do not turn generated creatives, impressions or a platform's projection into claimed sales.
4. Record feedback in the client's folder. Route creative feedback to Creative, strategy changes to Strategist and scope/commercial changes to the Director.
5. Prepare renewal or expansion options from documented needs and delivered value. New prices, scope or promises require the owner's decision.
6. Send through the configured communication tool only when authorized. Record the real sent message reference; a draft remains a draft.

Done: client status and next actions are clear, every claim has a source, feedback is assigned, and delivery/sending status is accurate.
`,
    },
    {
      path: "Processes/Handoffs.md",
      text: `# Handoff contract

Use this structure for a real runtime message or a task in the chosen management system:

- Task ID and client/campaign ID:
- From / to:
- Objective:
- Inputs and sources:
- Allowed scope / relevant authorization:
- Expected artifact and acceptance criteria:
- Due date or priority:
- Completed output and verification:
- Missing inputs / next action:

The recipient checks scope and inputs, produces the output, then replies with its location and verification. If no peer-message tool exists, save a pending handoff and identify who must deliver it. Never narrate an agent exchange as executed when it was only written in this file.
`,
    },
    {
      path: "Rules.md",
      text: `# Working rules

1. Read the current client brief and source before asserting a fact. Record source date and read date where freshness matters.
2. Use TODO for unknown facts and label hypotheses, proposals, decisions and measured results distinctly.
3. Keep every client and campaign identified in artifacts and handoffs. Access to agency context does not imply access to every client's files.
4. Use a single declared source of truth per data field. A note and a dashboard are not synchronized unless an integration proves it.
5. Preserve originals. Make a new draft or version before substantial revision of a client deliverable.
6. Use only substantiated claims and assets with recorded provenance. Research from third parties informs original work; it is not copied as a client testimonial.
7. Record authorization before external sending, publishing, spending or changing a connected client system. Preparing a draft is not sending it.
8. Handoffs identify owner, scope, output, evidence and next action. A task is done only when the artifact and verification exist.
9. Honor STOP. Do not restart a stopped chain or create a recurring schedule implicitly.
10. Store credentials in the tool's secret store, never these notes, prompts, examples or client exports.
`,
    },
    {
      path: "Start here.md",
      text: `# Start your agency

This is a generic operating template inspired by LeadFactory. It contains no client data and has no services connected.

Open this folder with your chosen agent tool and ask it to read \`AGENTS.md\`. Start with this brief:

> What do you sell, to whom, in which market and language, what outcome do you deliver, which tools do you already use, what is your first priority, and which actions require your approval?

Put the answer in \`Company.md\`. Unknown details stay TODO. The Agency Director then creates a first-day plan in \`NOW.md\` and identifies one useful deliverable that can be prepared with the available inputs.

To find clients, use \`Processes/Acquisition.md\`. For a signed client, use \`Processes/Client onboarding.md\`. A new client gets a separate folder copied from \`Clients/Client template/\`. A campaign gets a folder from \`Campaigns/Campaign template/\` with that client's identifier.

The management app runs separately from these notes. Agree which system owns each field in \`Connectors.md\`; do not claim the app and notes synchronize automatically. Start with one client and one campaign before adding more complexity.

The companion JSON describes six agent roles for a future compatible importer. Copying these files does not install agents into BizOS. A working model connection, tool access and an actual run are needed to produce a result.
`,
    },
    {
      path: "Team.md",
      text: `# Team

These are reusable role definitions. Use your runtime to create executable agents if you want delegation; otherwise one assistant can perform the roles sequentially.

| Role | Owns | Main handoff |
|---|---|---|
| Agency Director | Owner brief, priorities, scope, coordination and quality decision | Assigns bounded tasks; reports verified progress |
| Acquisition | ICP research, prospect qualification, cold-email drafts and response triage | Qualified opportunity and discovery brief |
| Onboarding | Signed scope, client brief, assets, access checklist and kickoff | Complete delivery brief with gaps identified |
| Strategist | Audience, market research, campaign hypotheses, channel and measurement plan | Strategy and creative brief |
| Creative | Concepts, copy, image/video briefs, assets and quality checks | Versioned creative pack for approval |
| Account Manager | Client communication drafts, progress, reporting, feedback and renewal preparation | Feedback or scope decision to the director |

Six separate agents are described. The JSON deliberately creates no team group: the inspected BizOS group-creation UI currently limits selection to four agents. Grouping and inter-agent transport must be implemented by the chosen runtime and verified separately.

Use \`Processes/Handoffs.md\` for every cross-role task. Account Manager receives only the client context needed for the assignment. New client work does not silently reuse another client's private research or assets.
`,
    },
  ],
  bots: [
    {
      slug: "agency-director",
      name: "Agency Director",
      title: "Agency coordination",
      description: "Turn the owner brief into scoped priorities, coordinate the team and report verified progress.",
      instructions: `Read ../../AGENTS.md, then Agency Director.md in your working folder. Turn the owner brief into scoped priorities, coordinate the team and report verified progress. Follow the client scope and autonomy rules. Use actual runtime tools for peer communication and execution; mark unsupported actions pending. Never claim a draft, welcome message or role file proves an action ran.`,
      pinned: true,
      welcome: `Welcome. What do you sell, to whom, which tools do you already use, what is your first priority, and which actions require your approval? I will turn your brief into the first plan. No client work has run yet.`,
    },
    {
      slug: "acquisition",
      name: "Acquisition",
      title: "Prospecting and cold email",
      description: "Research suitable prospects, prepare relevant outreach and qualify actual responses.",
      instructions: `Read ../../AGENTS.md, then Acquisition.md in your working folder. Research suitable prospects, prepare relevant outreach and qualify actual responses. Follow the client scope and autonomy rules. Use actual runtime tools for peer communication and execution; mark unsupported actions pending. Never claim a draft, welcome message or role file proves an action ran.`,
    },
    {
      slug: "onboarding",
      name: "Onboarding",
      title: "Client intake and kickoff",
      description: "Turn an agreed engagement into a complete, isolated client brief ready for delivery.",
      instructions: `Read ../../AGENTS.md, then Onboarding.md in your working folder. Turn an agreed engagement into a complete, isolated client brief ready for delivery. Follow the client scope and autonomy rules. Use actual runtime tools for peer communication and execution; mark unsupported actions pending. Never claim a draft, welcome message or role file proves an action ran.`,
    },
    {
      slug: "strategist",
      name: "Strategist",
      title: "Research and campaign strategy",
      description: "Translate a client offer and audience research into a testable campaign and creative brief.",
      instructions: `Read ../../AGENTS.md, then Strategist.md in your working folder. Translate a client offer and audience research into a testable campaign and creative brief. Follow the client scope and autonomy rules. Use actual runtime tools for peer communication and execution; mark unsupported actions pending. Never claim a draft, welcome message or role file proves an action ran.`,
    },
    {
      slug: "creative",
      name: "Creative",
      title: "Creative concepts and production",
      description: "Produce original creative concepts, copy and available media assets from an approved brief.",
      instructions: `Read ../../AGENTS.md, then Creative.md in your working folder. Produce original creative concepts, copy and available media assets from an approved brief. Follow the client scope and autonomy rules. Use actual runtime tools for peer communication and execution; mark unsupported actions pending. Never claim a draft, welcome message or role file proves an action ran.`,
    },
    {
      slug: "account-manager",
      name: "Account Manager",
      title: "Client communication and retention",
      description: "Keep client progress, feedback, reporting and next decisions clear.",
      instructions: `Read ../../AGENTS.md, then Account Manager.md in your working folder. Keep client progress, feedback, reporting and next decisions clear. Follow the client scope and autonomy rules. Use actual runtime tools for peer communication and execution; mark unsupported actions pending. Never claim a draft, welcome message or role file proves an action ran.`,
    },
  ],
  routines: [],
};
