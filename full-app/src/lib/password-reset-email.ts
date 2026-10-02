function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface BuildPasswordResetEmailOptions {
  firstName: string;
  resetUrl: string;
}

export function buildPasswordResetEmail({
  firstName,
  resetUrl,
}: BuildPasswordResetEmailOptions): string {
  const safeFirstName = escapeHtml(firstName || "");
  const safeResetUrl = escapeHtml(resetUrl);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Réinitialise ton mot de passe LeadFactory</title>
</head>
<body style="margin:0;padding:0;background:#FAF8F2;font-family:'Inter Tight','Helvetica Neue',Arial,sans-serif;color:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid #0a0a0a;box-shadow:8px 8px 0 #0a0a0a;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;background:#FFE600;border:3px solid #0a0a0a;padding:6px 14px;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;font-size:11px;transform:rotate(-1deg);">
                LeadFactory · Sécurité
              </div>
              <h1 style="font-size:28px;font-weight:900;text-transform:uppercase;line-height:1.05;margin:18px 0 8px 0;letter-spacing:-0.02em;">
                Réinitialise ton mot de passe
              </h1>
              <p style="font-size:15px;line-height:1.5;color:#525252;font-weight:500;margin:0 0 24px 0;">
                Hello ${safeFirstName ? safeFirstName : "toi"} 👋<br/>
                Tu as demandé à réinitialiser ton mot de passe LeadFactory. Clique sur le bouton ci-dessous pour en choisir un nouveau. Le lien est valable <strong>1 heure</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <a href="${safeResetUrl}" style="display:inline-block;background:#0066FF;color:#ffffff;text-decoration:none;border:3px solid #0a0a0a;box-shadow:6px 6px 0 #0a0a0a;padding:16px 28px;font-weight:900;text-transform:uppercase;letter-spacing:0.04em;font-size:14px;">
                Choisir un nouveau mot de passe →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px 32px;">
              <p style="font-size:12px;line-height:1.6;color:#525252;font-weight:500;margin:0 0 16px 0;">
                Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :
              </p>
              <p style="font-size:11px;line-height:1.4;color:#0066FF;word-break:break-all;background:#F4F4F4;border:2px solid #0a0a0a;padding:10px;margin:0;font-family:'JetBrains Mono',Menlo,monospace;">
                ${safeResetUrl}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <div style="background:#FFE600;border:3px solid #0a0a0a;padding:14px 16px;">
                <p style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px 0;">
                  ⚠️ Pense aux spams
                </p>
                <p style="font-size:12px;line-height:1.5;font-weight:500;margin:0;color:#0a0a0a;">
                  Si cet email a atterri dans tes spams ou dans "Promotions" (Gmail), marque-le comme "non spam" pour les prochains.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px 32px;border-top:3px solid #0a0a0a;">
              <p style="font-size:11px;line-height:1.5;color:#525252;font-weight:500;margin:16px 0 0 0;">
                Tu n'as pas demandé cette réinitialisation ? Ignore simplement cet email — ton mot de passe restera inchangé.<br/><br/>
                <span style="font-weight:700;">— L'équipe LeadFactory</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="font-size:10px;color:#a3a3a3;font-weight:500;margin:16px 0 0 0;text-align:center;">
          LeadFactory · Email automatique · Ne pas répondre
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
