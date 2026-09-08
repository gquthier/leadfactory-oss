/** The paired phone talks to the same local collaboration facade the desktop
 * uses. This adapter only translates between the mobile contract's DTOs and
 * the facade's arguments — it owns no state, no ids and no policy, so the
 * recruit, peer and STOP behaviour stays exactly where it lives today. */

export class MobileContractError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "MobileContractError";
  }
}

export interface LocalMobileContext {
  readonly kind: "local";
  readonly computerId: string;
  readonly workspaceId: string;
}

type ApprovalRow = { askId: string };

/** The subset of the sidecar's collaboration facade the mobile path needs.
 * Structural, so the facade stays private to the sidecar module. */
export interface CollaborationSurface {
  bootstrap(): Promise<unknown>;
  threads(): Promise<unknown>;
  messagePage(threadId: string, url: URL): Promise<unknown>;
  messageByClientId(threadId: string, clientMessageId: string): Promise<unknown>;
  postMessage(threadId: string, raw: unknown): Promise<{ status: number; body: unknown }>;
  runs(input: { threadId?: string; active?: boolean }): Promise<unknown>;
  getRun(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
  approvals(runId: string): Promise<{ runId: string; approvals: ApprovalRow[] }>;
  answer(runId: string, raw: unknown): Promise<{ runId: string; approvals: ApprovalRow[] }>;
}

export interface MobileBackend {
  readonly context: LocalMobileContext;
  bootstrap(): Promise<unknown>;
  threads(): Promise<unknown>;
  agents(): Promise<{ agents: unknown }>;
  messagePage(threadId: string, input: { before?: string; after?: string; limit?: number }): Promise<unknown>;
  messageByClientId(threadId: string, clientMessageId: string): Promise<unknown>;
  postMessage(threadId: string, body: unknown): Promise<{ status: number; body: unknown }>;
  runs(input: { threadId?: string; active?: boolean }): Promise<unknown>;
  getRun(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
  approvals(runId: string): Promise<{ runId: string; approvals: unknown[] }>;
  answer(runId: string, body: unknown): Promise<{ runId: string; approvals: unknown[] }>;
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MobileContractError(400, "invalid_payload", "A JSON object is required.");
  }
  const entries = value as Record<string, unknown>;
  const unknownKey = Object.keys(entries).find((key) => !allowed.includes(key));
  if (unknownKey) throw new MobileContractError(400, "invalid_payload", `Unknown field: ${unknownKey}.`);
  return entries;
}

/** The phone sends one approval id and a decision; the local runtime answers a
 * named ask. Both id spellings are accepted, and they must agree. */
function askAnswer(raw: unknown): { askId: string; answer: { kind: "allow_once" | "deny" } } {
  const input = record(raw, ["approvalId", "askId", "decision"]);
  if (input.approvalId !== undefined && input.askId !== undefined && input.approvalId !== input.askId) {
    throw new MobileContractError(400, "invalid_payload", "approvalId and askId do not match.");
  }
  const askId = input.approvalId ?? input.askId;
  if (typeof askId !== "string" || !askId.trim() || askId.length > 64) {
    throw new MobileContractError(400, "invalid_payload", "approvalId must be a non-empty string.");
  }
  if (input.decision !== "approve_once" && input.decision !== "deny") {
    throw new MobileContractError(400, "invalid_payload", "decision must be approve_once or deny.");
  }
  return { askId: askId.trim(), answer: { kind: input.decision === "deny" ? "deny" : "allow_once" } };
}

function approvalPage(page: { runId: string; approvals: ApprovalRow[] }) {
  return {
    runId: page.runId,
    approvals: page.approvals.map((approval) => ({
      id: approval.askId,
      approvalId: approval.askId,
      runId: page.runId,
      ...approval,
    })),
  };
}

/** Every local thread is a collaboration thread; there is no enterprise CEO route
 * on a paired computer. Named so the phone's `ChatRoute` decoder recognises it. */
const LOCAL_CHAT_ROUTE = "collaboration";

/**
 * Translate the desktop facade's bootstrap into the snapshot the paired phone
 * verifies (`LocalBootstrapDTO` in the native client):
 *
 * - `context` — the phone refuses a snapshot unless `kind === "local"` and both
 *   ids equal the grant it holds. The facade knows nothing about pairing, so the
 *   paired identity is stamped here and always wins over a same-named key.
 * - `capabilities.createThreads` — the shared client contract's name for what the
 *   local facade calls `createGroups`. Same permission, no widening: the phone still
 *   gates every creation on the manifest and on `manageParticipants`.
 * - `threads[].chatRoute` — required by the shared thread DTO; local threads are all
 *   collaboration threads.
 *
 * Everything else passes through unchanged so the phone sees the same roster,
 * humans and threads the desktop does.
 */
export function toMobileBootstrap(raw: unknown, context: LocalMobileContext, viewer: LocalViewer): Record<string, unknown> {
  const facade = plainObject(raw) ? raw : {};
  const capabilities = plainObject(facade.capabilities) ? facade.capabilities : {};
  const threads = Array.isArray(facade.threads)
    ? facade.threads.map((thread) =>
        plainObject(thread) ? { chatRoute: LOCAL_CHAT_ROUTE, ...thread, lastMessage: stampViewer(thread.lastMessage, viewer) } : thread)
    : facade.threads;
  return {
    ...facade,
    context,
    capabilities: { ...capabilities, createThreads: capabilities.createGroups === true },
    ...(threads === undefined ? {} : { threads }),
  };
}

/** The person holding the paired phone is the computer's local owner. The native
 * client recognises their messages by `senderActorId === "local-user:<workspaceId>"`
 * (see `Message.isAuthoredByViewer`); the desktop facade only carries
 * `senderUserId`, so the adapter stamps the actor id on exactly those messages. */
export interface LocalViewer {
  readonly userId: string;
  readonly actorId: string;
}

export function stampViewer(message: unknown, viewer: LocalViewer): unknown {
  if (!plainObject(message)) return message;
  if (message.senderType !== "human" || message.senderUserId !== viewer.userId) return message;
  if (typeof message.senderActorId === "string" && message.senderActorId.length > 0) return message;
  return { ...message, senderActorId: viewer.actorId };
}

function stampPage(raw: unknown, viewer: LocalViewer): unknown {
  if (!plainObject(raw) || !Array.isArray(raw.messages)) return raw;
  return { ...raw, messages: raw.messages.map((message) => stampViewer(message, viewer)) };
}

function stampSingle(raw: unknown, viewer: LocalViewer): unknown {
  if (!plainObject(raw) || !("message" in raw)) return raw;
  return { ...raw, message: stampViewer(raw.message, viewer) };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMobileBackend(
  facade: CollaborationSurface,
  identity: { computerId: string; workspaceId: string; userId: string },
): MobileBackend {
  const context: LocalMobileContext = {
    kind: "local",
    computerId: identity.computerId,
    workspaceId: identity.workspaceId,
  };
  const viewer: LocalViewer = { userId: identity.userId, actorId: `local-user:${identity.workspaceId}` };
  return {
    context,
    bootstrap: async () => toMobileBootstrap(await facade.bootstrap(), context, viewer),
    threads: () => facade.threads(),
    agents: async () => ({ agents: (await facade.bootstrap() as { agents: unknown }).agents }),
    messagePage: async (threadId, input) => {
      const url = new URL("https://local.invalid/api/collaboration/messages");
      if (input.before !== undefined) url.searchParams.set("before", input.before);
      if (input.after !== undefined) url.searchParams.set("after", input.after);
      if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
      return stampPage(await facade.messagePage(threadId, url), viewer);
    },
    messageByClientId: async (threadId, clientMessageId) =>
      stampSingle(await facade.messageByClientId(threadId, clientMessageId), viewer),
    postMessage: async (threadId, body) => {
      const result = await facade.postMessage(threadId, body);
      return { ...result, body: stampSingle(result.body, viewer) };
    },
    runs: (input) => facade.runs(input),
    getRun: (runId) => facade.getRun(runId),
    cancel: (runId) => facade.cancel(runId),
    approvals: async (runId) => approvalPage(await facade.approvals(runId)),
    answer: async (runId, body) => approvalPage(await facade.answer(runId, askAnswer(body))),
  };
}
