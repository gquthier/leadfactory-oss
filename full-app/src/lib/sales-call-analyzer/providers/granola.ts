/**
 * Adapter Granola.
 * Base URL : https://public-api.granola.ai/v1
 * Auth : Authorization: Bearer grn_<api_key>
 * IDs natifs préfixés `not_`.
 */

import {
  formatLines,
  ProviderError,
  type FormattedTranscript,
  type ProviderAdapter,
  type ProviderPingResult,
  type TranscriptLine,
} from "./types";

const BASE = "https://public-api.granola.ai/v1";

async function call(apiKey: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
}

function extractGranolaId(urlOrId: string): string | null {
  const t = urlOrId.trim();
  // granola.ai/notes/not_xyz123 ou .so/notes/not_xyz
  const m = t.match(/granola\.(?:ai|so)\/notes\/(not_[A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^not_[A-Za-z0-9_-]+$/.test(t)) return t;
  return null;
}

interface GranolaNote {
  id: string;
  title?: string | null;
  created_at?: string | null;
  duration_seconds?: number | null;
  url?: string | null;
  transcript?: {
    segments?: Array<{
      speaker?: string | null;
      text: string;
      start_time?: number | string | null;
      timestamp?: string | null;
    }>;
  };
}

function secondsOrTsToHHMMSS(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    // déjà formaté
    if (/^\d{2}:\d{2}:\d{2}$/.test(v)) return v;
    const n = Number(v);
    if (Number.isFinite(n)) return secondsOrTsToHHMMSS(n);
    return null;
  }
  if (!Number.isFinite(v)) return null;
  const s = Math.max(0, Math.floor(v));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export const granolaAdapter: ProviderAdapter = {
  id: "granola",
  label: "Granola",
  keyPlaceholder: "grn_xxxxxxxxxxxx",
  keyDocsUrl: "https://docs.granola.ai/introduction",
  meetingUrlPlaceholder: "https://granola.ai/notes/not_xyz123 ou l'ID brut not_…",

  async ping(apiKey): Promise<ProviderPingResult> {
    try {
      const res = await call(apiKey, "/notes?limit=1");
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async resolveMeeting(apiKey, urlOrId) {
    const id = extractGranolaId(urlOrId);
    if (!id) return null;
    const res = await call(apiKey, `/notes/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ProviderError("granola", res.status, await res.text());
    }
    const note = (await res.json()) as GranolaNote;
    return {
      meeting: {
        recordingId: note.id,
        title: note.title ?? null,
        createdAt: note.created_at ?? null,
        durationSeconds: note.duration_seconds ?? null,
        externalUrl: note.url ?? `https://granola.ai/notes/${note.id}`,
      },
    };
  },

  async getTranscript(apiKey, recordingId): Promise<FormattedTranscript> {
    const res = await call(apiKey, `/notes/${recordingId}?include=transcript`);
    if (!res.ok) {
      throw new ProviderError("granola", res.status, await res.text());
    }
    const note = (await res.json()) as GranolaNote;
    const segs = note.transcript?.segments ?? [];
    const lines: TranscriptLine[] = segs.map((s) => ({
      speaker: s.speaker ?? "Speaker",
      text: s.text,
      timestamp: s.timestamp ?? secondsOrTsToHHMMSS(s.start_time ?? null),
    }));
    if (lines.length === 0) {
      throw new ProviderError(
        "granola",
        null,
        "Aucun transcript disponible pour cette note (Granola ne le génère que pour les notes avec summary)."
      );
    }
    return { formatted: formatLines(lines), raw: note };
  },
};
