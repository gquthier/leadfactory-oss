/** The manifest a paired phone reads before it talks to this computer. It is
 * ported unchanged from the local client contract, plus the one key the iOS
 * packet gates on: native agent creation is not offered by the pairing
 * contract, so it is reported `unavailable` rather than silently missing. */
export const localClientManifest = {
  protocol: { name: "bizos-client", major: 1, minor: 1, minimumClient: { major: 1, minor: 0 } },
  compatibility: {
    unknownFields: "ignore",
    unknownCapabilities: "unsupported",
    unknownEnumValues: "preserve",
  },
  product: { id: "local-bizos-oss", execution: "paired-computer", dataOwner: "local-user" },
  capabilities: {
    "auth.pairedDevice": { status: "available", scope: "public", transport: "jwe-over-https" },
    "collaboration.threads": { status: "available", scope: "workspace", transport: "json" },
    "collaboration.messages": {
      status: "available",
      scope: "workspace",
      transport: "poll",
      recovery: "history",
    },
    "collaboration.messageLookup": {
      status: "available",
      scope: "workspace",
      transport: "json",
      recovery: "lookup",
    },
    "collaboration.runRecovery": {
      status: "available",
      scope: "workspace",
      transport: "poll",
      recovery: "active_runs",
    },
    "collaboration.agentReplies": {
      status: "available",
      scope: "workspace",
      transport: "json",
      context: "local-thread",
      tools: true,
      skills: false,
      approvals: true,
    },
    "collaboration.realtime": { status: "unavailable", scope: "workspace", reason: "not_implemented" },
    "agents.roster": { status: "available", scope: "workspace", transport: "json" },
    // Autonomous recruitment stays a computer-side decision under the existing
    // agent policy. The phone cannot ask for it: the pairing contract offers no
    // creation scope, so no endpoint is advertised here.
    "agents.create.local": { status: "unavailable", scope: "workspace", reason: "not_offered_by_pairing_contract" },
    "skills.clientCatalog": { status: "unavailable", scope: "workspace", reason: "computer_managed" },
    "approvals.local": { status: "available", scope: "workspace", transport: "json" },
    "runCancellation.local": { status: "available", scope: "workspace", transport: "json" },
  },
  endpoints: {
    "client.manifest": { method: "GET", path: "/api/client/manifest" },
    "collaboration.bootstrap": { method: "GET", path: "/api/collaboration/bootstrap" },
    "collaboration.threads": { method: "GET", path: "/api/collaboration/threads" },
    "collaboration.threadMessages": {
      method: "GET_POST",
      path: "/api/collaboration/threads/{threadId}/messages",
    },
    "collaboration.messageLookup": {
      method: "GET",
      path: "/api/collaboration/threads/{threadId}/messages/by-client/{clientMessageId}",
    },
    "collaboration.runs": { method: "GET", path: "/api/collaboration/runs" },
    "collaboration.run": { method: "GET", path: "/api/collaboration/runs/{runId}" },
    "collaboration.cancelRun": { method: "POST", path: "/api/collaboration/runs/{runId}/cancel" },
    "collaboration.approvals": { method: "GET", path: "/api/collaboration/runs/{runId}/approval" },
    "collaboration.resolveApproval": { method: "POST", path: "/api/collaboration/runs/{runId}/approval" },
    "agents.roster": { method: "GET", path: "/api/agents" },
  },
} as const;
