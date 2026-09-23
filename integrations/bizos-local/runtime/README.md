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

The catalogue contains Lead Gen Agency, Service-based Business and Software
for new companies; historical General OS and E-commerce bindings remain
supported. New company templates begin with a CEO and dormant specialist
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
