import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAccountInsights, getDailyInsights, getCampaignInsights, type DatePreset } from "@/lib/meta-api";
import { getGeminiApiKey } from "@/lib/gemini-key";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSystemPrompt } from "@/lib/ads-knowledge";

const STATUS_LABELS: Record<string, string> = {
  new: "Nouveau",
  contacted: "Contacté",
  qualified: "Qualifié",
  converted: "Converti",
  lost: "Perdu",
};

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const { message, campaign_id, history = [], period = "last_30d" } = body as {
    message?: string;
    campaign_id?: string;
    history?: Array<{ role: string; content: string }>;
    period?: string;
  };

  if (!message?.trim()) return NextResponse.json({ error: "Message requis" }, { status: 400 });

  const adminSupabase = createAdminClient();

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role, full_name, company")
    .eq("id", session.user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 403 });

  // ── Résolution du compte Meta selon le rôle ──────────────────────
  let adAccountId: string | null = null;
  let campaignName = "";
  let clientName = (profile.company || profile.full_name || "") as string;

  if (profile.role === "admin") {
    if (campaign_id) {
      const { data: campaign } = await adminSupabase
        .from("campaigns")
        .select("ad_account_id, name, profiles:profiles!campaigns_client_id_fkey(full_name, company)")
        .eq("id", campaign_id)
        .single();

      adAccountId = (campaign?.ad_account_id as string) ?? null;
      campaignName = (campaign?.name as string) ?? "";
      const p = campaign?.profiles as { full_name?: string; company?: string } | null;
      clientName = p?.company || p?.full_name || "le client";
    }
  } else {
    const { data: campaign } = await adminSupabase
      .from("campaigns")
      .select("ad_account_id, name")
      .eq("client_id", session.user.id)
      .not("ad_account_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    adAccountId = (campaign?.ad_account_id as string) ?? null;
    campaignName = (campaign?.name as string) ?? "";
  }

  // ── Données Meta ─────────────────────────────────────────────────
  let metaContext = "Aucune donnée Meta disponible — le compte publicitaire n'est pas encore lié à cette campagne.";

  if (adAccountId && process.env.META_ACCESS_TOKEN) {
    try {
      const [summary, daily, campaigns] = await Promise.all([
        getAccountInsights(adAccountId, period as DatePreset),
        getDailyInsights(adAccountId, period as DatePreset),
        getCampaignInsights(adAccountId, period as DatePreset),
      ]);

      const lines: string[] = [];

      if (summary) {
        lines.push(`## Résumé des performances (période : ${period})`);
        lines.push(`- Dépenses totales : ${summary.spend.toFixed(2)} €`);
        lines.push(`- Leads générés : ${summary.leads}`);
        lines.push(`- CPL : ${summary.cpl > 0 ? summary.cpl.toFixed(2) + " €" : "Non disponible"}`);
        lines.push(`- Impressions : ${summary.impressions.toLocaleString("fr-FR")}`);
        lines.push(`- Portée : ${summary.reach.toLocaleString("fr-FR")} personnes`);
        lines.push(`- CTR : ${summary.ctr.toFixed(2)} %`);
        lines.push(`- CPC : ${summary.cpc.toFixed(2)} €`);
        lines.push(`- CPM : ${summary.cpm.toFixed(2)} €`);
        lines.push(`- Période : du ${summary.date_start} au ${summary.date_stop}`);
      } else {
        lines.push("Aucune donnée disponible pour cette période.");
      }

      if (campaigns.length > 0) {
        lines.push(`\n## Par campagne`);
        for (const c of campaigns.slice(0, 10)) {
          lines.push(
            `- **${c.campaign_name}** : ${c.spend.toFixed(2)} € dépensés, ${c.leads} lead(s)` +
            (c.cpl > 0 ? `, CPL ${c.cpl.toFixed(2)} €` : "") +
            `, CTR ${c.ctr.toFixed(2)} %`
          );
        }
      }

      if (daily.length > 0) {
        const totalLeads = daily.reduce((s, d) => s + d.leads, 0);
        const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
        const activeDays = daily.filter((d) => d.spend > 0).length || 1;

        lines.push(`\n## Évolution (${daily.length} jours, ${activeDays} actifs)`);
        lines.push(`- Moyenne/jour : ${(totalSpend / activeDays).toFixed(2)} €, ${(totalLeads / activeDays).toFixed(1)} leads`);

        const last7 = daily.slice(-7);
        lines.push(`- 7 derniers jours : ${last7.reduce((s, d) => s + d.spend, 0).toFixed(2)} €, ${last7.reduce((s, d) => s + d.leads, 0)} leads`);

        const mid = Math.floor(daily.length / 2);
        const leadsFirst = daily.slice(0, mid).reduce((s, d) => s + d.leads, 0);
        const leadsSecond = daily.slice(mid).reduce((s, d) => s + d.leads, 0);
        lines.push(`- Tendance : ${leadsSecond > leadsFirst ? "hausse" : leadsSecond < leadsFirst ? "baisse" : "stable"} (${leadsFirst} → ${leadsSecond} leads)`);

        const best = daily.reduce((b, d) => (d.leads > b.leads ? d : b), daily[0]);
        if (best.leads > 0) lines.push(`- Meilleur jour : ${best.date} — ${best.leads} leads pour ${best.spend.toFixed(2)} €`);
      }

      metaContext = lines.join("\n");
    } catch (e) {
      metaContext = `Erreur lors de la récupération des données Meta : ${e instanceof Error ? e.message : "inconnue"}`;
    }
  }

  // ── Données Leads CRM (clients uniquement) ────────────────────────
  let leadsContext = "";

  if (profile.role !== "admin") {
    try {
      const { data: leads } = await adminSupabase
        .from("leads")
        .select("id, status, quality_score, cash_collected, meta_created_at, created_at")
        .eq("client_id", session.user.id)
        .order("created_at", { ascending: false });

      if (leads && leads.length > 0) {
        const byStatus = leads.reduce((acc: Record<string, number>, l) => {
          acc[l.status] = (acc[l.status] || 0) + 1;
          return acc;
        }, {});

        const convertedLeads = leads.filter(l => l.status === "converted");
        const totalCash = convertedLeads.reduce((s, l) => s + (Number(l.cash_collected) || 0), 0);

        const now = Date.now();
        const cut7  = new Date(now - 7  * 86400000).toISOString();
        const cut30 = new Date(now - 30 * 86400000).toISOString();
        const cut60 = new Date(now - 60 * 86400000).toISOString();

        const getDate = (l: { meta_created_at: string | null; created_at: string }) =>
          l.meta_created_at || l.created_at;

        const last7d  = leads.filter(l => getDate(l) >= cut7).length;
        const last30d = leads.filter(l => getDate(l) >= cut30).length;
        const prev30d = leads.filter(l => getDate(l) >= cut60 && getDate(l) < cut30).length;

        const withScore = leads.filter(l => l.quality_score != null);
        const avgQuality = withScore.length > 0
          ? (withScore.reduce((s, l) => s + (l.quality_score as number), 0) / withScore.length).toFixed(1)
          : null;

        const conversionRate = leads.length > 0
          ? (((byStatus.converted || 0) / leads.length) * 100).toFixed(1)
          : "0";

        const trendStr = prev30d > 0
          ? (last30d >= prev30d ? `hausse (${prev30d} → ${last30d})` : `baisse (${prev30d} → ${last30d})`)
          : null;

        const lines: string[] = [];
        lines.push("## Leads CRM — base de données Lead Factory");
        lines.push(`- Total leads en base : ${leads.length}`);
        lines.push(`- Par statut : ${Object.entries(byStatus).map(([s, n]) => `${STATUS_LABELS[s] || s} (${n})`).join(", ")}`);
        lines.push(`- Taux de conversion : ${conversionRate}%`);
        if (totalCash > 0) {
          lines.push(`- Cash collecté (deals signés) : ${totalCash.toFixed(2)} €`);
        } else if (byStatus.converted) {
          lines.push(`- Leads convertis / signés : ${byStatus.converted} (valeur non renseignée)`);
        }
        lines.push(`- 7 derniers jours : ${last7d} nouveaux leads`);
        lines.push(`- 30 derniers jours : ${last30d} nouveaux leads`);
        if (trendStr) lines.push(`- Tendance mensuelle : ${trendStr}`);
        if (avgQuality) lines.push(`- Qualité moyenne : ${avgQuality}/5`);

        leadsContext = lines.join("\n");
      } else {
        leadsContext = "## Leads CRM\nAucun lead en base de données pour l'instant.";
      }
    } catch {
      leadsContext = "";
    }
  }

  // ── Clé Gemini ───────────────────────────────────────────────────
  const geminiKey = await getGeminiApiKey(adminSupabase);
  if (!geminiKey) {
    return NextResponse.json(
      { error: "Clé Gemini non configurée. Rendez-vous dans Paramètres pour l'ajouter." },
      { status: 500 }
    );
  }

  // ── System prompt selon le rôle ──────────────────────────────────
  let systemPrompt: string;

  if (profile.role === "admin") {
    // Admin : AdsAsset knowledge (LeadBot) + génération de créatives HTML
    const dbContext = [
      campaignName ? `Campagne active : "${campaignName}"` : "",
      clientName ? `Client : "${clientName}"` : "",
      metaContext,
    ].filter(Boolean).join("\n\n");

    systemPrompt = buildSystemPrompt(dbContext) + `

---

## GÉNÉRATION DE CRÉATIVES HTML — INSTRUCTIONS

Quand l'utilisateur demande une créative, un visuel, une image ou utilise les mots "génère", "fais", "crée", "montre" :

Tu génères directement le code HTML/CSS complet d'une créative 1080×1080px.

Règles impératives :
- Renvoie UN SEUL bloc \`\`\`html ... \`\`\` contenant le HTML complet avec les styles inline ou un <style> intégré
- Dimensions fixes : width: 1080px, height: 1080px sur le body et l'élément racine
- Utilise des polices Google Fonts (lien <link> dans le <head>) — recommandées : Space Grotesk, Inter, Bebas Neue
- Respecte les 8 layouts templates définis dans le skill (Grosse Promesse, Avant/Après, Timeline, etc.)
- Copy en français sauf si demandé autrement
- Qualité production : couleurs nettes, typographie large et lisible, zones de sécurité 40px
- Pas de JavaScript, pas d'images externes (utilise des formes CSS pures ou des emojis)
- Si l'utilisateur spécifie un layout (ex: "layout 1", "avant/après"), applique-le exactement
- Génère toujours une créative prête à l'emploi, avec le vrai copy adapté au client si le contexte est disponible

Avant le bloc HTML, écris 1-2 phrases maximum décrivant le layout choisi et le copy.`;
  } else {
    // Client : Opti
    systemPrompt = `Tu es Opti, l'assistant analyste expert en publicité Meta de l'agence Lead Factory. Tu travailles pour ${clientName ? `"${clientName}"` : "ton client"}.

Tu analyses la campagne "${campaignName || "en cours"}".

DONNÉES DE PERFORMANCE META EN TEMPS RÉEL :
${metaContext}
${leadsContext ? `\n${leadsContext}` : ""}

TON CARACTÈRE — respecte-le à la lettre :
- Tu tutoies toujours la personne.
- Tu es un bourreau de travail : direct, efficace, sans fioritures. Tu vas droit au but.
- Zéro flatterie inutile. Pas de "super question !", pas de "excellente initiative !". Tu réponds, tu analyses, tu conclus.
- Tu es optimiste mais factuel : tu cherches le positif dans les données sans forcer. Si c'est bien, tu le dis clairement. Si c'est moins bien, tu l'expliques avec le contexte (marché, saisonnalité, apprentissage) — jamais par une erreur de l'équipe Lead Factory.
- Tu fais confiance au travail de l'équipe Lead Factory. Tu ne critiques JAMAIS leurs choix stratégiques, créatifs ou budgétaires.
- Tu parles en chiffres concrets. Pas de blabla vague, pas de généralités.
- EMOJIS : tu n'utilises QUE l'emoji 🧑‍🍳. Pas d'autres emojis.
- Si les données sont absentes, tu le signales sobrement et tu expliques comment les obtenir.
- Tu ne parles que des données de ce client — jamais d'autres comptes.

POSTURE POSITIVE MAIS SOBRE :
- Un CPL qui monte ? Tu l'expliques par le contexte et tu identifies ce qui reste solide.
- Peu de leads ? Tu mets en avant les impressions, le CTR ou la portée construite.
- Baisse de volume ? Tu contextualises avec la saisonnalité ou la phase de campagne.
- Tu conclus toujours sur ce qui est en bonne voie — sans t'emballer.`;
  }

  // ── Appel Gemini ─────────────────────────────────────────────────
  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const contents = [
      ...history.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const result = await model.generateContent({
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      contents,
    });

    const text = result.response.text();
    return NextResponse.json({ response: text, hasMetaData: !!adAccountId });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[AI Chat] Gemini error:", detail);
    return NextResponse.json(
      { error: `Erreur Gemini : ${detail}` },
      { status: 500 }
    );
  }
}
