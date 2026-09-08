// Connected OAuth plans and their isolated auth homes.
//
// Metadata lives in `plans.json` (0600). Each plan's CLI auth directory is
// either a NEW folder under `plans/<id>/codex|claude/` (0700) — for a second
// account the user logs into — or a reference to the machine default
// (`~/.codex`, `~/.claude`, `~/.cursor`) seeded on first launch. Paths never
// leave the main process: `publicList()` / `toPublic()` strip them before IPC.
//
// Cursor is the exception to "one folder, one account": its CLI stores the
// token in the macOS login Keychain under a fixed service, so a Cursor plan
// always REFERENCES `~/.cursor` and there is at most one per Mac.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DIRECTORY_MODE, type Storage } from "./storage.js";
import type {
  ConnectedPlan,
  PlanProvider,
  PlansFile,
  PlanRoutingState,
  PlanStatus,
  PublicPlan,
} from "./plan-types.js";

export const PLANS_FILE = "plans.json";
export const MAX_PLAN_LABEL = 80;
export const PLAN_ID = /^pln_[a-z0-9]+_[a-z0-9]+$/i;

function emptyRouting(): PlanRoutingState {
  return { pins: {}, defaultPolicy: "priority", activePlanId: null };
}

function emptyFile(): PlansFile {
  return { plans: [], routing: emptyRouting() };
}

export function newPlanId(nowMs: number = Date.now()): string {
  return `pln_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clipLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.slice(0, MAX_PLAN_LABEL) || "Plan";
}

/** Strip main-only auth homes before anything crosses the bridge. */
export function toPublic(plan: ConnectedPlan): PublicPlan {
  const { codexHome: _c, configDir: _d, cursorHome: _u, ...publicPlan } = plan;
  return publicPlan;
}

/** The auth home a plan points at, whichever family it belongs to. */
export function planHome(plan: ConnectedPlan): string | undefined {
  return plan.codexHome ?? plan.configDir ?? plan.cursorHome;
}

/** Which field on the row carries this family's home. */
export function homeFieldFor(provider: PlanProvider): "codexHome" | "configDir" | "cursorHome" {
  if (provider === "codex") return "codexHome";
  if (provider === "cursor") return "cursorHome";
  return "configDir";
}

export const DEFAULT_PLAN_LABEL: Record<PlanProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude Code",
  cursor: "Cursor",
};

export function maskEmailHint(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf("@");
  if (at <= 0) return undefined;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return undefined;
  if (local.length <= 2) return `${local[0] ?? "*"}…@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}@${domain}`;
}

export interface SeedFromMachineInput {
  nowIso: string;
  homeDir: string;
  /** Caller probed `codex login status` against the default home. */
  codexAuthenticated?: boolean;
  codexEmailHint?: string;
  /** Caller probed `claude auth status` against the default home. */
  claudeAuthenticated?: boolean;
  claudeEmailHint?: string;
  /** Caller probed `cursor-agent status` — one account per Mac. */
  cursorAuthenticated?: boolean;
  cursorEmailHint?: string;
}

export class PlanRegistry {
  private cached: PlansFile;

  constructor(private readonly storage: Storage) {
    this.cached = this.read();
  }

  private read(): PlansFile {
    const raw = this.storage.readJson<PlansFile | null>(PLANS_FILE, null);
    if (!raw || typeof raw !== "object") return emptyFile();
    const plans = Array.isArray(raw.plans) ? raw.plans.filter(isConnectedPlan) : [];
    const routing: PlanRoutingState =
      raw.routing && typeof raw.routing === "object"
        ? {
            pins:
              raw.routing.pins && typeof raw.routing.pins === "object"
                ? { ...(raw.routing.pins as Record<string, string>) }
                : {},
            defaultPolicy: raw.routing.defaultPolicy === "headroom" ? "headroom" : "priority",
            activePlanId:
              typeof raw.routing.activePlanId === "string"
                ? raw.routing.activePlanId
                : null,
          }
        : emptyRouting();
    return { plans, routing };
  }

  private persist(): void {
    this.storage.writeJson(PLANS_FILE, this.cached);
  }

  list(): ConnectedPlan[] {
    return this.cached.plans.map((plan) => ({ ...plan }));
  }

  publicList(): PublicPlan[] {
    return this.list().map(toPublic);
  }

  get(id: string): ConnectedPlan | undefined {
    const found = this.cached.plans.find((plan) => plan.id === id);
    return found ? { ...found } : undefined;
  }

  routing(): PlanRoutingState {
    return {
      pins: { ...this.cached.routing.pins },
      defaultPolicy: this.cached.routing.defaultPolicy,
      activePlanId: this.cached.routing.activePlanId ?? null,
    };
  }

  /**
   * A brand-new isolated auth home under userData. Empty until the user
   * runs `codex login` / `claude auth login` against it.
   */
  create(input: { provider: PlanProvider; label?: string; status?: PlanStatus }): ConnectedPlan {
    const id = newPlanId();
    const providerRoot = join(this.storage.layout.root, "plans", id, input.provider);
    mkdirSync(providerRoot, { recursive: true, mode: DIRECTORY_MODE });
    const priority = this.cached.plans.length;
    const plan: ConnectedPlan = {
      id,
      provider: input.provider,
      label: clipLabel(input.label ?? DEFAULT_PLAN_LABEL[input.provider]),
      authKind: "oauth",
      status: input.status ?? "disconnected",
      createdAt: new Date().toISOString(),
      priority,
      [homeFieldFor(input.provider)]: providerRoot,
    };
    this.cached.plans.push(plan);
    this.persist();
    return { ...plan };
  }

  /**
   * Reference an EXISTING auth home (machine default). Does not copy secrets —
   * the plan points at the caller's path.
   */
  createReferencing(input: {
    provider: PlanProvider;
    label: string;
    homePath: string;
    status?: PlanStatus;
    emailHint?: string;
    createdAt?: string;
  }): ConnectedPlan {
    const id = newPlanId();
    const priority = this.cached.plans.length;
    const plan: ConnectedPlan = {
      id,
      provider: input.provider,
      label: clipLabel(input.label),
      authKind: "oauth",
      status: input.status ?? "connected",
      createdAt: input.createdAt ?? new Date().toISOString(),
      priority,
      ...(input.emailHint ? { emailHint: maskEmailHint(input.emailHint) ?? input.emailHint } : {}),
      [homeFieldFor(input.provider)]: input.homePath,
    };
    this.cached.plans.push(plan);
    this.persist();
    return { ...plan };
  }

  remove(id: string): boolean {
    const index = this.cached.plans.findIndex((plan) => plan.id === id);
    if (index < 0) return false;
    const [removed] = this.cached.plans.splice(index, 1);
    for (const [key, pinned] of Object.entries(this.cached.routing.pins)) {
      if (pinned === id) delete this.cached.routing.pins[key];
    }
    if (this.cached.routing.activePlanId === id) this.cached.routing.activePlanId = null;
    this.persist();
    // Only delete isolated homes we own under userData — never wipe ~/.codex.
    const owned = join(this.storage.layout.root, "plans", id);
    try {
      rmSync(owned, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    void removed;
    return true;
  }

  update(id: string, patch: Partial<Omit<ConnectedPlan, "id" | "provider" | "authKind" | "createdAt">>): ConnectedPlan {
    const plan = this.cached.plans.find((candidate) => candidate.id === id);
    if (!plan) throw new Error(`unknown plan ${id}`);
    if (patch.label !== undefined) plan.label = clipLabel(patch.label);
    if (patch.status !== undefined) plan.status = patch.status;
    if (patch.emailHint !== undefined) plan.emailHint = maskEmailHint(patch.emailHint) ?? patch.emailHint;
    if (patch.quota !== undefined) plan.quota = patch.quota;
    if (patch.usage !== undefined) {
      // The address is the CLI's; only a hint of it leaves this file.
      const email = patch.usage.email ? (maskEmailHint(patch.usage.email) ?? patch.usage.email) : null;
      plan.usage = { ...patch.usage, email };
    }
    if (patch.cooldownUntil !== undefined) {
      if (patch.cooldownUntil === null || patch.cooldownUntil === "") delete plan.cooldownUntil;
      else plan.cooldownUntil = patch.cooldownUntil;
    }
    if (patch.lastUsedAt !== undefined) plan.lastUsedAt = patch.lastUsedAt;
    if (patch.priority !== undefined) plan.priority = patch.priority;
    // Paths are main-only; allow internal rewrites (e.g. tests) but never from IPC.
    if (patch.codexHome !== undefined) plan.codexHome = patch.codexHome;
    if (patch.configDir !== undefined) plan.configDir = patch.configDir;
    if (patch.cursorHome !== undefined) plan.cursorHome = patch.cursorHome;
    this.persist();
    return { ...plan };
  }

  setActive(id: string | null): ConnectedPlan | null {
    if (id === null) {
      this.cached.routing.activePlanId = null;
      this.persist();
      return null;
    }
    const plan = this.get(id);
    if (!plan) throw new Error(`unknown plan ${id}`);
    this.cached.routing.activePlanId = id;
    this.persist();
    return plan;
  }

  getActive(): ConnectedPlan | null {
    const id = this.cached.routing.activePlanId;
    if (!id) return null;
    return this.get(id) ?? null;
  }

  /** Every thread follows the new choice: sticky plans are forgotten. */
  clearAllPins(): void {
    this.cached.routing.pins = {};
    this.persist();
  }

  setPin(cursorKey: string, planId: string): void {
    this.cached.routing.pins[cursorKey] = planId;
    this.persist();
  }

  clearPin(cursorKey: string): void {
    if (!(cursorKey in this.cached.routing.pins)) return;
    delete this.cached.routing.pins[cursorKey];
    this.persist();
  }

  markCooldown(id: string, untilIso: string): void {
    this.update(id, { cooldownUntil: untilIso, status: "rate_limited" });
  }

  touch(id: string, atIso: string = new Date().toISOString()): void {
    this.update(id, { lastUsedAt: atIso });
  }

  /**
   * First-run import: if the registry is empty and the machine already has
   * a signed-in default Codex / Claude home, register those paths in place
   * (no secret copy). Idempotent when plans already exist.
   */
  seedFromMachine(input: SeedFromMachineInput): ConnectedPlan[] {
    if (this.cached.plans.length > 0) return this.list();
    const created: ConnectedPlan[] = [];
    if (input.codexAuthenticated) {
      created.push(
        this.createReferencing({
          provider: "codex",
          label: "ChatGPT",
          homePath: join(input.homeDir, ".codex"),
          status: "connected",
          ...(input.codexEmailHint ? { emailHint: input.codexEmailHint } : {}),
          createdAt: input.nowIso,
        }),
      );
    }
    if (input.claudeAuthenticated) {
      created.push(
        this.createReferencing({
          provider: "claude",
          label: "Claude Code",
          homePath: join(input.homeDir, ".claude"),
          status: "connected",
          ...(input.claudeEmailHint ? { emailHint: input.claudeEmailHint } : {}),
          createdAt: input.nowIso,
        }),
      );
    }
    if (input.cursorAuthenticated) {
      created.push(
        this.createReferencing({
          provider: "cursor",
          label: "Cursor",
          homePath: join(input.homeDir, ".cursor"),
          status: "connected",
          ...(input.cursorEmailHint ? { emailHint: input.cursorEmailHint } : {}),
          createdAt: input.nowIso,
        }),
      );
    }
    if (created[0] && !this.cached.routing.activePlanId) {
      this.cached.routing.activePlanId = created[0].id;
      this.persist();
    }
    return this.list();
  }
}

function isConnectedPlan(value: unknown): value is ConnectedPlan {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    PLAN_ID.test(row.id) &&
    (row.provider === "codex" || row.provider === "claude" || row.provider === "cursor") &&
    typeof row.label === "string" &&
    row.authKind === "oauth" &&
    typeof row.status === "string" &&
    typeof row.createdAt === "string" &&
    typeof row.priority === "number"
  );
}
