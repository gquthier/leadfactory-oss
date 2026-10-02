import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { decryptApiKey } from "@/lib/sales-call-analyzer/crypto";
import {
  getProvider,
  PROVIDER_IDS,
  ProviderError,
  type NotetakerProvider,
} from "@/lib/sales-call-analyzer/providers";
import { runAnalyzer } from "@/lib/sales-call-analyzer/run-analyzer";
import { consumeOrReject, refundCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SourceType =
  | "paste"
  | "fathom_url"
  | "fireflies_url"
  | "granola_url"
  | "tldv_url";

interface AnalyzeBody {
  sourceType: SourceType;
  meetingUrl?: string;
  /** Legacy : ancien client envoie fathomUrl à la place de meetingUrl. */
  fathomUrl?: string;
  transcript?: string;
  meetingTitle?: string;
  prospectCompany?: string;
}

const SOURCE_TO_PROVIDER: Record<Exclude<SourceType, "paste">, NotetakerProvider> = {
  fathom_url: "fathom",
  fireflies_url: "fireflies",
  granola_url: "granola",
  tldv_url: "tldv",
};

const ALL_SOURCE_TYPES: SourceType[] = [
  "paste",
  "fathom_url",
  "fireflies_url",
  "granola_url",
  "tldv_url",
];

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  if (!ALL_SOURCE_TYPES.includes(body.sourceType)) {
    return NextResponse.json({ error: "sourceType invalide" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Récupérer le transcript : paste OU via un des providers.
  let transcriptRaw = "";
  let transcriptFormatted = "";
  let meetingTitle = body.meetingTitle ?? null;
  let meetingDate: string | null = null;
  let externalRecordingId: string | null = null;
  let durationMinutes: number | null = null;
  let fathomUrlField: string | null = null;

  if (body.sourceType === "paste") {
    transcriptRaw = (body.transcript ?? "").trim();
    transcriptFormatted = transcriptRaw;
    if (transcriptRaw.length < 200) {
      return NextResponse.json(
        { error: "Transcript trop court (< 200 caractères)" },
        { status: 400 }
      );
    }
  } else {
    const providerId = SOURCE_TO_PROVIDER[body.sourceType];
    const adapter = getProvider(providerId);
    if (!adapter) {
      return NextResponse.json({ error: "Provider inconnu" }, { status: 400 });
    }

    const url = (body.meetingUrl ?? body.fathomUrl ?? "").trim();
    if (!url) {
      return NextResponse.json(
        { error: `URL ${adapter.label} manquante` },
        { status: 400 }
      );
    }

    // Récupérer la clé chiffrée pour ce provider
    const { data: keyRow } = await admin
      .from("client_external_api_keys")
      .select("key_encrypted, key_iv, key_tag")
      .eq("client_id", session.user.id)
      .eq("provider", providerId)
      .maybeSingle();

    if (!keyRow) {
      return NextResponse.json(
        {
          error: `Aucune clé ${adapter.label} configurée — branche-la dans Paramètres > Intégrations.`,
          needsKey: true,
          provider: providerId,
        },
        { status: 400 }
      );
    }

    let apiKey: string;
    try {
      apiKey = decryptApiKey(keyRow);
    } catch (e) {
      return NextResponse.json(
        { error: "Impossible de déchiffrer la clé", detail: (e as Error).message },
        { status: 500 }
      );
    }

    // Lookup meeting
    let resolved;
    try {
      resolved = await adapter.resolveMeeting(apiKey, url);
    } catch (e) {
      const msg =
        e instanceof ProviderError ? `${adapter.label} ${e.status ?? ""}` : (e as Error).message;
      await admin
        .from("client_external_api_keys")
        .update({ last_error: msg })
        .eq("client_id", session.user.id)
        .eq("provider", providerId);
      return NextResponse.json(
        { error: `Erreur ${adapter.label} au lookup : ${msg}` },
        { status: 502 }
      );
    }

    if (!resolved) {
      return NextResponse.json(
        {
          error: `Meeting introuvable dans ton compte ${adapter.label}. Vérifie l'URL ou colle le transcript manuellement.`,
        },
        { status: 404 }
      );
    }

    externalRecordingId = resolved.meeting.recordingId;
    meetingTitle = meetingTitle ?? resolved.meeting.title;
    meetingDate = resolved.meeting.createdAt;
    durationMinutes = resolved.meeting.durationSeconds
      ? Math.round(resolved.meeting.durationSeconds / 60)
      : null;
    fathomUrlField = url; // on garde l'URL d'origine quelle que soit la plateforme

    // Get transcript
    let formatted;
    try {
      formatted = await adapter.getTranscript(apiKey, resolved.meeting.recordingId);
    } catch (e) {
      const msg =
        e instanceof ProviderError ? `${adapter.label} ${e.status ?? ""}` : (e as Error).message;
      return NextResponse.json(
        { error: `Erreur ${adapter.label} au transcript : ${msg}` },
        { status: 502 }
      );
    }

    await admin
      .from("client_external_api_keys")
      .update({ last_used_at: new Date().toISOString(), last_error: null })
      .eq("client_id", session.user.id)
      .eq("provider", providerId);

    transcriptFormatted = formatted.formatted;
    transcriptRaw = JSON.stringify(formatted.raw);
  }

  // 2. Créer la row en status='running'
  const { data: inserted, error: insertErr } = await admin
    .from("sales_call_analyses")
    .insert({
      client_id: session.user.id,
      source_type: body.sourceType,
      fathom_url: fathomUrlField,
      fathom_recording_id: externalRecordingId,
      transcript_raw: transcriptRaw,
      meeting_title: meetingTitle,
      meeting_date: meetingDate,
      duration_minutes: durationMinutes,
      status: "running",
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: `Insert échoué : ${insertErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  // 2b. Crédits (5 par analyse, gratuit pour admins)
  const { data: roleRow } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  const isAdminWithoutPreview = roleRow?.role === "admin";
  const creditCheck = await consumeOrReject({
    clientId: session.user.id,
    isAdminWithoutPreview,
    feature: "sales_analyze",
    metadata: { analysis_id: inserted.id },
  });
  if (!creditCheck.ok) {
    await admin
      .from("sales_call_analyses")
      .update({ status: "failed", error_message: "Crédits insuffisants" })
      .eq("id", inserted.id);
    return creditCheck.response;
  }

  // 3. LLM
  try {
    const result = await runAnalyzer({
      transcript: transcriptFormatted,
      meta: {
        prospectCompany: body.prospectCompany,
        meetingTitle: meetingTitle ?? undefined,
        meetingDate: meetingDate ?? undefined,
      },
    });

    await admin
      .from("sales_call_analyses")
      .update({
        analysis_json: result.analysis,
        model_used: result.modelUsed,
        prompt_tokens: result.promptTokens ?? null,
        completion_tokens: result.completionTokens ?? null,
        status: "completed",
      })
      .eq("id", inserted.id);

    return NextResponse.json({ id: inserted.id, status: "completed" });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await admin
      .from("sales_call_analyses")
      .update({ status: "failed", error_message: msg.slice(0, 1000) })
      .eq("id", inserted.id);

    if (!isAdminWithoutPreview) {
      await refundCredits(session.user.id, "sales_analyze", {
        analysis_id: inserted.id,
        reason: "analyzer_error",
      });
    }

    return NextResponse.json(
      { id: inserted.id, status: "failed", error: msg },
      { status: 500 }
    );
  }
}
