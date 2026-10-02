/**
 * Adapter tl;dv.
 * Base URL : https://pasta.tldv.io
 * Auth : header x-api-key (pas Bearer)
 * API en alpha (v1alpha1) — peut breaker.
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

const BASE = "https://pasta.tldv.io/v1alpha1";

async function call(apiKey: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });
}

function extractTldvId(urlOrId: string): string | null {
  const t = urlOrId.trim();
  const m = t.match(/tldv\.io\/app\/meetings\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  const m2 = t.match(/tldv\.io\/([A-Za-z0-9_-]{6,})/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9_-]{6,}$/.test(t)) return t;
  return null;
}

interface TldvMeeting {
  id: string;
  name?: string | null;
  happenedAt?: string | null;
  duration?: number | null;
  url?: string | null;
}

interface TldvTranscript {
  id: string;
  meetingId: string;
  data?: Array<{
    speaker?: string | null;
    text: string;
    startTime?: number | null;
    endTime?: number | null;
  }>;
}

export const tldvAdapter: ProviderAdapter = {
  id: "tldv",
  label: "tl;dv",
  keyPlaceholder: "Clé API tl;dv (Settings → API keys)",
  keyDocsUrl: "https://tldv.io/app/settings/personal-settings/api-keys",
  meetingUrlPlaceholder: "https://tldv.io/app/meetings/<id> ou l'ID brut",

  async ping(apiKey): Promise<ProviderPingResult> {
    try {
      const res = await call(apiKey, "/meetings?page=1&pageSize=1");
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async resolveMeeting(apiKey, urlOrId) {
    const id = extractTldvId(urlOrId);
    if (!id) return null;
    const res = await call(apiKey, `/meetings/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ProviderError("tldv", res.status, await res.text());
    }
    const meeting = (await res.json()) as TldvMeeting;
    return {
      meeting: {
        recordingId: meeting.id,
        title: meeting.name ?? null,
        createdAt: meeting.happenedAt ?? null,
        durationSeconds: meeting.duration ?? null,
        externalUrl: meeting.url ?? `https://tldv.io/app/meetings/${meeting.id}`,
      },
    };
  },

  async getTranscript(apiKey, recordingId): Promise<FormattedTranscript> {
    const res = await call(apiKey, `/meetings/${recordingId}/transcript`);
    if (!res.ok) {
      throw new ProviderError("tldv", res.status, await res.text());
    }
    const tr = (await res.json()) as TldvTranscript;
    const lines: TranscriptLine[] = (tr.data ?? []).map((l) => ({
      speaker: l.speaker ?? "Speaker",
      text: l.text,
      timestamp: secondsToHHMMSS(l.startTime ?? null),
    }));
    return { formatted: formatLines(lines), raw: tr };
  },
};
