/**
 * Webhook natif Meta Lead Ads — endpoint UNIQUE pour TOUS les clients.
 *
 *   GET  = handshake de vérification (configuration du webhook dans le dashboard
 *          ou via POST /{app_id}/subscriptions) → renvoie hub.challenge brut.
 *   POST = réception des events `leadgen`. Vérifie X-Hub-Signature-256 (HMAC SHA256
 *          App Secret, comparaison timing-safe) sur le RAW body, puis pour chaque
 *          lead : page_id → client, lit le lead (Page/System token), insère.
 *
 * Le chemin Meta natif répond 200 après authentification. Le relais BizOS est
 * en plus rejeté si sa Page n'est pas explicitement autorisée.
 */

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { decryptToken } from "@/lib/linkedin/encryption";
import { getSingleLead, parseLeadFields } from "@/lib/meta-leads";
import { sha256, logWebhookEvent, finalizeLead } from "@/lib/integrations/lead-writer";
import {
  isAllowlistedBizosRelayPayload,
  verifyHmacSha256,
} from "@/lib/integrations/bizos-relay-auth";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // crypto + raw body

const PROVIDER = "meta";

// ── GET : handshake de vérification ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

// ── Signature HMAC sur le RAW body ───────────────────────────────────────────
function verifyMetaSignature(raw: string, header: string | null): boolean {
  return verifyHmacSha256(raw, header, process.env.FB_APP_SECRET);
}

interface LeadgenValue {
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  created_time?: number;
}

// ── POST : réception des events leadgen ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const raw = await req.text(); // RAW body obligatoire pour le HMAC

  const metaSignatureValid = verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"));
  const bizosRelaySignatureValid = verifyHmacSha256(
    raw,
    req.headers.get("x-bizos-relay-signature-256"),
    process.env.BIZOS_RELAY_SECRET,
  );
  if (!metaSignatureValid && !bizosRelaySignatureValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: {
    object?: string;
    entry?: Array<{
      id?: string;
      changes?: Array<{ field?: string; value?: LeadgenValue }>;
    }>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ received: true, note: "unparseable" }, { status: 200 });
  }

  // Only requests authenticated solely through the BizOS relay need this
  // additional tenant boundary. Native Meta delivery remains unchanged.
  if (
    !metaSignatureValid &&
    bizosRelaySignatureValid &&
    !isAllowlistedBizosRelayPayload(body, process.env.BIZOS_RELAY_PAGE_IDS)
  ) {
    return new Response("Relay Page not allowed", { status: 403 });
  }

  if (body.object === "page") {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen" || !change.value) continue;
        // await (et non fire-and-forget) : sur serverless le travail post-réponse
        // n'est pas garanti. 1 lead ≈ <1s, bien sous le timeout Meta.
        try {
          await handleLeadgen(change.value);
        } catch (e) {
          console.error("[webhooks/meta] handleLeadgen error:", e);
        }
      }
    }
  }

  // Toujours 200 (même sur lead non-mappé / erreur partielle) → pas de retry-storm.
  return Response.json({ received: true }, { status: 200 });
}

type Admin = ReturnType<typeof createAdminClient>;

/** Résout page_id → { clientId, readToken } via meta_connections (fallback campaigns). */
async function resolvePage(
  admin: Admin,
  pageId: string
): Promise<{ clientId: string; readToken: string } | null> {
  const systemToken = process.env.META_ACCESS_TOKEN ?? "";

  const { data: conn } = await admin
    .from("meta_connections")
    .select("client_id, page_token_encrypted, page_token_iv, page_token_tag")
    .eq("page_id", pageId)
    .maybeSingle();

  if (conn?.client_id) {
    let readToken = systemToken;
    if (conn.page_token_encrypted && conn.page_token_iv && conn.page_token_tag) {
      try {
        readToken = decryptToken({
          encrypted: conn.page_token_encrypted,
          iv: conn.page_token_iv,
          tag: conn.page_token_tag,
        });
      } catch (e) {
        console.error("[webhooks/meta] page token decrypt failed, fallback system token:", e);
      }
    }
    return { clientId: conn.client_id, readToken };
  }

  // Fallback : campagne liée à cette page (ancienne manière)
  const { data: campaign } = await admin
    .from("campaigns")
    .select("client_id")
    .eq("facebook_page_id", pageId)
    .not("client_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (campaign?.client_id) {
    return { clientId: campaign.client_id, readToken: systemToken };
  }

  return null;
}

async function handleLeadgen(value: LeadgenValue): Promise<void> {
  const admin = createAdminClient();
  const leadgenId = value.leadgen_id;
  const pageId = value.page_id;
  const payloadHash = sha256(JSON.stringify(value));

  if (!leadgenId || !pageId) {
    await logWebhookEvent(admin, {
      client_id: null,
      provider: PROVIDER,
      external_id: leadgenId ?? null,
      payload_hash: payloadHash,
      status: "rejected",
      http_status: 200,
      error: "Missing leadgen_id or page_id",
      parsed_body: value,
    });
    return;
  }

  // page_id → client + token de lecture
  const mapping = await resolvePage(admin, pageId);
  if (!mapping) {
    await logWebhookEvent(admin, {
      client_id: null,
      provider: PROVIDER,
      external_id: leadgenId,
      payload_hash: payloadHash,
      status: "rejected",
      http_status: 200,
      error: `Unmapped page ${pageId} (no meta_connections / campaigns mapping)`,
      parsed_body: value,
    });
    void notifyAdminUnmappedPage(pageId, leadgenId);
    return;
  }

  // Dédup naturelle : leads.meta_lead_id est UNIQUE
  const { data: existing } = await admin
    .from("leads")
    .select("id")
    .eq("meta_lead_id", leadgenId)
    .maybeSingle();

  if (existing) {
    await logWebhookEvent(admin, {
      client_id: mapping.clientId,
      provider: PROVIDER,
      external_id: leadgenId,
      payload_hash: payloadHash,
      status: "duplicate",
      http_status: 200,
      lead_id: existing.id,
      parsed_body: value,
    });
    return;
  }

  // Lecture du lead (Page Access Token ou System User token)
  const raw = await getSingleLead(leadgenId, mapping.readToken);
  const contact = parseLeadFields(raw.field_data);
  const fieldMap: Record<string, unknown> = {};
  for (const f of raw.field_data) fieldMap[f.name] = f.values?.[0] ?? null;

  await finalizeLead(admin, {
    clientId: mapping.clientId,
    source: "meta_ads",
    contact,
    columns: {
      meta_lead_id: raw.id,
      meta_form_id: raw.form_id || value.form_id || null,
      meta_ad_id: raw.ad_id ?? value.ad_id ?? null,
      meta_created_at: raw.created_time || null,
      field_data: fieldMap,
      external_id: raw.id,
    },
    log: {
      provider: PROVIDER,
      external_id: leadgenId,
      payload_hash: payloadHash,
      parsed_body: value,
    },
  });
}

/** Alerte admin best-effort sur page non mappée (jamais throw). */
async function notifyAdminUnmappedPage(pageId: string, leadgenId: string): Promise<void> {
  try {
    console.warn(`[webhooks/meta] LEAD on UNMAPPED page ${pageId} (leadgen ${leadgenId})`);
    const to = process.env.ADMIN_ALERT_EMAIL;
    if (!to) return;
    await sendEmail({
      to,
      subject: `⚠️ Lead Meta d'une page non liée (${pageId})`,
      html: `<p>Un lead Meta (<code>${leadgenId}</code>) est arrivé d'une Page non mappée : <strong>${pageId}</strong>.</p>
             <p>Lier cette page à un client dans <code>meta_connections</code> (ou via "Connecter Facebook") pour que ses leads soient ingérés.</p>`,
    });
  } catch (e) {
    console.error("[webhooks/meta] admin alert failed:", e);
  }
}
