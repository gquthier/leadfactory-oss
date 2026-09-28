# Runtime permission transitions — 2026-09-28

- Product: `local-bizos-oss`; execution: local harness and personal CLI drivers.
- Data owner: the selected local workspace. No cross-workspace propagation.
- Capability: runtime-wide permission changes, mission STOP, verified CLI-tree shutdown.
- Out of scope: cloud permissions, desktop labels, macOS prompts, undoing actions already executed.
- Proof: fictitious harnesses, a local fake CLI with a real detached descendant, linked Claude fixture. No personal profile or production access.

## Contract

`runtime.setPermissions` and legacy `runtime.setSettings({local:{permissions}})` serialize changes.

- Enabling `skip-all` affects new turns only. Native and host requests of existing turns keep their original policy. Pending cards are never automatically answered.
- Disabling saves `ask` first, stops missions with active bypass turns (including queued descendants), and awaits both terminal runs and verified CLI-tree shutdown. Cancelled missions are not restarted. Unrelated protected runs can continue.
- A native turn that ignores STOP fails after ten seconds. Unverified process cleanup also fails. Neither condition returns a successful revocation. New turns remain protected, and re-enabling is refused until a successful explicit revocation retry.
- Linked Claude remains bounded: native tools disabled, manual approvals, read-only sandbox, isolated settings/hooks/plugins. Bypass does not lift this boundary.

Settings responses retain their shape and add a non-persisted `permissionTransition`:

```ts
{
  effect: "new-turns" | "revoking" | "revoked" | "revocation-failed",
  manualReviewRequired?: boolean,
  continuingRunIds: string[],
  stoppedRunIds: string[]
}
```

GET reports `revoking` while STOP is pending and `revocation-failed` after an error; saved `local.permissions: "ask"` alone is not confirmation that old processes have exited.

## Crash boundary

Before saving `ask`, the runtime atomically writes and fsyncs `permission-revocation.json`. Only verified run settlement AND CLI-tree shutdown allow its removal. An error leaves the marker in place. Normal SIGINT/SIGTERM shutdown calls `harness.stop()`, awaits `waitForCliShutdown()`, then exits with status 0 only when cleanup was verified (`src/sidecar.ts`). A failed cleanup exits with status 1.

SIGKILL, a crash, or power loss can bypass that shutdown. CLI groups are detached; their captured identities and stop promises are in memory (`src/harness/procs.ts`). Startup has no durable inventory that can prove or reap those former descendants. If the marker exists (including damaged contents), startup forces `ask` and exposes `revocation-failed` with `manualReviewRequired: true`. It blocks re-enabling and refuses to clear the marker through an automatic retry, even if the current process has no tracked CLI children.

Checkpoint recovery is suspended on a startup with an inherited marker, so an interrupted cancellation is not automatically resumed as ordinary shutdown recovery. Verifying old process identities and clearing this inherited marker require a separate recovery operation; this patch provides no unsafe automatic acknowledgement or PID-based killing. Within the same runtime process, a failed STOP can be explicitly retried against its captured identities.

## Verification

Focused tests cover both transition directions, pending/late approval, multiple active missions, protected siblings, queued descendants, unresponsive STOP, concurrent writes, legacy settings, linked Claude, a real detached descendant exiting after its parent run, marker-before-settings ordering, failure retention, successful removal, and restart with a pending or corrupt marker.

`tsc --noEmit` and `git diff --check` pass. An expanded regression run has two failures reproduced unchanged on base `e74bc78`: the IPC test omits the existing `selectModel` channel, and the legacy facade test lacks a harness for its cloud getter. The unrelated date-dependent attachment assertion in `chat-outputs.test.ts` is outside this fix.
