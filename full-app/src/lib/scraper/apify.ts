import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = process.env.APIFY_ACTOR_GMAPS ?? 'lukaskrivka/google-maps-with-contact-details';

function getClient(): ApifyClient {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN env var is not set');
  return new ApifyClient({ token: APIFY_TOKEN });
}

export interface GMapsRawItem {
  title?: string;
  phone?: string;
  phoneUnformatted?: string;
  phoneNumbers?: string[];
  emails?: string[];
  website?: string;
  category?: string;
  categories?: string[];
  address?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
  neighborhood?: string;
  location?: { lat: number; lng: number };
  totalScore?: number;
  reviewsCount?: number;
  priceLevel?: number;
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  openingHours?: Array<{ day: string; hours: string }>;
  imageUrl?: string;
  imagesCount?: number;
  placeId?: string;
  url?: string;
  socialMediaUrls?: Record<string, string>;
  [key: string]: unknown;
}

export interface StartGoogleMapsRunInput {
  url: string;
  maxResults: number;
  enrichEmails: boolean;
}

export interface StartGoogleMapsRunResult {
  runId: string;
  defaultDatasetId: string;
}

export interface RunStatusResult {
  status: string;
  itemCount: number;
  costUsd: number;
  datasetId: string | undefined;
}

export async function startGoogleMapsRun(
  input: StartGoogleMapsRunInput,
): Promise<StartGoogleMapsRunResult> {
  const run = await getClient().actor(ACTOR_ID).start({
    startUrls: [{ url: input.url }],
    maxCrawledPlacesPerSearch: input.maxResults,
    scrapeContacts: input.enrichEmails,
    language: 'fr',
    countryCode: 'fr',
  });
  return { runId: run.id, defaultDatasetId: run.defaultDatasetId };
}

export async function getRunStatus(runId: string): Promise<RunStatusResult> {
  const client = getClient();
  const run = await client.run(runId).get();
  if (!run) throw new Error(`Apify run ${runId} not found`);
  let itemCount = 0;
  if (run.defaultDatasetId) {
    const dataset = await client.dataset(run.defaultDatasetId).get();
    itemCount = dataset?.itemCount ?? 0;
  }
  return {
    status: run.status,
    itemCount,
    costUsd: run.usageTotalUsd ?? 0,
    datasetId: run.defaultDatasetId,
  };
}

export async function fetchDataset(datasetId: string): Promise<GMapsRawItem[]> {
  const { items } = await getClient().dataset(datasetId).listItems();
  return items as unknown as GMapsRawItem[];
}

export async function abortRun(runId: string): Promise<void> {
  await getClient().run(runId).abort();
}
