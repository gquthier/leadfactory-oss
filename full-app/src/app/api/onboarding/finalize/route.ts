import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import {
  getCampaignStatusWriteCandidates,
  isCampaignStatusEnumError,
} from "@/lib/campaign-status";

interface SignupFinalizeRequest {
  onboarding_id?: string;
  email?: string;
  password?: string;
  full_name?: string;
}

interface BrandingSnapshot {
  website?: string | null;
  title?: string | null;
  description?: string | null;
  logo_candidates?: string[];
  status: "ok" | "failed";
  error?: string;
  collected_at: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeWebsite(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizePassword(value: unknown): string {
  return normalizeText(value);
}

function parseObjective(value: unknown): string {
  const raw = normalizeText(value);
  return raw || "leads";
}

function extractHostDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "";
  }
}

function buildCompanyName(responses: Record<string, unknown>, userInputName: string, email: string): string {
  if (userInputName) return userInputName;
  const website = normalizeWebsite(responses.website);
  const domain = extractHostDomain(website);
  if (domain) return domain.charAt(0).toUpperCase() + domain.slice(1);
  return email.split("@")[0] || "Client";
}

function safeAbsoluteUrl(baseUrl: string, candidate: string): string {
  const cleaned = normalizeText(candidate);
  if (!cleaned) return "";
  try {
    if (/^https?:\/\//i.test(cleaned)) return cleaned;
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return cleaned.startsWith("//") ? `https:${cleaned}` : cleaned;
  }
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseMeta(html: string): { title: string | null; description: string | null; logo: string | null } {
  const title = firstMatch(html, [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]);

  const description = firstMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]);

  const logo = firstMatch(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+rel=["'][^"']*(?:icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  ]);

  return {
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 500) : null,
    logo: logo ?? null,
  };
}

async function scrapeWebsiteBranding(website: string): Promise<BrandingSnapshot> {
  const collectedAt = new Date().toISOString();
  const candidates = new Set<string>();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(website, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadFactory/1.0)",
        Accept: "text/html, text/plain, */*",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        website,
        status: "failed",
        collected_at: collectedAt,
        error: `HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const parsed = parseMeta(html);
    if (parsed.logo) candidates.add(safeAbsoluteUrl(website, parsed.logo));

    return {
      website,
      status: "ok",
      collected_at: collectedAt,
      title: parsed.title,
      description: parsed.description,
      logo_candidates: Array.from(candidates),
    };
  } catch (error) {
    return {
      website,
      status: "failed",
      collected_at: collectedAt,
      error: error instanceof Error ? error.message : "Erreur inconnue du scraping",
    };
  }
}

async function queueBrandingEnrichment(
  adminSupabase: ReturnType<typeof createAdminClient>,
  onboardingId: string,
  responses: Record<string, unknown>
) {
  const website = normalizeWebsite(responses.website);
  if (!website) return;

  const snapshot = await scrapeWebsiteBranding(website);
  const enriched = {
    ...responses,
    _branding_scrape: snapshot,
    _branding_scrape_started_at: new Date().toISOString(),
  };
  await adminSupabase
    .from("onboarding_responses")
    .update({ responses: enriched })
    .eq("id", onboardingId);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as SignupFinalizeRequest | null;
  if (!body) {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const onboardingId = normalizeText(body.onboarding_id);
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const fullNameInput = normalizeText(body.full_name);

  if (!onboardingId) return NextResponse.json({ error: "onboarding_id manquant" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Email manquant" }, { status: 400 });
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Le mot de passe doit contenir au moins 8 caractères." }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data: onboarding, error: onboardingError } = await adminSupabase
    .from("onboarding_responses")
    .select("id,responses,questionnaire_type,client_id")
    .eq("id", onboardingId)
    .single();

  if (onboardingError) {
    return NextResponse.json({ error: onboardingError.message }, { status: 404 });
  }
  if (!onboarding) {
    return NextResponse.json({ error: "Brief introuvable" }, { status: 404 });
  }
  if (onboarding.questionnaire_type !== "signup") {
    return NextResponse.json({ error: "Le brief n'est pas un onboarding signup." }, { status: 400 });
  }
  if (onboarding.client_id) {
    return NextResponse.json({ error: "Ce brief d'onboarding a déjà été finalisé." }, { status: 409 });
  }

  const responses = asRecord(onboarding.responses);
  const website = normalizeWebsite(responses.website);
  const company = buildCompanyName(responses, fullNameInput, email);
  const objective = parseObjective(responses.objectif || responses.goal);
  const budget = responses.budget ? Number.parseFloat(normalizeText(responses.budget)) || null : null;
  const fullName = fullNameInput || company;

  const { data: newUser, error: userError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, company },
  });

  if (userError) {
    return NextResponse.json({ error: `Erreur création compte: ${userError.message}` }, { status: 500 });
  }

  const userId = newUser.user.id;

  await adminSupabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: fullName,
    company,
    role: "client",
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  let campaign: { id: string } | null = null;
  let campaignError: { message: string } | null = null;

  for (const status of getCampaignStatusWriteCandidates("brief_received")) {
    const { data: createdCampaign, error: createCampaignError } = await adminSupabase
      .from("campaigns")
      .insert({
        client_id: userId,
        onboarding_response_id: onboarding.id,
        name: `Campagne Meta — ${company}`,
        status,
        budget_monthly: budget,
        platform: "meta",
        objective,
      })
      .select("id")
      .single();

    if (!createCampaignError) {
      campaign = createdCampaign;
      break;
    }

    campaignError = createCampaignError;
    if (!isCampaignStatusEnumError(createCampaignError.message)) {
      break;
    }
  }

  if (!campaign) {
    return NextResponse.json(
      { error: `Erreur création campagne: ${campaignError?.message ?? "échec inconnu"}` },
      { status: 500 }
    );
  }

  const nextResponses: Record<string, unknown> = {
    ...responses,
    signup_completed_at: new Date().toISOString(),
    signup_email: email,
    signup_name: fullName,
    signup_objective: objective,
    website,
    campaign_id: campaign.id,
  };

  await adminSupabase.from("onboarding_responses").update({
    client_id: userId,
    campaign_id: campaign.id,
    responses: nextResponses,
  }).eq("id", onboarding.id);

  void queueBrandingEnrichment(adminSupabase, onboarding.id, responses);

  return NextResponse.json({
    success: true,
    user_id: userId,
    campaign_id: campaign.id,
    onboarding_id: onboarding.id,
  });
}
