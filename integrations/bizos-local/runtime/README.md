# Local BizOS runtime — Agency and E-commerce

This folder contains the source closure of the local sidecar used by the LeadFactory-enabled BizOS build. It includes no cloud model credentials or private cloud engine. The cockpit, skills and notes are copied from this repository when building; the runtime is AGPL-3.0-only, with Apache-2.0 attributions preserved in NOTICE and licenses/. Both business kits retain their MIT licences.

## Build and test

Use Node.js 22 or newer. Electron is a compile-time type dependency here; this command skips its binary download:

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build
npm test
```

The desktop shell is distributed with the corresponding sources alongside the application release. See [the BizOS guide](../../../docs/BIZOS.md). Starting this sidecar alone does not provide the desktop chat interface.

A model and external accounts are supplied by the user. Inference through a personal remote provider is not offline inference. Profiles and client databases must never be added to this repository.

## Second-brain links and Finder reveal

The local graph resolves explicit wiki and Markdown links, plus deterministic
references to existing `.md`, `.markdown` and `.txt` files. Filename references
may be exact inline-code spans or explicit paths in prose. Filename mention
resolution checks the linking note's folder, then the vault root; a bare mention
links only when the remaining basename match is unique. Explicit wiki links keep
their legacy bare-basename fallback. The graph does not infer links from
headings, role names or semantic similarity, and an unresolved filename mention
does not create a ghost node. Code blocks, indented examples, HTML comments,
URLs, paths outside the vault and files excluded from the vault index are
ignored.

The brain open endpoint may reveal the selected vault in Finder only with
`mode: "reveal"` and the exact empty path `""`. The runtime resolves the opaque
root id to its already authorized canonical vault and calls `/usr/bin/open` with
`["-R", vault]`. Empty paths remain invalid for default-app and Obsidian opens,
and for note read, rename and trash operations. Revealing is also available for
a vault shared read-only because it does not mutate the vault.

## Local dashboard summary

`GET /api/local/dashboard-summary` uses the sidecar's existing bearer token and
projects only the current verified local workspace. It reads bounded, fixed
files in the bound vault; it never installs or opens a business cockpit, mints
a dashboard ticket, runs an ops script, or calls a cloud/third-party service.
Agency and legacy E-commerce counts come from their persisted local cockpit
records. Service and Software counts come from initialized `state/*.jsonl`
operational logs. Agents and routines come from the runtime roster. Lists are
capped at eight items and contain no contacts, note bodies, connection data,
credentials or vault paths.

Each section reports `ready`, `empty`, `unavailable`, or `error`. `empty` means
an initialized source was read successfully and has no records; a missing or
unsafe source is never displayed as zero. E-commerce finance is explicitly
the sum of manually entered metrics in the profile's currency over all
recorded dates, with no profit calculation. Email and finance for other
templates are unavailable until a dedicated local data source exists.

The summary also carries `activity` (input + output tokens today and this
calendar month from recorded runs, runs today, running/queued runs, the current
run and the last failure of the past 24 hours, with public thread ids),
`plan` (the active plan or local provider: label, status and its busiest usage
window), `mode` (permission policy and inference source) and `setup` (plan,
company, team, routines, first completed task). The run history keeps 200 runs:
when it may not reach back to the start of the month, `monthComplete` is false
and day totals that it cannot cover are `null`. A plan label that is an e-mail
address is withheld.

`attention` lists, newest first and at most five, what the agents need from the
person: pending asks of waiting runs (`question` or `approval`, with `approvalId`,
public `runId` and any `choices`), pending or waiting Ops decisions (`decision`,
routed to the owning agent's thread or the CEO's) and runs that failed in the
past 24 hours (`failure`, with the recorded error). Each agent row also carries
its public `threadId` and, while working or waiting, its current `task`.
Answer an ask with `POST /api/collaboration/runs/{runId}/approval`
`{ "askId": approvalId, "answer": { "kind": "text", "text": "…" } }` (or
`allow_once` / `deny` / `choice`); any other reply is an ordinary chat message:
`POST /api/collaboration/threads/{threadId}/messages` `{ clientMessageId, content }`.

## Native Ollama connector

The local sidecar can call an already running Ollama server directly at
`http://127.0.0.1:11434` (or another explicit loopback port). Add an Ollama
provider in Settings, check its installed models, and select one; the runtime
never pulls a model or starts Ollama. Legacy saved addresses ending in `/v1`
are normalized to the native origin. The model must report local chat support;
agents also require `tools` support. A missing, remote or unsupported model
fails its run without another provider taking over.

Quick chats use text only. Agents receive only the host team and business tools
actually mounted for their run; the native Ollama path has no CLI shell,
filesystem reader, browser, MCP app or attachment reader. STOP aborts the HTTP
request and revokes host tool capabilities. Run readback records the verified
provider and model plus Ollama's observed token counts, without a quota or
price estimate. Personal remote API providers still use their existing route.

## Source scope and repeatable assets

`source-manifest.json` identifies the source files copied from the local
sidecar source closure, including type-only dependencies. No legacy Electron
application entrypoint or private cloud engine is included. Electron is needed
only to resolve the existing computer-host types; its binary is not used by
this runtime.

Build this folder inside the full kit checkout: `kit:sync` reads the repository
root three levels above. It copies only the public cockpit, template, skills,
notes and MIT notices into ignored generated folders. The source archive needs
these sibling files; this folder alone is not a standalone kit distribution.

The generated kit manifest hashes every copied file. Its `syncedAt` uses
`SOURCE_DATE_EPOCH` (Unix seconds; default `0`) so repeated builds of the same
inputs do not drift with wall-clock time. `sourceCommit` is provenance metadata
when Git metadata exists, or `null` in a source archive; compare file hashes
when verifying archive and checkout builds.

`npm test` runs isolated template installation and binding, permissions, shared cockpits and
real-sidecar-process tests, with temporary profiles and scripted model drivers.
Build first so the sidecar-process test is exercised. These tests do not call a
paid model, test real user credentials or validate a signed desktop installer.

## Local voice task boundary

The desktop main process delegates a finalized voice task through four
bearer-authenticated loopback routes:

- `POST /api/local/voice/calls` prepares an opaque call for one public local
  agent id and returns the server-resolved direct thread and exact personal
  plan binding. An optional `expectedBinding` lets later delegations in the
  same voice session verify that the selected account did not change.
- `POST /api/local/voice/calls/:callId/dispatch` persists one real user message
  and starts one collaboration run. Its `operationId` is idempotent.
- `GET /api/local/voice/calls/:callId` returns persisted run state and actual
  assistant text for polling.
- `POST /api/local/voice/calls/:callId/cancel` requests cancellation only for
  queued or running ids owned by that call. A prepared call can also be
  cancelled. Running state remains visible until the provider acknowledges
  cancellation.

This boundary accepts no provider credential, profile id, thread id, plan id
override or run id from voice. The runtime independently resolves the agent's
own plan override, or the currently selected plan when the agent has none. It
accepts connected Codex and Claude personal plans only. External API providers,
Cursor, disconnected plans and exhausted plans are rejected. A started voice
run cannot fail over to another account or provider family.

The current single-task tranche removes Local BizOS team coordination tools
from strict voice runs and blocks group handoff. This keeps STOP complete while
run lineage is limited to the initial run. Normal text chat keeps its existing
routing, failover and coordination tools. GPT-Live transport and credentials
remain owned by the desktop main process and never enter this runtime contract.

## Routine integrity

Interval routines accept whole-minute intervals from 5 through 10,080 minutes
and are shown as `every N minutes`, matching their relative scheduler behavior.
An active routine always names an existing, non-archived local agent. The same
owner invariant is enforced for direct harness/IPC calls and sidecar calls.

Agent-created routines remain bound to the active source turn. STOP revokes an
accepted request even when it is waiting behind another local mutation or an
owner lookup; the sidecar checks the run and session again at the serialized
write boundary. STOP does not delete a routine that was already committed.

Archiving an agent pauses every routine it owns without changing the routine's
last or next run timestamps. Reactivating the agent does not re-arm them; each
routine must be resumed explicitly. Missing or archived owners are checked
again after session preparation and when a queued routine reaches dispatch, so
they cannot advance schedule bookkeeping or start a provider turn. Archiving
does not interrupt a provider turn that already started; STOP remains the
explicit control for work already executing.

## Proactive routines, heartbeat and push events

A routine run is wrapped in a short prompt (`harness/routine-run.ts`): deliver
the result casually, answer exactly `[SILENT]` when nothing is new, don't
repeat the previous report (quoted, ≤1,200 chars), and end with `[DONE]` when
the watched thing is over. Routine and heartbeat replies are held until the
turn ends: `[SILENT]` publishes nothing and records run outcome `silent`;
otherwise `routine.fired` is recorded just before the reply messages.
`endsAt` (tool `until`, PATCH `ends_at`) makes a watch self-expiring: no window
at or after it ever fires, and the routine is then disabled with `expiredAt`.
A routine or heartbeat run cannot create routines.

Routine team events (`routine.created|updated|deleted|fired`) share the durable
team-event history with recruitment. `GET /api/local/events` (same bearer and
origin checks) streams `ready`, `message`, `team-event` and `run` frames with a
15-second ping; it is a refresh hint, never the source of truth.

The sidecar heartbeat (default every 30 minutes, 08:00–21:00 local, set with
`POST /api/local/runtime/heartbeat`) wakes an idle agent only for its latest
unfinished task checkpoint, or to nudge once on a task blocked for two hours
with no reply. The gate reads the run store only; each task is woken at most
once per two hours and three times in all.

## Local team-tool status

`/api/local/runtime` reports `tools.scope = "local"` and separate Codex,
Claude, and Cursor transport states. The aggregate `tools.available` means at
least one agent team-tool transport is registered and usable by its supported
CLI: dynamic host tools for Codex, or the packaged local-team MCP bridge for
Claude. Cursor is reported as unsupported, and Quick chats are reported as
intentionally excluded from this team-tool surface.

This status does not claim that a CLI is installed or signed in, that a
personal app is connected, or that computer/Chrome permissions exist. Those
have separate checks. The deliberately absent cloud MCP server does not make
the local transport status unavailable; `cloudTools` remains false.

## Native CLI permissions in local BizOS

The harness adds workspace context, agent coordination and tools to the user's
personal Codex app-server / Claude Code CLI. Built-in CLI tools remain enabled;
Claude receives BizOS instructions through `--append-system-prompt`. This is not
a promise that every interactive CLI feature is exposed in the desktop UI.

The workspace setting `local.permissions = skip-all` explicitly selects native
unrestricted execution: Codex uses `never` approvals and `dangerFullAccess`, and
Claude uses `bypassPermissions` / `--dangerously-skip-permissions`. In this mode,
Claude merges BizOS MCP configuration with its native account/project MCP sources
instead of restricting it with `--strict-mcp-config`. Personal profile selection
and cloud/local credential isolation remain unchanged.

The default remains `ask`; protected mode retains MCP isolation and the selected
file sandbox. Each Codex turn sends an explicit approval policy, including resumed
threads, so disabling bypass restores `on-request` on the next turn. Changing the
setting does not approve an already pending action. macOS permissions and Jev's
separate action confirmations are unaffected.

`tests/native-capabilities.test.ts` exercises both permission modes for new and
resumed Codex turns with a fake app-server transport, plus Claude's native tool,
context and connector arguments. It makes no model call. See the official
[Codex app-server contract](https://learn.chatgpt.com/docs/app-server) and
[Claude CLI reference](https://code.claude.com/docs/en/cli-reference).

## Agent brief, memory and autonomy

Local Codex, Claude Code and Cursor agents receive a short brief
(`buildLocalBrief` in `src/harness/prompt.ts`, about 2.7k characters before
memory): identity, company and person, mission, freedom to act, texting style
(a blank line is a new chat bubble), routines (`[SILENT]` when there is nothing
new), teammates, three safety rules and a few runtime facts. The cloud prompt,
Quick chats and native Ollama keep their existing prompts.

The brief is byte-stable within a provider session and is sent once per session:
Codex gets it on `thread/start` (or when `thread/resume` fails) and a resumed,
primed thread receives only the messages since the agent's last reply
(`resumedSystem`); Claude re-sends the same bytes in `--append-system-prompt`,
with the time, checkpoint and new messages in the turn text; Cursor gets it
prefixed once per chat. A primed session is recorded per thread and agent in
`cursors.json` (`|ctx`); a provider that starts a new session, a policy change,
a plan failover or a cleared thread falls back to the brief plus a bounded
transcript. A changed brief older than six hours is re-sent.

Memory is two Markdown files the agent edits with its own file tools:
`MEMORY.md` in its folder (2,200 characters) and `USER.md` at the root of the
bound second brain, else in the profile's `workspaces/` folder (1,375
characters). The runtime creates a missing file and never rewrites one. Both are
read when the brief is built, shown with a fill gauge and, past the cap, a
request to consolidate. Symlinks are not read; control characters and fence
markers are neutralised and known secret formats redacted. A read-only sandbox
marks memory read-only; `USER.md` outside the agent's writable roots is marked
read-only for that agent.

An `in_progress` checkpoint that changes continues automatically for up to 45
minutes of wall clock or 20 continuations. A permission or question that
expires unanswered no longer ends the task as failed: the run completes, the
checkpoint becomes `blocked` with `waiting for your approval: …`, and a late
answer through `lbz:threads:answerExpired` (the HTTP approval endpoint uses it
for ended runs) resumes the task from its checkpoint. A late "allow once" grants
the exact same request once, for one hour. A person's refusal still stops the
task. The expired-request record lives in memory; after a restart, or at any
time, a reply in the thread continues the task, whose blocked checkpoint is in
the turn context.

At start, the latest run of each agent thread whose task was `in_progress`
when an app shutdown or crash interrupted it (touched within 12 hours) is
continued once with a note that the app restarted. STOP-cancelled runs are never
resumed, a run is resumed at most once, and a chain of two restart resumes is
not extended further.
