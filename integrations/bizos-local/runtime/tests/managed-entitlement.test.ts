import { describe, expect, it } from "vitest";
import { ManagedEntitlementState } from "../src/harness/managed-entitlement.js";

const subject = "e82b04d0-1b3c-4a50-a42b-41c20d65cfea";
const orgId = "d5bf5acb-078f-4e48-94b6-72b2b669efee";
const initial = Date.parse("2026-09-27T09:00:00.000Z");
const projection = (patch: Record<string, unknown> = {}) => ({
  version: 1,
  subject,
  orgId,
  instanceId: "qa-runtime",
  features: { customModels: true, customConnectors: true, cloudComputer: true },
  issuedAt: new Date(initial).toISOString(),
  expiresAt: new Date(initial + 900_000).toISOString(),
  ...patch,
});

describe("Managed entitlement RAM authority", () => {
  it("is free on restart and expires by monotonic elapsed time when wall time rolls back", () => {
    let wall = initial,
      mono = 10;
    const state = new ManagedEntitlementState(
      "qa-runtime",
      () => wall,
      () => mono,
    );
    const session = state.beginOwnerSession();
    expect(state.get().features.customModels).toBe(false);
    state.apply({ sessionId: session.sessionId, revision: 1, projection: projection() });
    expect(state.get().features.customModels).toBe(true);
    wall -= 60_000;
    mono += 900_001;
    expect(state.get().features.customModels).toBe(false);
    expect(new ManagedEntitlementState("qa-runtime").get().features.customModels).toBe(false);
  });

  it("rejects foreign binding, future/expired/overlong claims, missing booleans and extra authority", () => {
    for (const patch of [
      { instanceId: "foreign" },
      { subject: "local:user" },
      { orgId: "foreign" },
      { issuedAt: new Date(initial + 1).toISOString() },
      { expiresAt: new Date(initial).toISOString() },
      { expiresAt: new Date(initial + 900_001).toISOString() },
      { features: { customModels: true } },
      { tier: "pro" },
    ]) {
      const state = new ManagedEntitlementState("qa-runtime", () => initial);
      const session = state.beginOwnerSession();
      expect(() => state.apply({ sessionId: session.sessionId, revision: 1, projection: projection(patch) })).toThrow();
      expect(state.get().tier).toBe("free");
    }
  });

  it("clears on denial, fences stale writes and binds the owner session to one account/org", () => {
    const state = new ManagedEntitlementState("qa-runtime", () => initial);
    const session = state.beginOwnerSession();
    const apply = (revision: number, value: unknown) =>
      state.apply({ sessionId: session.sessionId, revision, projection: value });
    apply(1, projection());
    expect(() => apply(2, projection({ subject: "ac918392-d348-46ca-8c98-c656e3156c64" }))).toThrow();
    apply(3, null);
    expect(() => apply(2, projection())).toThrow();
    expect(state.get().tier).toBe("free");
    state.beginOwnerSession();
    expect(() => apply(4, projection())).toThrow();
    expect(state.get().tier).toBe("free");
  });

  it("never exposes identity/session handles in the public feature summary or extends a replay", () => {
    let wall = initial,
      mono = 0;
    const state = new ManagedEntitlementState(
      "qa-runtime",
      () => wall,
      () => mono,
    );
    const session = state.beginOwnerSession();
    state.apply({ sessionId: session.sessionId, revision: 1, projection: projection() });
    wall += 100_000;
    mono += 200_000;
    state.apply({ sessionId: session.sessionId, revision: 2, projection: projection() });
    mono = 900_001;
    expect(state.get().tier).toBe("free");
    wall = initial + 1000;
    state.apply({ sessionId: session.sessionId, revision: 3, projection: projection() });
    expect(state.get().tier).toBe("free");
    const summary = JSON.stringify(state.get());
    for (const secret of [subject, orgId, session.sessionId]) expect(summary).not.toContain(secret);
  });
});
