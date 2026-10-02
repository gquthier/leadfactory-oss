/**
 * GET    /api/client/integrations/keys       → liste les clés du client
 * POST   /api/client/integrations/keys       → crée une clé (one-time display du token)
 *
 * (révocation : voir /api/client/integrations/keys/[id]/route.ts)
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { generateApiKey } from "@/lib/integrations/api-key";

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

const VALID_PROVIDERS = ["calcom", "typeform", "zapier", "n8n", "make", "generic", "custom"];

export async function GET() {
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_api_keys")
    .select("id, label, key_prefix, provider, revoked_at, last_used_at, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: Request) {
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { label?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const label = body.label?.trim();
  const provider = (body.provider || "generic").toLowerCase();

  if (!label || label.length > 80) {
    return NextResponse.json(
      { error: "Le label doit faire entre 1 et 80 caractères" },
      { status: 400 }
    );
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json(
      { error: `Provider invalide. Autorisés : ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }

  // Limite anti-abuse : max 20 clés actives par client
  const admin = createAdminClient();
  const { count } = await admin
    .from("integration_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("revoked_at", null);

  if ((count ?? 0) >= 20) {
    return NextResponse.json(
      { error: "Limite atteinte (20 clés actives max). Révoque-en une avant." },
      { status: 400 }
    );
  }

  const { fullKey, prefix, hash } = generateApiKey();

  const { data, error } = await admin
    .from("integration_api_keys")
    .insert({
      client_id: clientId,
      label,
      provider,
      key_prefix: prefix,
      key_hash: hash,
    })
    .select("id, label, key_prefix, provider, revoked_at, last_used_at, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    key: data,
    // ⚠️ Affiché UNE SEULE FOIS — jamais re-fetchable
    full_key: fullKey,
  });
}
