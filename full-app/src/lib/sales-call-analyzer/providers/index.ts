/**
 * Registry des providers AI Notetaker supportés.
 * Source de vérité pour résoudre un id → adapter.
 */

import { fathomAdapter } from "./fathom";
import { firefliesAdapter } from "./fireflies";
import { granolaAdapter } from "./granola";
import { tldvAdapter } from "./tldv";
import type { NotetakerProvider, ProviderAdapter } from "./types";

export const PROVIDERS: Record<NotetakerProvider, ProviderAdapter> = {
  fathom: fathomAdapter,
  fireflies: firefliesAdapter,
  granola: granolaAdapter,
  tldv: tldvAdapter,
};

export const PROVIDER_IDS: NotetakerProvider[] = ["fathom", "fireflies", "granola", "tldv"];

export function getProvider(id: string): ProviderAdapter | null {
  if (id in PROVIDERS) return PROVIDERS[id as NotetakerProvider];
  return null;
}

/** Liste minimale pour l'UI (sans exposer les méthodes async). */
export interface ProviderPublicInfo {
  id: NotetakerProvider;
  label: string;
  keyPlaceholder: string;
  keyDocsUrl: string;
  meetingUrlPlaceholder: string;
}

export const PROVIDERS_PUBLIC: ProviderPublicInfo[] = PROVIDER_IDS.map((id) => {
  const p = PROVIDERS[id];
  return {
    id: p.id,
    label: p.label,
    keyPlaceholder: p.keyPlaceholder,
    keyDocsUrl: p.keyDocsUrl,
    meetingUrlPlaceholder: p.meetingUrlPlaceholder,
  };
});

export type { NotetakerProvider, ProviderAdapter } from "./types";
export { ProviderError } from "./types";
