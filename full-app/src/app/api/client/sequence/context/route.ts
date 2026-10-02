import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import {
  loadClientSequenceContext,
  summarizeContextForUI,
} from "@/lib/sequence-context";

export const dynamic = "force-dynamic";

// GET /api/client/sequence/context
// Retourne le contexte client résumé pour affichage UI (champ par champ)
// + un flag indiquant si l'onboarding a été complété
export async function GET() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const previewClientId = await getPreviewClientId();
  const clientId =
    profile?.role === "admin" && previewClientId ? previewClientId : session.user.id;

  const ctx = await loadClientSequenceContext(clientId, null);
  const summary = summarizeContextForUI(ctx);

  // Détecte si on a au moins de la matière à utiliser
  const hasOnboarding = summary.length >= 3;

  return NextResponse.json({
    context: ctx,
    summary,
    has_onboarding: hasOnboarding,
  });
}
