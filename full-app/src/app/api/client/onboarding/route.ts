import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("onboarding_responses")
    .select("id, responses, submitted_at")
    .eq("client_id", session.user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ brief: null });
  }
  return NextResponse.json({
    brief: {
      id: data.id,
      responses: data.responses ?? {},
      submitted_at: data.submitted_at,
    },
  });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    patch?: Record<string, unknown>;
  } | null;
  if (!body || !body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "patch manquant" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Récupère le brief le plus récent du client
  const { data: existing, error: fetchError } = await admin
    .from("onboarding_responses")
    .select("id, responses, client_id")
    .eq("client_id", session.user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Aucun brief trouvé pour ce client" },
      { status: 404 }
    );
  }

  // Defense in depth : on re-check que c'est bien son brief
  if (existing.client_id !== session.user.id) {
    return NextResponse.json({ error: "Brief non autorisé" }, { status: 403 });
  }

  // Champs jamais éditables côté client (sécurité + intégrité)
  const FORBIDDEN_KEYS = new Set([
    "i_email",
    "i_password",
    "i_password_confirm",
  ]);

  const previousResponses = (existing.responses ?? {}) as Record<string, unknown>;
  const sanitizedPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    sanitizedPatch[key] = value;
  }
  const newResponses = { ...previousResponses, ...sanitizedPatch };

  const { error: updateError } = await admin
    .from("onboarding_responses")
    .update({ responses: newResponses })
    .eq("id", existing.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, responses: newResponses });
}
