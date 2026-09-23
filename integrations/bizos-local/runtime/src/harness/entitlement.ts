// The local plan tier: `free` or `pro`.
//
// HONEST STUB. This is a local switch, persisted in the runtime state
// directory (`entitlement.json`) and overridable with `BIZOS_LOCAL_PLAN`.
// Nothing here talks to a billing system, verifies a purchase or signs
// anything: anyone who can write this file or set that variable is Pro. It
// exists so the product can be built and tested against the free/pro split
// (custom models and custom connectors are Pro; connecting a personal
// Codex / Claude Code / Cursor plan stays free). Linking it to real billing
// (a signed, expiring entitlement from the account) is future work.
import type { Storage } from "./storage.js";

export const ENTITLEMENT_FILE = "entitlement.json";
export const PLAN_ENV = "BIZOS_LOCAL_PLAN";

export type PlanTier = "free" | "pro";
export type ProFeature = "customModels" | "customConnectors";

export interface Entitlement {
  tier: PlanTier;
  /** `env`: BIZOS_LOCAL_PLAN; `local`: entitlement.json; `default`: neither. */
  source: "env" | "local" | "default";
  features: Record<ProFeature, boolean>;
}

export class ProRequiredError extends Error {
  readonly code = "pro_required";
  constructor(readonly feature: ProFeature) {
    super(feature === "customConnectors"
      ? "Adding your own apps and connectors needs BizOS Pro."
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
  return { tier, source, features: { customModels: pro, customConnectors: pro } };
}

export class EntitlementStore {
  constructor(
    private readonly storage: Storage,
    private readonly environment: () => NodeJS.ProcessEnv = () => process.env,
  ) {}

  get(): Entitlement {
    const fromEnv = asTier(this.environment()[PLAN_ENV]);
    if (fromEnv) return entitlementFor(fromEnv, "env");
    const raw = this.storage.readJson<{ tier?: unknown } | null>(ENTITLEMENT_FILE, null);
    const stored = raw && typeof raw === "object" ? asTier(raw.tier) : null;
    return stored ? entitlementFor(stored, "local") : entitlementFor("free", "default");
  }

  tier(): PlanTier {
    return this.get().tier;
  }

  /** Persists the local tier. An env override still wins, and the answer
   * says so (`source: "env"`). */
  set(value: unknown): Entitlement {
    const tier = asTier(value);
    if (!tier) throw new Error("tier must be \"free\" or \"pro\"");
    this.storage.writeJson(ENTITLEMENT_FILE, { version: 1, tier });
    return this.get();
  }

  require(feature: ProFeature): void {
    if (!this.get().features[feature]) throw new ProRequiredError(feature);
  }
}
