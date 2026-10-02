/**
 * Endpoint webhook public — POST /api/integrations/webhook/[token]
 *
 * URL exposable à n'importe quel outil externe (Cal.com, Typeform, Zapier, n8n…).
 * Authentifie via le `[token]` dans l'URL (full API key = lf_live_xxx).
 *
 * Réponses :
 *   200 { status: 'accepted'|'duplicate', lead_id? }  → toujours, même duplicate
 *   400 { error }                                     → payload sans champs lead reconnus
 *   401 { error }                                     → token invalide ou révoqué
 *   429 { error }                                     → rate limit
 *   500 { error }                                     → erreur DB
 *
 * Pour Cal.com / Typeform, les retries sur 5xx sont gérés côté provider.
 * On retourne 200 sur duplicate pour ÉVITER les retries en boucle.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ingestWebhook } from "@/lib/integrations/ingest";
import type { LeadSource } from "@/lib/integrations/mappers";

export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB
const VALID_PROVIDERS: LeadSource[] = [
  "calcom",
  "typeform",
  "zapier",
  "n8n",
  "make",
  "webhook",
  "other",
];

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}

function headersToObject(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = params.token;

  // ── 1. Read raw body (max 100KB) ────────────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (rawBody.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  if (!rawBody.trim()) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  // ── 2. Parse JSON ───────────────────────────────────────────────────────
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 3. Provider override via query string ──────────────────────────────
  const url = new URL(req.url);
  const providerParam = url.searchParams.get("provider")?.toLowerCase() ?? null;
  const providerOverride =
    providerParam && (VALID_PROVIDERS as string[]).includes(providerParam)
      ? (providerParam as LeadSource)
      : undefined;

  // ── 4. Dispatch to ingest ──────────────────────────────────────────────
  const result = await ingestWebhook({
    token,
    rawBody,
    parsedBody,
    headers: headersToObject(req),
    ip: clientIp(req),
    providerOverride,
  });

  return NextResponse.json(
    {
      status: result.status,
      ...(result.lead_id && { lead_id: result.lead_id }),
      ...(result.error && { error: result.error }),
    },
    { status: result.http_status }
  );
}

// GET handler pour permettre aux outils de tester la URL (ping)
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  // On ne révèle PAS si le token est valide ou non — réponse uniforme
  return NextResponse.json({
    status: "ok",
    message: "LeadFactory webhook endpoint. POST your JSON payload to this URL.",
    token_prefix: params.token.slice(0, 12) + "...",
  });
}
