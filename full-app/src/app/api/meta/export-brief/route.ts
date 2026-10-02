import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  getAccountInsights, getCampaignInsights, getDailyInsights, getAdInsights,
} from "@/lib/meta-api";
import type { DatePreset, MetaInsights, MetaAdInsight } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Gemini + 4 Meta API calls can take >10 s — extend to 60 s
export const maxDuration = 60;

function f(n: number, dec = 2) {
  return n?.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) ?? "—";
}

export async function POST(req: Request) {
  try {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase      = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  await initMetaToken(adminSupabase);

  const { data: profile } = await adminSupabase
    .from("profiles").select("role, full_name, company")
    .eq("id", session.user.id).single();

  const { adAccountId, period } = (await req.json()) as { adAccountId: string; period: DatePreset };
  if (!adAccountId) return NextResponse.json({ error: "adAccountId requis" }, { status: 400 });

  // ── Permission check for clients ──────────────────────────────────────────
  if (profile?.role !== "admin") {
    const variants = [adAccountId];
    if (adAccountId.startsWith("act_")) variants.push(adAccountId.slice(4));
    else variants.push(`act_${adAccountId}`);

    const { data: campaign } = await adminSupabase
      .from("campaigns").select("id")
      .eq("client_id", session.user.id)
      .in("ad_account_id", variants)
      .limit(1).maybeSingle();

    if (!campaign) return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
  }

  // ── Fetch all Meta data in parallel ──────────────────────────────────────
  const [summary, campaigns, daily, ads] = await Promise.all([
    getAccountInsights(adAccountId, period),
    getCampaignInsights(adAccountId, period),
    getDailyInsights(adAccountId, period),
    getAdInsights(adAccountId, period),
  ]);

  const last14 = (daily ?? []).slice(-14);
  const top5ads = (ads ?? []).slice(0, 5);

  // ── Build Gemini prompt ───────────────────────────────────────────────────
  const fmtCampaigns = (campaigns ?? []).map((c: MetaInsights & { campaign_name?: string }, i: number) =>
    `${i + 1}. ${(c as { campaign_name?: string }).campaign_name ?? `Campagne ${i + 1}`}
   Dépense: ${f(c.spend)}€ | Leads: ${c.leads} | CPL: ${c.cpl > 0 ? f(c.cpl) + "€" : "—"} | CTR: ${f(c.ctr)}% | CPM: ${f(c.cpm)}€ | Impressions: ${c.impressions?.toLocaleString("fr-FR")}`
  ).join("\n");

  const fmtAds = top5ads.map((ad: MetaAdInsight, i: number) =>
    `${i + 1}. ${ad.ad_name} [${ad.status ?? "?"}]
   Dépense: ${f(ad.spend)}€ | Leads: ${ad.leads} | CPL: ${ad.cpl > 0 ? f(ad.cpl) + "€" : "—"} | CTR: ${f(ad.ctr)}% | CPM: ${f(ad.cpm)}€`
  ).join("\n");

  const fmtDaily = last14.map((d: MetaInsights & { date?: string }) =>
    `${d.date ?? ""}: ${f(d.spend)}€ dép. | ${d.leads} leads | CPL ${d.cpl > 0 ? f(d.cpl) + "€" : "—"} | CTR ${f(d.ctr)}% | Imp. ${d.impressions?.toLocaleString("fr-FR")}`
  ).join("\n");

  const periodLabel: Record<string, string> = {
    last_7d: "7 derniers jours", last_14d: "14 derniers jours",
    last_30d: "30 derniers jours", last_90d: "90 derniers jours",
    this_month: "ce mois", last_month: "le mois dernier", maximum: "toute la durée",
  };

  const prompt = `Tu es un expert senior en media buying Meta Ads (Facebook/Instagram Ads), spécialisé dans la génération de leads B2B. Voici les données complètes de performance du compte publicitaire "${adAccountId}" sur la période : ${periodLabel[period] ?? period}.

===== RÉSUMÉ GLOBAL =====
- Dépense totale : ${f(summary?.spend ?? 0)} €
- Leads générés : ${summary?.leads ?? 0}
- CPL moyen : ${(summary?.cpl ?? 0) > 0 ? f(summary!.cpl) + " €" : "— (aucun lead)"}
- CTR : ${f(summary?.ctr ?? 0)} %
- CPM : ${f(summary?.cpm ?? 0)} €
- CPC : ${f(summary?.cpc ?? 0)} €
- Impressions : ${(summary?.impressions ?? 0).toLocaleString("fr-FR")}
- Portée : ${(summary?.reach ?? 0).toLocaleString("fr-FR")} personnes uniques
- Clics : ${(summary?.clicks ?? 0).toLocaleString("fr-FR")}
- Taux de conversion (clics→leads) : ${(summary?.clicks ?? 0) > 0 ? f(((summary!.leads / summary!.clicks) * 100)) + " %" : "—"}
- Période couverte : ${summary?.date_start ?? ""} → ${summary?.date_stop ?? ""}

===== PAR CAMPAGNE (${(campaigns ?? []).length} campagnes) =====
${fmtCampaigns || "Aucune donnée campagne disponible."}

===== TOP ${top5ads.length} CRÉATIVES (par dépense) =====
${fmtAds || "Aucune donnée créative disponible."}

===== ÉVOLUTION QUOTIDIENNE (${last14.length} derniers jours) =====
${fmtDaily || "Aucune donnée quotidienne disponible."}

===== BENCHMARKS META ADS B2B (références sectorielles) =====
- CPL B2B : bon < 80€ | acceptable < 150€ | à optimiser > 150€
- CTR : bon > 1,5% | acceptable > 0,8% | faible < 0,8%
- CPM : bon < 10€ | acceptable < 20€ | élevé > 20€
- CPC : bon < 3€ | acceptable < 6€ | élevé > 6€
- Taux de conversion : bon > 10% | acceptable > 5% | faible < 5%

---

Génère maintenant le brief analytique complet en français. Sois factuel, précis et actionnable. Utilise uniquement les données fournies.

# BRIEF ANALYTIQUE — CAMPAGNES META ADS
**Période :** ${periodLabel[period] ?? period} (${summary?.date_start ?? ""} → ${summary?.date_stop ?? ""})
**Compte :** ${adAccountId}
**Généré le :** ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}

---

## 1. SYNTHÈSE EXÉCUTIVE

[3-4 phrases résumant la performance globale, le positionnement par rapport aux benchmarks, et le verdict global (excellent / correct / à optimiser).]

## 2. ANALYSE GLOBALE DE PERFORMANCE

[Analyse détaillée et critique de chaque KPI : dépense, leads, CPL, CTR, CPM, CPC, taux de conversion. Comparer aux benchmarks.]

## 3. ANALYSE PAR CAMPAGNE

[Pour chaque campagne : performance, comparaison entre elles, identification de la plus performante et explication du pourquoi.]

## 4. ANALYSE DES CRÉATIVES

[Analyse des top créatives : quelle(s) performent le mieux, quels patterns de performance, recommandations sur les créatives.]

## 5. POINTS FORTS ✅

[Liste bullet des éléments positifs et des succès à maintenir.]

## 6. POINTS DE VIGILANCE ⚠️

[Liste bullet des risques, anomalies, métriques dégradées et alertes.]

## 7. RECOMMANDATIONS PRIORITAIRES 🎯

[3-5 actions concrètes, ordonnées par impact potentiel sur les performances.]

## 8. PLAN D'ACTION

[Tableau ou liste structurée des actions avec : Action | Priorité (HAUTE/MOYENNE/BASSE) | Impact attendu]

---
*Brief généré automatiquement par Lead Factory Analytics via Gemini 2.0 Flash*`;

  // ── Call Gemini — try models in order until one succeeds ─────────────────
  const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const MODELS = ["gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-2.0-flash"];
  let brief = "";
  let lastError: unknown;

  for (const modelName of MODELS) {
    try {
      const model  = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      brief = result.response.text();
      break;
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      // Only retry on 429 quota errors — propagate other errors immediately
      if (!msg.includes("429")) throw err;
    }
  }

  if (!brief) {
    const msg = lastError instanceof Error ? lastError.message : "Quota Gemini épuisé";
    return NextResponse.json(
      { error: `Quota Gemini épuisé sur tous les modèles. Activez la facturation sur Google AI Studio (ai.google.dev) pour débloquer les limites. Détail : ${msg.slice(0, 200)}` },
      { status: 429 }
    );
  }

  return NextResponse.json({ brief });

  } catch (err: unknown) {
    console.error("[export-brief]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
