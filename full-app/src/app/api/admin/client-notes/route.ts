import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";

// GET /api/admin/client-notes?campaign_id=xxx
export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaign_id");
  if (!campaignId) return NextResponse.json({ error: "campaign_id requis" }, { status: 400 });

  const { data, error } = await adminSupabase
    .from("client_notes")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data });
}

// POST /api/admin/client-notes
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { campaign_id, client_id, content } = await req.json();
  if (!campaign_id || !client_id || !content?.trim()) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  const { data: note, error } = await adminSupabase
    .from("client_notes")
    .insert({ campaign_id, client_id, content: content.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Envoyer un email de notification au client (non bloquant)
  const { data: clientProfile } = await adminSupabase
    .from("profiles")
    .select("email, full_name, company")
    .eq("id", client_id)
    .single();

  const { data: campaign } = await adminSupabase
    .from("campaigns")
    .select("name")
    .eq("id", campaign_id)
    .single();

  if (clientProfile?.email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const clientName = clientProfile.full_name || clientProfile.company || "Client";
    const campaignName = campaign?.name || "votre campagne";

    sendEmail({
      to: clientProfile.email,
      subject: `Nouveau message de votre gestionnaire — ${campaignName}`,
      html: `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:3px solid #000;max-width:600px;width:100%;">
<tr><td style="background:#0047FF;padding:24px 40px;border-bottom:3px solid #000;">
<span style="color:#fff;font-size:24px;font-weight:900;text-transform:uppercase;">LeadFactory</span>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="font-size:15px;margin:0 0 16px;">Bonjour <strong>${clientName}</strong>,</p>
<p style="font-size:15px;margin:0 0 24px;">Votre gestionnaire vous a envoyé un nouveau message concernant <strong>${campaignName}</strong> :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFDF5;border:3px solid #000;margin-bottom:28px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0;font-size:15px;white-space:pre-wrap;">${content.trim()}</p>
</td></tr></table>
<a href="${appUrl}/client/campaigns/${campaign_id}" style="display:inline-block;background:#000;color:#FDE047;font-weight:900;font-size:14px;text-transform:uppercase;letter-spacing:1px;padding:14px 28px;text-decoration:none;border:3px solid #000;">
  Voir dans mon espace →
</a>
<p style="font-size:14px;margin:32px 0 0;font-weight:700;">L'équipe Lead Factory</p>
</td></tr>
<tr><td style="background:#f5f5f5;border-top:3px solid #000;padding:16px 40px;">
<p style="margin:0;font-size:12px;color:#888;">Cet email a été envoyé automatiquement.</p>
</td></tr>
</table></td></tr></table>
</body></html>`.trim(),
    }).catch(() => {});
  }

  return NextResponse.json({ note });
}
