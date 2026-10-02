import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logActivity, trackLogin } from "@/lib/activity-log";

export async function POST() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const userId = session.user.id;
  const email = session.user.email ?? "";

  // Get role from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  const role = (profile?.role as "admin" | "client") ?? "client";

  // Track login + detect first login
  const isFirstLogin = await trackLogin(userId, email);

  // Log the login event
  await logActivity({
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    action: isFirstLogin ? "first_login" : "login",
    metadata: {
      is_first_login: isFirstLogin,
      user_agent: undefined, // could be passed from client if needed
    },
  });

  return NextResponse.json({ ok: true, isFirstLogin });
}
