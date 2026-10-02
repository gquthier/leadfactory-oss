export interface NormalizedLead {
  business_name: string;
  phone_e164: string | null;
  phone_national: string | null;
  email: string | null;
  has_email: boolean;
  website: string | null;
  has_website: boolean;
  category_primary: string;
  category_all: string;
  rating: number | null;
  reviews_count: number;
  price_level: number | null;
  claimed: boolean;
  is_open_now: boolean;
  hours_summary: string;
  photos_count: number;
  main_image_url: string | null;
  address_full: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string;
  place_id: string;
  permanently_closed: boolean;
  temporarily_closed: boolean;
}

export type CallPriority = 'A' | 'B' | 'C' | 'D';

export type DisqualifiedReason =
  | 'permanently_closed'
  | 'temporarily_closed'
  | 'no_phone'
  | 'phone_invalid';

export function buildDisqualifiedReason(lead: NormalizedLead): DisqualifiedReason | null {
  if (lead.permanently_closed) return 'permanently_closed';
  if (lead.temporarily_closed) return 'temporarily_closed';
  if (!lead.phone_national && !lead.phone_e164) return 'no_phone';
  if (lead.phone_national && !lead.phone_e164) return 'phone_invalid';
  return null;
}

export function buildCallPriority(
  lead: NormalizedLead,
  disqualified: string | null,
): CallPriority {
  if (disqualified) return 'D';

  const rating = lead.rating ?? 0;
  const reviews = lead.reviews_count;

  if (rating >= 4.5 && reviews >= 30 && lead.has_website && lead.is_open_now) return 'A';
  if (rating >= 4.0 && reviews >= 10) return 'B';
  if (reviews >= 1) return 'C';
  return 'D';
}

export function buildPersonalizationHook(lead: NormalizedLead): string {
  if (!lead.has_website) {
    return `J'ai cherché ${lead.business_name} en ligne, j'ai vu que vous n'avez pas encore de site web — c'est volontaire ?`;
  }
  if ((lead.rating ?? 0) >= 4.5 && lead.reviews_count >= 30) {
    return `J'ai vu vos ${lead.rating}★ avec ${lead.reviews_count} avis sur Google, vraiment beau travail`;
  }
  if (lead.reviews_count <= 10) {
    return `Je vois que ${lead.business_name} commence à se faire connaître sur Google`;
  }
  if (!lead.claimed) {
    return `J'ai vu la fiche Google de ${lead.business_name}, elle n'a pas l'air encore revendiquée par vous`;
  }
  return `Bonjour, j'ai vu ${lead.business_name} sur Google Maps`;
}

export type PitchAngle =
  | 'no_website'
  | 'low_reviews'
  | 'unclaimed_listing'
  | 'high_volume_established'
  | 'standard';

export function buildPitchAngle(lead: NormalizedLead): PitchAngle {
  if (!lead.has_website) return 'no_website';
  if (!lead.claimed) return 'unclaimed_listing';
  if (lead.reviews_count <= 10) return 'low_reviews';
  if (lead.reviews_count >= 100 && (lead.rating ?? 0) >= 4.3) return 'high_volume_established';
  return 'standard';
}

const SUNDAY_TOKENS = ['dim', 'dimanche', 'sun', 'sunday'];

export function buildBestCallWindow(lead: NormalizedLead, _category: string): string {
  if (!lead.hours_summary) return 'Lun-Ven 10h-12h';
  const segments = lead.hours_summary.split(',').map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (SUNDAY_TOKENS.some((t) => lower.startsWith(t))) continue;
    return seg;
  }
  return 'Lun-Ven 10h-12h';
}
