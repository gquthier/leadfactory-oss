import Papa from 'papaparse';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { GMapsRawItem } from './apify';
import type {
  NormalizedLead,
  CallPriority,
  DisqualifiedReason,
  PitchAngle,
} from './personalization';
import {
  buildCallPriority,
  buildDisqualifiedReason,
  buildPersonalizationHook,
  buildPitchAngle,
  buildBestCallWindow,
} from './personalization';

export interface EnrichedLead extends NormalizedLead {
  call_priority: CallPriority;
  disqualified_reason: DisqualifiedReason | null;
  personalization_hook: string;
  best_call_window: string;
  pitch_angle: PitchAngle;
  scraped_at: string;
}

const FR_DAY_TOKENS_BY_INDEX: Record<number, string[]> = {
  0: ['dim', 'dimanche', 'sun', 'sunday'],
  1: ['lun', 'lundi', 'mon', 'monday'],
  2: ['mar', 'mardi', 'tue', 'tuesday'],
  3: ['mer', 'mercredi', 'wed', 'wednesday'],
  4: ['jeu', 'jeudi', 'thu', 'thursday'],
  5: ['ven', 'vendredi', 'fri', 'friday'],
  6: ['sam', 'samedi', 'sat', 'saturday'],
};

function pickPhone(raw: GMapsRawItem): string | null {
  if (raw.phone) return raw.phone;
  if (raw.phoneUnformatted) return raw.phoneUnformatted;
  if (raw.phoneNumbers && raw.phoneNumbers.length > 0) return raw.phoneNumbers[0];
  return null;
}

function pickEmail(raw: GMapsRawItem): string | null {
  if (raw.emails && raw.emails.length > 0) return raw.emails[0];
  return null;
}

function pickCategoryAll(raw: GMapsRawItem): string {
  if (raw.categories && raw.categories.length > 0) return raw.categories.join('; ');
  if (raw.category) return raw.category;
  return '';
}

function pickCategoryPrimary(raw: GMapsRawItem): string {
  if (raw.category) return raw.category;
  if (raw.categories && raw.categories.length > 0) return raw.categories[0];
  return '';
}

function buildAddressFull(raw: GMapsRawItem): string {
  if (raw.address) return raw.address;
  const parts = [raw.street, raw.postalCode, raw.city].filter((p): p is string => Boolean(p));
  return parts.join(', ');
}

function buildHoursSummary(raw: GMapsRawItem): string {
  if (!raw.openingHours || raw.openingHours.length === 0) return '';
  return raw.openingHours.map((h) => `${h.day} ${h.hours}`).join(', ');
}

function parseHourRange(hours: string): { startMin: number; endMin: number } | null {
  const match = hours.match(/(\d{1,2})[:hH](\d{2})\s*[-–à]\s*(\d{1,2})[:hH](\d{2})/);
  if (!match) {
    const compact = hours.match(/(\d{1,2})h\s*[-–à]\s*(\d{1,2})h/);
    if (!compact) return null;
    const sh = Number(compact[1]);
    const eh = Number(compact[2]);
    return { startMin: sh * 60, endMin: eh * 60 };
  }
  const sh = Number(match[1]);
  const sm = Number(match[2]);
  const eh = Number(match[3]);
  const em = Number(match[4]);
  return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
}

function computeIsOpenNow(raw: GMapsRawItem): boolean {
  if (!raw.openingHours || raw.openingHours.length === 0) return false;
  const now = new Date();
  const parisOffsetMin = 120;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMin = (utcMin + parisOffsetMin + 24 * 60) % (24 * 60);
  const dayIdx = (now.getUTCDay() + (utcMin + parisOffsetMin >= 24 * 60 ? 1 : 0)) % 7;
  const tokens = FR_DAY_TOKENS_BY_INDEX[dayIdx];
  const todayEntry = raw.openingHours.find((h) =>
    tokens.some((t) => h.day.toLowerCase().startsWith(t)),
  );
  if (!todayEntry) return false;
  const range = parseHourRange(todayEntry.hours);
  if (!range) return false;
  return localMin >= range.startMin && localMin <= range.endMin;
}

export function normalize(raw: GMapsRawItem): NormalizedLead {
  const phone = pickPhone(raw);
  const parsed = phone ? parsePhoneNumberFromString(phone, 'FR') : null;
  const phone_e164 = parsed?.isValid() ? parsed.format('E.164') : null;
  const phone_national = parsed?.formatNational() ?? phone ?? null;

  const website = raw.website ?? null;
  const email = pickEmail(raw);
  const category_primary = pickCategoryPrimary(raw);
  const category_all = pickCategoryAll(raw);
  const hours_summary = buildHoursSummary(raw);

  return {
    business_name: raw.title ?? '',
    phone_e164,
    phone_national,
    email,
    has_email: Boolean(email),
    website,
    has_website: Boolean(website),
    category_primary,
    category_all,
    rating: typeof raw.totalScore === 'number' ? raw.totalScore : null,
    reviews_count: raw.reviewsCount ?? 0,
    price_level: typeof raw.priceLevel === 'number' ? raw.priceLevel : null,
    claimed: typeof raw.totalScore === 'number' || (raw.reviewsCount ?? 0) > 0,
    is_open_now: computeIsOpenNow(raw),
    hours_summary,
    photos_count: raw.imagesCount ?? 0,
    main_image_url: raw.imageUrl ?? null,
    address_full: buildAddressFull(raw),
    street: raw.street ?? '',
    postal_code: raw.postalCode ?? '',
    city: raw.city ?? '',
    country: raw.countryCode ?? '',
    latitude: raw.location?.lat ?? null,
    longitude: raw.location?.lng ?? null,
    google_maps_url: raw.url ?? '',
    place_id: raw.placeId ?? '',
    permanently_closed: Boolean(raw.permanentlyClosed),
    temporarily_closed: Boolean(raw.temporarilyClosed),
  };
}

export function enrich(lead: NormalizedLead, scrapedAt: string): EnrichedLead {
  const disqualified_reason = buildDisqualifiedReason(lead);
  const call_priority = buildCallPriority(lead, disqualified_reason);
  const personalization_hook = buildPersonalizationHook(lead);
  const best_call_window = buildBestCallWindow(lead, lead.category_primary);
  const pitch_angle = buildPitchAngle(lead);
  return {
    ...lead,
    call_priority,
    disqualified_reason,
    personalization_hook,
    best_call_window,
    pitch_angle,
    scraped_at: scrapedAt,
  };
}

const PRIORITY_ORDER: Record<CallPriority, number> = { A: 0, B: 1, C: 2, D: 3 };

interface CsvRow {
  business_name: string;
  phone_e164: string;
  phone_national: string;
  email: string;
  has_email: string;
  website: string;
  has_website: string;
  category_primary: string;
  category_all: string;
  rating: string;
  reviews_count: string;
  price_level: string;
  claimed: string;
  is_open_now: string;
  hours_summary: string;
  main_image_url: string;
  address_full: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
  google_maps_url: string;
  place_id: string;
  call_priority: string;
  disqualified_reason: string;
  personalization_hook: string;
  best_call_window: string;
  pitch_angle: string;
  scraped_at: string;
}

const CSV_COLUMNS: ReadonlyArray<keyof CsvRow> = [
  'business_name',
  'phone_e164',
  'phone_national',
  'email',
  'has_email',
  'website',
  'has_website',
  'category_primary',
  'category_all',
  'rating',
  'reviews_count',
  'price_level',
  'claimed',
  'is_open_now',
  'hours_summary',
  'main_image_url',
  'address_full',
  'street',
  'postal_code',
  'city',
  'country',
  'latitude',
  'longitude',
  'google_maps_url',
  'place_id',
  'call_priority',
  'disqualified_reason',
  'personalization_hook',
  'best_call_window',
  'pitch_angle',
  'scraped_at',
];

function s(value: string | null | undefined): string {
  return value ?? '';
}

function n(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function b(value: boolean): string {
  return value ? 'true' : 'false';
}

function toRow(e: EnrichedLead): CsvRow {
  return {
    business_name: s(e.business_name),
    phone_e164: s(e.phone_e164),
    phone_national: s(e.phone_national),
    email: s(e.email),
    has_email: b(e.has_email),
    website: s(e.website),
    has_website: b(e.has_website),
    category_primary: s(e.category_primary),
    category_all: s(e.category_all),
    rating: n(e.rating),
    reviews_count: n(e.reviews_count),
    price_level: n(e.price_level),
    claimed: b(e.claimed),
    is_open_now: b(e.is_open_now),
    hours_summary: s(e.hours_summary),
    main_image_url: s(e.main_image_url),
    address_full: s(e.address_full),
    street: s(e.street),
    postal_code: s(e.postal_code),
    city: s(e.city),
    country: s(e.country),
    latitude: n(e.latitude),
    longitude: n(e.longitude),
    google_maps_url: s(e.google_maps_url),
    place_id: s(e.place_id),
    call_priority: e.call_priority,
    disqualified_reason: s(e.disqualified_reason),
    personalization_hook: s(e.personalization_hook),
    best_call_window: s(e.best_call_window),
    pitch_angle: e.pitch_angle,
    scraped_at: e.scraped_at,
  };
}

function extractSearchQuery(inputUrl: string | undefined): string {
  if (!inputUrl) return '';
  try {
    const u = new URL(inputUrl);
    const m = u.pathname.match(/\/search\/([^/?]+)/i);
    if (m && m[1]) return decodeURIComponent(m[1]).replace(/\+/g, ' ');
  } catch {
    return '';
  }
  return '';
}

function buildBrandingHeader(meta: {
  scraped_at: string;
  input_url?: string;
  total_leads: number;
}): string {
  const date = new Date(meta.scraped_at).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
  const query = extractSearchQuery(meta.input_url);
  const parts = [
    'Fichier généré par votre instance locale LeadFactory',
    date,
    `${meta.total_leads} leads`,
    query ? `Recherche: ${query}` : '',
  ].filter(Boolean);
  const escaped = parts.join(' | ').replace(/"/g, '""');
  return `"${escaped}"\r\n\r\n`;
}

export function buildCsv(
  items: GMapsRawItem[],
  jobMeta: { scraped_at: string; input_url?: string },
): string {
  const normalized = items.map(normalize);

  const seen = new Set<string>();
  const deduped: NormalizedLead[] = [];
  for (const lead of normalized) {
    if (!lead.place_id) {
      deduped.push(lead);
      continue;
    }
    if (seen.has(lead.place_id)) continue;
    seen.add(lead.place_id);
    deduped.push(lead);
  }

  const enriched = deduped.map((lead) => enrich(lead, jobMeta.scraped_at));

  enriched.sort((a, b2) => {
    const aDq = a.disqualified_reason !== null;
    const bDq = b2.disqualified_reason !== null;
    if (aDq !== bDq) return aDq ? 1 : -1;
    const pDiff = PRIORITY_ORDER[a.call_priority] - PRIORITY_ORDER[b2.call_priority];
    if (pDiff !== 0) return pDiff;
    return b2.reviews_count - a.reviews_count;
  });

  const rows = enriched.map(toRow);

  const csv = Papa.unparse(rows, {
    quotes: true,
    header: true,
    newline: '\r\n',
    columns: CSV_COLUMNS as string[],
  });

  const header = buildBrandingHeader({
    scraped_at: jobMeta.scraped_at,
    input_url: jobMeta.input_url,
    total_leads: enriched.length,
  });

  return '﻿' + header + csv;
}
