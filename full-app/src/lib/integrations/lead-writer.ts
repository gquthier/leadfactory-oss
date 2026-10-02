/**
 * Tronc commun d'écriture de lead — partagé entre l'ingestion API-key (ingest.ts)
 * et le webhook Meta natif (api/webhooks/meta). Évite la divergence : un seul
 * endroit qui insère le lead, logue l'event et déclenche la notif email.
 *
 * La DÉDUP reste à la charge de l'appelant (mécanismes différents : payload_hash
 * + external_id côté API-key ; meta_lead_id UNIQUE côté Meta).
 */

import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase-server";
import { maybeSendNewLeadEmail } from "@/lib/new-lead-email";
import { maybeForwardLeadToGhlBridge } from "@/lib/integrations/ghl-bridge";

type Admin = ReturnType<typeof createAdminClient>;

export type WebhookStatus = "accepted" | "duplicate" | "rejected" | "error";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Tronque le payload avant stockage JSONB (évite des logs énormes). */
export function truncatePayloadForLog(parsed: unknown): unknown {
  try {
    const str = JSON.stringify(parsed);
    if (str.length <= 32_000) return parsed;
    return { _truncated: true, _original_size: str.length, _preview: str.slice(0, 8_000) };
  } catch {
    return { _unserializable: true };
  }
}

export interface WebhookLogArgs {
  client_id: string | null;
  api_key_id?: string | null;
  provider: string | null;
  external_id: string | null;
  payload_hash: string;
  status: WebhookStatus;
  http_status: number;
  error?: string;
  lead_id?: string;
  ip?: string | null;
  parsed_body: unknown;
}

export async function logWebhookEvent(admin: Admin, args: WebhookLogArgs): Promise<void> {
  try {
    await admin.from("integration_webhook_logs").insert({
      client_id: args.client_id,
      api_key_id: args.api_key_id ?? null,
      provider: args.provider,
      external_id: args.external_id,
      payload_hash: args.payload_hash,
      status: args.status,
      http_status: args.http_status,
      error: args.error ?? null,
      lead_id: args.lead_id ?? null,
      ip: args.ip ?? null,
      raw_payload: truncatePayloadForLog(args.parsed_body),
    });
  } catch (e) {
    console.error("[lead-writer] failed to log webhook event:", e);
  }
}

export interface FinalizeLeadInput {
  clientId: string;
  source: string;
  contact: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
  };
  /** Colonnes additionnelles (field_data, external_id, integration_api_key_id, meta_* …) */
  columns?: Record<string, unknown>;
  log: {
    provider: string | null;
    external_id: string | null;
    payload_hash: string;
    api_key_id?: string | null;
    ip?: string | null;
    parsed_body: unknown;
  };
}

export interface FinalizeResult {
  status: "accepted" | "error";
  http_status: number;
  lead_id?: string;
  error?: string;
}

/**
 * Insert lead → log (accepted/error) → notif email (fire-and-forget).
 * Suppose que l'appelant a déjà fait sa dédup.
 */
export async function finalizeLead(admin: Admin, input: FinalizeLeadInput): Promise<FinalizeResult> {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    full_name: input.contact.full_name,
    email: input.contact.email,
    phone: input.contact.phone,
    company: input.contact.company,
    source: input.source,
    status: "new",
    ...(input.columns ?? {}),
  };

  const { data: lead, error: insertError } = await admin
    .from("leads")
    .insert(row)
    .select("id")
    .single();

  const logBase = {
    client_id: input.clientId,
    api_key_id: input.log.api_key_id ?? null,
    provider: input.log.provider,
    external_id: input.log.external_id,
    payload_hash: input.log.payload_hash,
    ip: input.log.ip,
    parsed_body: input.log.parsed_body,
  };

  if (insertError || !lead) {
    await logWebhookEvent(admin, {
      ...logBase,
      status: "error",
      http_status: 500,
      error: insertError?.message ?? "Insert failed",
    });
    return { status: "error", http_status: 500, error: insertError?.message ?? "Insert failed" };
  }

  await logWebhookEvent(admin, {
    ...logBase,
    status: "accepted",
    http_status: 200,
    lead_id: lead.id,
  });

  // Awaited (not fire-and-forget): on Vercel serverless, post-response work isn't
  // guaranteed — the function can freeze before the SMTP send completes. The webhook
  // already awaits handleLeadgen for the same reason. maybeSendNewLeadEmail never
  // throws (it catches internally), so awaiting is safe and ~1-2s under Meta's timeout.
  await maybeSendNewLeadEmail({
    clientId: input.clientId,
    leadId: lead.id,
    fullName: input.contact.full_name,
    email: input.contact.email,
    phone: input.contact.phone,
    company: input.contact.company,
    source: input.source,
  });

  // Forward best-effort vers le bridge GoHighLevel (clients GHL allow-listés only ;
  // no-op sans env ; ne throw jamais). Awaited pour la même raison serverless que l'email.
  await maybeForwardLeadToGhlBridge({
    clientId: input.clientId,
    leadId: lead.id,
    contact: input.contact,
    source: input.source,
    columns: input.columns,
  });

  return { status: "accepted", http_status: 200, lead_id: lead.id };
}
