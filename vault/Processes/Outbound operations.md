# Outbound operations

Owner: Acquisition. Use `outbound-campaign-ops` after the offer, prospect list and sequence are prepared. Work on one authorized clientId/campaignId at a time.

Keep the account reference, sender readiness evidence, recipient selection, exclusions, sequence version, lot limit and campaign authorization in the client's private `08-outbound/` folder. Keep secrets in the configured service, never in the notes or repository. In SaaS, use broker tools only; standalone BYOK uses the owner's own account and is a separate execution boundary.

Deduplicate and reconcile before dispatch. Record stable batch and provider message IDs; distinguish planned, provider-accepted, delivered, replied, failed and unknown. A timeout is not proof of failure: inspect the prior receipt before retrying. STOP or a breached limit stops new dispatch, then reconcile work already accepted.

The LeadFactory cockpit has clients, campaigns, tasks and deliverables, not an individual-lead CRM or a native cold-email sender. Import CSV/JSON into an authorized external provider only when available and requested. Use `agency_campaigns` for the campaign record, `agency_tasks` for pending operations and `agency_deliverables` for summaries and artifact references. State any manual import or unavailable tool explicitly.

Route actual replies through `Processes/Reply qualification.md`. No campaign is active merely because a skill, account or export exists.
