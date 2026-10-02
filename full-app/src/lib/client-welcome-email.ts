function safeAppOrigin(appUrl: string): string {
  const url = new URL(appUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) {
    throw new Error("Une URL d’application HTTPS valide est requise (HTTP réservé au local).");
  }
  return url.origin;
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface BuildClientWelcomeEmailOptions {
  clientName: string;
  email: string;
  /** Compatibilité des anciens appelants : ce champ n’est jamais lu ni envoyé. */
  password?: string;
  appUrl: string;
  integrationVideoUrl?: string;
}

export function buildClientWelcomeEmail({
  clientName,
  email,
  appUrl,
  integrationVideoUrl = process.env.LEADFACTORY_INTEGRATION_VIDEO_URL || "",
}: BuildClientWelcomeEmailOptions): string {
  const safeClientName = escapeHtml(clientName);
  const safeEmail = escapeHtml(email);
  const origin = safeAppOrigin(appUrl);
  const loginUrl = `${origin}/login`;
  const safeResetUrl = escapeHtml(`${origin}/forgot-password`);
  const safeLoginUrl = escapeHtml(loginUrl);
  let safeIntegrationVideoUrl = "";
  try {
    const video = new URL(integrationVideoUrl);
    if (video.protocol === "https:" && !video.username && !video.password) safeIntegrationVideoUrl = escapeHtml(video.href);
  } catch { /* Aucun guide vidéo configuré. */ }

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenue chez Lead Factory</title>
</head>
<body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,sans-serif;color:#111111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:3px solid #111111;box-shadow:10px 10px 0 #111111;">
          <tr>
            <td style="background:#0047FF;padding:28px 32px;border-bottom:3px solid #111111;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left">
                    <div style="display:inline-block;background:#FFE45C;color:#111111;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
                      Hello
                    </div>
                    <div style="margin-top:16px;color:#ffffff;font-size:34px;font-weight:900;line-height:1;text-transform:uppercase;letter-spacing:-1px;">
                      Bienvenue chez Lead Factory
                    </div>
                    <p style="margin:14px 0 0 0;color:#dfe8ff;font-size:15px;line-height:1.6;font-weight:600;">
                      Ton espace client est prêt. Tout est centralisé pour suivre l'avancement de ton projet et collaborer avec l'équipe.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
                Bonjour <strong>${safeClientName}</strong>,
              </p>

              <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;">
                Bienvenue sur la plateforme Lead Factory. Cet espace te sert à suivre exactement ce qu'on construit ensemble, voir les éléments attendus de ton côté, et garder une vue claire sur l'état de ton acquisition.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;background:#fff6bf;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px 0;">
                      Tes accès
                    </div>
                    <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;">
                      <strong>Email de connexion :</strong> ${safeEmail}
                    </p>
                    <p style="margin:0;font-size:15px;line-height:1.6;">
                      Choisissez ou récupérez votre mot de passe depuis
                      <a href="${safeResetUrl}" style="color:#0047FF;font-weight:700;">la page de récupération</a>,
                      avec votre email de connexion. Le lien personnel vous sera envoyé par le service d’authentification configuré.
                      Aucun mot de passe n’est transmis dans cet email.
                    </p>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td width="50%" valign="top" style="padding-right:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border:3px solid #111111;min-height:180px;">
                      <tr>
                        <td style="padding:20px;">
                          <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Ce qu'est la plateforme</div>
                          <p style="margin:0;font-size:14px;line-height:1.7;">
                            La plateforme Lead Factory est ton espace client de pilotage. Elle te sert a centraliser le suivi de l'accompagnement, accéder a tes informations clés, et garder une vue claire sur tout ce qui concerne tes campagnes.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border:3px solid #111111;min-height:180px;">
                      <tr>
                        <td style="padding:20px;">
                          <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Ce que tu vas pouvoir piloter</div>
                          <p style="margin:0;font-size:14px;line-height:1.7;">
                            Tu peux suivre les performances disponibles et analyser les chiffres effectivement remontés par les sources connectées. Tu as aussi un mini CRM intégré si tu veux suivre tes leads au meme endroit.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${safeIntegrationVideoUrl ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#ffffff;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="display:inline-block;background:#111111;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
                      Première action attendue
                    </div>
                    <p style="margin:16px 0 10px 0;font-size:18px;font-weight:900;line-height:1.4;text-transform:uppercase;">
                      Regarder la petite vidéo d'intégration
                    </p>
                    <p style="margin:0 0 18px 0;font-size:14px;line-height:1.7;">
                      On te recommande de commencer par là. Elle t'explique comment utiliser l'espace client et ce que l'équipe attend de toi pour avancer vite.
                    </p>
                    <a
                      href="${safeIntegrationVideoUrl}"
                      style="display:inline-block;background:#FFE45C;color:#111111;text-decoration:none;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:14px 18px;border:3px solid #111111;"
                    >
                      Voir la vidéo d'intégration
                    </a>
                  </td>
                </tr>
              </table>` : ""}

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;">
                <tr>
                  <td align="left">
                    <a
                      href="${safeLoginUrl}"
                      style="display:inline-block;background:#0047FF;color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:0.6px;padding:16px 22px;border:3px solid #111111;"
                    >
                      Accéder à mon espace client
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.7;color:#555555;">
                <strong>URL de connexion :</strong>
                <a href="${safeLoginUrl}" style="color:#0047FF;font-weight:700;text-decoration:none;">${safeLoginUrl}</a>
              </p>
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.7;color:#555555;">
                Ton login se fait directement depuis ce lien. Garde-le sous la main.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.7;color:#555555;">
                Pense à sauvegarder cet espace dans tes favoris pour y revenir facilement pendant tout l'accompagnement.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px;background:#111111;color:#ffffff;border-top:3px solid #111111;">
              <p style="margin:0 0 6px 0;font-size:14px;font-weight:800;">L'équipe Lead Factory</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#b7b7b7;">
                Email automatique envoyé depuis la plateforme Lead Factory.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
