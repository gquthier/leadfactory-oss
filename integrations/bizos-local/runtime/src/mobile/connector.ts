import { randomBytes } from "node:crypto";
import { Storage } from "../harness/storage.js";
import type { MobileBackend } from "./backend.js";
import { LocalPairingService, PairingError } from "./pairing.js";
import { routeMobileRequest } from "./router.js";

const RELAY_IDENTITY_FILE = "mobile-relay-identity.json";

type RelayIdentity = { version: 1; computerId: string; computerToken: string };

type RelayRequest = {
  requestId: string;
  grantId: string;
  sequence: number;
  envelope: string;
};

type RelayClaim = { offerId: string; claimId: string; envelope: string };

class RelayHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "RelayHttpError";
  }
}

function relayIdentity(storage: Storage, computerId: string): RelayIdentity {
  const value = storage.readJsonStrict<Partial<RelayIdentity> | null>(RELAY_IDENTITY_FILE, null);
  if (value) {
    if (value.version !== 1 || value.computerId !== computerId || typeof value.computerToken !== "string" || value.computerToken.length < 40) {
      throw new Error(`${RELAY_IDENTITY_FILE} is corrupt or belongs to another computer`);
    }
    return value as RelayIdentity;
  }
  const created: RelayIdentity = {
    version: 1,
    computerId,
    computerToken: randomBytes(32).toString("base64url"),
  };
  storage.writeJson(RELAY_IDENTITY_FILE, created);
  return created;
}

function configuredRelayUrl(raw: string | undefined, allowInsecureLoopback: boolean): string | null {
  if (!raw) return null;
  const url = new URL(raw);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(allowInsecureLoopback && url.protocol === "http:" && loopback)) {
    throw new Error("LOCALBIZOS_RELAY_URL must be HTTPS (loopback HTTP is test-only)");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("LOCALBIZOS_RELAY_URL must be an origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

/** Local contract errors (route, pairing, collaboration) carry a status and a
 * code; anything else is an internal failure the phone must not learn about. */
function safeError(error: unknown) {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof candidate?.status === "number" && candidate.status >= 400 && candidate.status <= 599
    && typeof candidate.code === "string") {
    return {
      status: candidate.status,
      body: {
        error: {
          code: candidate.code,
          message: typeof candidate.message === "string" ? candidate.message.slice(0, 500) : "The local request failed.",
          retryable: candidate.status >= 500,
        },
      },
    };
  }
  return { status: 500, body: { error: { code: "local_request_failed", message: "The local request failed.", retryable: true } } };
}

export interface RelayConnectorOptions {
  stateRoot: string;
  relayUrl?: string;
  computerName: string;
  backend: MobileBackend;
  fetchImpl?: typeof fetch;
  allowInsecureLoopbackRelay?: boolean;
  pollIntervalMs?: number;
}

export class RelayConnector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private connected = false;
  private lastError: string | null = null;

  private constructor(
    readonly pairing: LocalPairingService,
    private readonly backend: MobileBackend,
    private readonly relayUrl: string | null,
    private readonly identity: RelayIdentity,
    private readonly fetchImpl: typeof fetch,
    private readonly pollIntervalMs: number,
  ) {}

  static async open(options: RelayConnectorOptions): Promise<RelayConnector> {
    const relayUrl = configuredRelayUrl(options.relayUrl, options.allowInsecureLoopbackRelay === true);
    const storage = new Storage(options.stateRoot);
    const identity = relayIdentity(storage, options.backend.context.computerId);
    const pairing = await LocalPairingService.open({
      stateRoot: options.stateRoot,
      computerId: options.backend.context.computerId,
      workspaceId: options.backend.context.workspaceId,
      computerName: options.computerName,
      allowInsecureLoopbackRelay: options.allowInsecureLoopbackRelay,
    });
    return new RelayConnector(
      pairing,
      options.backend,
      relayUrl,
      identity,
      options.fetchImpl ?? fetch,
      options.pollIntervalMs ?? 750,
    );
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.relayUrl) throw new RelayHttpError(503, "relay_not_configured", "Remote relay is not configured.");
    const response = await this.fetchImpl(this.relayUrl + path, {
      method,
      headers: {
        authorization: `Computer ${this.identity.computerToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new RelayHttpError(
        response.status,
        typeof parsed?.error?.code === "string" ? parsed.error.code : "relay_failed",
        typeof parsed?.error?.message === "string" ? parsed.error.message : "Relay request failed.",
      );
    }
    return parsed as T;
  }

  async register(): Promise<void> {
    if (!this.relayUrl) return;
    await this.call("POST", "/v1/computers", { computerId: this.identity.computerId });
    this.connected = true;
    this.lastError = null;
  }

  start(): void {
    if (this.running || !this.relayUrl) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        if (!this.connected) await this.register();
        await this.pollOnce();
      } catch (error) {
        this.connected = false;
        this.lastError = error instanceof Error ? error.message.slice(0, 200) : "Relay unavailable";
      } finally {
        if (this.running) {
          this.timer = setTimeout(tick, this.pollIntervalMs);
          this.timer.unref();
        }
      }
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status() {
    return {
      ...this.pairing.status(),
      relay: {
        configured: this.relayUrl !== null,
        connected: this.connected,
        url: this.relayUrl,
        lastError: this.lastError,
      },
    };
  }

  async createOffer() {
    if (!this.relayUrl) throw new PairingError(503, "relay_not_configured", "Remote relay is not configured.");
    if (!this.connected) await this.register();
    const created = await this.pairing.createOffer(this.relayUrl);
    await this.call("PUT", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/offers/${encodeURIComponent(created.offer.offerId)}`, {
      pairingSecret: created.offer.pairingSecret,
      expiresAt: created.offer.expiresAt,
    });
    return created;
  }

  async confirmClaim(claimId: string, decision: "approve" | "deny") {
    const confirmed = await this.pairing.confirmClaim(claimId, decision);
    await this.publishClaim(confirmed);
    return confirmed.status === "approved"
      ? { claimId, status: "approved" as const, grant: confirmed.grant }
      : confirmed;
  }

  private async publishClaim(confirmed: Awaited<ReturnType<LocalPairingService["confirmClaim"]>>) {
    if (confirmed.status === "approved") {
      await this.call("PUT", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/grants/${encodeURIComponent(confirmed.grant.grantId)}`, {
        relayToken: confirmed.relayToken,
        expiresAt: confirmed.grant.expiresAt,
      });
      await this.call("PUT", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/claims/${encodeURIComponent(confirmed.claimId)}/response`, {
        status: "approved",
        envelope: confirmed.responseEnvelope,
      });
      this.pairing.markClaimPublished(confirmed.claimId);
      return;
    }
    await this.call("PUT", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/claims/${encodeURIComponent(confirmed.claimId)}/response`, {
      status: "denied",
    });
    this.pairing.markClaimPublished(confirmed.claimId);
  }

  async revokeGrant(grantId: string) {
    const revoked = this.pairing.revokeGrant(grantId);
    if (this.relayUrl) {
      await this.call("DELETE", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/grants/${encodeURIComponent(grantId)}`);
    }
    return revoked;
  }

  async pollOnce(): Promise<void> {
    if (!this.relayUrl) return;
    const revocationPage = await this.call<{ revocations: Array<{ grantId: string; revokedAt: string }> }>(
      "GET", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/revocations`,
    );
    for (const revocation of revocationPage.revocations) {
      try { this.pairing.revokeGrant(revocation.grantId); } catch (error) {
        if (!(error instanceof PairingError && error.code === "grant_not_found")) throw error;
      }
      await this.call("DELETE", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/revocations/${encodeURIComponent(revocation.grantId)}`);
    }
    for (const publication of await this.pairing.pendingPublications()) {
      await this.publishClaim(publication);
    }
    const claimPage = await this.call<{ claims: RelayClaim[] }>(
      "GET", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/claims`,
    );
    for (const claim of claimPage.claims) {
      try {
        await this.pairing.acceptClaim(claim.offerId, claim.claimId, claim.envelope);
      } catch (error) {
        if (error instanceof PairingError && error.code === "offer_consumed") continue;
        await this.call("PUT", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/claims/${encodeURIComponent(claim.claimId)}/response`, {
          status: "denied",
        });
      }
    }

    const requestPage = await this.call<{ requests: RelayRequest[] }>(
      "GET", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/requests`,
    );
    for (const item of requestPage.requests) {
      try {
        const accepted = await this.pairing.acceptRequest(item.grantId, item.requestId, item.sequence, item.envelope);
        let responseEnvelope = accepted.responseEnvelope;
        if (!responseEnvelope) {
          const result = accepted.duplicate
            ? { status: 503, body: { error: { code: "request_recovery_required", message: "The computer restarted while handling this request.", retryable: true } } }
            : await routeMobileRequest(this.backend, accepted.scopes, accepted.request as any).catch(safeError);
          responseEnvelope = await this.pairing.completeRequest(item.grantId, item.requestId, item.sequence, result);
        }
        await this.call("PUT", `/v1/computers/${encodeURIComponent(this.identity.computerId)}/requests/${encodeURIComponent(item.requestId)}/response`, {
          envelope: responseEnvelope,
        });
      } catch {
        // Invalid envelopes stay opaque and expire at the relay. There is no
        // authenticated recipient to whom an encrypted error can be sent.
      }
    }
    this.connected = true;
    this.lastError = null;
  }
}
