/**
 * Adapter Fathom.
 * Base URL : https://api.fathom.ai/external/v1
 * Auth : header X-Api-Key
 * Note : pas d'endpoint slug→recording_id, on scanne /meetings pour matcher.
 */

import {
  formatLines,
  ProviderError,
  type FormattedTranscript,
  type MeetingMeta,
  type ProviderAdapter,
  type ProviderPingResult,
  type TranscriptLine,
} from "./types";

const BASE = "https://api.fathom.ai/external/v1";

interface FathomMeeting {
  recording_id: number;
  url?: string;
  share_url?: string;
  title?: string;
  created_at?: string;
  duration_seconds?: number;
}

interface FathomTranscriptResponse {
  transcript: Array<{
    speaker: { display_name: string };
    text: string;
    timestamp?: string;
  }>;
}

async function call(apiKey: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
    },
  });
}

function extractSlug(url: string): string | null {
  const t = url.trim();
  const m = t.match(/fathom\.video\/(?:share|calls)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  const m2 = t.match(/fathom\.video\/([A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

export const fathomAdapter: ProviderAdapter = {
  id: "fathom",
  label: "Fathom",
  keyPlaceholder: "fathom_xxxxxxxxxxxx",
  keyDocsUrl: "https://fathom.video/api_settings/new",
  meetingUrlPlaceholder: "https://fathom.video/share/abc123…",

  async ping(apiKey): Promise<ProviderPingResult> {
    try {
      const res = await call(apiKey, "/meetings?limit=1");
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async resolveMeeting(apiKey, urlOrId) {
    const slug = extractSlug(urlOrId);
    if (!slug) {
      // Peut-être un recording_id numérique brut
      const asNum = urlOrId.trim();
      if (/^\d+$/.test(asNum)) {
        return {
          meeting: {
            recordingId: asNum,
            title: null,
            createdAt: null,
            durationSeconds: null,
            externalUrl: null,
          },
        };
      }
      return null;
    }

    const MAX_PAGES = 20;
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 180).toISOString();
    let cursor: string | undefined;

    for (let i = 0; i < MAX_PAGES; i++) {
      const params = new URLSearchParams({ created_after: since });
      if (cursor) params.set("cursor", cursor);
      const res = await call(apiKey, `/meetings?${params.toString()}`);
      if (!res.ok) {
        throw new ProviderError("fathom", res.status, await res.text());
      }
      const data = (await res.json()) as {
        meetings?: FathomMeeting[];
        items?: FathomMeeting[];
        next_cursor?: string;
      };
      const meetings = data.meetings ?? data.items ?? [];
      for (const m of meetings) {
        const hit = (m.url ?? "").includes(slug) || (m.share_url ?? "").includes(slug);
        if (hit) {
          return {
            meeting: {
              recordingId: String(m.recording_id),
              title: m.title ?? null,
              createdAt: m.created_at ?? null,
              durationSeconds: m.duration_seconds ?? null,
              externalUrl: m.share_url ?? m.url ?? null,
            },
          };
        }
      }
      if (!data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return null;
  },

  async getTranscript(apiKey, recordingId): Promise<FormattedTranscript> {
    const res = await call(apiKey, `/recordings/${recordingId}/transcript`);
    if (!res.ok) {
      throw new ProviderError("fathom", res.status, await res.text());
    }
    const data = (await res.json()) as FathomTranscriptResponse;
    const lines: TranscriptLine[] = (data.transcript ?? []).map((l) => ({
      speaker: l.speaker?.display_name ?? "Speaker",
      text: l.text,
      timestamp: l.timestamp ?? null,
    }));
    return { formatted: formatLines(lines), raw: data };
  },
};
