import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { buildBasePrompt, buildClaudeSystemPrompt, buildClaudeUserPrompt } from "@/lib/generate-creative-prompt";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { campaign_id } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  const { data: campaign } = await adminSupabase
    .from("campaigns")
    .select("onboarding_response_id, name")
    .eq("id", campaign_id)
    .single();

  if (!campaign?.onboarding_response_id) {
    return NextResponse.json({ error: "Aucun brief associé à cette campagne" }, { status: 400 });
  }

  const { data: onboarding } = await adminSupabase
    .from("onboarding_responses")
    .select("responses")
    .eq("id", campaign.onboarding_response_id)
    .single();

  if (!onboarding?.responses) {
    return NextResponse.json({ error: "Brief introuvable" }, { status: 404 });
  }

  const baseBrief = buildBasePrompt(onboarding.responses as Record<string, unknown>);
  const systemPrompt = buildClaudeSystemPrompt();
  const userPrompt = buildClaudeUserPrompt(baseBrief);

  if (!process.env.GEMINI_API_KEY) {
    // Fallback si pas de clé Gemini
    const fallback = `${userPrompt}\n\n---\n\n⚠️ Gemini non configuré (GEMINI_API_KEY manquante) — Voici le brief structuré :\n\n${baseBrief}`;
    await adminSupabase.from("campaigns").update({ ai_creative_prompt: fallback }).eq("id", campaign_id);
    return NextResponse.json({ prompt: fallback });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent(userPrompt);
  const promptText = result.response.text();

  await adminSupabase
    .from("campaigns")
    .update({ ai_creative_prompt: promptText, updated_at: new Date().toISOString() })
    .eq("id", campaign_id);

  return NextResponse.json({ prompt: promptText });
}
