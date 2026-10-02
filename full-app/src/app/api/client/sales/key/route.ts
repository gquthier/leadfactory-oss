import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { encryptApiKey } from "@/lib/sales-call-analyzer/crypto";
import { getProvider, PROVIDER_IDS } from "@/lib/sales-call-analyzer/providers";
import type { NotetakerProvider } from "@/lib/sales-call-analyzer/providers";

export const dynamic = "force-dynamic";

function parseProvider(value: unknown): NotetakerProvider | null {
  if (typeof value !== "string") return null;
  return (PROVIDER_IDS as string[]).includes(value)
    ? (value as NotetakerProvider)
    : null;
}

async function requireSession() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return session;
}

/**
 * GET : retourne toutes les clés du user (1 par provider max).
 * Backward compat : si pas de ?provider, renvoie `key` = la clé fathom (legacy).
 */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const providerParam = parseProvider(url.searchParams.get("provider"));

  const admin = createAdminClient();
  const query = admin
    .from("client_external_api_keys")
    .select("id, provider, label, key_preview, last_used_at, last_error, created_at")
    .eq("client_id", session.user.id);

  if (providerParam) {
    const { data } = await query.eq("provider", providerParam).maybeSingle();
    return NextResponse.json({ key: data ?? null });
  }

  const { data } = await query.order("created_at", { ascending: false });
  const keys = data ?? [];
  // Legacy : exposer aussi `key` = la clé Fathom pour les anciens callers.
  const fathomKey = keys.find((k) => k.provider === "fathom") ?? null;
  return NextResponse.json({ keys, key: fathomKey });
}

interface PostBody {
  provider?: string;
  apiKey: string;
  label?: string;
}

/**
 * POST : enregistre / remplace la clé pour un provider donné.
 * `provider` est requis ; fallback "fathom" pour compat avec l'ancien client.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const providerId = parseProvider(body.provider) ?? "fathom";
  const adapter = getProvider(providerId);
  if (!adapter) {
    return NextResponse.json({ error: "Provider inconnu" }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? "").trim();
  if (!apiKey || apiKey.length < 10) {
    return NextResponse.json(
      { error: `Clé ${adapter.label} invalide (trop courte)` },
      { status: 400 }
    );
  }

  const ping = await adapter.ping(apiKey);
  if (!ping.ok) {
    return NextResponse.json(
      {
        error: `La clé ${adapter.label} n'est pas acceptée par l'API`,
        detail: ping.error,
        status: ping.status,
      },
      { status: 400 }
    );
  }

  let encrypted;
  try {
    encrypted = encryptApiKey(apiKey);
  } catch (e) {
    return NextResponse.json(
      { error: "Chiffrement impossible", detail: (e as Error).message },
      { status: 500 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("client_external_api_keys")
    .upsert(
      {
        client_id: session.user.id,
        provider: providerId,
        label: body.label ?? `Ma clé ${adapter.label}`,
        key_encrypted: encrypted.ciphertext,
        key_iv: encrypted.iv,
        key_tag: encrypted.tag,
        key_preview: encrypted.preview,
        last_error: null,
      },
      { onConflict: "client_id,provider" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, provider: providerId, preview: encrypted.preview });
}

/**
 * DELETE : supprime la clé pour un provider donné.
 * `?provider=<id>` ou fallback fathom.
 */
export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const providerId = parseProvider(url.searchParams.get("provider")) ?? "fathom";

  const admin = createAdminClient();
  const { error } = await admin
    .from("client_external_api_keys")
    .delete()
    .eq("client_id", session.user.id)
    .eq("provider", providerId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, provider: providerId });
}
