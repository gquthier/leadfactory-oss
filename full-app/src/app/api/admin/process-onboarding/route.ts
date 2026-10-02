import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { buildClientWelcomeEmail } from "@/lib/client-welcome-email";
import {
  getCampaignStatusWriteCandidates,
  isCampaignStatusEnumError,
} from "@/lib/campaign-status";
import { logActivity } from "@/lib/activity-log";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { onboarding_response_id } = await req.json();
  if (!onboarding_response_id) return NextResponse.json({ error: "onboarding_response_id requis" }, { status: 400 });

  const { data: onboarding } = await adminSupabase
    .from("onboarding_responses")
    .select("*")
    .eq("id", onboarding_response_id)
    .single();

  if (!onboarding) return NextResponse.json({ error: "Brief introuvable" }, { status: 404 });
  if (onboarding.client_id) return NextResponse.json({ error: "Ce brief a déjà été traité" }, { status: 400 });

  const r = onboarding.responses as Record<string, unknown>;
  const entreprise = String(r.a_entreprise || "Client").trim();
  const budget = r.g_budget ? parseFloat(String(r.g_budget)) : null;
  const objectif = Array.isArray(r.b_objectif) ? r.b_objectif[0] : String(r.b_objectif || "leads");

  // Utiliser uniquement l’adresse fournie pour ce client.
  const email = typeof r.i_email === "string" ? r.i_email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Un email client valide est requis dans le brief" }, { status: 400 });
  const tempPassword = `${randomUUID()}-${randomUUID()}`;

  // 1. Créer l'utilisateur auth
  const { data: newUser, error: userError } = await adminSupabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: entreprise },
  });

  if (userError) return NextResponse.json({ error: `Erreur création user: ${userError.message}` }, { status: 500 });

  const userId = newUser.user.id;

  // 2. Upsert le profil pour garantir qu'il existe avec les bonnes données
  // Le trigger handle_new_user peut avoir un délai, donc on utilise upsert
  // pour créer la row si elle n'existe pas encore, ou la mettre à jour si elle existe.
  const { error: profileError } = await adminSupabase.from("profiles").upsert({
    id: userId,
    email: newUser.user.email!,
    full_name: entreprise,
    role: "client",
    company: entreprise,
    phone: String(r.e_qui_repond || ""),
    managed_by: session.user.id,
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  if (profileError) {
    return NextResponse.json(
      { error: `Erreur profil: ${profileError.message}` },
      { status: 500 }
    );
  }

  // 3. Créer la campagne
  let campaign: { id: string } | null = null;
  let campaignError: { message: string } | null = null;

  for (const status of getCampaignStatusWriteCandidates("brief_received")) {
    const result = await adminSupabase
      .from("campaigns")
      .insert({
        client_id: userId,
        onboarding_response_id,
        name: `Campagne Meta — ${entreprise}`,
        status,
        budget_monthly: budget,
        platform: "meta",
        objective: objectif,
        managed_by: session.user.id,
      })
      .select()
      .single();

    campaign = result.data;
    campaignError = result.error;

    if (!campaignError) {
      break;
    }

    if (!isCampaignStatusEnumError(campaignError.message)) {
      break;
    }
  }

  if (campaignError || !campaign) {
    return NextResponse.json(
      { error: `Erreur campagne: ${campaignError?.message ?? "campagne introuvable"}` },
      { status: 500 }
    );
  }

  // 4. Lier l'onboarding au client + campagne
  await adminSupabase.from("onboarding_responses").update({
    client_id: userId,
    campaign_id: campaign.id,
    reviewed_by: session.user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", onboarding_response_id);

  // 5. Créer les tâches onboarding par défaut
  const defaultTasks = [
    { client_id: userId, created_by: session.user.id, title: "Partager votre compte Meta Ads Manager", description: "Créez et/ou partagez l'accès à votre compte Meta Ads Manager ainsi que vos pages Facebook et Instagram." },
    { client_id: userId, created_by: session.user.id, title: "Partager l'accès à Google Analytics", description: "Partagez l'accès à votre compte Google Analytics (ou créez un compte si vous n'en avez pas encore)." },
    { client_id: userId, created_by: session.user.id, title: "Envoyer vos visuels et branding", description: "Partagez le maximum de visuels, logos, chartes graphiques et tout asset créatif qui pourrait nous être utile (lien WeTransfer, Drive, Dropbox...)." },
  ];
  await adminSupabase.from("client_tasks").insert(defaultTasks);

  // 6. Fire-and-forget AI generation — signed with INTERNAL_TRIGGER_SECRET
  const internalSecret = process.env.INTERNAL_TRIGGER_SECRET;
  if (internalSecret) {
    fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/generate-ai-assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
      },
      body: JSON.stringify({ campaignId: campaign.id }),
    }).catch(() => {});
  } else {
    console.warn('[process-onboarding] INTERNAL_TRIGGER_SECRET missing — skipping AI generation');
  }

  // 7. Envoyer l'email de bienvenue avec les identifiants
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  await sendEmail({
    to: email,
    subject: "Bienvenue chez Lead Factory",
    html: buildClientWelcomeEmail({
      clientName: entreprise,
      email,
      password: tempPassword,
      appUrl,
    }),
  });

  // Log onboarding processed
  logActivity({
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    actorRole: "admin",
    action: "onboarding_processed",
    targetType: "client",
    targetId: userId,
    targetLabel: entreprise,
    metadata: { campaign_id: campaign.id, onboarding_response_id },
  });

  return NextResponse.json({
    success: true,
    email,
    client_id: userId,
    campaign_id: campaign.id,
  });
}
