import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CompactEncrypt,
  SignJWT,
  calculateJwkThumbprint,
  compactDecrypt,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from "jose";
import { Storage } from "../harness/storage.js";

const PAIRING_FILE = "mobile-pairing.json";
const IDENTITY_FILE = "mobile-identity.json";
const OFFER_TTL_MS = 5 * 60_000;
const GRANT_TTL_MS = 30 * 24 * 60 * 60_000;
const REQUEST_TTL_SECONDS = 60;
export const REQUEST_JOURNAL_LIMIT = 128;
const INCOMPLETE_REQUEST_LIMIT = 32;
const COMPLETED_REQUEST_RETENTION_MS = 24 * 60 * 60_000;

export const MOBILE_SCOPES = [
  "chat:read",
  "chat:write",
  "run:read",
  "run:cancel",
  "approval:resolve",
  "agent:read",
] as const;

export type MobileScope = (typeof MOBILE_SCOPES)[number];

export class PairingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PairingError";
  }
}

type KeyMaterial = { publicJwk: JWK; privateJwk: JWK };
type GeneratedKey = Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];
export type SecureIdentity = { signing: KeyMaterial; encryption: KeyMaterial };
export type PublicSecureIdentity = {
  signing: { publicJwk: JWK };
  encryption: { publicJwk: JWK };
};

type OfferRecord = {
  offerId: string;
  secretHash: string;
  relayUrl: string;
  createdAt: string;
  expiresAt: string;
  claimId: string | null;
};

type ClaimRecord = {
  claimId: string;
  offerId: string;
  deviceId: string;
  deviceName: string;
  requestedScopes: MobileScope[];
  deviceSigningKey: JWK;
  deviceEncryptionKey: JWK;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied";
  grantId: string | null;
  publication: {
    status: "approved" | "denied";
    responseEnvelope: string | null;
    relayCredentialEnvelope: string | null;
    publishedAt: string | null;
  } | null;
};

type GrantRecord = {
  grantId: string;
  deviceId: string;
  deviceName: string;
  scopes: MobileScope[];
  deviceSigningKey: JWK;
  deviceEncryptionKey: JWK;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  lastSequence: number;
};

type RequestRecord = {
  grantId: string;
  requestId: string;
  sequence: number;
  envelopeHash: string;
  acceptedAt: string;
  responseEnvelope: string | null;
};

type PairingState = {
  version: 1;
  computerId: string;
  offers: Record<string, OfferRecord>;
  claims: Record<string, ClaimRecord>;
  grants: Record<string, GrantRecord>;
  requests: Record<string, RequestRecord>;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function secretMatches(secret: string, expectedHash: string): boolean {
  const left = Buffer.from(hash(secret));
  const right = Buffer.from(expectedHash);
  return left.length === right.length && timingSafeEqual(left, right);
}

function unix(date: Date): number { return Math.floor(date.getTime() / 1000); }
function iso(date: Date): string { return date.toISOString(); }
function future(date: Date, milliseconds: number): Date { return new Date(date.getTime() + milliseconds); }

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validPublicKey(value: unknown, use: "sig" | "enc", alg: "ES256" | "ECDH-ES"): value is JWK {
  if (!plainObject(value)) return false;
  return value.kty === "EC" && value.crv === "P-256" && typeof value.x === "string" &&
    typeof value.y === "string" && value.use === use && value.alg === alg &&
    typeof value.kid === "string" && !("d" in value);
}

async function publicJwk(key: GeneratedKey, use: "sig" | "enc", alg: "ES256" | "ECDH-ES"): Promise<JWK> {
  const exported = await exportJWK(key);
  const kid = await calculateJwkThumbprint(exported, "sha256");
  return { ...exported, kid, use, alg };
}

async function privateJwk(key: GeneratedKey, publicKey: JWK): Promise<JWK> {
  return { ...(await exportJWK(key)), kid: publicKey.kid, use: publicKey.use, alg: publicKey.alg };
}

export async function createSecureIdentity(): Promise<SecureIdentity> {
  const signingKeys = await generateKeyPair("ES256", { extractable: true });
  const encryptionKeys = await generateKeyPair("ECDH-ES", { extractable: true });
  const signingPublic = await publicJwk(signingKeys.publicKey, "sig", "ES256");
  const encryptionPublic = await publicJwk(encryptionKeys.publicKey, "enc", "ECDH-ES");
  return {
    signing: {
      publicJwk: signingPublic,
      privateJwk: await privateJwk(signingKeys.privateKey, signingPublic),
    },
    encryption: {
      publicJwk: encryptionPublic,
      privateJwk: await privateJwk(encryptionKeys.privateKey, encryptionPublic),
    },
  };
}

export async function encryptSignedClaims(
  claims: JWTPayload,
  senderSigningPrivateKey: JWK,
  recipientEncryptionPublicKey: JWK,
  options: { jweAlgorithm?: "ECDH-ES" } = {},
): Promise<string> {
  if (options.jweAlgorithm && options.jweAlgorithm !== "ECDH-ES") {
    throw new PairingError(400, "unsupported_algorithm", "Only ECDH-ES is allowed.");
  }
  if (!validPublicKey(recipientEncryptionPublicKey, "enc", "ECDH-ES")) {
    throw new PairingError(400, "invalid_key", "The recipient encryption key is invalid.");
  }
  const signingKey = await importJWK(senderSigningPrivateKey, "ES256");
  const jws = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: senderSigningPrivateKey.kid })
    .sign(signingKey);
  const encryptionKey = await importJWK(recipientEncryptionPublicKey, "ECDH-ES");
  return new CompactEncrypt(new TextEncoder().encode(jws))
    .setProtectedHeader({
      alg: "ECDH-ES",
      enc: "A256GCM",
      cty: "JWT",
      kid: recipientEncryptionPublicKey.kid,
    })
    .encrypt(encryptionKey);
}

async function decryptJws(envelope: string, recipient: SecureIdentity): Promise<string> {
  try {
    const key = await importJWK(recipient.encryption.privateJwk, "ECDH-ES");
    const decrypted = await compactDecrypt(envelope, key, {
      keyManagementAlgorithms: ["ECDH-ES"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const header = decrypted.protectedHeader;
    if (header.alg !== "ECDH-ES" || header.enc !== "A256GCM" || header.cty !== "JWT" ||
        header.kid !== recipient.encryption.publicJwk.kid) {
      throw new Error("protected JWE header does not match the local identity");
    }
    return new TextDecoder().decode(decrypted.plaintext);
  } catch (error) {
    if (error instanceof PairingError) throw error;
    throw new PairingError(401, "invalid_envelope", "The secure envelope could not be decrypted.");
  }
}

async function verifyJws(
  jws: string,
  senderSigningKey: JWK,
  expectations: { issuer: string; audience: string; subject: string; now: Date },
): Promise<JWTPayload> {
  try {
    if (!validPublicKey(senderSigningKey, "sig", "ES256")) throw new Error("invalid signing key");
    const header = decodeProtectedHeader(jws);
    if (header.alg !== "ES256" || header.typ !== "JWT" || header.kid !== senderSigningKey.kid) {
      throw new Error("protected JWS header does not match the sender identity");
    }
    const key = await importJWK(senderSigningKey, "ES256");
    const result = await jwtVerify(jws, key, {
      algorithms: ["ES256"],
      issuer: expectations.issuer,
      audience: expectations.audience,
      subject: expectations.subject,
      currentDate: expectations.now,
      clockTolerance: 5,
      requiredClaims: ["iss", "sub", "aud", "jti", "iat", "exp"],
    });
    return result.payload;
  } catch {
    throw new PairingError(401, "invalid_envelope", "The secure envelope signature or claims are invalid.");
  }
}

export async function decryptVerifiedClaims(
  envelope: string,
  recipient: SecureIdentity,
  senderSigningKey: JWK,
  expectations: { issuer: string; audience: string; subject: string; now: Date },
): Promise<JWTPayload> {
  return verifyJws(await decryptJws(envelope, recipient), senderSigningKey, expectations);
}

function cleanPublicIdentity(identity: SecureIdentity): PublicSecureIdentity {
  return {
    signing: { publicJwk: identity.signing.publicJwk },
    encryption: { publicJwk: identity.encryption.publicJwk },
  };
}

function validateIdentity(value: unknown): value is SecureIdentity {
  if (!plainObject(value) || !plainObject(value.signing) || !plainObject(value.encryption)) return false;
  const signing = value.signing as Record<string, unknown>;
  const encryption = value.encryption as Record<string, unknown>;
  return validPublicKey(signing.publicJwk, "sig", "ES256") && plainObject(signing.privateJwk) &&
    typeof signing.privateJwk.d === "string" && validPublicKey(encryption.publicJwk, "enc", "ECDH-ES") &&
    plainObject(encryption.privateJwk) && typeof encryption.privateJwk.d === "string";
}

function validateState(value: unknown, computerId: string): value is PairingState {
  if (!plainObject(value) || value.version !== 1 || value.computerId !== computerId) return false;
  if (!plainObject(value.offers) || !plainObject(value.claims) || !plainObject(value.grants) || !plainObject(value.requests)) return false;
  const offersValid = Object.entries(value.offers).every(([id, row]) => plainObject(row) && row.offerId === id &&
    typeof row.secretHash === "string" && typeof row.relayUrl === "string" &&
    typeof row.createdAt === "string" && typeof row.expiresAt === "string" &&
    (row.claimId === null || typeof row.claimId === "string"));
  const claimsValid = Object.entries(value.claims).every(([id, row]) => {
    if (!plainObject(row) || row.claimId !== id || typeof row.offerId !== "string" ||
        typeof row.deviceId !== "string" || typeof row.deviceName !== "string" ||
        !Array.isArray(row.requestedScopes) || row.requestedScopes.some((scope) => !MOBILE_SCOPES.includes(scope as MobileScope)) ||
        !validPublicKey(row.deviceSigningKey, "sig", "ES256") || !validPublicKey(row.deviceEncryptionKey, "enc", "ECDH-ES") ||
        typeof row.createdAt !== "string" || typeof row.expiresAt !== "string" ||
        !["pending", "approved", "denied"].includes(String(row.status)) ||
        !(row.grantId === null || typeof row.grantId === "string")) return false;
    if (row.publication === null) return row.status === "pending";
    return plainObject(row.publication) && (row.publication.status === "approved" || row.publication.status === "denied") &&
      (row.publication.responseEnvelope === null || typeof row.publication.responseEnvelope === "string") &&
      (row.publication.relayCredentialEnvelope === null || typeof row.publication.relayCredentialEnvelope === "string") &&
      (row.publication.publishedAt === null || typeof row.publication.publishedAt === "string");
  });
  const grantsValid = Object.entries(value.grants).every(([id, row]) => plainObject(row) && row.grantId === id &&
    typeof row.deviceId === "string" && typeof row.deviceName === "string" && Array.isArray(row.scopes) &&
    row.scopes.every((scope) => MOBILE_SCOPES.includes(scope as MobileScope)) &&
    validPublicKey(row.deviceSigningKey, "sig", "ES256") && validPublicKey(row.deviceEncryptionKey, "enc", "ECDH-ES") &&
    typeof row.createdAt === "string" && typeof row.expiresAt === "string" &&
    (row.lastSeenAt === null || typeof row.lastSeenAt === "string") &&
    (row.revokedAt === null || typeof row.revokedAt === "string") && Number.isSafeInteger(row.lastSequence));
  const requestsValid = Object.entries(value.requests).every(([key, row]) => plainObject(row) &&
    key === `${row.grantId}:${row.requestId}` && typeof row.grantId === "string" && typeof row.requestId === "string" &&
    Number.isSafeInteger(row.sequence) && typeof row.envelopeHash === "string" && typeof row.acceptedAt === "string" &&
    (row.responseEnvelope === null || typeof row.responseEnvelope === "string"));
  return offersValid && claimsValid && grantsValid && requestsValid;
}

function safeClaim(claim: ClaimRecord) {
  return {
    claimId: claim.claimId,
    deviceId: claim.deviceId,
    deviceName: claim.deviceName,
    requestedScopes: claim.requestedScopes,
    createdAt: claim.createdAt,
    expiresAt: claim.expiresAt,
    status: claim.status,
  };
}

function safeGrant(grant: GrantRecord) {
  return {
    grantId: grant.grantId,
    deviceId: grant.deviceId,
    deviceName: grant.deviceName,
    scopes: grant.scopes,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    lastSeenAt: grant.lastSeenAt,
    revokedAt: grant.revokedAt,
  };
}

export interface LocalPairingOptions {
  stateRoot: string;
  computerId: string;
  workspaceId: string;
  computerName: string;
  now?: () => Date;
  allowInsecureLoopbackRelay?: boolean;
}

export class LocalPairingService {
  private mutationTail: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly storage: Storage,
    private readonly identity: SecureIdentity,
    private readonly state: PairingState,
    private readonly options: LocalPairingOptions,
  ) {}

  static async open(options: LocalPairingOptions): Promise<LocalPairingService> {
    const storage = new Storage(options.stateRoot);
    const storedIdentity = storage.readJsonStrict<unknown>(IDENTITY_FILE, null);
    let identity: SecureIdentity;
    if (storedIdentity === null) {
      identity = await createSecureIdentity();
      storage.writeJson(IDENTITY_FILE, identity);
    } else if (validateIdentity(storedIdentity)) {
      identity = storedIdentity;
    } else {
      throw new Error(`${IDENTITY_FILE} is corrupt`);
    }
    const storedState = storage.readJsonStrict<unknown>(PAIRING_FILE, null);
    let state: PairingState;
    if (storedState === null) {
      state = { version: 1, computerId: options.computerId, offers: {}, claims: {}, grants: {}, requests: {} };
      storage.writeJson(PAIRING_FILE, state);
    } else if (validateState(storedState, options.computerId)) {
      state = storedState;
    } else {
      throw new Error(`${PAIRING_FILE} is corrupt or belongs to another computer`);
    }
    return new LocalPairingService(storage, identity, state, options);
  }

  get publicIdentity(): PublicSecureIdentity { return cleanPublicIdentity(this.identity); }
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private save(): void { this.storage.writeJson(PAIRING_FILE, this.state); }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(work, work);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
  private pruneRequests(grantId: string): void {
    const now = this.now().getTime();
    const rows = Object.entries(this.state.requests)
      .filter(([, row]) => row.grantId === grantId)
      .sort((left, right) => right[1].sequence - left[1].sequence);
    let retainedCompleted = 0;
    for (const [key, row] of rows) {
      if (!row.responseEnvelope) continue;
      retainedCompleted += 1;
      if (now - Date.parse(row.acceptedAt) > COMPLETED_REQUEST_RETENTION_MS || retainedCompleted > REQUEST_JOURNAL_LIMIT) {
        delete this.state.requests[key];
      }
    }
  }

  status() {
    const now = this.now().getTime();
    return {
      computerId: this.options.computerId,
      workspaceId: this.options.workspaceId,
      computerName: this.options.computerName,
      offers: Object.values(this.state.offers)
        .filter((offer) => !offer.claimId && Date.parse(offer.expiresAt) > now)
        .map(({ secretHash: _secret, ...offer }) => offer),
      pendingClaims: Object.values(this.state.claims).filter((claim) => claim.status === "pending").map(safeClaim),
      grants: Object.values(this.state.grants).map(safeGrant),
    };
  }

  createOffer(relayUrl: string) { return this.exclusive(() => this.createOfferLocked(relayUrl)); }
  private async createOfferLocked(relayUrl: string) {
    let parsed: URL;
    try { parsed = new URL(relayUrl); } catch { throw new PairingError(400, "invalid_relay", "Relay URL is invalid."); }
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !(this.options.allowInsecureLoopbackRelay && parsed.protocol === "http:" && loopback)) {
      throw new PairingError(400, "invalid_relay", "A public relay must use HTTPS.");
    }
    const offerId = `offer_${randomUUID()}`;
    const pairingSecret = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const expiresAt = future(createdAt, OFFER_TTL_MS);
    this.state.offers[offerId] = {
      offerId,
      secretHash: hash(pairingSecret),
      relayUrl: parsed.origin,
      createdAt: iso(createdAt),
      expiresAt: iso(expiresAt),
      claimId: null,
    };
    this.save();
    const offer = {
      version: 1 as const,
      relayUrl: parsed.origin,
      computerId: this.options.computerId,
      computerName: this.options.computerName,
      offerId,
      pairingSecret,
      expiresAt: iso(expiresAt),
      computerSigningKey: this.identity.signing.publicJwk,
      computerEncryptionKey: this.identity.encryption.publicJwk,
    };
    const payload = Buffer.from(JSON.stringify(offer), "utf8").toString("base64url");
    return { offer, qrPayload: `bizos://pair?payload=${payload}` };
  }

  acceptClaim(offerId: string, claimId: string, envelope: string) {
    return this.exclusive(() => this.acceptClaimLocked(offerId, claimId, envelope));
  }
  private async acceptClaimLocked(offerId: string, claimId: string, envelope: string) {
    const offer = this.state.offers[offerId];
    if (!offer) throw new PairingError(404, "offer_not_found", "Pairing offer was not found.");
    if (offer.claimId) throw new PairingError(409, "offer_consumed", "Pairing offer was already used.");
    if (Date.parse(offer.expiresAt) <= this.now().getTime()) throw new PairingError(410, "offer_expired", "Pairing offer expired.");
    const jws = await decryptJws(envelope, this.identity);
    let unsafe: JWTPayload;
    try { unsafe = decodeJwt(jws); } catch { throw new PairingError(401, "invalid_envelope", "Pairing claim is invalid."); }
    const signingKey = unsafe.deviceSigningKey;
    const encryptionKey = unsafe.deviceEncryptionKey;
    if (!validPublicKey(signingKey, "sig", "ES256") || !validPublicKey(encryptionKey, "enc", "ECDH-ES") ||
        typeof unsafe.deviceId !== "string" || typeof unsafe.deviceName !== "string") {
      throw new PairingError(401, "invalid_envelope", "Pairing claim keys or device identity are invalid.");
    }
    const payload = await verifyJws(jws, signingKey, {
      issuer: `bizos-mobile:${unsafe.deviceId}`,
      audience: `bizos-computer:${this.options.computerId}`,
      subject: offerId,
      now: this.now(),
    });
    if (payload.jti !== claimId || typeof payload.pairingSecret !== "string" ||
        !secretMatches(payload.pairingSecret, offer.secretHash) || typeof payload.nonce !== "string" || payload.nonce.length < 16) {
      throw new PairingError(401, "invalid_envelope", "Pairing claim is not bound to this offer.");
    }
    const requestedScopes = Array.isArray(payload.requestedScopes) ? payload.requestedScopes : [];
    if (!requestedScopes.every((scope): scope is MobileScope => typeof scope === "string" && MOBILE_SCOPES.includes(scope as MobileScope))) {
      throw new PairingError(403, "invalid_scope", "Pairing requested an unsupported scope.");
    }
    const createdAt = this.now();
    const claim: ClaimRecord = {
      claimId,
      offerId,
      deviceId: payload.deviceId as string,
      deviceName: (payload.deviceName as string).slice(0, 100),
      requestedScopes,
      deviceSigningKey: signingKey,
      deviceEncryptionKey: encryptionKey,
      createdAt: iso(createdAt),
      expiresAt: offer.expiresAt,
      status: "pending",
      grantId: null,
      publication: null,
    };
    offer.claimId = claimId;
    this.state.claims[claimId] = claim;
    this.save();
    return safeClaim(claim);
  }

  confirmClaim(claimId: string, decision: "approve" | "deny") {
    return this.exclusive(() => this.confirmClaimLocked(claimId, decision));
  }
  private async confirmClaimLocked(claimId: string, decision: "approve" | "deny") {
    const claim = this.state.claims[claimId];
    if (!claim) throw new PairingError(404, "claim_not_found", "Pairing claim was not found.");
    if (claim.status !== "pending") return this.resolvedClaim(claim);
    if (Date.parse(claim.expiresAt) <= this.now().getTime()) throw new PairingError(410, "claim_expired", "Pairing claim expired.");
    if (decision === "deny") {
      claim.status = "denied";
      claim.publication = {
        status: "denied",
        responseEnvelope: null,
        relayCredentialEnvelope: null,
        publishedAt: null,
      };
      this.save();
      return { claimId, status: "denied" as const };
    }
    const createdAt = this.now();
    const expiresAt = future(createdAt, GRANT_TTL_MS);
    const grantId = `grant_${randomUUID()}`;
    const relayToken = randomBytes(32).toString("base64url");
    const grant: GrantRecord = {
      grantId,
      deviceId: claim.deviceId,
      deviceName: claim.deviceName,
      scopes: [...claim.requestedScopes],
      deviceSigningKey: claim.deviceSigningKey,
      deviceEncryptionKey: claim.deviceEncryptionKey,
      createdAt: iso(createdAt),
      expiresAt: iso(expiresAt),
      lastSeenAt: null,
      revokedAt: null,
      lastSequence: 0,
    };
    const responseEnvelope = await encryptSignedClaims({
      iss: `bizos-computer:${this.options.computerId}`,
      sub: grantId,
      aud: `bizos-mobile:${claim.deviceId}`,
      jti: claimId,
      iat: unix(createdAt),
      exp: unix(expiresAt),
      grantId,
      computerId: this.options.computerId,
      workspaceId: this.options.workspaceId,
      deviceId: claim.deviceId,
      relayUrl: this.state.offers[claim.offerId]?.relayUrl,
      relayToken,
      scopes: grant.scopes,
      nextSequence: 1,
      expiresAt: grant.expiresAt,
    }, this.identity.signing.privateJwk, claim.deviceEncryptionKey);
    const relayCredentialEnvelope = await encryptSignedClaims({
      iss: `bizos-computer:${this.options.computerId}`,
      sub: grantId,
      aud: `bizos-computer:${this.options.computerId}`,
      jti: `publication:${claimId}`,
      iat: unix(createdAt),
      exp: unix(expiresAt),
      relayToken,
    }, this.identity.signing.privateJwk, this.identity.encryption.publicJwk);
    this.state.grants[grantId] = grant;
    claim.status = "approved";
    claim.grantId = grantId;
    claim.publication = {
      status: "approved",
      responseEnvelope,
      relayCredentialEnvelope,
      publishedAt: null,
    };
    // Grant, encrypted relay credential, and phone response commit together.
    // A crash after this write is replayed by `pendingPublications()`.
    this.save();
    return { claimId, status: "approved" as const, grant: safeGrant(grant), relayToken, responseEnvelope };
  }

  private async resolvedClaim(claim: ClaimRecord): Promise<
    | { claimId: string; status: "denied" }
    | { claimId: string; status: "approved"; grant: ReturnType<typeof safeGrant>; relayToken: string; responseEnvelope: string }
  > {
    if (claim.status === "denied") return { claimId: claim.claimId, status: "denied" };
    const grant = claim.grantId ? this.state.grants[claim.grantId] : undefined;
    const publication = claim.publication;
    if (!grant || !publication?.relayCredentialEnvelope || !publication.responseEnvelope) {
      throw new PairingError(500, "publication_corrupt", "Pairing publication is incomplete.");
    }
    const payload = await decryptVerifiedClaims(
      publication.relayCredentialEnvelope,
      this.identity,
      this.identity.signing.publicJwk,
      {
        issuer: `bizos-computer:${this.options.computerId}`,
        audience: `bizos-computer:${this.options.computerId}`,
        subject: grant.grantId,
        now: this.now(),
      },
    );
    if (typeof payload.relayToken !== "string") {
      throw new PairingError(500, "publication_corrupt", "Pairing relay credential is invalid.");
    }
    return {
      claimId: claim.claimId,
      status: "approved",
      grant: safeGrant(grant),
      relayToken: payload.relayToken,
      responseEnvelope: publication.responseEnvelope,
    };
  }

  async pendingPublications() {
    const pending = Object.values(this.state.claims).filter(
      (claim) => claim.status !== "pending" && claim.publication && !claim.publication.publishedAt,
    );
    return Promise.all(pending.map((claim) => this.resolvedClaim(claim)));
  }

  markClaimPublished(claimId: string): void {
    const claim = this.state.claims[claimId];
    if (!claim?.publication) throw new PairingError(404, "claim_not_found", "Pairing claim publication was not found.");
    if (!claim.publication.publishedAt) {
      claim.publication.publishedAt = iso(this.now());
      this.save();
    }
  }

  revokeGrant(grantId: string) {
    const grant = this.state.grants[grantId];
    if (!grant) throw new PairingError(404, "grant_not_found", "Device grant was not found.");
    if (!grant.revokedAt) {
      grant.revokedAt = iso(this.now());
      this.save();
    }
    return { grantId, revokedAt: grant.revokedAt };
  }

  acceptRequest(grantId: string, requestId: string, sequence: number, envelope: string) {
    return this.exclusive(() => this.acceptRequestLocked(grantId, requestId, sequence, envelope));
  }
  private async acceptRequestLocked(grantId: string, requestId: string, sequence: number, envelope: string) {
    const grant = this.state.grants[grantId];
    if (!grant) throw new PairingError(401, "grant_not_found", "Device grant was not found.");
    if (grant.revokedAt) throw new PairingError(401, "grant_revoked", "Device grant was revoked.");
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) throw new PairingError(401, "grant_expired", "Device grant expired.");
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new PairingError(400, "invalid_sequence", "Request sequence is invalid.");
    this.pruneRequests(grantId);
    const incomplete = Object.values(this.state.requests).filter(
      (record) => record.grantId === grantId && !record.responseEnvelope,
    ).length;
    if (incomplete >= INCOMPLETE_REQUEST_LIMIT) {
      throw new PairingError(429, "too_many_pending_requests", "Too many requests are awaiting recovery.");
    }
    const requestKey = `${grantId}:${requestId}`;
    const envelopeHash = hash(envelope);
    const existing = this.state.requests[requestKey];
    if (existing) {
      if (existing.sequence !== sequence || existing.envelopeHash !== envelopeHash) {
        throw new PairingError(409, "request_conflict", "Request id was reused with different content.");
      }
      return { duplicate: true as const, responseEnvelope: existing.responseEnvelope, scopes: grant.scopes };
    }
    if (sequence <= grant.lastSequence) throw new PairingError(409, "replay", "Request sequence was already consumed.");
    const jws = await decryptJws(envelope, this.identity);
    const payload = await verifyJws(jws, grant.deviceSigningKey, {
      issuer: `bizos-mobile:${grant.deviceId}`,
      audience: `bizos-computer:${this.options.computerId}`,
      subject: grantId,
      now: this.now(),
    });
    if (payload.jti !== requestId || payload.sequence !== sequence || typeof payload.nonce !== "string" ||
        payload.nonce.length < 16 || !plainObject(payload.request)) {
      throw new PairingError(401, "invalid_envelope", "Request is not bound to its grant and sequence.");
    }
    grant.lastSequence = sequence;
    grant.lastSeenAt = iso(this.now());
    this.state.requests[requestKey] = {
      grantId,
      requestId,
      sequence,
      envelopeHash,
      acceptedAt: iso(this.now()),
      responseEnvelope: null,
    };
    this.save();
    return { duplicate: false as const, request: payload.request, scopes: grant.scopes };
  }

  completeRequest(grantId: string, requestId: string, sequence: number, response: unknown) {
    return this.exclusive(() => this.completeRequestLocked(grantId, requestId, sequence, response));
  }
  private async completeRequestLocked(grantId: string, requestId: string, sequence: number, response: unknown) {
    const grant = this.state.grants[grantId];
    const record = this.state.requests[`${grantId}:${requestId}`];
    if (!grant || !record || record.sequence !== sequence) {
      throw new PairingError(404, "request_not_found", "Accepted request was not found.");
    }
    if (record.responseEnvelope) return record.responseEnvelope;
    const now = this.now();
    const responseEnvelope = await encryptSignedClaims({
      iss: `bizos-computer:${this.options.computerId}`,
      sub: grantId,
      aud: `bizos-mobile:${grant.deviceId}`,
      jti: requestId,
      iat: unix(now),
      exp: unix(future(now, REQUEST_TTL_SECONDS * 1000)),
      sequence,
      response,
    }, this.identity.signing.privateJwk, grant.deviceEncryptionKey);
    record.responseEnvelope = responseEnvelope;
    this.pruneRequests(grantId);
    this.save();
    return responseEnvelope;
  }
}
