/**
 * Interface commune pour tous les providers AI Notetaker.
 * Chaque provider implémente ces 4 méthodes ; le pipeline /analyze ne dépend pas
 * du provider, il choisit l'adapter via le registry selon la clé enregistrée.
 */

export type NotetakerProvider = "fathom" | "fireflies" | "granola" | "tldv";

export interface MeetingMeta {
  recordingId: string; // ID interne du provider (peut être num, slug, etc.)
  title: string | null;
  createdAt: string | null; // ISO
  durationSeconds: number | null;
  /** URL canonique vers le meeting chez le provider (pour traçabilité). */
  externalUrl: string | null;
}

export interface TranscriptLine {
  speaker: string;
  text: string;
  /** Timestamp HH:MM:SS si dispo. */
  timestamp?: string | null;
}

export interface FormattedTranscript {
  /** String prêt pour LLM, format `[HH:MM:SS] Speaker : text`. */
  formatted: string;
  /** Payload brut du provider (utile pour debug / replay). */
  raw: unknown;
}

export interface ProviderPingResult {
  ok: boolean;
  error?: string;
  status?: number;
}

export interface ProviderAdapter {
  /** Identifiant interne (matche client_external_api_keys.provider). */
  readonly id: NotetakerProvider;
  /** Nom affiché dans l'UI. */
  readonly label: string;
  /** Format attendu de la clé (placeholder UI). */
  readonly keyPlaceholder: string;
  /** URL pour récupérer une clé (lien externe dans l'UI). */
  readonly keyDocsUrl: string;
  /** Format URL meeting attendu en input user (placeholder + regex hint). */
  readonly meetingUrlPlaceholder: string;

  /** Ping rapide : vérifie que la clé est acceptée par l'API. */
  ping(apiKey: string): Promise<ProviderPingResult>;

  /**
   * Résout une URL de meeting (ou ID brut) vers un recording ID interne + meta.
   * Doit gérer les variantes d'URL possibles pour ce provider.
   */
  resolveMeeting(
    apiKey: string,
    urlOrId: string
  ): Promise<{ meeting: MeetingMeta } | null>;

  /** Récupère le transcript brut du provider et le formate pour LLM. */
  getTranscript(
    apiKey: string,
    recordingId: string
  ): Promise<FormattedTranscript>;
}

export class ProviderError extends Error {
  constructor(
    public provider: NotetakerProvider,
    public status: number | null,
    message: string
  ) {
    super(`${provider} ${status ?? ""}: ${message.slice(0, 200)}`);
    this.name = "ProviderError";
  }
}

/** Convertit un tableau de lignes en string formaté pour LLM. */
export function formatLines(lines: TranscriptLine[]): string {
  return lines
    .map((l) => {
      const ts = l.timestamp ? `[${l.timestamp}] ` : "";
      const sp = l.speaker || "Speaker";
      return `${ts}${sp} : ${l.text}`;
    })
    .join("\n");
}

/** Convertit des secondes en HH:MM:SS pour les providers qui ne fournissent que des seconds offsets. */
export function secondsToHHMMSS(seconds: number | undefined | null): string | null {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return null;
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
