import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenclawRequestBody {
  userMessage: string;
  conversationId: string;
  leadId?: string;
  context?: {
    campaignName?: string;
    clientName?: string;
    metaSummary?: string;
  };
}

interface WebhookPayload {
  conversationId: string;
  leadId: string;
  userMessage: string;
  context: {
    source: string;
    adminId: string;
    campaignName?: string;
    clientName?: string;
    metaSummary?: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEBHOOK_URL =
  "https://example.invalid";
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000, 2000] as const;

// ─── Helper: send with retry ──────────────────────────────────────────────────

async function sendWithRetry(
  url: string,
  rawBody: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, BACKOFF_MS[attempt - 1])
      );
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
    });

    lastStatus = res.status;
    console.log("[openclaw] Webhook response status:", lastStatus, `(attempt ${attempt + 1}/${MAX_ATTEMPTS})`);

    if (res.ok) {
      // 2xx — parse body and return
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      return { ok: true, status: lastStatus, body };
    }

    // Only retry on 5xx
    if (res.status < 500) {
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      return { ok: false, status: lastStatus, body };
    }
  }

  return { ok: false, status: lastStatus, body: null };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // ── 1. Auth — session check ───────────────────────────────────────────────
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // ── 2. Auth — admin role check ────────────────────────────────────────────
  const adminSupabase = createAdminClient();

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  // ── 3. HMAC secret check ──────────────────────────────────────────────────
  const secret = process.env.WEBHOOK_SECRET_META_LEADS;
  if (!secret) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET_META_LEADS non configuré" },
      { status: 500 }
    );
  }

  // ── 4. Parse request body ─────────────────────────────────────────────────
  let requestBody: OpenclawRequestBody;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const { userMessage, conversationId, leadId, context } = requestBody;

  if (!userMessage || !conversationId) {
    return NextResponse.json(
      { error: "userMessage et conversationId sont requis" },
      { status: 400 }
    );
  }

  // ── 5. Build webhook payload ──────────────────────────────────────────────
  const payload: WebhookPayload = {
    conversationId,
    leadId: leadId ?? "",
    userMessage,
    context: {
      source: "meta_lead_form",
      adminId: session.user.id,
      ...(context?.campaignName !== undefined && { campaignName: context.campaignName }),
      ...(context?.clientName !== undefined && { clientName: context.clientName }),
      ...(context?.metaSummary !== undefined && { metaSummary: context.metaSummary }),
    },
  };

  // ── 6. Build HMAC signature ───────────────────────────────────────────────
  const timestamp = ((Date.now() / 1000) | 0).toString();
  const nonce = randomUUID();
  const rawBody = JSON.stringify(payload);
  const canonicalString = `${timestamp}.${nonce}.${rawBody}`;

  const signature = createHmac("sha256", secret)
    .update(canonicalString)
    .digest("hex");

  console.log(
    "[openclaw] Sending to webhook, ts:",
    timestamp,
    "nonce:",
    nonce.slice(0, 8) + "..."
  );

  // ── 7. Send with retry ────────────────────────────────────────────────────
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-webhook-signature": signature,
    "x-webhook-timestamp": timestamp,
    "x-webhook-nonce": nonce,
  };

  const result = await sendWithRetry(WEBHOOK_URL, rawBody, headers);

  // ── 8. Return response ────────────────────────────────────────────────────
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      status: result.status,
      data: result.body,
    });
  }

  return NextResponse.json(
    { error: "Webhook error", status: result.status },
    { status: 502 }
  );
}
