/**
 * Admin endpoints for provisioning webhook keys for a client.
 *
 * GET  /api/admin/clients/[id]/webhook  → list active webhook keys (without secrets)
 * POST /api/admin/clients/[id]/webhook  → create a fresh "Make · Meta Lead Ads" key
 *                                          and return the full token (one-time reveal)
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { generateApiKey } from "@/lib/integrations/api-key";
import { buildMakeBlueprint } from "@/lib/integrations/make-blueprint";

export const dynamic = "force-dynamic";

async function ensureAdmin() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { error: "Forbidden", status: 403 as const };

  return { admin, sessionUserId: session.user.id };
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await ensureAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { admin } = auth;

  const [{ data: client }, { data: keys }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, email, company")
      .eq("id", params.id)
      .maybeSingle(),
    admin
      .from("integration_api_keys")
      .select("id, label, key_prefix, provider, revoked_at, last_used_at, created_at")
      .eq("client_id", params.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  return NextResponse.json({ client, keys: keys ?? [] });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await ensureAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { admin } = auth;

  let body: { label?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional; defaults to Make Meta preset
  }

  const label = body.label?.trim() || "Make · Meta Lead Ads";
  const provider = (body.provider ?? "make").toLowerCase();

  // Verify the client exists
  const { data: client } = await admin
    .from("profiles")
    .select("id, full_name, email, company")
    .eq("id", params.id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Anti-clutter: max 20 active keys per client (same cap as the client-side endpoint)
  const { count } = await admin
    .from("integration_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("client_id", params.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= 20) {
    return NextResponse.json(
      { error: "Limite atteinte (20 clés actives max). Révoque-en une avant." },
      { status: 400 }
    );
  }

  const { fullKey, prefix, hash } = generateApiKey();

  const { data: inserted, error } = await admin
    .from("integration_api_keys")
    .insert({
      client_id: params.id,
      label,
      provider,
      key_prefix: prefix,
      key_hash: hash,
    })
    .select("id, label, key_prefix, provider, revoked_at, last_used_at, created_at")
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid";
  const webhookUrl = `${appUrl}/api/integrations/webhook/${fullKey}`;

  const clientLabel = client.company || client.full_name || client.email || "Client";
  const blueprint = buildMakeBlueprint({ webhookUrl, clientLabel });

  return NextResponse.json({
    key: inserted,
    full_key: fullKey,
    webhook_url: webhookUrl,
    client,
    blueprint,
  });
}
