// The session broker — how a BizOS tool server gets the user's cookie
// without the cookie ever entering the model's environment.
//
// Before this existed, `LBZ_SESSION_COOKIE` was set on the MCP server's
// environment and therefore hoisted onto the `codex` process itself (codex
// forwards named variables from its own environment to a stdio server).
// A model with a shell could read every `app.bizos.lol` cookie with
// `printenv` and write it, in clear, into the thread transcript.
//
// Now the main process runs a loopback-only HTTP broker on 127.0.0.1 with
// an ephemeral port. At each spawn `mcp-mount` mints ONE opaque token per
// tool server (32 random bytes, hex), bound to the cookie of that spawn and
// valid for 60 seconds. The token — not the cookie — travels in the child
// environment. `bizos-mcp` exchanges it once, at startup, for the cookie,
// which then lives only in that server's memory. A second exchange of the
// same token fails, so a token a model manages to read afterwards is dead.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** How long a freshly issued token can be exchanged. */
export const TOKEN_TTL_MS = 60_000;
export const SESSION_PATH = "/session";
/** Refuse a body big enough to be an attack rather than a token. */
const MAX_BODY_BYTES = 4096;

interface Grant {
  /** sha256 of the token: the broker never keeps the token itself. */
  digest: Buffer;
  cookie: string;
  expiresAt: number;
}

export interface SessionBroker {
  /** `http://127.0.0.1:<port>` — handed to the tool server as LBZ_BROKER_URL. */
  readonly url: string;
  /** Mint a one-shot token bound to this cookie. */
  issue(cookie: string): string;
  /** How many tokens are still redeemable (tests and diagnostics). */
  outstanding(): number;
  close(): Promise<void>;
}

export interface BrokerOptions {
  /** Injectable for the TTL tests. */
  now?(): number;
  /** Loopback only. Overridable for a test that needs a specific host. */
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

/** The token a request presents, from `Authorization: Bearer …` or a JSON body. */
export function tokenFromRequest(headerValue: string | undefined, body: string): string {
  const bearer = /^Bearer\s+([A-Za-z0-9]{16,128})$/.exec((headerValue ?? "").trim());
  if (bearer?.[1]) return bearer[1];
  try {
    const parsed = JSON.parse(body || "{}") as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : "";
  } catch {
    return "";
  }
}

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

export async function startSessionBroker(options: BrokerOptions = {}): Promise<SessionBroker> {
  const now = options.now ?? (() => Date.now());
  const grants: Grant[] = [];

  const sweep = (): void => {
    const cutoff = now();
    for (let index = grants.length - 1; index >= 0; index -= 1) {
      const grant = grants[index];
      if (grant && grant.expiresAt <= cutoff) grants.splice(index, 1);
    }
  };

  /** Consume a token. A hit removes the grant: exactly one exchange ever
   * succeeds, so a token that leaks after the handshake is already dead. */
  const redeem = (token: string): string | null => {
    sweep();
    if (!token) return null;
    const wanted = digestOf(token);
    for (let index = 0; index < grants.length; index += 1) {
      const grant = grants[index];
      if (!grant || grant.digest.length !== wanted.length) continue;
      if (!timingSafeEqual(grant.digest, wanted)) continue;
      grants.splice(index, 1);
      return grant.cookie;
    }
    return null;
  };

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, payload: unknown): void => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(payload));
    };
    const path = (request.url ?? "").split("?")[0];
    if (request.method !== "POST" || path !== SESSION_PATH) {
      send(404, { error: "not_found" });
      return;
    }
    void readBody(request)
      .then((body) => {
        const cookie = redeem(tokenFromRequest(request.headers.authorization, body));
        if (cookie === null) {
          send(401, { error: "token_rejected" });
          return;
        }
        send(200, { cookie });
      })
      .catch(() => send(400, { error: "bad_request" }));
  });

  // The broker must never be the reason the app (or a test runner) stays
  // alive: it is a helper for children that are themselves short-lived.
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
    throw new Error("the session broker did not bind a TCP port");
  }

  return {
    url: `http://${host}:${address.port}`,
    issue(cookie: string): string {
      sweep();
      const token = randomBytes(32).toString("hex");
      grants.push({ digest: digestOf(token), cookie, expiresAt: now() + TOKEN_TTL_MS });
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
