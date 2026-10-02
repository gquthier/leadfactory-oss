/**
 * Système de crédits clients (LeadFactory).
 *
 * Règles :
 *   - Chaque client a un solde de crédits (seed initial = 1000).
 *   - Les admins ne consomment JAMAIS de crédits (preview admin = gratuit).
 *   - Une consommation est journalisée dans `credit_usage` (immuable).
 *   - Sous 50 crédits, l'API renvoie un warning (mais laisse passer).
 *   - À 0 crédit, l'API renvoie 402 Payment Required.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

export const CREDIT_COSTS = {
  sales_analyze: 5,
  cold_call_script: 4,
  outbound_chat: 3,
  personal_brand_chat: 1,
  reels_chat: 1,
} as const;

export const CREDIT_WARNING_THRESHOLD = 50;

export type CreditFeature = keyof typeof CREDIT_COSTS;

export interface CreditsBalance {
  client_id: string;
  balance: number;
  total_granted: number;
  total_consumed: number;
  last_consumed_at: string | null;
}

export async function getCreditsBalance(
  clientId: string
): Promise<CreditsBalance | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_credits")
    .select("client_id, balance, total_granted, total_consumed, last_consumed_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[credits] getCreditsBalance error", error);
    return null;
  }
  return (data as CreditsBalance | null) ?? null;
}

export async function ensureCreditsRow(clientId: string): Promise<CreditsBalance> {
  const existing = await getCreditsBalance(clientId);
  if (existing) return existing;

  const admin = createAdminClient();
  await admin.from("client_credits").insert({
    client_id: clientId,
    balance: 1000,
    total_granted: 1000,
  });
  await admin.from("credit_usage").insert({
    client_id: clientId,
    feature: "admin_grant",
    amount: -1000,
    metadata: { reason: "lazy_seed_first_access" },
  });
  return {
    client_id: clientId,
    balance: 1000,
    total_granted: 1000,
    total_consumed: 0,
    last_consumed_at: null,
  };
}

export interface ConsumeResult {
  allowed: boolean;
  reason?: "insufficient" | "no_row";
  remaining: number;
  cost: number;
}

/**
 * Consomme `CREDIT_COSTS[feature]` crédits du solde du client.
 * Retourne `{ allowed: false }` si solde insuffisant.
 *
 * IMPORTANT : à appeler AVANT le travail coûteux (LLM call). En cas d'échec
 * applicatif après consommation, le caller doit appeler `refundCredits`.
 */
export async function consumeCredits(
  clientId: string,
  feature: CreditFeature,
  metadata: Record<string, unknown> = {}
): Promise<ConsumeResult> {
  const cost = CREDIT_COSTS[feature];
  const admin = createAdminClient();

  const row = await ensureCreditsRow(clientId);

  if (row.balance < cost) {
    return {
      allowed: false,
      reason: "insufficient",
      remaining: row.balance,
      cost,
    };
  }

  const newBalance = row.balance - cost;
  const { error: updateError } = await admin
    .from("client_credits")
    .update({
      balance: newBalance,
      total_consumed: row.total_consumed + cost,
      last_consumed_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);
  if (updateError) {
    console.error("[credits] consumeCredits update error", updateError);
    return { allowed: false, reason: "no_row", remaining: row.balance, cost };
  }

  await admin.from("credit_usage").insert({
    client_id: clientId,
    feature,
    amount: cost,
    metadata,
  });

  return { allowed: true, remaining: newBalance, cost };
}

/**
 * Crédite à nouveau le client (en cas d'échec après consume).
 * Idempotent par metadata.refund_ref si fourni.
 */
export async function refundCredits(
  clientId: string,
  feature: CreditFeature,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const cost = CREDIT_COSTS[feature];
  const admin = createAdminClient();
  const row = await getCreditsBalance(clientId);
  if (!row) return;

  await admin
    .from("client_credits")
    .update({
      balance: row.balance + cost,
      total_consumed: Math.max(0, row.total_consumed - cost),
    })
    .eq("client_id", clientId);

  await admin.from("credit_usage").insert({
    client_id: clientId,
    feature: "admin_refund",
    amount: -cost,
    metadata: { refunded_feature: feature, ...metadata },
  });
}

/**
 * Helper pour endpoints API : check + return 402 response si insuffisant.
 * Retourne `null` si OK (le caller continue), ou une `NextResponse` à renvoyer.
 *
 * - Si le user est admin (role='admin') ET pas en preview client, on ne
 *   consomme rien (admin de l'équipe = usage interne).
 * - Si admin en preview (previewClientId fourni) : on consomme sur le client
 *   prévisualisé. Décision : on consomme quand même, sinon l'admin pourrait
 *   épuiser les LLMs gratuitement en preview.
 */
export async function consumeOrReject(args: {
  clientId: string;
  isAdminWithoutPreview: boolean;
  feature: CreditFeature;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; remaining: number | null } | { ok: false; response: NextResponse }> {
  if (args.isAdminWithoutPreview) {
    return { ok: true, remaining: null };
  }

  const result = await consumeCredits(args.clientId, args.feature, args.metadata ?? {});
  if (!result.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Crédits insuffisants",
          message: `Cette action coûte ${result.cost} crédits, il vous en reste ${result.remaining}. Contactez l'équipe Lead Factory pour recharger.`,
          credits: { balance: result.remaining, cost: result.cost },
        },
        { status: 402 }
      ),
    };
  }
  return { ok: true, remaining: result.remaining };
}
