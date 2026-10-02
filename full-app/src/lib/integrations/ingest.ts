/**
 * Orchestration de l'ingestion d'un webhook entrant (API-key / Make / Zapier…).
 *
 * Flow :
 *   1. verifyApiKey → trouve le client
 *   2. (rate-limit) — limite naïve in-DB par api_key_id, 60 req/min
 *   3. mapPayload → extrait les champs lead
 *   4. dédup par (api_key_id, payload_hash) ou (api_key_id, external_id)
 *   5. finalizeLead → INSERT leads + INSERT integration_webhook_logs + notif (tronc commun)
 */

import { createAdminClient } from "@/lib/supabase-server";
import { verifyApiKey, type ApiKeyRecord } from "./api-key";
import {
  mapPayload,
  isValidEmail,
  type LeadSource,
  type MappedLead,
} from "./mappers";
import { sha256, logWebhookEvent, finalizeLead } from "./lead-writer";

export interface IngestInput {
  token: string;
  rawBody: string;
  parsedBody: unknown;
  headers: Record<string, string>;
  ip?: string | null;
  providerOverride?: LeadSource;
}

export interface IngestResult {
  status: "accepted" | "duplicate" | "rejected" | "error";
  http_status: number;
  lead_id?: string;
  error?: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60; // 60 req/min/clé

async function checkRateLimit(
  admin: ReturnType<typeof createAdminClient>,
  apiKeyId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("integration_webhook_logs")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("created_at", cutoff);

  return (count ?? 0) < RATE_LIMIT_MAX;
}

export async function ingestWebhook(input: IngestInput): Promise<IngestResult> {
  const admin = createAdminClient();
  const payloadHash = sha256(input.rawBody);

  // ── 1. Verify API key ──────────────────────────────────────────────────────
  let key: ApiKeyRecord | null = null;
  try {
    key = await verifyApiKey(admin, input.token);
  } catch (e) {
    console.error("[ingest] verifyApiKey error:", e);
  }

  if (!key) {
    // 401 mais on log pour pouvoir détecter scan/brute force
    await logWebhookEvent(admin, {
      client_id: null,
      api_key_id: null,
      provider: null,
      external_id: null,
      payload_hash: payloadHash,
      status: "rejected",
      http_status: 401,
      error: "Invalid or revoked API key",
      ip: input.ip,
      parsed_body: input.parsedBody,
    });
    return { status: "rejected", http_status: 401, error: "Invalid token" };
  }

  // ── 2. Rate limit ──────────────────────────────────────────────────────────
  const allowed = await checkRateLimit(admin, key.id);
  if (!allowed) {
    await logWebhookEvent(admin, {
      client_id: key.client_id,
      api_key_id: key.id,
      provider: key.provider,
      external_id: null,
      payload_hash: payloadHash,
      status: "rejected",
      http_status: 429,
      error: "Rate limit exceeded (60 req/min)",
      ip: input.ip,
      parsed_body: input.parsedBody,
    });
    return { status: "rejected", http_status: 429, error: "Rate limit exceeded" };
  }

  // ── 3. Map payload ─────────────────────────────────────────────────────────
  const mapped: MappedLead = mapPayload(
    { headers: input.headers, body: input.parsedBody },
    input.providerOverride
  );

  // Validation minimale : on exige au moins email OU phone OU full_name
  if (!mapped.email && !mapped.phone && !mapped.full_name) {
    await logWebhookEvent(admin, {
      client_id: key.client_id,
      api_key_id: key.id,
      provider: mapped.source,
      external_id: mapped.external_id,
      payload_hash: payloadHash,
      status: "rejected",
      http_status: 400,
      error: "Payload contains no recognizable lead fields (email, phone, name)",
      ip: input.ip,
      parsed_body: input.parsedBody,
    });
    return {
      status: "rejected",
      http_status: 400,
      error: "No lead fields found in payload",
    };
  }

  if (mapped.email && !isValidEmail(mapped.email)) {
    mapped.email = null; // soft : on accepte le lead sans email
  }

  // ── 4. Dédup ───────────────────────────────────────────────────────────────
  // Check par payload_hash (dédup naturelle pour retries identiques)
  const { data: existingByHash } = await admin
    .from("integration_webhook_logs")
    .select("id, lead_id")
    .eq("api_key_id", key.id)
    .eq("payload_hash", payloadHash)
    .maybeSingle();

  if (existingByHash) {
    await logWebhookEvent(admin, {
      client_id: key.client_id,
      api_key_id: key.id,
      provider: mapped.source,
      external_id: mapped.external_id,
      payload_hash: payloadHash,
      status: "duplicate",
      http_status: 200,
      lead_id: existingByHash.lead_id ?? undefined,
      ip: input.ip,
      parsed_body: input.parsedBody,
    });
    return {
      status: "duplicate",
      http_status: 200,
      lead_id: existingByHash.lead_id ?? undefined,
    };
  }

  // Check par external_id (Cal.com booking uid, Typeform event_id)
  if (mapped.external_id) {
    const { data: existingLead } = await admin
      .from("leads")
      .select("id")
      .eq("client_id", key.client_id)
      .eq("integration_api_key_id", key.id)
      .eq("external_id", mapped.external_id)
      .maybeSingle();

    if (existingLead) {
      await logWebhookEvent(admin, {
        client_id: key.client_id,
        api_key_id: key.id,
        provider: mapped.source,
        external_id: mapped.external_id,
        payload_hash: payloadHash,
        status: "duplicate",
        http_status: 200,
        lead_id: existingLead.id,
        ip: input.ip,
        parsed_body: input.parsedBody,
      });
      return { status: "duplicate", http_status: 200, lead_id: existingLead.id };
    }
  }

  // ── 5. Insert lead + log + notif (tronc commun) ─────────────────────────────
  const result = await finalizeLead(admin, {
    clientId: key.client_id,
    source: mapped.source,
    contact: {
      full_name: mapped.full_name,
      email: mapped.email,
      phone: mapped.phone,
      company: mapped.company,
    },
    columns: {
      field_data: mapped.field_data,
      external_id: mapped.external_id,
      integration_api_key_id: key.id,
    },
    log: {
      provider: mapped.source,
      external_id: mapped.external_id,
      payload_hash: payloadHash,
      api_key_id: key.id,
      ip: input.ip,
      parsed_body: input.parsedBody,
    },
  });

  return result;
}
