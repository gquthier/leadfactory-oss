import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logActivity, touchLastSeen, type ActivityAction, type TargetType } from "@/lib/activity-log";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { action, targetType, targetId, targetLabel, metadata } = await req.json() as {
    action: ActivityAction;
    targetType?: TargetType;
    targetId?: string;
    targetLabel?: string;
    metadata?: Record<string, unknown>;
  };

  const userId = session.user.id;
  const email = session.user.email ?? "";

  // Get role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  const role = (profile?.role as "admin" | "client") ?? "client";

  // Update last_seen
  touchLastSeen(userId);

  // Log the activity
  await logActivity({
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    action,
    targetType,
    targetId,
    targetLabel,
    metadata,
  });

  return NextResponse.json({ ok: true });
}
