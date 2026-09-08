# Lead Gen Agency template

`lead-gen-agency.company-template.json` describes the six agent roles and the notes in `../vault/`. It uses the `CompanyTemplate` shape inspected in the local BizOS harness on September 8, 2026: id, integer version, name, folders, notes, bots and routines.

This JSON is a **data pack**. The LeadFactory-enabled build of BizOS local consumes it through Apps → LeadFactory → Install the template. See the [installation guide](../docs/BIZOS.md) for the corresponding build and source distribution. Copying this JSON alone does not install anything.

The notes are also usable as ordinary Markdown in an agent workspace. Outside the BizOS installer, they do not automatically configure a model, discover skills, create executable agents, connect accounts or synchronize the management app.

There are six bot roles and zero routines. The local installer creates their real threads and a team conversation. It exposes the bundled LeadFactory skills and the cockpit through tools scoped to an active agency run. A personal model connection is still required to execute a mission.

The JSON `notes` are an exact copy of the Markdown files under `vault/`. When editing the vault, update the corresponding JSON note text. Paths are relative to a new vault and contain no traversal or hidden segments. Do not apply the pack over an existing personalized workspace without a separate, reviewed migration.

For local BizOS, the user owns the workspace, models and accounts. A future cloud adapter must create separate cloud records and import only this public content; it must not transfer private engine code, secrets or other-mode context.
