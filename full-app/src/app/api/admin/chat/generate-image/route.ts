import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

interface GenerateImageRequestBody {
  prompt: string;
  clientId?: string;
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
  const body: GenerateImageRequestBody = await req.json();
  const { prompt, clientId } = body;

  if (!prompt) {
    return NextResponse.json({ error: "Prompt requis" }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY non configurée" },
      { status: 500 }
    );
  }

  // ── 3. Enrich prompt with client context if provided ──────────────────────
  let enrichedPrompt = prompt;

  if (clientId) {
    try {
      const { data: activeClient } = await adminSupabase
        .from("profiles")
        .select("full_name, company")
        .eq("id", clientId)
        .single();

      if (activeClient) {
        enrichedPrompt = `Créative Meta Ads pour ${activeClient.company ?? activeClient.full_name ?? "un client"}. ${prompt}`;
      }
    } catch (err) {
      console.error("[generate-image] Client load error:", err);
    }
  }

  // ── 4. Call Gemini image generation via REST API ──────────────────────────
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: enrichedPrompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[generate-image] Gemini API error:", response.status, errorText);
      return NextResponse.json(
        { error: `Erreur API Gemini: ${response.status}` },
        { status: 500 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePart = parts.find((p: any) => p.inlineData);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textPart = parts.find((p: any) => p.text);

    if (!imagePart) {
      console.error("[generate-image] No image in Gemini response:", JSON.stringify(data, null, 2));
      return NextResponse.json(
        {
          error: "Aucune image générée. Le modèle n'a pas pu créer d'image pour ce prompt.",
          text: textPart?.text ?? "",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png",
      text: textPart?.text ?? "",
    });
  } catch (err: unknown) {
    console.error("[generate-image] Error:", err);
    const message =
      err instanceof Error ? err.message : "Erreur inconnue lors de la génération";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
