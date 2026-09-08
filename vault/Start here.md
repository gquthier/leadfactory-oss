# Start your agency

This is the reusable LeadFactory operating template. It contains no originating client data or external service accounts.

Open this folder with your chosen agent tool and ask it to read `AGENTS.md`. Start with this brief:

> What do you sell, to whom, in which market and language, what outcome do you deliver, which tools do you already use, what is your first priority, and which actions require your approval?

Put the answer in `Company.md`. Unknown details stay TODO. The Agency Director then creates a first-day plan in `NOW.md` and identifies one useful deliverable that can be prepared with the available inputs.

To find clients, use `Processes/Acquisition.md`. For a signed client, use `Processes/Client onboarding.md`. A new client gets a separate folder copied from `Clients/Client template/`. A campaign gets a folder from `Campaigns/Campaign template/` with that client's identifier.

When installed from Apps → LeadFactory in BizOS local, the cockpit owns the client, campaign, onboarding, task and deliverable records. Use the agency tools exposed by your active run to read and update them. They are the same records shown in the dashboard. Read a LeadFactory skill and its relevant references before doing that work; the runtime supplies tools to list and read the included skills.

If using these Markdown files without the BizOS installer, the management app runs separately. Agree which system owns each field in `Connectors.md`; an exported dossier is not automatic synchronization. Copying the JSON alone does not execute agents. In either setup, a working personal model connection, tool access and an actual run are needed to produce a result.
