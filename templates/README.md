# Lead Gen Agency template

`lead-gen-agency.company-template.json` describes the six agent roles and the notes in `../vault/`. It uses the `CompanyTemplate` shape inspected in the local BizOS harness on September 8, 2026: id, integer version, name, folders, notes, bots and routines.

This is a **data pack**, not an operational BizOS import feature. The inspected harness currently applies its hardcoded Company OS template. A catalogue, template selection and resumable installer must be added to consume this pack. No BizOS integration code is included here.

The notes are also usable as ordinary Markdown in an agent workspace. They do not automatically configure a model, discover skills, create executable agents, connect accounts, synchronize the management app or send messages.

There are six bots, zero routines and no automatic team group. A compatible runtime may create separate executable agents and their threads; this must be verified. The inspected BizOS group-creation UI limits selection to four agents, so grouping is deliberately left to the future adapter.

The JSON `notes` are an exact copy of the Markdown files under `vault/`. When editing the vault, update the corresponding JSON note text. Paths are relative to a new vault and contain no traversal or hidden segments. Do not apply the pack over an existing personalized workspace without a separate, reviewed migration.

For local BizOS, the user owns the workspace, models and accounts. A future cloud adapter must create separate cloud records and import only this public content; it must not transfer private engine code, secrets or other-mode context.
