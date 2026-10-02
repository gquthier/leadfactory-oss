import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_connections")
    .select(
      "page_id, page_name, instagram_account_id, scopes, subscribed_leadgen, connected_at, expires_at, last_refreshed_at, last_error"
    )
    .eq("client_id", session.user.id)
    .order("connected_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ connected: false, pages: [] });
  }

  return NextResponse.json({
    connected: true,
    pages: data.map((d) => ({
      pageId: d.page_id,
      pageName: d.page_name,
      instagramAccountId: d.instagram_account_id,
      scopes: d.scopes,
      subscribedLeadgen: d.subscribed_leadgen,
      connectedAt: d.connected_at,
      expiresAt: d.expires_at,
      lastRefreshedAt: d.last_refreshed_at,
      lastError: d.last_error,
    })),
  });
}
