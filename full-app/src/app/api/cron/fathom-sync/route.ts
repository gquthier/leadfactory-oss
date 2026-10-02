import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import {
  listFathomMeetings,
  formatTranscript,
  meetingDate,
  meetingTitle,
  FathomApiError,
  type FathomMeeting,
} from "@/lib/fathom-sync/list-meetings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Fenêtre de scan : on relit les N derniers jours à chaque passage. La dédup
// (index unique client_id + fathom_recording_id) rend les re-scans idempotents,
// donc un overlap large ne crée pas de doublons et rattrape les meetings tardifs.
const LOOKBACK_DAYS = 3;

/**
 * Clés API Fathom à scanner. Plusieurs comptes possibles (Thomas + Responsable),
 * séparés par virgule dans FATHOM_API_KEYS. Fallback sur FATHOM_API_KEY (mono-compte).
 * NB : un secret webhook `whsec_...` n'est PAS une clé API et est ignoré ici.
 */
function loadFathomKeys(): string[] {
  const multi = process.env.FATHOM_API_KEYS;
  const single = process.env.FATHOM_API_KEY;
  const raw = (multi || single || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  // Garde-fou : on écarte tout ce qui ressemble à un webhook secret.
  return raw.filter((k) => !k.startsWith("whsec_"));
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKeys = loadFathomKeys();
  if (apiKeys.length === 0) {
    return NextResponse.json(
      { error: "Aucune clé Fathom configurée (FATHOM_API_KEYS ou FATHOM_API_KEY)" },
      { status: 500 },
    );
  }

  const admin = createAdminClient();

  // ─── Index email → client_id (clients uniquement) ───────────────
  const { data: clients, error: clientsErr } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "client");

  if (clientsErr) {
    console.error("[fathom-sync] profiles error:", clientsErr);
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  const emailToClient = new Map<string, string>();
  for (const c of clients ?? []) {
    if (c.email) emailToClient.set(c.email.trim().toLowerCase(), c.id);
  }

  const createdAfter = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let scanned = 0;
  let matched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ─── Scan de chaque compte Fathom ───────────────────────────────
  for (const apiKey of apiKeys) {
    let meetings: FathomMeeting[] = [];
    try {
      meetings = await listFathomMeetings(apiKey, { createdAfter });
    } catch (err) {
      const msg =
        err instanceof FathomApiError
          ? `Fathom ${err.status} (clé …${apiKey.slice(-4)})`
          : err instanceof Error
            ? err.message
            : "unknown error";
      console.error("[fathom-sync] list error:", msg);
      errors.push(msg);
      continue; // une clé en échec ne bloque pas les autres
    }

    for (const m of meetings) {
      scanned++;

      // Clients distincts invités à ce meeting (match email exact).
      const clientIds = new Set<string>();
      for (const inv of m.calendar_invitees ?? []) {
        const email = inv.email?.trim().toLowerCase();
        if (!email) continue;
        const cid = emailToClient.get(email);
        if (cid) clientIds.add(cid);
      }

      if (clientIds.size === 0) {
        skipped++; // no-match → on ignore le meeting
        continue;
      }

      const recordingId = String(m.recording_id);
      const transcript = formatTranscript(m.transcript);
      const title = meetingTitle(m);
      const date = meetingDate(m);
      const externalUrl = m.share_url ?? m.url ?? null;

      // Multi-match → une ligne par client. Dédup explicite par SELECT puis
      // UPDATE/INSERT : PostgREST ne sait pas cibler l'index unique PARTIEL via
      // onConflict (la clause WHERE de l'index n'est pas répétée), donc on évite
      // ON CONFLICT. L'idempotence repose sur le SELECT (client_id + recording_id) ;
      // l'index unique partiel reste un garde-fou côté base.
      const row = {
        title,
        transcript: transcript || null,
        external_url: externalUrl,
        meeting_date: date,
        source: "fathom",
      };

      for (const clientId of Array.from(clientIds)) {
        matched++;

        // INSERT-first, fallback UPDATE : on tente l'insert ; si la contrainte
        // unique (uq_client_calls_fathom) le rejette (code 23505), la ligne existe
        // déjà → on bascule sur un UPDATE ciblé. Insensible aux problèmes de
        // visibilité d'un SELECT préalable, et idempotent par construction.
        const { error: insErr } = await admin
          .from("client_calls")
          .insert({ client_id: clientId, fathom_recording_id: recordingId, ...row });

        if (!insErr) {
          inserted++;
          continue;
        }

        // 23505 = unique_violation Postgres → la ligne existe, on met à jour.
        if (insErr.code === "23505") {
          const { error: updErr } = await admin
            .from("client_calls")
            .update(row)
            .eq("client_id", clientId)
            .eq("fathom_recording_id", recordingId);
          if (updErr) {
            console.error("[fathom-sync] update error:", updErr.message);
            errors.push(updErr.message);
          } else {
            updated++;
          }
        } else {
          console.error("[fathom-sync] insert error:", insErr.message);
          errors.push(insErr.message);
        }
      }
    }
  }

  console.log(
    `[fathom-sync] keys=${apiKeys.length} scanned=${scanned} matched=${matched} inserted=${inserted} updated=${updated} skipped=${skipped} errors=${errors.length}`,
  );

  return NextResponse.json({
    keys: apiKeys.length,
    scanned,
    matched,
    inserted,
    updated,
    skipped,
    errors: errors.slice(0, 10),
  });
}
