# Personal model selection — candidate .40

Read and implemented 2026-09-28. Scope: `local-bizos-oss`; user-owned CLI accounts,
API providers, workspace data. No cloud credentials or admission changes.

## Contract

Authenticated `POST /api/local/model-selection` accepts:

```json
{"scope":{"kind":"quickchat","chatId":"qchat_…"},"selection":{"source":"provider","providerId":"prv_…","model":"lab/model"}}
```

Other scopes: `{kind:"agent",agentId:"bot_…"}` and `{kind:"workspace"}`.
Other selections: `{source:"plan",planId:"pln_…",model:"…"}` and
`{source:"auto",model:""}` (inherit, agent/QuickChat only). Workspace selection
requires a concrete model. The endpoint validates scope, source and catalog
before one scope-owned write and returns the effective selection. A concrete
model requires an explicit plan/provider source: `auto` only means inherited
default for agent/QuickChat, and is refused for workspace writes. It rejects
active runs. The Desktop confirms persistence with a fresh read.

QuickChat stores its own selection in its existing expiring record. Changing
configuration does not change its timestamps/TTL or other chats. Group controls
explicitly edit workspace defaults; existing agent overrides still win.
Selecting a model never rewrites a connector's shared default. The new workspace
provider override uses `local.inferenceModel`; legacy profiles without this field
keep using the connector default even when `local.model` still names an old CLI
model. This migration case has a separate injected-driver regression.

Personal models are usable independently of the paid entitlement. Other
entitlement features remain unchanged. Explicit CLI account selection disables
account failover. Removed explicit accounts/providers remain unavailable; their
next turn fails instead of silently choosing a different source.

Provider discovery uses GET `/models`, preserves all valid distinct IDs plus
names/modalities/tool metadata, and refuses a response over 8 MiB explicitly.
The previous catalog survives a failed refresh with unavailable status. Catalogs
are not execution/quota guarantees. Claude/Codex catalogs use the chosen account's
configuration; account-unverifiable catalogs, including Cursor, remain static.

## Evidence

- New tests first failed on the 200-model cap, free gate and absent selection API.
- Runtime TypeScript build passes.
- 53 focused runtime tests passed across personal-model-selection, entitlement,
  quick-chats, ollama, openai-dispatch, cursor-dispatch, continuity-dispatch,
  sidecar-model-selection and sidecar-entitlement. Final targeted recheck includes
  deleted explicit CLI accounts in all three scopes. After the legacy-profile
  compatibility fix, 15 targeted unit/HTTP tests passed.
- Real sidecar HTTP fixture verifies auth, free personal providers, 650 models,
  secret-free public responses, exact workspace/QuickChat persistence, unchanged
  connector defaults/TTL and rejected invalid writes. Provider server accepts only
  GET `/v1/models`; no chat endpoint is exposed.
- Injected drivers prove Claude/Codex account directories and exact API models in
  agent, QuickChat and workspace/group scopes. No real inference is needed.
- An old entitlement regression initially attempted its synthetic OpenRouter
  provider after removal of the historical fallback. The suite was stopped and
  the test was changed to an injected API driver; all subsequent runs use fixtures.

Full packaged UI verification and cloud destination integration belong to the
release integration step. These tests do not certify live provider quotas,
production cloud routing or a distributed binary.

## Review correction

A provider model copied into an Automatic workspace row could previously erase
its provider ID. Two failing Desktop regressions and a failing runtime regression
reproduced this before correction. Concrete workspace rows now always carry a
source ID; agent/QuickChat expose one explicit inheritance action. Runtime and IPC
reject concrete model IDs with `source:auto`. The test also preserves prior .39
settings/history and proves subsequent dispatch still reaches the legacy API
provider, never a CLI fallback. Settings displays the effective workspace model.
