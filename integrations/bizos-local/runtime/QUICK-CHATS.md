# Local workspace chats

Experiment branch: `experiment/quick-chat-workbench-20260918`.

Quick chats are standalone task conversations. Creating one writes workspace-local
metadata in `quick-chats.json`; it does not create a BotStore record, persona,
agent folder, or team member. Conversations and provider sessions are isolated
by `chat:<id>`, while their working directory is the selected workspace. An
unbound workspace uses one shared directory under its runtime state.

`POST /api/local/quick-chats` takes an idempotent `requestId` and returns the
public collaboration thread as `thread`. Its kind is `chat`, its `agentIds`
array is empty, and its runs have `agentId: null`. Assistant messages use
`senderType: assistant`, with no agent or human ID. The desktop imports these
through the existing collaboration pipeline into its native Signal chat UI.

Messages, run status, cancellation and approvals use the existing collaboration
routes. The direct local quick-chat endpoints also enforce the desktop bearer
and workspace scope. A generic internal executor reuses the dispatcher without
adding a persistent bot. Team recruitment, agent-specific computer access and
team tools are not mounted for these executors. Normal configured providers,
workspace tools and access settings still apply.

Validation on 2026-09-18: `npm run build` and `npm test`, 13 files / 138 tests
passing. Quick-chat tests cover independent histories and provider sessions,
workspace working directories, restart persistence, idempotency, validation,
STOP, approval scoping and provider errors. Harness drivers are scripted; the
HTTP test starts a real sidecar in a temporary HOME. Real-provider UI checks are
documented in the desktop experiment’s `WORKBENCH-PREVIEW.md`.
