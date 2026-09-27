// RAM-only projection delivered by Desktop main over the owner-bearer route.
// This grants local features, never SaaS authority, credits or provider access.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Entitlement, ProFeature } from "./entitlement.js";

export const MANAGED_ENTITLEMENT_ENV = "LOCALBIZOS_MANAGED_ENTITLEMENT";
export const MAX_ENTITLEMENT_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FEATURES: ProFeature[] = ["customModels", "customConnectors", "cloudComputer"];

export interface ManagedProjection {
  version: 1;
  subject: string;
  orgId: string;
  instanceId: string;
  features: Record<ProFeature, boolean>;
  issuedAt: string;
  expiresAt: string;
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid entitlement object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    throw new Error("Invalid entitlement fields");
  return row;
}

export function validateManagedProjection(value: unknown, instanceId: string, now: number): ManagedProjection {
  const row = exact(value, ["version", "subject", "orgId", "instanceId", "features", "issuedAt", "expiresAt"]);
  const features = exact(row.features, FEATURES);
  if (
    row.version !== 1 ||
    typeof row.subject !== "string" ||
    !UUID.test(row.subject) ||
    typeof row.orgId !== "string" ||
    !UUID.test(row.orgId) ||
    row.instanceId !== instanceId ||
    !INSTANCE.test(instanceId) ||
    FEATURES.some((key) => typeof features[key] !== "boolean") ||
    typeof row.issuedAt !== "string" ||
    !UTC.test(row.issuedAt) ||
    typeof row.expiresAt !== "string" ||
    !UTC.test(row.expiresAt)
  )
    throw new Error("Invalid entitlement claims");
  const issued = Date.parse(row.issuedAt),
    expires = Date.parse(row.expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now ||
    expires <= now ||
    expires <= issued ||
    expires - issued > MAX_ENTITLEMENT_MS
  )
    throw new Error("Invalid entitlement lifetime");
  return {
    version: 1,
    subject: row.subject,
    orgId: row.orgId,
    instanceId,
    features: {
      customModels: features.customModels as boolean,
      customConnectors: features.customConnectors as boolean,
      cloudComputer: features.cloudComputer as boolean,
    },
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
  };
}

export class ManagedEntitlementState {
  private sessionId: string | null = null;
  private revision = 0;
  private binding: string | null = null;
  private snapshot: ManagedProjection | null = null;
  private deadline = 0;
  private lastExpiresAt: string | null = null;
  constructor(
    private readonly instanceId: string,
    private readonly now = Date.now,
    private readonly monotonic = () => performance.now(),
  ) {
    if (!INSTANCE.test(instanceId)) throw new Error("Invalid managed runtime instance");
  }

  beginOwnerSession(): { sessionId: string } {
    this.sessionId = randomUUID();
    this.revision = 0;
    this.binding = null;
    this.snapshot = null;
    this.deadline = 0;
    this.lastExpiresAt = null;
    return { sessionId: this.sessionId };
  }

  apply(value: unknown): Entitlement {
    const row = exact(value, ["sessionId", "revision", "projection"]);
    if (
      !this.sessionId ||
      row.sessionId !== this.sessionId ||
      !Number.isSafeInteger(row.revision) ||
      (row.revision as number) <= this.revision
    )
      throw new Error("Stale entitlement delivery");
    const projection =
      row.projection === null ? null : validateManagedProjection(row.projection, this.instanceId, this.now());
    const binding = projection ? `${projection.subject}\0${projection.orgId}` : null;
    if (this.binding && binding && binding !== this.binding) throw new Error("Entitlement account changed");
    this.revision = row.revision as number;
    if (!projection) {
      this.snapshot = null;
      return this.get();
    }
    const deadline = this.monotonic() + Math.min(MAX_ENTITLEMENT_MS, Date.parse(projection.expiresAt) - this.now());
    this.deadline = this.lastExpiresAt === projection.expiresAt ? Math.min(this.deadline, deadline) : deadline;
    this.lastExpiresAt = projection.expiresAt;
    this.snapshot = projection;
    this.binding = binding;
    return this.get();
  }

  get(): Entitlement {
    const value = this.snapshot;
    if (!value || this.monotonic() >= this.deadline || this.now() >= Date.parse(value.expiresAt)) {
      this.snapshot = null;
      return {
        tier: "free",
        source: "managed",
        features: { customModels: false, customConnectors: false, cloudComputer: false },
      };
    }
    return {
      tier: FEATURES.some((key) => value.features[key]) ? "pro" : "free",
      source: "managed",
      features: { ...value.features },
      expiresAt: value.expiresAt,
    };
  }
}
