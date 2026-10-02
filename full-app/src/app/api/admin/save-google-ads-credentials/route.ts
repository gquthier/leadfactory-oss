import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

interface GoogleAdsCredentials {
  developer_token: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  manager_customer_id?: string;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  const body = await req.json() as Partial<GoogleAdsCredentials>;
  const { developer_token, client_id, client_secret, refresh_token, manager_customer_id } = body;

  if (!developer_token || !client_id || !client_secret || !refresh_token) {
    return NextResponse.json(
      { error: "Champs requis: developer_token, client_id, client_secret, refresh_token" },
      { status: 400 },
    );
  }

  // Inject into running process so routes take effect immediately (no restart needed)
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = developer_token;
  process.env.GOOGLE_ADS_CLIENT_ID = client_id;
  process.env.GOOGLE_ADS_CLIENT_SECRET = client_secret;
  process.env.GOOGLE_ADS_REFRESH_TOKEN = refresh_token;
  if (manager_customer_id) {
    process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID = manager_customer_id;
  }

  return NextResponse.json({ success: true });
}
