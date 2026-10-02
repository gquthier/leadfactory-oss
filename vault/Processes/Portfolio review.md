# Portfolio review

Owner: CEO / CEO. Use the `agency-portfolio-ops` skill for a daily or weekly multi-client review within the owner's authorized scope.

The cockpit owns clients, campaigns, tasks, onboarding and deliverables. Read `agency_clients`, then the selected client's campaign/task/deliverable records. Each item keeps its real clientId and campaignId; a private client brief is not portfolio-wide context.

Write `Reports/Portfolio/<date>.md`: clientId, cockpit status, campaignId, owner, next action and taskId, due date, blocker, available capacity and evidence/date. Owner, deadline and capacity are coordination notes, not invented API fields. Store the next action with `agency_tasks` using its actual schema, and link the detailed report as a deliverable. Avoid duplicate open tasks.

Daily: triage overdue work, missing briefs and blocked approvals. Weekly: compare commitments, delivered work, retouches and capacity; identify decisions before taking on more work. Unknown capacity or results stay unknown. Do not replace factual status with a revenue promise.

Only a confirmed cockpit write is synchronized. Without its tools, deliver a dated Markdown/JSON handoff and state which import remains. Do not edit generated `Clients/<id>/Dossier.md` or application data files. Update NOW.md with decisions and next actions; a review cadence does not activate a routine automatically.
