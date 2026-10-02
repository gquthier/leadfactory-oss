import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("linkedin_connections")
    .select("linkedin_user_id, full_name, profile_picture, scopes, connected_at, expires_at, refresh_expires_at, last_refreshed_at, last_error")
    .eq("client_id", session.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    linkedinUserId: data.linkedin_user_id,
    fullName: data.full_name,
    profilePicture: data.profile_picture,
    scopes: data.scopes,
    connectedAt: data.connected_at,
    expiresAt: data.expires_at,
    refreshExpiresAt: data.refresh_expires_at,
    lastRefreshedAt: data.last_refreshed_at,
    lastError: data.last_error,
  });
}
