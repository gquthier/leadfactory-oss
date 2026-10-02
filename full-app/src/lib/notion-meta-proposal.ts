type JsonRecord = Record<string, unknown>;

interface CreateNotionProposalParams {
  company: string;
  onboardingId: string;
  campaignId?: string | null;
  responses: JsonRecord;
}

const NOTION_VERSION = "2022-06-28";

function text(v: unknown): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (v === null || v === undefined) return "";
  return String(v);
}

function rich(content: string) {
  return [{ type: "text", text: { content } }];
}

function paragraph(content: string) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: rich(content) } };
}

function heading(content: string, level: 2 | 3 = 2) {
  if (level === 2) {
    return { object: "block", type: "heading_2", heading_2: { rich_text: rich(content) } };
  }
  return { object: "block", type: "heading_3", heading_3: { rich_text: rich(content) } };
}

function bullet(content: string) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: rich(content) },
  };
}

async function notionFetch(path: string, token: string, body?: object, method = "POST") {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Notion API ${res.status}: ${t}`);
  }

  return res.json();
}

export async function createNotionMetaCampaignProposal(
  params: CreateNotionProposalParams
): Promise<{ pageId: string; url: string } | null> {
  const token = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_CAMPAIGN_DATABASE_ID;

  if (!token || !databaseId) return null;

  const title = `Proposition de campagne ${params.company}`;

  const created = await notionFetch("/pages", token, {
    parent: { database_id: databaseId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: title } }],
      },
    },
  });

  const r = params.responses;

  const blocks = [
    paragraph(
      "Ce document vise à résumer la proposition de campagne Meta Ads ainsi que les cibles visées avant production des créatifs."
    ),
    paragraph(
      "Vous pouvez commenter directement sur ce document pour vos retours."
    ),
    heading("Contexte client", 2),
    bullet(`Entreprise: ${params.company}`),
    bullet(`Offre: ${text(r.a_resume_offre) || "N/A"}`),
    bullet(`Pitch: ${text(r.a_pitch) || "N/A"}`),
    bullet(`Problèmes adressés: ${text(r.a_problemes) || "N/A"}`),
    heading("Objectif Meta Ads", 2),
    bullet(`Objectif business: ${text(r.b_objectif) || "N/A"}`),
    bullet(`Conversion visée: ${text(r.b_conversion) || "N/A"}`),
    bullet(`KPI: ${text(r.b_kpi) || "N/A"}`),
    bullet(`Objectif chiffré: ${text(r.b_objectif_chiffre) || "N/A"}`),
    heading("Proposition de campagne (Meta Ads)", 2),
    paragraph("Campagne 1 — Angle principal (promesse + preuve)"),
    bullet(`Promesse: ${text(r.c_promesse) || "N/A"}`),
    bullet(`Bénéfice clé #1: ${text(r.c_benefice1) || "N/A"}`),
    bullet(`Preuve: ${text(r.c_preuve_detail) || "N/A"}`),
    paragraph("Campagne 2 — Angle douleur / objection"),
    bullet(`Pain points ICP #1: ${text(r.d_cible1_problemes) || "N/A"}`),
    bullet(`Freins ICP #1: ${text(r.d_cible1_freins) || "N/A"}`),
    paragraph("Campagne 3 — Angle opportunité / différenciation"),
    bullet(`Différenciants: ${text(r.a_differenciants) || "N/A"}`),
    bullet(`Différenciation marché: ${text(r.a_differenciation) || "N/A"}`),
    heading("Cibles", 2),
    bullet(`ICP 1: ${text(r.d_cible1_description) || "N/A"}`),
    bullet(`ICP 2: ${text(r.d_cible2_description) || "N/A"}`),
    bullet(`Exclusions: ${text(r.d_exclusions) || "N/A"}`),
    heading("Budget & contraintes", 2),
    bullet(`Budget mensuel: ${text(r.g_budget) || "N/A"}`),
    bullet(`Timing: ${text(r.g_timing) || "N/A"}`),
    bullet(`No-go: ${text(r.c_nogo) || "N/A"}`),
    heading("Tracking & delivery", 2),
    bullet(`Pixel: ${text(r.f_pixel) || "N/A"}`),
    bullet(`CAPI: ${text(r.f_capi) || "N/A"}`),
    bullet(`GA4: ${text(r.f_ga4) || "N/A"}`),
    paragraph(
      `Onboarding ID: ${params.onboardingId} | Campaign ID: ${params.campaignId ?? "n/a"}`
    ),
  ];

  await notionFetch(`/blocks/${created.id}/children`, token, { children: blocks as object[] }, "PATCH");

  return { pageId: created.id, url: created.url };
}
