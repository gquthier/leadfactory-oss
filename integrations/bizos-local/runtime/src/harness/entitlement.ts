// Desktop-managed runtime accepts a short-lived RAM projection from its native owner.
// Independent OSS keeps the historical local switch for user-controlled features;
// neither mode grants SaaS authority, provider credentials or cloud credits.
import type { Storage } from "./storage.js";
import { ManagedEntitlementState } from "./managed-entitlement.js";

export const ENTITLEMENT_FILE = "entitlement.json";
export const PLAN_ENV = "BIZOS_LOCAL_PLAN";

export type PlanTier = "free" | "pro";
export type ProFeature = "customModels" | "customConnectors" | "cloudComputer";

export interface Entitlement {
  tier: PlanTier;
  /** `managed`: expiring native projection; other sources are OSS-only switches. */
  source: "env" | "local" | "default" | "managed";
  features: Record<ProFeature, boolean>;
  expiresAt?: string;
}

export class ProRequiredError extends Error {
  readonly code = "pro_required";
  constructor(readonly feature: ProFeature) {
    super(feature === "customConnectors"
      ? "Adding your own apps and connectors needs BizOS Pro."
      : feature === "cloudComputer"
        ? "The cloud computer needs BizOS Pro."
        : "Custom models and API providers need BizOS Pro.");
    this.name = "pro_required";
  }
}

function asTier(value: unknown): PlanTier | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "pro" || text === "free" ? text : null;
}

export function entitlementFor(tier: PlanTier, source: Entitlement["source"]): Entitlement {
  const pro = tier === "pro";
  return { tier, source, features: { customModels: pro, customConnectors: pro, cloudComputer: pro } };
}

export class EntitlementStore {
  private readonly managed: ManagedEntitlementState | null;
  constructor(
    private readonly storage: Storage,
    private readonly environment: () => NodeJS.ProcessEnv = () => process.env,
    managedInstanceId?: string,
  ) { this.managed=managedInstanceId ? new ManagedEntitlementState(managedInstanceId) : null; }

  get(): Entitlement {
    if(this.managed) return this.managed.get();
    const fromEnv = asTier(this.environment()[PLAN_ENV]);
    if (fromEnv) return entitlementFor(fromEnv, "env");
    const raw = this.storage.readJson<{ tier?: unknown } | null>(ENTITLEMENT_FILE, null);
    const stored = raw && typeof raw === "object" ? asTier(raw.tier) : null;
    return stored ? entitlementFor(stored, "local") : entitlementFor("free", "default");
  }

  tier(): PlanTier {
    return this.get().features.customModels ? "pro" : "free";
  }

  /** Persists the local tier. An env override still wins, and the answer
   * says so (`source: "env"`). */
  set(value: unknown): Entitlement {
    if(this.managed) throw new Error("Managed entitlement cannot be set locally");
    const tier = asTier(value);
    if (!tier) throw new Error("tier must be \"free\" or \"pro\"");
    this.storage.writeJson(ENTITLEMENT_FILE, { version: 1, tier });
    return this.get();
  }

  require(feature: ProFeature): void {
    if (!this.get().features[feature]) throw new ProRequiredError(feature);
  }

  beginOwnerSession(): {sessionId:string} {
    if(!this.managed) throw new Error("Managed entitlement unavailable in OSS mode");
    return this.managed.beginOwnerSession();
  }

  applyManaged(value: unknown): Entitlement {
    if(!this.managed) throw new Error("Managed entitlement unavailable in OSS mode");
    return this.managed.apply(value);
  }
}
