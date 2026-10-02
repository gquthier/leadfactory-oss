function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface BuildSurprisesEmailOptions {
  firstName: string;
  appUrl: string;
  counts: { linkedinPosts: number; emailSequences: number; callScripts: number };
}

export function buildSurprisesReadyEmail({ firstName, appUrl, counts }: BuildSurprisesEmailOptions): string {
  const safeFirstName = escapeHtml(firstName);
  const surprisesUrl = `${appUrl}/client/surprises`;
  const safeUrl = escapeHtml(surprisesUrl);
  const totalAssets = counts.linkedinPosts + counts.emailSequences + counts.callScripts;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tes surprises sont prêtes</title>
</head>
<body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,sans-serif;color:#111111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:3px solid #111111;box-shadow:10px 10px 0 #111111;">
          <tr>
            <td style="background:#FFE45C;padding:28px 32px;border-bottom:3px solid #111111;">
              <div style="display:inline-block;background:#111111;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
                Surprise
              </div>
              <div style="margin-top:16px;color:#111111;font-size:32px;font-weight:900;line-height:1;text-transform:uppercase;letter-spacing:-1px;">
                Tes surprises sont prêtes 🎁
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                Salut ${safeFirstName},
              </p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                Pour fêter ton arrivée sur LeadFactory, on a préparé en arrière-plan
                <strong>${totalAssets} assets sur-mesure</strong> à partir de ton brief.
              </p>
              <div style="margin:24px 0;padding:20px;border:3px solid #111111;background:#f3efe6;">
                <div style="font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">
                  Au menu :
                </div>
                <div style="font-size:15px;line-height:1.7;">
                  ✦ <strong>${counts.linkedinPosts} posts LinkedIn</strong> prêts à publier (8 frameworks différents)<br />
                  ✦ <strong>${counts.emailSequences} séquences cold email</strong> (angles complémentaires)<br />
                  ✦ <strong>${counts.callScripts} script de cold call</strong> (avec objections + CTA)
                </div>
              </div>
              <p style="margin:24px 0 16px;font-size:16px;line-height:1.5;">
                Tout est dans ton espace, onglet <strong>Surprises</strong> dans la sidebar (badge clignotant 👀).
              </p>
              <div style="text-align:center;margin:32px 0;">
                <a href="${safeUrl}" style="display:inline-block;background:#0047FF;color:#ffffff;font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;padding:16px 32px;border:3px solid #111111;box-shadow:6px 6px 0 #111111;text-decoration:none;">
                  Voir mes surprises →
                </a>
              </div>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#666;">
                Tu peux modifier, télécharger, ou t'inspirer de ces assets — c'est ton point de départ.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#111111;padding:20px 32px;color:#ffffff;font-size:12px;text-align:center;">
              LeadFactory — l'OS d'acquisition de ton agence
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
