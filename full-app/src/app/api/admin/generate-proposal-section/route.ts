import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionType = "brief" | "qualification" | "campaign";

interface AdSet {
  name: string;
  geo: string;
  age: string;
  sex: string;
  interests: string;
}

interface Creative {
  name: string;
  angle: string;
  format: string;
  headline: string;
  primaryText: string;
}

interface CampaignEntry {
  name: string;
  objective: string;
  dailyBudget: string;
  testDuration: string;
  adSets: AdSet[];
  creatives: Creative[];
}

interface ExistingProposal {
  briefHtml: string;
  qualificationHtml: string;
  campaigns: CampaignEntry[];
}

interface RequestBody {
  section: SectionType;
  campaign_id: string;
  clientName: string;
  onboardingData: Record<string, unknown> | null;
  aiDeliverables: string | null;
  existingProposal: ExistingProposal;
  campaignIndex?: number;
}

// ---------------------------------------------------------------------------
// Gemini config
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-3.1-pro-preview";

function geminiUrl(): string {
  const key = process.env.GEMINI_API_KEY;
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function val(v: unknown): string {
  if (!v) return "\u2014";
  if (Array.isArray(v)) return (v as unknown[]).join(", ") || "\u2014";
  return String(v).trim() || "\u2014";
}

function onb(data: Record<string, unknown> | null, key: string): string {
  if (!data) return "\u2014";
  return val(data[key]);
}

// ---------------------------------------------------------------------------
// Context prompt (shared across all sections)
// ---------------------------------------------------------------------------

function buildContext(body: RequestBody): string {
  const d = body.onboardingData;
  const ep = body.existingProposal;

  const campaignsSummary = ep.campaigns.length
    ? ep.campaigns
        .map(
          (c, i) =>
            `  Campagne ${i + 1}: ${c.name} | Objectif: ${c.objective} | Budget: ${c.dailyBudget} | Dur\u00e9e: ${c.testDuration} | ${c.adSets.length} ad sets | ${c.creatives.length} cr\u00e9atives`
        )
        .join("\n")
    : "  (aucune)";

  return `Tu es un expert Meta Ads senior de l'agence LeadFactory. Tu g\u00e9n\u00e8res des propositions de campagne Meta Ads pour des clients.

CONTEXTE CLIENT:
- Nom: ${body.clientName}
- Entreprise: ${onb(d, "a_entreprise")}
- Offre: ${onb(d, "a_resume_offre")}
- Prix: ${onb(d, "a_prix")}
- Type: ${onb(d, "a_type")}
- Objectifs: ${onb(d, "b_objectif")}
- KPIs: ${onb(d, "b_kpi")}
- Budget: ${onb(d, "g_budget")}
- Cible 1: ${onb(d, "d_cible1_description")}, ${onb(d, "d_cible1_secteur")}, ${onb(d, "d_cible1_fonctions")}
- Cible 2: ${onb(d, "d_cible2_description")}
- CTA: ${onb(d, "c_cta_type")}
- Promesse: ${onb(d, "c_promesse")}
- B\u00e9n\u00e9fices: ${onb(d, "c_benefice1")}, ${onb(d, "c_benefice2")}, ${onb(d, "c_benefice3")}
- Preuves: ${onb(d, "c_preuve_detail")}
- Destination: ${onb(d, "e_destination_principale")}
- Conversion events: ${onb(d, "b_conversion")}

CONTENU AI EXISTANT (si disponible):
${body.aiDeliverables ?? "(aucun)"}

PROPOSITION ACTUELLE:
Brief: ${ep.briefHtml || "(vide)"}
Qualification: ${ep.qualificationHtml || "(vide)"}
Campagnes:
${campaignsSummary}`;
}

// ---------------------------------------------------------------------------
// Section-specific prompts
// ---------------------------------------------------------------------------

function briefPrompt(context: string): string {
  return `${context}

---

G\u00e9n\u00e8re un brief strat\u00e9gique court pour cette campagne Meta Ads.

R\u00e8gles:
- 4 \u00e0 7 phrases maximum.
- Inclure : contexte client, offre principale, type de funnel choisi (Instant Form ou VSL), objectif du test, ce qu'on valide.
- Style : direct, professionnel, pas de jargon IA. Pas de "Dans cette proposition..." ni "Nous allons explorer...".
- Utilise "On" et la voix directe. Phrases courtes (15-25 mots).
- Inclure des chiffres sp\u00e9cifiques : CPL cible, volume de leads, dur\u00e9e du test, budget journalier.
- Uniquement des balises HTML simples : <p>, <strong>, <em>. Pas de divs, pas de classes.

R\u00e9ponds UNIQUEMENT en JSON valide avec cette structure :
{ "briefHtml": "<p>...</p>" }`;
}

function qualificationPrompt(context: string): string {
  return `${context}

---

G\u00e9n\u00e8re un questionnaire de qualification pour un Instant Form Meta.

R\u00e8gles:
- 4 \u00e0 6 questions maximum.
- Chaque question : titre, type (choix unique / choix multiple / texte libre), options de r\u00e9ponse.
- Terminer avec les r\u00e8gles de qualification : "Lead qualifi\u00e9 si..." et "Lead disqualifi\u00e9 si...".
- Questions classiques : (1) intention/projet, (2) timeline, (3) budget, (4) coordonn\u00e9es.
- Utiliser <h3> pour les titres de question, <p> pour les descriptions, <ul><li> pour les options.
- Adapter les questions au secteur et \u00e0 l'offre du client.

R\u00e9ponds UNIQUEMENT en JSON valide avec cette structure :
{ "qualificationHtml": "<h3>Question 1...</h3><p>...</p><ul><li>...</li></ul>..." }`;
}

function campaignPrompt(context: string): string {
  return `${context}

---

G\u00e9n\u00e8re une structure de campagne Meta Ads compl\u00e8te.

R\u00e8gles:
- 1 campagne, 2 ad sets (Int\u00e9r\u00eats + Broad).
- 5 \u00e0 10 cr\u00e9atives avec des angles distincts parmi : Douleur, D\u00e9sir, Preuve, Contre-intuitif, Urgence.
- Format par d\u00e9faut : Image statique 1080x1080.
- Budget : suivre le brief client, par d\u00e9faut 30-50 \u20ac/jour pour les PME.
- Convention naming : [CLIENT] - [OFFRE] - [OBJECTIF].

R\u00e9ponds UNIQUEMENT en JSON valide avec cette structure :
{
  "campaign": {
    "name": "...",
    "objective": "Leads",
    "dailyBudget": "50 \u20ac/jour",
    "testDuration": "14 jours",
    "adSets": [
      { "name": "Audience par int\u00e9r\u00eats", "geo": "France", "age": "25-55", "sex": "Tous", "interests": "..." },
      { "name": "Audience Broad", "geo": "France", "age": "25-55", "sex": "Tous", "interests": "aucun" }
    ],
    "creatives": [
      { "name": "Cr\u00e9ative 1", "angle": "Douleur", "format": "Image statique 1080x1080", "headline": "...", "primaryText": "..." }
    ]
  }
}`;
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

async function callGemini(prompt: string): Promise<string> {
  const response = await fetch(geminiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const result = await response.json();
  const text: string | undefined =
    result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("No response from Gemini");
  }

  return text;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function verifyAdmin() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { error: "Non autoris\u00e9", status: 401 } as const;
  }

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: "Admin requis", status: 403 } as const;
  }

  return { session, adminSupabase } as const;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // 1. Check API key
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Cl\u00e9 API Gemini non configur\u00e9e" },
      { status: 500 }
    );
  }

  // 2. Auth
  const auth = await verifyAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 3. Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requ\u00eate invalide" },
      { status: 400 }
    );
  }

  const { section, campaign_id, clientName, existingProposal } = body;

  if (!section || !campaign_id || !clientName || !existingProposal) {
    return NextResponse.json(
      { error: "Champs requis manquants : section, campaign_id, clientName, existingProposal" },
      { status: 400 }
    );
  }

  const validSections: SectionType[] = ["brief", "qualification", "campaign"];
  if (!validSections.includes(section)) {
    return NextResponse.json(
      { error: `Section invalide. Valeurs accept\u00e9es : ${validSections.join(", ")}` },
      { status: 400 }
    );
  }

  if (section === "campaign" && body.campaignIndex == null) {
    return NextResponse.json(
      { error: "campaignIndex requis pour la section campaign" },
      { status: 400 }
    );
  }

  // 4. Build prompt
  const context = buildContext(body);
  let prompt: string;

  switch (section) {
    case "brief":
      prompt = briefPrompt(context);
      break;
    case "qualification":
      prompt = qualificationPrompt(context);
      break;
    case "campaign":
      prompt = campaignPrompt(context);
      break;
  }

  // 5. Call Gemini
  try {
    const rawText = await callGemini(prompt);

    // 6. Parse JSON response
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error("[generate-proposal-section] JSON parse error. Raw text:", rawText);
      return NextResponse.json(
        { error: "Erreur de format dans la r\u00e9ponse IA" },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("[generate-proposal-section] Gemini call failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
