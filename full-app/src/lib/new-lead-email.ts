import { createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface NewLeadEmailContext {
  clientId: string;
  leadId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  notes?: string | null;
}

/**
 * Fire-and-forget. Don't await this from API routes; let it run in the background
 * so lead creation isn't slowed down by SMTP.
 */
export async function maybeSendNewLeadEmail(ctx: NewLeadEmailContext): Promise<void> {
  try {
    // Skip scraping leads entirely (same rule as the in-app trigger).
    const src = (ctx.source ?? "").toLowerCase();
    if (["scraping", "gmaps", "google_maps"].includes(src)) return;

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name, notify_new_lead_email, notify_new_lead")
      .eq("id", ctx.clientId)
      .maybeSingle();

    if (!profile?.email) return;
    if (profile.notify_new_lead === false) return;
    if (profile.notify_new_lead_email === false) return;

    const recipientName = profile.full_name?.split(" ")[0] ?? "Client";
    const leadDisplay = ctx.fullName ?? ctx.email ?? "Nouveau lead";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid";
    const crmUrl = `${appUrl}/client/crm`;

    const subject = `🎯 Nouveau lead — ${leadDisplay}${ctx.company ? ` (${ctx.company})` : ""}`;
    const html = renderEmailHtml({
      recipientName,
      leadDisplay,
      ctx,
      crmUrl,
    });

    await sendEmail({ to: profile.email, subject, html });
  } catch (err) {
    console.error("[new-lead-email] failed:", err);
    // Never throw — email failure must not affect the lead creation.
  }
}

function renderEmailHtml({
  recipientName,
  leadDisplay,
  ctx,
  crmUrl,
}: {
  recipientName: string;
  leadDisplay: string;
  ctx: NewLeadEmailContext;
  crmUrl: string;
}): string {
  const rows: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Nom", value: ctx.fullName },
    { label: "Société", value: ctx.company },
    { label: "Email", value: ctx.email },
    { label: "Téléphone", value: ctx.phone },
    { label: "Source", value: ctx.source },
  ];
  const rowsHtml = rows
    .filter((r) => r.value && String(r.value).trim() !== "")
    .map(
      (r) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:12px;color:#666;width:120px;">${escapeHtml(r.label)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:14px;font-weight:600;color:#111;">${escapeHtml(String(r.value))}</td>
        </tr>`
    )
    .join("");
  const notesBlock = ctx.notes
    ? `
      <div style="margin:20px 0;padding:16px;border:2px solid #111;background:#f3efe6;">
        <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Notes</div>
        <div style="font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(ctx.notes)}</div>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Nouveau lead</title></head>
<body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:3px solid #111;box-shadow:8px 8px 0 #111;">
        <tr><td style="background:#0047FF;padding:24px 32px;border-bottom:3px solid #111;">
          <div style="display:inline-block;background:#FFE45C;color:#111;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111;">CRM · Nouveau lead</div>
          <div style="margin-top:14px;color:#fff;font-size:28px;font-weight:900;line-height:1.1;text-transform:uppercase;letter-spacing:-0.5px;">${escapeHtml(leadDisplay)}</div>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Salut ${escapeHtml(recipientName)},</p>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.5;">Un nouveau lead vient d&apos;arriver dans ton CRM.</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px;">${rowsHtml}</table>
          ${notesBlock}
          <div style="text-align:center;margin:28px 0 8px;">
            <a href="${escapeHtml(crmUrl)}" style="display:inline-block;background:#0047FF;color:#fff;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:1px;padding:14px 28px;border:3px solid #111;box-shadow:5px 5px 0 #111;text-decoration:none;">Ouvrir le CRM →</a>
          </div>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.4;color:#666;">Pour ne plus recevoir ces notifications, ouvre <a href="${escapeHtml(crmUrl)}" style="color:#666;">CRM &gt; Paramètres &gt; Préférences</a> et décoche &laquo; Notification nouveau lead &raquo;.</p>
        </td></tr>
        <tr><td style="background:#111;padding:14px 32px;color:#fff;font-size:11px;text-align:center;letter-spacing:1px;text-transform:uppercase;">LeadFactory</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
