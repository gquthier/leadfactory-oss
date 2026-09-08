# Team

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

Use `Processes/Handoffs.md` for every cross-role task. Account Manager receives only the client context needed for the assignment. New client work does not silently reuse another client's private research or assets.
