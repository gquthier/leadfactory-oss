/**
 * GET /api/client/integrations/logs?limit=100&api_key_id=...
 *
 * Logs des webhooks reçus pour ce client. Paginé (limit max 200, défaut 50).
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";

export const dynamic = "force-dynamic";

async function getEffectiveClientId() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const previewClientId = await getPreviewClientId();
  return profile?.role === "admin" && previewClientId
    ? previewClientId
    : session.user.id;
}

export async function GET(req: Request) {
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50)
  );
  const apiKeyId = url.searchParams.get("api_key_id");

  const admin = createAdminClient();
  let query = admin
    .from("integration_webhook_logs")
    .select(
      "id, api_key_id, provider, external_id, status, http_status, error, lead_id, ip, created_at"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (apiKeyId) {
    query = query.eq("api_key_id", apiKeyId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
