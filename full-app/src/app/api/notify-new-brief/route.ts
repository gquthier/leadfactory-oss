import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const { entreprise, submitted_at } = await req.json();

    if (!entreprise || !submitted_at) {
      return NextResponse.json(
        { error: "entreprise and submitted_at are required" },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const formattedDate = new Date(submitted_at).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    await sendEmail({
      to: "contact@example.com",
      subject: `🔔 Nouveau brief reçu — ${entreprise}`,
      html: `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:3px solid #000;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#0047FF;padding:28px 40px;border-bottom:3px solid #000;">
              <span style="color:#ffffff;font-size:28px;font-weight:900;letter-spacing:-1px;text-transform:uppercase;">
                LeadFactory
              </span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="font-size:22px;font-weight:900;margin:0 0 20px;">
                🔔 Nouveau brief reçu
              </p>
              <p style="font-size:16px;margin:0 0 24px;">
                Un nouveau brief vient d'être soumis par <strong>${entreprise}</strong> le <strong>${formattedDate}</strong>.
              </p>
              <p style="font-size:16px;margin:0 0 32px;">
                Rendez-vous sur votre dashboard pour le traiter :
              </p>
              <a href="${appUrl}/admin/onboarding"
                 style="display:inline-block;background:#0047FF;color:#ffffff;font-weight:900;font-size:15px;
                        text-decoration:none;padding:14px 28px;border:3px solid #000;letter-spacing:0.5px;">
                Voir le brief →
              </a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f5f5f5;border-top:3px solid #000;padding:16px 40px;">
              <p style="margin:0;font-size:12px;color:#888;">
                Cet email a été envoyé automatiquement par Lead Factory.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[notify-new-brief] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
