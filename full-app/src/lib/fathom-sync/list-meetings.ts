/**
 * Helper de listing Fathom pour la synchro automatique des meetings clients.
 *
 * Distinct de l'adapter `sales-call-analyzer/providers/fathom.ts` (qui résout
 * UN meeting depuis une URL collée par un client). Ici on LISTE les meetings
 * récents enregistrés par le compte propriétaire de la clé (Thomas) pour les
 * rattacher aux clients par email d'invité.
 *
 * API : GET https://api.fathom.ai/external/v1/meetings
 * Auth : header X-Api-Key
 * Doc  : https://developers.fathom.ai/api-reference/meetings/list-meetings
 */

const BASE = "https://api.fathom.ai/external/v1";

/** Un invité du calendrier tel que retourné par Fathom. */
export interface FathomInvitee {
  name: string | null;
  email: string | null;
  email_domain: string | null;
  is_external: boolean;
}

/** Une ligne de transcript Fathom. */
export interface FathomTranscriptLine {
  speaker: { display_name: string; matched_calendar_invitee_email?: string | null };
  text: string;
  timestamp?: string;
}

/** Un meeting tel que retourné par /meetings (sous-ensemble exploité ici). */
export interface FathomMeeting {
  recording_id: number;
  title?: string | null;
  meeting_title?: string | null;
  share_url?: string | null;
  url?: string | null;
  created_at?: string | null;
  recording_start_time?: string | null;
  calendar_invitees?: FathomInvitee[];
  transcript?: FathomTranscriptLine[];
}

interface FathomListResponse {
  items?: FathomMeeting[];
  // Tolérance : certaines réponses historiques utilisaient `meetings`.
  meetings?: FathomMeeting[];
  next_cursor?: string | null;
  limit?: number | null;
}

export class FathomApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Fathom API ${status}: ${body.slice(0, 200)}`);
    this.name = "FathomApiError";
  }
}

/**
 * Récupère tous les meetings créés après `createdAfter` (ISO 8601), transcript inclus.
 * Pagine via next_cursor. Borné par `maxPages` pour éviter une boucle runaway.
 */
export async function listFathomMeetings(
  apiKey: string,
  opts: { createdAfter: string; maxPages?: number },
): Promise<FathomMeeting[]> {
  const maxPages = opts.maxPages ?? 20;
  const out: FathomMeeting[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      created_after: opts.createdAfter,
      include_transcript: "true",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${BASE}/meetings?${params.toString()}`, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new FathomApiError(res.status, await res.text());
    }

    const data = (await res.json()) as FathomListResponse;
    const items = data.items ?? data.meetings ?? [];
    out.push(...items);

    if (!data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return out;
}

/** Formate un transcript Fathom en texte lisible "Speaker : texte" ligne par ligne. */
export function formatTranscript(lines: FathomTranscriptLine[] | undefined): string {
  if (!lines || lines.length === 0) return "";
  return lines
    .map((l) => {
      const who = l.speaker?.display_name?.trim() || "Speaker";
      const ts = l.timestamp ? `[${l.timestamp}] ` : "";
      return `${ts}${who} : ${l.text}`;
    })
    .join("\n");
}

/** Date "métier" du meeting : recording_start_time si dispo, sinon created_at. */
export function meetingDate(m: FathomMeeting): string | null {
  return m.recording_start_time ?? m.created_at ?? null;
}

/** Titre affichable du meeting. */
export function meetingTitle(m: FathomMeeting): string {
  return (m.meeting_title || m.title || "Meeting Fathom").trim();
}
