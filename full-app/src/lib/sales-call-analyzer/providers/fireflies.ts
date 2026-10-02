/**
 * Adapter Fireflies.ai (GraphQL).
 * Endpoint unique : POST https://api.fireflies.ai/graphql
 * Auth : Authorization: Bearer <api_key>
 * IDs natifs retournés directement par les queries.
 */

import {
  formatLines,
  ProviderError,
  secondsToHHMMSS,
  type FormattedTranscript,
  type ProviderAdapter,
  type ProviderPingResult,
  type TranscriptLine,
} from "./types";

const ENDPOINT = "https://api.fireflies.ai/graphql";

interface GraphQLResp<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new ProviderError("fireflies", res.status, await res.text());
  }
  const json = (await res.json()) as GraphQLResp<T>;
  if (json.errors && json.errors.length) {
    throw new ProviderError("fireflies", null, json.errors.map((e) => e.message).join(" | "));
  }
  if (!json.data) {
    throw new ProviderError("fireflies", null, "GraphQL response sans data");
  }
  return json.data;
}

function extractFirefliesId(urlOrId: string): string | null {
  const t = urlOrId.trim();
  // app.fireflies.ai/view/<id> ou /transcript/<id>
  const m = t.match(/fireflies\.ai\/(?:view|transcript|share)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  // ID brut (alphanumérique sans slash)
  if (/^[A-Za-z0-9_-]{6,}$/.test(t)) return t;
  return null;
}

export const firefliesAdapter: ProviderAdapter = {
  id: "fireflies",
  label: "Fireflies.ai",
  keyPlaceholder: "Bearer key (Fireflies Settings → Developer Settings)",
  keyDocsUrl: "https://app.fireflies.ai/settings/developer",
  meetingUrlPlaceholder: "https://app.fireflies.ai/view/AbCdEf123 ou l'ID brut",

  async ping(apiKey): Promise<ProviderPingResult> {
    try {
      // Petite query peu coûteuse : récupère 1 transcript récent
      const query = `query Ping { transcripts(limit: 1) { id title } }`;
      await gql(apiKey, query);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof ProviderError ? `${e.status ?? ""} ${e.message}` : (e as Error).message;
      return { ok: false, error: msg.slice(0, 200) };
    }
  },

  async resolveMeeting(apiKey, urlOrId) {
    const id = extractFirefliesId(urlOrId);
    if (!id) return null;

    // Récupère juste les métadonnées (pas les sentences pour ce check rapide)
    const query = `
      query GetMeta($id: String!) {
        transcript(id: $id) {
          id
          title
          date
          duration
          meeting_link
        }
      }
    `;
    try {
      const data = await gql<{
        transcript: {
          id: string;
          title?: string | null;
          date?: string | number | null;
          duration?: number | null;
          meeting_link?: string | null;
        } | null;
      }>(apiKey, query, { id });
      if (!data.transcript) return null;
      const t = data.transcript;
      const createdAt = typeof t.date === "number" ? new Date(t.date).toISOString() : t.date ?? null;
      return {
        meeting: {
          recordingId: t.id,
          title: t.title ?? null,
          createdAt,
          durationSeconds: t.duration ?? null,
          externalUrl: t.meeting_link ?? `https://app.fireflies.ai/view/${t.id}`,
        },
      };
    } catch (e) {
      // ID invalide / 404 GraphQL = null
      if (e instanceof ProviderError && e.message.toLowerCase().includes("not found")) {
        return null;
      }
      throw e;
    }
  },

  async getTranscript(apiKey, recordingId): Promise<FormattedTranscript> {
    const query = `
      query GetTranscript($id: String!) {
        transcript(id: $id) {
          id
          title
          sentences {
            speaker_name
            text
            start_time
          }
        }
      }
    `;
    const data = await gql<{
      transcript: {
        id: string;
        title?: string | null;
        sentences?: Array<{
          speaker_name?: string | null;
          text: string;
          start_time?: number | null;
        }> | null;
      } | null;
    }>(apiKey, query, { id: recordingId });

    if (!data.transcript) {
      throw new ProviderError("fireflies", 404, "Transcript introuvable");
    }
    const lines: TranscriptLine[] = (data.transcript.sentences ?? []).map((s) => ({
      speaker: s.speaker_name ?? "Speaker",
      text: s.text,
      timestamp: secondsToHHMMSS(s.start_time ?? null),
    }));
    return { formatted: formatLines(lines), raw: data };
  },
};
