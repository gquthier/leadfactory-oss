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

  const body = await req.json();
  const {
    full_name,
    company,
    email: customEmail,
    phone,
    ad_account_id,
    ad_account_name,
  } = body as {
    full_name: string;
    company?: string;
    email?: string;
    phone?: string;
    ad_account_id?: string;
    ad_account_name?: string;
  };

  if (!full_name?.trim()) return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });

  const entreprise = (company || full_name).trim();
  const email = typeof customEmail === "string" ? customEmail.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Un email client valide est requis" }, { status: 400 });
  const tempPassword = `${randomUUID()}-${randomUUID()}`;

  // 1. Créer l'utilisateur auth
  const { data: newUser, error: userError } = await adminSupabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: full_name.trim() },
  });

  if (userError) return NextResponse.json({ error: `Erreur création compte : ${userError.message}` }, { status: 500 });
  const userId = newUser.user.id;

  // 2. Mettre à jour le profil
  await adminSupabase.from("profiles").update({
    full_name: full_name.trim(),
    company: entreprise,
    phone: phone?.trim() || "",
    managed_by: session.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", userId);

  // 3. Créer une campagne si un compte Meta est fourni
  let campaignId: string | null = null;
  if (ad_account_id) {
    const accountId = ad_account_id.startsWith("act_") ? ad_account_id.slice(4) : ad_account_id;
    for (const status of getCampaignStatusWriteCandidates("meta_account_setup")) {
      const { data: campaign, error } = await adminSupabase
        .from("campaigns")
        .insert({
          client_id: userId,
          name: `Campagne Meta — ${entreprise}`,
          status,
          platform: "meta",
          ad_account_id: accountId,
          managed_by: session.user.id,
        })
        .select("id")
        .single();

      if (!error) {
        campaignId = campaign?.id ?? null;
        break;
      }

      if (!isCampaignStatusEnumError(error.message)) {
        return NextResponse.json({ error: `Erreur campagne : ${error.message}` }, { status: 500 });
      }
    }
  }

  // 3b. Créer les tâches onboarding par défaut
  const defaultTasks = [
    { client_id: userId, created_by: session.user.id, title: "Partager votre compte Meta Ads Manager", description: "Créez et/ou partagez l'accès à votre compte Meta Ads Manager ainsi que vos pages Facebook et Instagram." },
    { client_id: userId, created_by: session.user.id, title: "Partager l'accès à Google Analytics", description: "Partagez l'accès à votre compte Google Analytics (ou créez un compte si vous n'en avez pas encore)." },
    { client_id: userId, created_by: session.user.id, title: "Envoyer vos visuels et branding", description: "Partagez le maximum de visuels, logos, chartes graphiques et tout asset créatif qui pourrait nous être utile (lien WeTransfer, Drive, Dropbox...)." },
  ];
  await adminSupabase.from("client_tasks").insert(defaultTasks);

  // 4. Envoyer email de bienvenue
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  await sendEmail({
    to: email,
    subject: "Bienvenue chez Lead Factory",
    html: buildClientWelcomeEmail({
      clientName: full_name.trim(),
      email,
      password: tempPassword,
      appUrl,
    }),
  });

  // Log client creation
  logActivity({
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    actorRole: "admin",
    action: "client_created",
    targetType: "client",
    targetId: userId,
    targetLabel: full_name.trim(),
    metadata: { company: entreprise, email, campaign_id: campaignId },
  });

  return NextResponse.json({
    success: true,
    email,
    client_id: userId,
    campaign_id: campaignId,
    ad_account_name: ad_account_name || null,
  });
}
