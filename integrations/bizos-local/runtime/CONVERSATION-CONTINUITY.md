# Linked conversation continuity — 26 September 2026

Implementation in this worktree; no production migration, app installation or
real paid provider call was performed for this work. Backend counterpart:
`docs/backend/conversation-continuity.md` in the SaaS repository. Local OSS that
has no explicit conversation link has no transcript upload or installation grant.
The existing `cloud-link` dashboard snapshot is a separate contract.

QuickChat is a local, ephemeral 24-hour conversation. Continuity link and
attach reject `chat:qchat_…` before contacting the desktop bridge; the HTTP
boundary rejects the same identity. Older local QuickChat mappings, outbox
events, queued commands and run records are removed on recovery or expiry,
without deleting any remote archive. A QuickChat cannot be reprojected or
synchronized from that legacy mapping after expiry. Persistent bot and group
links remain unchanged.

## Persistence and context

`continuity.json` is an atomic, fsynced inbox/outbox. Human intents and finalized
public agent messages have stable UUIDs, local sequence, canonical server
sequence and payload hashes. Draft streaming text stays local. Canonical wire
payloads are compared field for field and against PostgreSQL's JSONB SHA256.
Messages awaiting a server receipt remain visible from the ledger even if the
NDJSON projection write fails. Storage errors are raised; corrupt security
ledgers are not reset to empty.

When a restored profile shares an installation with a newer copy, canonical
events from that installation set the minimum outbox sequence. Pending events
are rebased above it before upload, retaining their event IDs and content;
acknowledged events keep their original receipts. A stale forward message
cursor after projection is reset to the first local transcript page, with
`cursorReset: true`, so a polling client can merge by message ID and continue.

Projection keeps pre-link local history before the shared archive. Matching local
messages retain attachments, reply metadata and timestamps while canonical text
is refreshed. Polling forward from the last pre-link message reaches new shared
messages. Upload batches obey both the 100-event and 256 KiB UTF-8 request limits.
New local-only messages record the last visible message as a durable presentation
anchor, so attachment-only replies and control messages stay after an imported
archive even when that archive contains no matching local message IDs. These
anchors stay in the local ledger and are not uploaded.
The link records the last pre-link local row. Older profiles without that
boundary or per-message anchors place their remaining local rows after the
latest canonical message no later than the row timestamp. This keeps final
local replies reachable by forward polling from the canonical cursor.
Turning backup off stops event uploads; it does not remove the visible
canonical projection. New local replies still anchor after that projection,
and old null anchors are recovered by chronology when no pre-link boundary
places them earlier.

The first explicit link starts from that boundary; it does not import old native
CLI chats. A second installation discovers an authorized BizOS conversation and
attaches its public projection to a chosen local bot. A copied workspace cannot
supply its installation identity: a changed main identity requires explicit
reattachment, and account/org changes are refused.

Linked Claude/Codex turns reconstruct the entire synchronized neutral archive.
They never trust an old CLI resume cursor. This costs additional input tokens.
There is a **256 KiB context limit**: above it execution waits and the full archive
is retained. A checkpoint is an artifact/transfer manifest; this version does not
claim its summary can replace arbitrary older instructions. Historical tool
results are data, never automatically replayed commands. `read_conversation_archive`
is a bounded archive reader: `limit` accepts 1–20 events, the complete JSON page
is capped at 60,000 characters, and `next` advances after complete events. One
event that cannot fit returns an explicit error instead of an empty continuation
page. `read_conversation_artifact` verifies local versioned
bytes before every page and returns at most 6,000 Unicode characters with
`offset`, `next` and `total`; it does not duplicate the document as base64 for the
model. MCP conversation results exceeding the output bound return a visible
error instead of truncated JSON. `list_accessible_computers` queries only the cloud agent bound to this
conversation, not the human's full device inventory.

Bindings distinguish installation, provider account, runtime contract, policy,
prepared sequence, sent sequence and confirmed sequence. `session.started` is
not confirmation. Codex confirms after the `turn/start` RPC response; Claude
confirms only after a successful result. Every new linked turn reconstructs even
when a previous binding was confirmed, because native history has no independent
attestation in this version.

Messages are limited to **20,000 characters**. Artifacts are explicit immutable
versions, SHA256-verified, at most **128 KiB**. There is no automatic folder upload.
The latest authorized checkpoint pulls required artifact versions before a turn;
missing/conflicting bytes block it. Checkpoints and blobs are conversation scoped.

`publish_conversation_artifact` is available through both Claude's mounted MCP
and Codex's actual dynamic tools. It accepts explicit text, a document name, a
supported text MIME type, version and previous SHA256 (null for version 1), plus
the artifact UUID for updates. No disk path or folder is accepted. The host run
ID is captured by the dispatcher or capability broker; a native CLI turn ID
cannot select authority. Admission, current grants and the live lease authorize
the operation; STOP is checked again after waiting and before the checkpoint.

The publication writes immutable verified bytes and a checkpoint containing the
latest versions, preserving previous checkpoint instructions. Publications on
one conversation are serialized through their entire sync/write/checkpoint
sequence, so parallel documents cannot replace a complete manifest with an older
partial one. A stale version conflicts rather than silently rebasing. A lost
response or STOP after upload leaves an unknown effect for reconciliation; the
runtime does not claim to roll back already accepted bytes. Validation rejected
before document mutation is recorded as failed, allowing correction of the input.

## Authority and actual tool surface

The server policy is read before `runs/start`; disabled policy blocks execution.
The personal runtime chosen on the destination must be present and supported. The approved fallback model and spending
limit are sent unchanged. A claimed run has one owner, generation, token and
expiry. A local 200 ms watchdog refuses new mediated calls after expiry and stops
the supervised CLI process group. Every host tool call is admitted at the server
again with an operation UUID, target and full argument hash. Pending/unknown
operations cannot be repeated automatically. Aborting a process does not undo a
remote form submission or any other external effect.

Recruitment and routine creation retain their successful local result with the
confirmed effect. Repeating the same operation returns that result without
executing the tool again. If the host reply was lost before the result was
saved, the existing recruitment journal or deterministic routine ID supplies
the result. A confirmed broker receipt is read, never rewritten with a new
terminal message. Routine replay compares normalized immutable fields and
preserves subsequent pause state.
When a BizOS model turn recruits an agent, its signed model selection is also
set on the recruit's new direct chat and team group before the introduction and
initial task start. The selection is checked against the current organization
and workspace before inheritance.

| Capability | Linked behavior | Automatic transfer |
| --- | --- | --- |
| Claude native builtins | `--restricted --safe-mode --tools ""`, no bypass, custom hooks/plugins/settings disabled | Only after the init tool list contains solely the mounted BizOS MCP prefix |
| BizOS team/pack/Computer tools | Current lease + server admission immediately before the operation; terminal receipts | Only when no operation is pending or unknown |
| Recruitment, routine creation, cloud shell | Refused in a linked turn until child/shell authority has a server lineage | No |
| Codex native tools / inherited MCP | Session reconstructed; native effects explicitly classified uncontrolled | **Not delivered**: effective native tool confinement is not proven |
| Local independent OSS | Existing local permissions and workflows | Outside this system |

`runs/finish(finalEvents)` reconciles bounded final output after lease expiry.
Its exact request is durable before transmission and is retried identically after
a lost response. STOP/revocation/new ownership can still reject it; the local
result remains visibly pending rather than pretending it reached the cloud.
An atomic terminal receipt exceeding 256 KiB waits for reconciliation with a
visible size error; it is not repeatedly transmitted as an oversized request.

Explicit STOP is persisted separately from terminal receipts, including while
admission is awaiting the server. It is reconciled before ordinary synchronization
when connectivity returns. Stopped missions are excluded from shutdown and quota
continuations, and transfer checks STOP again after each asynchronous boundary.
Late admission responses cannot launch a cancelled command or revoke a newer run.

Routine occurrence journals store the original payload and occurrence ID before
advancing the schedule. The same ID deduplicates a lost enqueue response. Queued
commands survive normal shutdown; a command interrupted after provider admission
is retained for reconciliation and is not automatically repeated.
Cancelling a queued command removes its durable queue record; recovery also
refuses stale records whose runs are terminal. Routine recovery takes its mutex
before dispatch, handles immediate settlement and checks the durable run state
when deduplication returns a run completed during an earlier process.

## Main bridge and lifecycle

Main holds the app-wide key in OS protected storage. The runtime receives only
`{installationId,userId,orgId,workspaceId}` from `status`. It calls the existing
native descriptor's `POST /v1/continuity` with `{operation,body}`; bearer HMAC is
`HMAC-SHA256(secret, workspaceId + NUL + "continuity")` and header
`x-bizos-workspace` is required. Main checks workspace/enrollment scope and signs
and performs backend HTTPS itself. No key or generic signer is a model tool.

An open linked runtime sends declared CLI presence and synchronizes its journal
on a 15 s tick with jitter, backing off to 60 s on errors. Incoming canonical
messages publish ordinary thread events. Closing stops the tick.

Owner-bearer sidecar routes:

- `GET /api/local/continuity/status?threadId=…` (omit for all local links).
- `GET /api/local/continuity/agents`, `/conversations`, `/transfers`.
- `GET /api/local/continuity/policy?threadId=…`. Policy writes belong to desktop
  management IPC; models cannot expand permissions or a spending limit.
- `POST /api/local/continuity/link` with local `threadId`, explicit cloud
  `agentId`, `audience`, optional `cloudThreadId`, and `title`.
- `POST /api/local/continuity/attach` with local `threadId`, `conversationId`.
- `POST /api/local/continuity/sync` with `threadId`.
- `POST /api/local/continuity/artifact/put` and `/artifact/read` with explicit
  bounded version fields (see the backend contract).
- `POST /api/local/continuity/transfer/prepare` with `threadId`, `transferId`,
  `destination` and optional summary. The source freezes new tools, stops its
  process, checks termination, commits a checkpoint, prepares and quiesces. A
  cloud destination then commits through its existing authorized server adapter.
- `POST /api/local/continuity/transfer/accept` with local `threadId` and the
  discovered transfer receipt (`transferId,runId,epoch,checkpointId,expectedHead,
  manifestHash,modelRuntime`). It verifies dependencies and commits at the
  destination; the next dispatched turn claims the transferred run.
- `POST /api/local/continuity/prepare-shutdown` with `{}` returns
  `{results:[{threadId,state:'transferred'|'waiting',reason?}]}`. Desktop must call
  this **before** tearing down the main signing bridge, allowing 20 s for the
  response. Preparation has a 12 s admission deadline, a 7 s source-stop bound
  within it, and each bridge request has a 3 s timeout. A lost response stays
  reconcilable. SIGTERM also attempts it
  before stopping the harness. Only enabled `autoContinue`, an approved fallback
  and a verified supervised run can transfer. A failed bounded Claude run with
  a quota/capacity error uses the same authorized transfer path.

Abrupt power loss cannot prove source quiescence and remains waiting. Codex
uncontrolled runs remain waiting for explicit reconciliation. These limits are
not represented as completed automatic switching.

## Verification scope

`tests/continuity*.test.ts` exercise temporary storage, real driver subprocesses
with protocol doubles and a loopback HTTP server. The vertical fixture runs
Claude A → OpenRouter-compatible HTTP driver → Codex B → old Claude A with 35
older messages, an old correction, a later cloud correction and a new artifact
hash. Providers in this fixture are doubles, not real Claude/OpenRouter/Codex
inference. It also covers lost receipts, final output after expiry, approved
shutdown transfer, background reception, device inventory scoping, draft message
publication, disk errors and occurrence recovery. Full backend SQL/RLS, signed
cross-repository integration and desktop UI proofs are separate parent-agent work.

The original continuity branch passed `npm run build` (294 packaged kit files)
and **470 tests in 51 files** on 26 September 2026, before this unified merge.
Those counts are historical branch evidence, not a claim about this merged tree.
Test providers, network services and writable workspaces are fixtures; this is
not a claim of real-provider execution or installed desktop validation.

The subsequent local-only projection regression was reproduced and corrected;
the targeted continuity, dispatch and bot-harness suites passed **42 tests**.
That original 470-test gate also includes actual dispatcher publication of document
versions, MCP publication interrupted by STOP, rejected invalid inputs, concurrent
document manifests and conflicting updates, and complete paginated reconstruction
of a 120,000-byte UTF-8 document with emoji and escaped characters.
Archive pagination is tested with long escaped events, complete reconstruction
through `next`, an explicit event count limit, and rejection of a single event
that cannot fit without truncation.
