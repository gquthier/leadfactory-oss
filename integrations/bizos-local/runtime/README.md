# BizOS Local runtime

This is the Node.js sidecar shipped with the BizOS Workbench Preview. It owns
local company state, chats, agent runs, routines, the bound Markdown vault and
read-only dashboard summaries. Electron provides the conversation UI, owns
personal GPT-Live, Jev and Kie credentials, and starts or adopts the sidecar.
Local execution does not make remote Codex, Claude, Cursor or personal API
inference offline. Native Ollama uses an already running loopback server.

## Build and test

Use Node.js 22 or newer inside the full `leadfactory-oss` checkout:

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build              # kit:sync, tsc, copy public kit assets
npx tsc --noEmit -p .
npx vitest run
```

`kit:sync` reads the repository root three levels above this folder. The
`source-manifest.json` lists the copied runtime source closure; generated
cockpit, templates, skills and notes are ignored. Its kit manifest hashes
copied files and uses `SOURCE_DATE_EPOCH` (default `0`) for a repeatable
`syncedAt`; `sourceCommit` is provenance when Git metadata is present. This
folder alone is not a complete kit distribution. Tests use temporary profiles
and scripted drivers, not paid providers or real credentials.

## Managed Codex and Claude CLI bootstrap

The existing Plans → Connect action first uses an available CLI already on the
machine. When Codex or Claude is absent, the runtime downloads the pinned
official native macOS arm64 binary on demand into
`<baseUserData>/managed-cli/<provider>/<version>/` and then opens Terminal for
the person's OAuth sign-in. The action can be repeated after a failed download,
denied Terminal launch, or unfinished sign-in. A failed download creates no
plan; later launch and sign-in retries reuse the same isolated plan.
`plans.test` checks that plan's auth home. An authenticated default `~/.codex`
or `~/.claude` is imported first without copying credentials; a later Connect
creates a separate isolated profile for another account. Explicit default
import remains idempotent.

The pins are in `src/harness/managed-cli.ts`: Codex 0.155.1 from OpenAI's
`rust-v0.155.1` release (Apache-2.0), and Claude Code 2.1.283 from Anthropic's
native release endpoint (Anthropic proprietary terms). Claude is downloaded
directly from its publisher on the person's action; it is not bundled. The
installer checks exact archive byte count and SHA-256, a single regular tar
member for Codex, and the extracted executable's pinned size (228803200 bytes)
and SHA-256 (`8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e`).
Claude's executable has the same size and hash as its direct download. It also
checks strict macOS code signature and pinned Team ID/bundle identifier,
arm64 architecture, and exact CLI version before publishing a private version
directory by rename. It rejects symlinked managed paths. Existing CLI choices
keep their existing PATH and canonical-path checks. Managed versions are not
overwritten or automatically updated during runs; Claude's CLI auto-updater is
disabled in its clean child environment.

The selected absolute binary is used for status, login, model discovery, and
turns. Terminal
launch waits for `osascript` success or reports denial, exit failure, or timeout;
that only means a login window opened. The person must finish OAuth in Terminal;
`plans.test` confirms it afterward. Runtime tests
inject downloads and commands; they do not exercise real OAuth or a clean Mac
desktop package. A real artifact and end-to-end provider probe remain separate
release checks.

## Process and HTTP boundary

The sidecar listens on `127.0.0.1` with an OS-assigned ephemeral port. Its
private descriptor contains the origin, random bearer token, instance ID and
PID. Public routes require that bearer and exact loopback Host/Origin checks;
internal team routes use separate one-shot capabilities. Electron main keeps
the bearer out of the renderer. `GET /api/local/events` sends `ready`,
`message`, `team-event` and `run` SSE refresh hints with a 15-second ping;
clients reread durable state after a hint.

Key local routes include `/api/local/dashboard-summary`,
`/api/local/brain/*`, `/api/local/runtime/heartbeat`,
`/api/local/avatar-worker/{claim,report}` and
`/api/local/voice/calls/*`. Voice `prepare` resolves a direct agent thread and
pins its connected Codex or Claude plan; `dispatch` is idempotent by operation
ID, and `cancel` targets only that call's owned work. Voice accepts no provider
credential or caller-selected plan. GPT-Live transport remains in Electron.

The default sidecar state root on macOS is
`~/Library/Application Support/BizOS-local-harness`; a managed desktop OS sets
`LOCALBIZOS_SIDECAR_STATE` and `LOCALBIZOS_SIDECAR_DESCRIPTOR` to private paths
under its own profile. The bound company vault and agent files live inside the
selected state root or an explicitly bound user vault. Never add profiles,
descriptors or personal credentials to this repository.

## Company work

The catalogue contains Lead Gen Agency, Service-based Business, Software and
Autonomous Company (`company-os`) for new companies. Historical Company OS and
E-commerce bindings remain supported. New company templates begin with a CEO and dormant specialist
roles, recruited when needed. The vault graph resolves explicit wiki and
Markdown links plus unambiguous references to existing text notes. It does
not infer semantic links or index paths outside the bound vault. Finder reveal
works for an authorized vault root without mutating it.

The dashboard reads bounded local cockpit and `state/*.jsonl` records. It
distinguishes `ready`, `empty`, `unavailable` and `error`, caps attention and
business lists, and omits vault paths, note bodies, contacts and credentials.
Activity and plan usage reflect recorded local runs and provider reports;
missing source data is not presented as zero. The native Ollama connector
requires a compatible installed model at `127.0.0.1:11434` or another explicit
loopback port. It does not start Ollama, pull models or provide a CLI shell.

## Agent behavior and limits

Agents can create expiring routines. `[SILENT]` suppresses an unchanged
routine or heartbeat result and `[DONE]` ends a watch. Agent-created routines
remain tied to the active turn; STOP revokes work that has not committed.
Archiving an agent pauses its routines. The default heartbeat checks for
unfinished work every 30 minutes between 08:00 and 21:00 local time; it does
not call a model when there is nothing to resume.

Codex, Claude Code and Cursor agents get a short local brief and bounded
context. Codex receives the full brief in the **first turn text** of a new
thread or failed resume, then only new context on a primed resumed thread;
it is not a `thread/start` system parameter. Claude sends its brief through
`--append-system-prompt`; Cursor prefixes its chat. Agent `MEMORY.md` and
company `USER.md` are read into that context up to 2,200 and 1,375 characters.
An unchanged or unsafe file is not rewritten. A progressing checkpoint can
continue for at most 45 minutes or 20 turns; expired approvals block until
the person answers. Interrupted in-progress work can resume once after a
restart. Quick chats and native Ollama use their own prompts.

Avatar jobs persist intent before a paid Kie submission. A known task ID can
resume polling; an uncertain submission is never retried automatically. The
runtime stores job state and normalized image data, not the personal Kie key.
The desktop must supply the provider worker. This code and its tests do not
verify live Kie billing, native Jev permissions or a signed desktop installer.

See [the runtime changelog](../CHANGELOG.md) and the desktop
`docs/bizos-local/README.md` for the consolidated release and package steps.


## Workspace QuickChat retention (2026-09-26)

QuickChat is a workspace conversation, not an agent. Its display name is
always **QuickChat**, including historical auto-titles. It shares the selected
company workspace but never owns that workspace or its business deliverables.

A QuickChat expires at `lastMessageAt + 24 hours`, including the exact boundary.
A new user message or published assistant message moves that deadline. Legacy
streaming assistant text also counts while it is displayed. Reads, retries of
an identical send, progress/approval/control messages, system activity and
preview updates do not. An empty QuickChat uses `createdAt`. Timers run while the
runtime is active; startup, reads, sends and provider callbacks also check the
wall clock, so sleep or downtime cannot extend retention.

`runtime/quick-chats.json` stores `lastMessageAt` and derived `expiresAt`. Legacy
rows recover activity from user/assistant content timestamps and the associated
assistant run’s end/update timestamp (old streamed rows kept turn-start time).
Where historical evidence is missing, only the retained timestamps are known.
`runtime/expired-quick-chats.json` retains opaque IDs only: retries cannot recreate
a deleted chat, and cleanup can resume after a crash. Transcript/native logs,
runs, native resume cursors, plan pins, approvals, exclusively referenced runtime
preview images and sidecar idempotency metadata are removed. Active turns are
aborted and late writes are blocked. A failed unlink leaves the chat revoked and
retries on reads, restart and a one-minute timer without blocking other chats.
Shared workspace files, shared previews and provider-managed histories outside
BizOS runtime state are not deleted by this policy.

The sidecar sends `event: thread` with
`{ threadId, change: "deleted", reason: "expired" }`; bootstrap omission remains
the source of truth. The desktop owns its cache deletion and retention notice.
Tests use temporary directories, injected clocks and scripted providers; they do
not prove a native desktop build or deletion inside an external CLI provider.


## Onboarding from business context (2026-09-26)

`POST /api/local/brain/templates/apply` accepts optional `companyName` and
`context: { sourceLabel, files: [{ path, text }] }`, beside `owner.name` and
`language`. Context requires `company-os` in a new managed vault. Send all creation options
in this first apply call; it already binds and installs atomically. Do not call
`workspace-template/bind` first: that route installs immediately without creation
options. A late context import into such an installation now returns 409 instead
of silently claiming success. Read `workspace-template` afterward to verify the
resulting binding. Electron owns
the native picker and supplies a UTF-8 snapshot; the runtime never opens a
caller-supplied source directory. The selected originals receive no writes or
new access grants. `bootstrap.backend.companyName` exposes the current known
company name when it fits the 64-character workspace title (otherwise null), so Desktop may adopt it for a still-provisional workspace
title without asking the person to name an existing business again. Limits: 80 files, 256 KiB per file, 512 KiB total, relative
paths up to 512 characters and individual names up to 255 UTF-8 bytes. Supported
extensions: Markdown, MDX, text, JSON, CSV and YAML. Hidden/traversal paths,
secrets, dependencies, instruction files, duplicates and binary text are refused.
Only this apply route allows a 4 MiB JSON body to account for escaping; other
routes keep their existing body limit.

The private snapshot lives in `Knowledge/Imported Context/files/`, indexed by
`Knowledge/Imported Context/README.md`. It is source evidence, not agent
instructions or authorization. The creation journal records the snapshot before
binding so startup can resume the same selection after a crash. Once installed,
retries preserve user edits and do not post another welcome.

Fresh installations opt into onboarding sequencing; historical journals and
existing teams retain their original behavior. CEO reads supplied context,
reuses known owner/company names, and asks for only missing information. If the
company name is missing, a name proposal must receive a user answer before the
separate priority question. A priority card must receive its own answer before
recruitment. Tool guards enforce that order, including across restarts and
continuations. Completion is durable, recovered from paginated history if a
crash preceded its checkpoint; later operational quick replies, long chats and
cleared transcripts do not restart completed onboarding. The
CEO is still responsible for reading and interpreting source documents and for
keeping prose to one question at a time. Tests use scripted agents and real
loopback HTTP, not a paid model, so they do not prove model reasoning quality.
