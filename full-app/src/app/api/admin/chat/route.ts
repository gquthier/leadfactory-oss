import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { buildSystemPrompt } from "@/lib/ads-knowledge";
import { initMetaToken } from "@/lib/meta-token";
import {
  getAllAccountsInsights,
  getAccountInsights,
  getCampaignInsights,
  type DatePreset,
} from "@/lib/meta-api";

// ─── Gemini Tool Declarations ────────────────────────────────────────────────

const META_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "create_custom_audience",
        description:
          "Crée une audience personnalisée Meta dans un compte publicitaire. À utiliser quand l'utilisateur demande de créer une audience, un segment ou une liste de retargeting Meta.",
        parameters: {
          type: "object",
          properties: {
            ad_account_id: {
              type: "string",
              description:
                "ID du compte publicitaire Meta (format: act_XXXXXXXXX). Déduit depuis le contexte client/campagne disponible.",
            },
            name: {
              type: "string",
              description: "Nom de l'audience (clair, descriptif, max 100 caractères)",
            },
            description: {
              type: "string",
              description: "Description optionnelle de l'audience et de ses critères",
            },
            subtype: {
              type: "string",
              description:
                "Type d'audience: CUSTOM (liste clients), WEBSITE (visiteurs pixel), ENGAGEMENT (interactions FB/IG). Par défaut: CUSTOM",
            },
          },
          required: ["ad_account_id", "name"],
        },
      },
    ],
  },
];

interface HistoryPart {
  text: string;
}

interface HistoryEntry {
  role: "user" | "model";
  parts: HistoryPart[];
}

interface ChatRequestBody {
  message: string;
  history: HistoryEntry[];
  clientId?: string;
  imageBase64?: string;
  imageMimeType?: string;
  period?: string;
}

export async function POST(req: Request) {
  // ── 1. Auth — admin only ──────────────────────────────────────────────────
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const adminSupabase = createAdminClient();

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  const body: ChatRequestBody = await req.json();
  const { message, history = [], clientId, imageBase64, imageMimeType, period = "last_30d" } = body;

  if (!message && !imageBase64) {
    return NextResponse.json({ error: "Message requis" }, { status: 400 });
  }

  // ── 3. Load DB context ────────────────────────────────────────────────────
  let dbContext = "";

  try {
    // All clients (role = client)
    const { data: clients } = await adminSupabase
      .from("profiles")
      .select("id, full_name, company, email")
      .eq("role", "client");

    // All campaigns
    const { data: campaigns } = await adminSupabase
      .from("campaigns")
      .select("id, name, status, budget_monthly, ad_account_id, client_id");

    const clientList = (clients ?? [])
      .map(
        (c: { id: string; full_name: string | null; company: string | null; email: string | null }) =>
          `  - ${c.full_name ?? "Sans nom"} (${c.company ?? "—"}) <${c.email ?? "—"}> [id: ${c.id}]`
      )
      .join("\n");

    const campaignList = (campaigns ?? [])
      .map(
        (c: { id: string; name: string | null; status: string | null; budget_monthly: number | null; ad_account_id: string | null; client_id: string | null }) =>
          `  - ${c.name ?? "Sans nom"} | statut: ${c.status ?? "—"} | budget: ${c.budget_monthly ? c.budget_monthly + " €/mois" : "—"} | ad_account: ${c.ad_account_id ?? "non lié"} | client_id: ${c.client_id ?? "—"} [id: ${c.id}]`
      )
      .join("\n");

    dbContext = `CLIENTS (${(clients ?? []).length}) :\n${clientList || "  Aucun"}\n\nCAMPAGNES (${(campaigns ?? []).length}) :\n${campaignList || "  Aucune"}`;

    // ── Meta Ads context ────────────────────────────────────────────────────
    if (process.env.META_ACCESS_TOKEN) {
      try {
        let metaLines: string[] = [];

        if (clientId) {
          // Client sélectionné : insights de son compte Meta uniquement
          const clientCampaign = (campaigns ?? []).find(
            (c: { client_id: string | null; ad_account_id: string | null }) =>
              c.client_id === clientId && c.ad_account_id
          );
          if (clientCampaign?.ad_account_id) {
            const [summary, byCampaign] = await Promise.all([
              getAccountInsights(clientCampaign.ad_account_id, period as DatePreset),
              getCampaignInsights(clientCampaign.ad_account_id, period as DatePreset),
            ]);
            metaLines.push(`\nMETA ADS — compte ${clientCampaign.ad_account_id} (période : ${period}) :`);
            if (summary) {
              metaLines.push(`  Dépenses : ${summary.spend.toFixed(2)} € | Leads : ${summary.leads} | CPL : ${summary.cpl > 0 ? summary.cpl.toFixed(2) + " €" : "—"} | CTR : ${summary.ctr.toFixed(2)} % | CPC : ${summary.cpc.toFixed(2)} € | Impressions : ${summary.impressions.toLocaleString("fr-FR")}`);
            } else {
              metaLines.push("  Aucune donnée pour cette période.");
            }
            if (byCampaign.length > 0) {
              metaLines.push("  Par campagne :");
              for (const c of byCampaign.slice(0, 10)) {
                metaLines.push(`    - ${c.campaign_name} : ${c.spend.toFixed(2)} €, ${c.leads} lead(s)${c.cpl > 0 ? `, CPL ${c.cpl.toFixed(2)} €` : ""}, CTR ${c.ctr.toFixed(2)} %`);
              }
            }
          }
        } else {
          // Pas de client sélectionné : résumé de TOUS les comptes accessibles
          const allAccounts = await getAllAccountsInsights(period as DatePreset);
          if (allAccounts.length > 0) {
            metaLines.push(`\nMETA ADS — TOUS LES COMPTES (${allAccounts.length} actifs, période : ${period}) :`);
            let totalSpend = 0;
            let totalLeads = 0;
            for (const acc of allAccounts) {
              const ins = acc.insights;
              if (ins) {
                totalSpend += ins.spend;
                totalLeads += ins.leads;
                metaLines.push(
                  `  - ${acc.name} (${acc.id}) : ${ins.spend.toFixed(2)} € | ${ins.leads} leads | CPL ${ins.cpl > 0 ? ins.cpl.toFixed(2) + " €" : "—"} | CTR ${ins.ctr.toFixed(2)} % | CPC ${ins.cpc.toFixed(2)} €`
                );
              } else {
                metaLines.push(`  - ${acc.name} (${acc.id}) : aucune dépense sur cette période`);
              }
            }
            metaLines.push(`  TOTAL : ${totalSpend.toFixed(2)} € dépensés, ${totalLeads} leads générés`);
          }
        }

        if (metaLines.length > 0) dbContext += metaLines.join("\n");
      } catch (metaErr) {
        console.error("[chat] Meta context error:", metaErr);
        dbContext += "\n\nMETA ADS : Erreur lors de la récupération des données.";
      }
    }

    // If specific client requested, load their onboarding
    if (clientId) {
      const { data: onboardingData } = await adminSupabase
        .from("onboarding_responses")
        .select("responses, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: activeClient } = await adminSupabase
        .from("profiles")
        .select("full_name, company, email")
        .eq("id", clientId)
        .single();

      if (activeClient) {
        let activeClientInfo = `\nCLIENT ACTIF : ${activeClient.full_name ?? "—"} (${activeClient.company ?? "—"}) <${activeClient.email ?? "—"}>`;

        if (onboardingData?.responses) {
          const responses = onboardingData.responses as Record<string, unknown>;
          const onboardingLines = Object.entries(responses)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}`)
            .join("\n");
          activeClientInfo += `\nBRIEF ONBOARDING :\n${onboardingLines}`;
        }

        dbContext += activeClientInfo;
      }
    }
  } catch (err) {
    console.error("[chat] DB context error:", err);
    dbContext = "Erreur lors du chargement des données.";
  }

  // ── 4. Build system prompt ────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(dbContext);

  // ── 5. Initialize Gemini ──────────────────────────────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY non configurée" },
      { status: 500 }
    );
  }

  await initMetaToken(adminSupabase);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.7 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: META_TOOLS as any,
  });

  // ── 6. Build current message parts ───────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentParts: any[] = [];

  if (imageBase64 && imageMimeType) {
    currentParts.push({
      inlineData: {
        data: imageBase64,
        mimeType: imageMimeType,
      },
    });
  }

  currentParts.push({ text: message || "Analyse cette image." });

  // ── 7. Call Gemini with chat history ──────────────────────────────────────
  try {
    const chat = model.startChat({
      history: history.map((entry) => ({
        role: entry.role,
        parts: entry.parts,
      })),
    });

    const result = await chat.sendMessage(currentParts);
    const response = result.response;

    // ── Detect function calls (tool use) ──────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const functionCalls = (response as any).functionCalls?.();
    if (functionCalls && functionCalls.length > 0) {
      const fc = functionCalls[0] as { name: string; args: Record<string, string> };
      let confirmText = "";
      try { confirmText = response.text(); } catch { /* no text part */ }

      return NextResponse.json({
        pendingAction: { type: fc.name, params: fc.args },
        text: confirmText || null,
      });
    }

    return NextResponse.json({ text: response.text() });
  } catch (err: unknown) {
    console.error("[chat] Gemini error:", err);
    const message =
      err instanceof Error ? err.message : "Erreur inconnue Gemini";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
