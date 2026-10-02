import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionType = "brand_identity" | "target_audience" | "competitive_landscape" | "templates" | "copywriting" | "visual_style" | "references";

interface CreativeTemplate {
  id: string;
  name: string;
  format: string;
  angle: string;
  headline: string;
  subHeadline: string;
  bulletPoints: string[];
  styleDirection: string;
}

interface ExistingBrief {
  brandIdentityHtml: string;
  targetAudienceHtml: string;
  competitiveLandscapeHtml: string;
  templates: CreativeTemplate[];
  copywritingDirectionHtml: string;
  visualStyleHtml: string;
  referencesHtml: string;
}

interface RequestBody {
  section: SectionType;
  campaign_id: string;
  clientName: string;
  onboardingData: Record<string, unknown> | null;
  existingBrief: ExistingBrief;
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

function buildContext(body: RequestBody, deliverables: string): string {
  const d = body.onboardingData;

  return `Tu es un creative strategist senior de l'agence LeadFactory. Tu génères des briefs créatifs détaillés pour les designers qui vont créer les visuels dans Figma.

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
- Bénéfices: ${onb(d, "c_benefice1")}, ${onb(d, "c_benefice2")}, ${onb(d, "c_benefice3")}
- Preuves: ${onb(d, "c_preuve_detail")}
- Destination: ${onb(d, "e_destination_principale")}
- Conversion events: ${onb(d, "b_conversion")}
- Site web: ${onb(d, "a_site_web")}
- Drive / assets: ${onb(d, "h_drive_link")}
- Identité visuelle: ${onb(d, "h_brand_guidelines")}
- Couleurs marque: ${onb(d, "h_brand_colors")}
- Polices: ${onb(d, "h_fonts")}
- Concurrents: ${onb(d, "f_concurrents")}
- USP: ${onb(d, "c_usp")}
- Ton de marque: ${onb(d, "h_brand_tone")}

AI DELIVERABLES DU CLIENT:
${deliverables || "(aucun)"}

BRIEF CRÉATIF ACTUEL:
- Identité de marque: ${body.existingBrief.brandIdentityHtml || "(vide)"}
- Audience cible: ${body.existingBrief.targetAudienceHtml || "(vide)"}
- Paysage concurrentiel: ${body.existingBrief.competitiveLandscapeHtml || "(vide)"}
- Templates: ${body.existingBrief.templates.length} templates existants
- Direction copywriting: ${body.existingBrief.copywritingDirectionHtml || "(vide)"}
- Style visuel: ${body.existingBrief.visualStyleHtml || "(vide)"}
- Références: ${body.existingBrief.referencesHtml || "(vide)"}`;
}

// ---------------------------------------------------------------------------
// Section-specific prompts
// ---------------------------------------------------------------------------

function brandIdentityPrompt(context: string): string {
  return `${context}

---

Génère la section "Identité de marque" du brief créatif.

Règles:
- Inclure : nom de marque, logo (lien si disponible), site web, drive/assets, couleurs de marque, polices, guidelines visuelles existantes.
- Utilise des emojis pour structurer visuellement (🎨 pour couleurs, 🔤 pour typo, 🌐 pour site, etc.)
- Format HTML simple : <h3>, <p>, <strong>, <ul>, <li>. Pas de divs, pas de classes.
- Ton professionnel mais accessible, en français.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{ "brandIdentityHtml": "<h3>🏢 Marque</h3><p>...</p>" }`;
}

function targetAudiencePrompt(context: string): string {
  return `${context}

---

Génère la section "Audience cible" du brief créatif.

Règles:
- Synthétiser les données onboarding (cibles, secteur, fonctions) + insights psychographiques.
- Inclure : persona principal, douleurs, désirs, objections, déclencheurs d'achat, langage utilisé.
- Utilise des emojis pour structurer (🎯 cible, 😰 douleurs, ✨ désirs, 🚫 objections, etc.)
- Format HTML simple : <h3>, <p>, <strong>, <ul>, <li>.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{ "targetAudienceHtml": "<h3>🎯 Persona principal</h3><p>...</p>" }`;
}

function competitiveLandscapePrompt(context: string): string {
  return `${context}

---

Génère la section "Paysage concurrentiel" du brief créatif.

Règles:
- Analyser les concurrents mentionnés dans le brief client.
- Inclure : positionnement concurrent, styles visuels observés, angles publicitaires utilisés, opportunités de différenciation.
- Utilise des emojis (🔍 analyse, 💡 opportunités, ⚡ différenciation, etc.)
- Format HTML simple : <h3>, <p>, <strong>, <ul>, <li>.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{ "competitiveLandscapeHtml": "<h3>🔍 Analyse concurrentielle</h3><p>...</p>" }`;
}

function templatesPrompt(context: string): string {
  return `${context}

---

Génère 10 templates créatifs pour des publicités Meta Ads (images statiques).

Règles:
- Chaque template a un angle marketing distinct parmi : Douleur, Désir, Preuve sociale, Contre-intuitif, Urgence, Autorité, Comparaison, Témoignage, Éducatif, Transformation.
- Formats variés : "Image statique 1080x1080", "Image statique 1080x1350", "Carrousel".
- Headline : phrase courte qui arrête le scroll (max 8 mots).
- Sub-headline : phrase de support (max 15 mots).
- 3-4 bullet points par template (texte à mettre sur le visuel).
- Style direction : description courte du style visuel recommandé.
- Utilise des emojis dans les headlines et bullet points.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{
  "templates": [
    {
      "id": "tpl-1",
      "name": "Template 1 — [Angle]",
      "format": "Image statique 1080x1080",
      "angle": "Douleur",
      "headline": "...",
      "subHeadline": "...",
      "bulletPoints": ["...", "...", "..."],
      "styleDirection": "..."
    }
  ]
}`;
}

function copywritingPrompt(context: string): string {
  return `${context}

---

Génère la section "Direction Copywriting" du brief créatif.

Règles:
- Définir le ton de voix (formel/informel, tutoiement/vouvoiement, technique/accessible).
- Messaging framework : promesse principale, preuves clés, CTA principal.
- Messages clés à utiliser et à éviter.
- Exemples de formulations recommandées vs à éviter.
- Utilise des emojis (✍️ ton, 💬 messages clés, ✅ à faire, ❌ à éviter, etc.)
- Format HTML simple : <h3>, <p>, <strong>, <ul>, <li>.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{ "copywritingDirectionHtml": "<h3>✍️ Ton de voix</h3><p>...</p>" }`;
}

function visualStylePrompt(context: string): string {
  return `${context}

---

Génère la section "Recommandations Style Visuel" du brief créatif.

Règles:
- Palette de couleurs recommandée (reprendre les couleurs de marque si disponibles + couleurs complémentaires).
- Typographie recommandée.
- Style d'imagerie (photo, illustration, 3D, flat design, etc.).
- Mood / ambiance visuelle.
- Exemples de styles de référence.
- Utilise des emojis (🎨 couleurs, 🖼️ imagerie, ✨ mood, 📐 mise en page, etc.)
- Format HTML simple : <h3>, <p>, <strong>, <ul>, <li>.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{ "visualStyleHtml": "<h3>🎨 Palette de couleurs</h3><p>...</p>" }`;
}

function referencesPrompt(context: string): string {
  return `${context}

---

Génère la section "Références & Documents" du brief créatif.

Règles:
- Lister tous les liens et documents de référence disponibles : site web, drive, brand guidelines, logos, exemples de pubs concurrentes.
- Organiser par catégorie : assets de marque, documents stratégiques, exemples visuels, liens utiles.
- Utilise des emojis (📁 documents, 🔗 liens, 🖼️ visuels, 📊 stratégie, etc.)
- Format HTML simple : <h3>, <p>, <strong>, <ul>, <li>, <a>.

Réponds UNIQUEMENT en JSON valide avec cette structure :
{ "referencesHtml": "<h3>📁 Assets de marque</h3><ul><li>...</li></ul>" }`;
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
    return { error: "Non autorisé", status: 401 } as const;
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
      { error: "Clé API Gemini non configurée" },
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
      { error: "Corps de requête invalide" },
      { status: 400 }
    );
  }

  const { section, campaign_id, clientName, existingBrief } = body;

  if (!section || !campaign_id || !clientName || !existingBrief) {
    return NextResponse.json(
      { error: "Champs requis manquants : section, campaign_id, clientName, existingBrief" },
      { status: 400 }
    );
  }

  const validSections: SectionType[] = ["brand_identity", "target_audience", "competitive_landscape", "templates", "copywriting", "visual_style", "references"];
  if (!validSections.includes(section)) {
    return NextResponse.json(
      { error: `Section invalide. Valeurs acceptées : ${validSections.join(", ")}` },
      { status: 400 }
    );
  }

  // 4. Fetch AI deliverables for enriched context
  let deliverables = "";
  try {
    const { data: campaign } = await auth.adminSupabase
      .from("campaigns")
      .select("client_id")
      .eq("id", campaign_id)
      .single();

    if (campaign?.client_id) {
      const { data: delivs } = await auth.adminSupabase
        .from("ai_deliverables")
        .select("type, content, created_at")
        .eq("client_id", campaign.client_id)
        .order("created_at", { ascending: false });

      if (delivs && delivs.length > 0) {
        deliverables = delivs
          .map((d) => `[${d.type}] ${typeof d.content === "string" ? d.content.slice(0, 500) : JSON.stringify(d.content).slice(0, 500)}`)
          .join("\n\n");
      }
    }
  } catch {
    // Non-blocking: continue without deliverables
  }

  // 5. Build prompt
  const context = buildContext(body, deliverables);
  let prompt: string;

  switch (section) {
    case "brand_identity":
      prompt = brandIdentityPrompt(context);
      break;
    case "target_audience":
      prompt = targetAudiencePrompt(context);
      break;
    case "competitive_landscape":
      prompt = competitiveLandscapePrompt(context);
      break;
    case "templates":
      prompt = templatesPrompt(context);
      break;
    case "copywriting":
      prompt = copywritingPrompt(context);
      break;
    case "visual_style":
      prompt = visualStylePrompt(context);
      break;
    case "references":
      prompt = referencesPrompt(context);
      break;
  }

  // 6. Call Gemini
  try {
    const rawText = await callGemini(prompt);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error("[generate-creative-brief-section] JSON parse error. Raw text:", rawText);
      return NextResponse.json(
        { error: "Erreur de format dans la réponse IA" },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("[generate-creative-brief-section] Gemini call failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
