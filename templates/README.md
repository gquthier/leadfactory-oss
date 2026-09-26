# Native business template sources

Prepared on **26 September 2026**, private GitHub preview. The recommended experience is **BizOS**, with native templates and agent roles designed for the chosen business model. Skills and process files are readable, editable and duplicable under their licenses.

`lead-gen-agency.company-template.json` describes the six source roles and notes in `../vault/`. Its fields follow `CompanyTemplate`: id, integer version, name, folders, notes, bots and routines. The modern runtime applies its creation transformation: **CEO and its real thread are installed first**, while specialist definitions remain in `Roles/` for recruitment when useful. Existing installations and historical roles are preserved; the source roster is not a promise that all six agents start immediately. No routine is activated by this data pack.

The current runtime supports five IDs: `lead-gen-agency`, `service-based-business`, `software`, `company-os` and legacy `ecommerce`. The first four are current creation choices. “Work OS” is an editorial alias, not a sixth runtime identifier. The standalone Company OS in the umbrella catalog and the lightweight native Company OS are distinct packages.

## Source and installation

The runtime's `templateOf` loads the reviewed pack and bundled skills; `creationTemplateOf` provides the current initial layout. The Agency pack includes **26 skills** and the client cockpit. Human and agent tools share that cockpit's data when used through BizOS. A model connection is still required for a mission. Copying JSON alone does not install agents, connect accounts, start schedules or synchronize the app.

The JSON notes must exactly mirror `vault/` Markdown. Update the source notes and manifest together and keep the runtime fallback in sync. Native installation preserves user edits and resumes without duplicates; do not overwrite an existing personalized workspace with a raw copy.

## Private source exports

Run `node scripts/export-templates.mjs --output <new-directory>` from a development checkout. It builds the runtime, exports all five real manifests, materializes notes and includes runnable Agency/E-commerce cockpits from `export-allowlist.json`. It also records the CEO-only creation manifests for the four current choices. The output contains component licenses and integrity hashes. Review and scan the actual output before private publication; never export live company data.

The kit/cockpit resources retain MIT; runtime-derived exports retain AGPL-3.0-only and upstream notices. A private GitHub source license does not make downloads publicly accessible. The [umbrella catalog](https://github.com/gquthier/bizos-templates) remains private.

## Credential boundary

In BizOS SaaS, agents use authorized server tools without receiving platform provider keys. A template does not grant new access. Standalone operation uses the owner's own accounts and local data; local file permissions do not hide credentials from the machine's owner. Never transfer SaaS keys into the template, model context, local environment or downloads.
