export type PlanProvider = "codex" | "claude" | "cursor";
export type PlanAuthKind = "oauth";
export type PlanStatus = "connected" | "expired" | "rate_limited" | "error" | "disconnected";

export interface ConnectedPlan {
  id: string; // pln_<base36>
  provider: PlanProvider;
  label: string;
  authKind: PlanAuthKind;
  status: PlanStatus;
  emailHint?: string;
  /** Codex only — absolute CODEX_HOME. Main-only; strip before IPC. */
  codexHome?: string;
  /** Claude only — absolute CLAUDE_CONFIG_DIR. Main-only; strip before IPC. */
  configDir?: string;
  /**
   * Cursor only — the machine's `~/.cursor`. Main-only; strip before IPC.
   *
   * It is NOT an isolation handle. `CURSOR_CONFIG_DIR` moves settings, chats
   * and projects, but on macOS the CLI keeps its OAuth token in the login
   * Keychain under a FIXED service (`cursor-access-token`, account
   * `cursor-user`, domain `"cursor"` — read from the shipped bundle,
   * 2026-09-07), so a second directory would still sign in the same account.
   * Hence: one Cursor plan per Mac, and this path never enters a child
   * environment.
   */
  cursorHome?: string;
  quota?: { window: "5h" | "weekly" | "daily"; usedPct: number; resetsAt?: string };
  /** What the CLI itself reported about the account's limits, and when. */
  usage?: {
    at: string;
    planType: string | null;
    email: string | null;
    reached: boolean;
    windows: Array<{ label: string; windowMinutes: number; usedPct: number; resetsAt: string | null; limitName: string | null }>;
  };
  cooldownUntil?: string;
  lastUsedAt?: string;
  createdAt: string;
  priority: number;
}

export interface PlanRoutingState {
  pins: Record<string, string>;
  defaultPolicy: "headroom" | "priority";
  activePlanId?: string | null;
}

export interface PlansFile {
  plans: ConnectedPlan[];
  routing: PlanRoutingState;
}

/** Renderer-safe shape: never carries auth home paths. */
export type PublicPlan = Omit<ConnectedPlan, "codexHome" | "configDir" | "cursorHome">;
