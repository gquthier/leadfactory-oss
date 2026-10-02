import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin")
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await req.json();
  const { product, context, numSegments = 7 } = body as {
    product?: string;
    context?: string;
    numSegments?: number;
  };

  const productName = product?.trim();
  const productContext = context?.trim();
  if(!productName || !productContext)return NextResponse.json({error:"Produit et brief personnel requis."},{status:400});

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Tu es un expert en création de publicités UGC (User Generated Content) pour les réseaux sociaux (TikTok, Instagram Reels, YouTube Shorts).

Génère un script UGC percutant pour ce produit/service :
**Produit**: ${productName}
**Contexte**: ${productContext}

N’invente aucun montant, résultat, nom de client ou témoignage. Les preuves doivent être explicitement fournies et autorisées dans le brief.
Génère exactement ${numSegments} segments de captions, chacun sur 2-3 lignes maximum.
Chaque segment doit :
- Être en MAJUSCULES
- Être court et impactant (max 5 mots par ligne)
- Raconter une histoire progressive (hook → problème → solution → résultat → prix → CTA)

Format de réponse STRICT (séparés par ---) :
LIGNE 1
LIGNE 2
LIGNE 3
---
LIGNE 1
LIGNE 2
---
(etc.)

Aucun autre texte, juste les segments séparés par ---.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const segments = text
      .split("---")
      .map((s: string) => s.trim())
      .filter(Boolean);

    return NextResponse.json({ script: text, segments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
