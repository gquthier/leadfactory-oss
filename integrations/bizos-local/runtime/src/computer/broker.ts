// How `computer_observe` reaches the computer.
//
// The tool server (`mcp/bizos-mcp.mts`) is a child of `codex`, in another
// process, with no Electron in it. The machine is a surface owned by the MAIN
// process. So the tools travel the same road the BizOS tools already travel: a
// loopback HTTP server on 127.0.0.1 with an ephemeral port, and a token minted
// per spawn that is set on the child's environment through codex's `env_vars`
// forwarding — the name in argv, the value never.
//
// It is a SECOND broker beside `harness/session-broker.ts` rather than a route
// added to it, because the two hand out different things on different terms and
// mixing them would blur both:
//
//   * the session broker gives out THE USER'S COOKIE. That is a secret, so its
//     token is one-shot and dies sixty seconds after it is minted.
//   * this one gives out no secret at all. It gives out the right to drive ONE
//     agent's browser, and it has to be usable many times across a turn, so a
//     one-shot token is the wrong shape.
//
// What keeps a long-lived token from being a standing power is not its
// lifetime, it is `ComputerManager`: a call is refused unless that agent has a
// turn in flight, and acting on a host the agent is signed in to raises a card
// whatever the token says. A model that reads this token out of its own
// environment has bought exactly the power it already had.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { parseComputerActions, settleMs, ComputerActionError } from "./actions.js";
import type { ComputerManager, ComputerRequester, ComputerRequesterInput } from "./manager.js";
import { HUMAN_CONTROL_MESSAGE, isHumanControlError } from "./human-session.js";
import { formatObservation } from "./observe.js";
import { MAX_ACTIONS } from "./types.js";

export const COMPUTER_PATH = "/computer";
/** A body is a small batch of actions, never a payload. */
const MAX_BODY_BYTES = 64 * 1024;
/** A grant dies with the app; this only bounds a token left behind by a spawn
 * whose bot was deleted. */
export const GRANT_TTL_MS = 12 * 60 * 60_000;

interface Grant {
  digest: Buffer;
  requester: ComputerRequester;
  expiresAt: number;
}

export interface ComputerBroker {
  /** `http://127.0.0.1:<port>` — handed to the tool server as LBZ_COMPUTER_URL. */
  readonly url: string;
  /** Mint the token for one spawn of one agent's tool server. */
  issue(requester: ComputerRequesterInput): string;
  outstanding(): number;
  close(): Promise<void>;
}

export interface ComputerBrokerOptions {
  manager: ComputerManager;
  now?(): number;
  host?: string;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

export function tokenFromRequest(headerValue: string | undefined): string {
  const bearer = /^Bearer\s+([A-Za-z0-9]{16,128})$/.exec((headerValue ?? "").trim());
  return bearer?.[1] ?? "";
}

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

/**
 * One request, decided.
 *
 * Exported and pure-ish so the refusals — an unknown op, a batch of thirty
 * actions, a `file:` URL — are tested against the real function rather than
 * against a description of it.
 */
export async function handleComputerCall(
  manager: ComputerManager,
  requester: ComputerRequesterInput,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  const request = (body ?? {}) as Record<string, unknown>;
  const op = String(request.op ?? "");
  try {
    if (op === "observe") {
      const { observation, text } = await manager.observe(requester);
      return {
        status: 200,
        payload: {
          ok: true,
          text,
          image: observation.imageBase64 ? { mimeType: observation.mimeType, data: observation.imageBase64 } : null,
          frameId: observation.frameId,
          url: observation.url,
          title: observation.title,
        },
      };
    }
    if (op === "act") {
      const actions = parseComputerActions(request.actions);
      const settle = settleMs(request.settle_ms);
      const wantsObservation = request.observe !== false;
      // The settle wait and the look happen in the backend, in the same round
      // trip as the batch — one call on the cloud computer, not three.
      const result = await manager.act(requester, actions, wantsObservation, settle);
      if (!wantsObservation) {
        return { status: 200, payload: { ok: true, completed: result.completed, text: `${result.completed} action(s) done.` } };
      }
      const { observation, text } = result.observation
        ? { observation: result.observation, text: formatObservation(result.observation) }
        : await manager.observe(requester);
      return {
        status: 200,
        payload: {
          ok: true,
          completed: result.completed,
          text: `${result.completed} action(s) done.\n${text}`,
          image: observation.imageBase64 ? { mimeType: observation.mimeType, data: observation.imageBase64 } : null,
          url: observation.url,
          title: observation.title,
        },
      };
    }
    if (op === "download") {
      const outcome = await manager.download(requester, String(request.url ?? ""));
      const where = manager.backendKind() === "container"
        ? "It is in your virtual computer's Downloads folder."
        : "It is inside your own workspace, so upload_document can read it.";
      return {
        status: 200,
        payload: {
          ok: true,
          text: `Saved ${outcome.name} (${outcome.bytes} bytes) to ${outcome.path}. ${where}`,
          path: outcome.path,
        },
      };
    }
    if (op === "request_handoff") {
      const reason = typeof request.reason === "string" ? request.reason.trim() : "";
      const result = await manager.requestHandoff(requester, reason);
      const text = result === "given_back"
        ? "Your user gave the computer back. Observe it before continuing."
        : result === "denied"
          ? "Your user declined the handoff. Ask what they want you to do next."
          : "The handoff was cancelled because this run is no longer active.";
      return { status: 200, payload: { ok: true, result, text } };
    }
    return { status: 400, payload: { ok: false, error: `unknown computer operation ${op || "(missing)"}` } };
  } catch (error) {
    // The person holding the seat is not a failure to retry around: one
    // sentence, whichever layer (manager, desktop bridge, cloud seat) said it.
    const message =
      isHumanControlError(error)
        ? HUMAN_CONTROL_MESSAGE
        : error instanceof ComputerActionError
        ? `${error.message} (at most ${MAX_ACTIONS} actions per call)`
        : error instanceof Error
          ? error.message
          : String(error);
    // A refusal is a RESULT the model must read and adapt to, not a transport
    // failure: 200 with `ok:false` keeps it out of the tool server's retry path.
    return { status: 200, payload: { ok: false, error: message } };
  }
}

export async function startComputerBroker(options: ComputerBrokerOptions): Promise<ComputerBroker> {
  const now = options.now ?? (() => Date.now());
  const grants: Grant[] = [];

  const sweep = (): void => {
    const cutoff = now();
    for (let index = grants.length - 1; index >= 0; index -= 1) {
      const grant = grants[index];
      if (grant && grant.expiresAt <= cutoff) grants.splice(index, 1);
    }
  };

  /** Which agent this token speaks for — and no other. A token cannot name a
   * bot: the binding was made when it was minted, in this process. */
  const requesterFor = (token: string): ComputerRequester | null => {
    sweep();
    if (!token) return null;
    const wanted = digestOf(token);
    for (const grant of grants) {
      if (grant.digest.length !== wanted.length) continue;
      if (timingSafeEqual(grant.digest, wanted)) return grant.requester;
    }
    return null;
  };

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, payload: unknown): void => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(payload));
    };
    const path = (request.url ?? "").split("?")[0];
    if (request.method !== "POST" || path !== COMPUTER_PATH) {
      send(404, { ok: false, error: "not_found" });
      return;
    }
    const requester = requesterFor(tokenFromRequest(request.headers.authorization));
    if (!requester) {
      send(401, { ok: false, error: "token_rejected" });
      return;
    }
    void readBody(request)
      .then(async (raw) => {
        let body: unknown = {};
        try {
          body = raw ? (JSON.parse(raw) as unknown) : {};
        } catch {
          send(400, { ok: false, error: "bad_request" });
          return;
        }
        const { status, payload } = await handleComputerCall(options.manager, requester, body);
        send(status, payload);
      })
      .catch(() => send(400, { ok: false, error: "bad_request" }));
  });

  server.unref();

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("the computer broker did not bind a TCP port");
  }

  return {
    url: `http://${host}:${address.port}`,
    issue(input: ComputerRequesterInput): string {
      sweep();
      const token = randomBytes(32).toString("hex");
      const requester = typeof input === "string" ? { botId: input } : input;
      grants.push({ digest: digestOf(token), requester: { ...requester }, expiresAt: now() + GRANT_TTL_MS });
      return token;
    },
    outstanding(): number {
      sweep();
      return grants.length;
    },
    async close(): Promise<void> {
      grants.length = 0;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
