import type { MobileBackend } from "./backend.js";
import { localClientManifest } from "./manifest.js";
import type { MobileScope } from "./pairing.js";

export type MobileRequest = { method: string; path: string; body?: unknown };

export class MobileRouteError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "MobileRouteError";
  }
}

function requireScope(scopes: readonly MobileScope[], scope: MobileScope): void {
  if (!scopes.includes(scope)) throw new MobileRouteError(403, "scope_denied", `Grant does not allow ${scope}.`);
}

function parsedPath(raw: string): URL {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("#")) {
    throw new MobileRouteError(403, "remote_route_forbidden", "Remote route is not allowed.");
  }
  const rawPath = raw.split("?", 1)[0] ?? raw;
  try {
    for (const segment of rawPath.split("/")) {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
        throw new Error("unsafe path segment");
      }
    }
    return new URL(raw, "https://local.invalid");
  } catch {
    throw new MobileRouteError(403, "remote_route_forbidden", "Remote route is not allowed.");
  }
}

function onlyQuery(url: URL, names: readonly string[]): void {
  for (const key of url.searchParams.keys()) {
    if (!names.includes(key)) throw new MobileRouteError(400, "invalid_query", `Query field ${key} is not allowed.`);
  }
}

function segment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes("/") || decoded.includes("\\")) throw new Error("invalid id");
    return decoded;
  } catch {
    throw new MobileRouteError(400, "invalid_id", "Route id is invalid.");
  }
}

export async function routeMobileRequest(
  backend: MobileBackend,
  scopes: readonly MobileScope[],
  request: MobileRequest,
): Promise<{ status: number; body: any }> {
  const method = request.method.toUpperCase();
  const url = parsedPath(request.path);
  const path = url.pathname;

  if (method === "GET" && path === "/api/client/manifest") {
    onlyQuery(url, []);
    return { status: 200, body: localClientManifest };
  }
  if (method === "GET" && path === "/api/collaboration/bootstrap") {
    requireScope(scopes, "chat:read");
    onlyQuery(url, []);
    return { status: 200, body: await backend.bootstrap() };
  }
  if (method === "GET" && path === "/api/agents") {
    requireScope(scopes, "agent:read");
    onlyQuery(url, []);
    return { status: 200, body: await backend.agents() };
  }
  if (method === "GET" && path === "/api/collaboration/threads") {
    requireScope(scopes, "chat:read");
    onlyQuery(url, []);
    return { status: 200, body: await backend.threads() };
  }

  const messageLookup = path.match(/^\/api\/collaboration\/threads\/([^/]+)\/messages\/by-client\/([^/]+)$/);
  if (method === "GET" && messageLookup?.[1] && messageLookup[2]) {
    requireScope(scopes, "chat:read");
    onlyQuery(url, []);
    return { status: 200, body: await backend.messageByClientId(segment(messageLookup[1]), segment(messageLookup[2])) };
  }
  const messages = path.match(/^\/api\/collaboration\/threads\/([^/]+)\/messages$/);
  if (messages?.[1] && method === "GET") {
    requireScope(scopes, "chat:read");
    onlyQuery(url, ["before", "after", "limit"]);
    const rawLimit = url.searchParams.get("limit");
    if (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit)) {
      throw new MobileRouteError(400, "invalid_query", "Message limit is invalid.");
    }
    return {
      status: 200,
      body: await backend.messagePage(segment(messages[1]), {
        ...(url.searchParams.get("before") ? { before: url.searchParams.get("before")! } : {}),
        ...(url.searchParams.get("after") ? { after: url.searchParams.get("after")! } : {}),
        ...(rawLimit !== null ? { limit: Number(rawLimit) } : {}),
      }),
    };
  }
  if (messages?.[1] && method === "POST") {
    requireScope(scopes, "chat:write");
    onlyQuery(url, []);
    const result = await backend.postMessage(segment(messages[1]), request.body);
    return { status: result.status, body: result.body };
  }

  if (method === "GET" && path === "/api/collaboration/runs") {
    requireScope(scopes, "run:read");
    onlyQuery(url, ["threadId", "state"]);
    const state = url.searchParams.get("state");
    if (state && state !== "active") throw new MobileRouteError(400, "invalid_query", "Run state is invalid.");
    return {
      status: 200,
      body: await backend.runs({
        ...(url.searchParams.get("threadId") ? { threadId: url.searchParams.get("threadId")! } : {}),
        active: state === "active",
      }),
    };
  }
  const run = path.match(/^\/api\/collaboration\/runs\/([^/]+)$/);
  if (method === "GET" && run?.[1]) {
    requireScope(scopes, "run:read");
    onlyQuery(url, []);
    return { status: 200, body: await backend.getRun(segment(run[1])) };
  }
  const cancel = path.match(/^\/api\/collaboration\/runs\/([^/]+)\/cancel$/);
  if (method === "POST" && cancel?.[1]) {
    requireScope(scopes, "run:cancel");
    onlyQuery(url, []);
    return { status: 200, body: await backend.cancel(segment(cancel[1])) };
  }
  const approval = path.match(/^\/api\/collaboration\/runs\/([^/]+)\/approval$/);
  if (method === "GET" && approval?.[1]) {
    requireScope(scopes, "run:read");
    onlyQuery(url, []);
    return { status: 200, body: await backend.approvals(segment(approval[1])) };
  }
  if (method === "POST" && approval?.[1]) {
    requireScope(scopes, "approval:resolve");
    onlyQuery(url, []);
    return { status: 200, body: await backend.answer(segment(approval[1]), request.body) };
  }

  throw new MobileRouteError(403, "remote_route_forbidden", "Remote route is not allowed.");
}
