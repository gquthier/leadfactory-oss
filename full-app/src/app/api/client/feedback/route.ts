import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { message, category } = await req.json() as { message: string; category: string };
  if (!message?.trim()) return NextResponse.json({ error: "Message vide" }, { status: 400 });

  // Fetch client name for context
  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("full_name, company, email")
    .eq("id", session.user.id)
    .single();

  const clientName = profile?.company || profile?.full_name || session.user.email;

  // Send notification email to admin
  sendEmail({
    to: "contact@example.com",
    subject: `[Feedback client] ${category} — ${clientName}`,
    html: `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:3px solid #000;max-width:600px;width:100%;">
<tr><td style="background:#0047FF;padding:28px 40px;border-bottom:3px solid #000;">
<span style="color:#fff;font-size:28px;font-weight:900;text-transform:uppercase;">LeadFactory</span>
<span style="color:#FDE047;font-weight:900;font-size:14px;margin-left:12px;">Nouveau Feedback</span>
</td></tr>
<tr><td style="padding:40px;">
<p style="font-size:14px;margin:0 0 8px;"><strong>Client :</strong> ${clientName}</p>
<p style="font-size:14px;margin:0 0 8px;"><strong>Email :</strong> ${profile?.email ?? session.user.email}</p>
<p style="font-size:14px;margin:0 0 24px;"><strong>Catégorie :</strong> ${category}</p>
<div style="background:#FFF9C4;border:3px solid #000;padding:20px 24px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${message}</div>
</td></tr>
</table></td></tr></table>
</body></html>`.trim(),
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
