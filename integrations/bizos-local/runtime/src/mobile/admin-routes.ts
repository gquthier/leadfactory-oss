/** The desktop pairing surface, resolved as data so the loopback route table
 * and the published contract cannot drift apart. Every route here is
 * bearer-only on loopback: a phone reaches the computer through the relay as
 * an opaque envelope and never through these paths. */
export type PairingAdminRoute =
  | { kind: "status" }
  | { kind: "createOffer" }
  | { kind: "claims" }
  | { kind: "confirmClaim"; id: string }
  | { kind: "grants" }
  | { kind: "revokeGrant"; id: string };

function identifier(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") return null;
  return decoded;
}

export function pairingAdminRoute(method: string, pathname: string): PairingAdminRoute | null {
  const verb = method.toUpperCase();
  if (verb === "GET" && pathname === "/api/local/pairing") return { kind: "status" };
  if (verb === "POST" && pathname === "/api/local/pairing/offers") return { kind: "createOffer" };
  if (verb === "GET" && pathname === "/api/local/pairing/claims") return { kind: "claims" };
  if (verb === "GET" && pathname === "/api/local/pairing/grants") return { kind: "grants" };
  const confirm = pathname.match(/^\/api\/local\/pairing\/claims\/([^/]+)\/confirm$/);
  if (verb === "POST" && confirm?.[1]) {
    const id = identifier(confirm[1]);
    return id ? { kind: "confirmClaim", id } : null;
  }
  const grant = pathname.match(/^\/api\/local\/pairing\/grants\/([^/]+)$/);
  if (verb === "DELETE" && grant?.[1]) {
    const id = identifier(grant[1]);
    return id ? { kind: "revokeGrant", id } : null;
  }
  return null;
}
