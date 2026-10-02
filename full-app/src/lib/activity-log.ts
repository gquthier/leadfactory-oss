import {createAdminClient} from './supabase-server';
export type ActivityAction =
  | "login"
  | "first_login"
  | "client_created"
  | "client_updated"
  | "client_deleted"
  | "client_deactivated"
  | "client_reactivated"
  | "client_results_rated"
  | "campaign_created"
  | "campaign_updated"
  | "campaign_status_changed"
  | "task_created"
  | "task_completed"
  | "lead_viewed"
  | "onboarding_processed"
  | "password_reset"
  | "page_visit";

export type TargetType =
  | "client"
  | "campaign"
  | "lead"
  | "task"
  | "page";

interface LogActivityParams {
  actorId: string | null;
  actorEmail?: string;
  actorRole: "admin" | "client" | "system";
  action: ActivityAction;
  targetType?: TargetType;
  targetId?: string;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert an activity log entry. Fire-and-forget — never throws.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await createAdminClient().from("activity_logs").insert({
      actor_id: params.actorId,
      actor_email: params.actorEmail,
      actor_role: params.actorRole,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      target_label: params.targetLabel ?? null,
      metadata: params.metadata ?? {},
    });
  } catch {
    // Silent — logging should never break the main flow
  }
}

/**
 * Update last_seen_at (and first_login_at if first time) on profiles.
 */
export async function trackLogin(userId: string, email: string): Promise<boolean> {
  let isFirstLogin = false;

  try {
    // Check if first login
    const { data: profile } = await createAdminClient()
      .from("profiles")
      .select("first_login_at")
      .eq("id", userId)
      .single();

    const now = new Date().toISOString();
    const updates: Record<string, string> = { last_seen_at: now };

    if (!profile?.first_login_at) {
      updates.first_login_at = now;
      isFirstLogin = true;
    }

    await createAdminClient()
      .from("profiles")
      .update(updates)
      .eq("id", userId);
  } catch {
    // Silent
  }

  return isFirstLogin;
}

/**
 * Update last_seen_at only (for page visits, API calls, etc.)
 */
export async function touchLastSeen(userId: string): Promise<void> {
  try {
    await createAdminClient()
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
  } catch {
    // Silent
  }
}
