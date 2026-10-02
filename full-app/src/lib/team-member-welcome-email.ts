import type { TeamRole } from "@/types/index";

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

function getRoleLabel(role: TeamRole) {
  switch (role) {
    case "designer":
      return "Designer";
    case "media_buyer":
      return "Media Buyer";
    case "super_admin":
      return "Super Admin";
    default:
      return "Admin CRM";
  }
}

function getRoleDescription(role: TeamRole) {
  switch (role) {
    case "designer":
      return "Tu vas retrouver dans la plateforme les briefs, les projets attribués et les informations utiles pour produire les créatives Meta demandées.";
    case "media_buyer":
      return "Tu vas piloter les projets qui te sont attribués, suivre les briefs, les assets et les informations nécessaires au setup et à l'optimisation des campagnes Meta.";
    case "super_admin":
      return "Tu disposes d'un accès complet à la plateforme Lead Factory pour gérer l'équipe, les clients, les campagnes et les modules internes.";
    default:
      return "Tu vas gérer les clients, les campagnes et la coordination CRM depuis la plateforme Lead Factory.";
  }
}

interface BuildTeamMemberWelcomeEmailOptions {
  fullName: string;
  email: string;
  /** Compatibilité des anciens appelants : ce champ n’est jamais lu ni envoyé. */
  password?: string;
  role: TeamRole;
  appUrl: string;
}

export function buildTeamMemberWelcomeEmail({
  fullName,
  email,
  role,
  appUrl,
}: BuildTeamMemberWelcomeEmailOptions): string {
  const origin = safeAppOrigin(appUrl);
  const loginUrl = `${origin}/login`;
  const safeResetUrl = escapeHtml(`${origin}/forgot-password`);
  const safeFullName = escapeHtml(fullName);
  const safeEmail = escapeHtml(email);
  const safeLoginUrl = escapeHtml(loginUrl);
  const safeRole = escapeHtml(getRoleLabel(role));
  const safeRoleDescription = escapeHtml(getRoleDescription(role));

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenue dans l'équipe Lead Factory</title>
</head>
<body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,sans-serif;color:#111111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:3px solid #111111;box-shadow:10px 10px 0 #111111;">
          <tr>
            <td style="background:#111111;padding:28px 32px;border-bottom:3px solid #111111;">
              <div style="display:inline-block;background:#FFE45C;color:#111111;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
                Team access
              </div>
              <div style="margin-top:16px;color:#ffffff;font-size:34px;font-weight:900;line-height:1;text-transform:uppercase;letter-spacing:-1px;">
                Bienvenue chez Lead Factory
              </div>
              <p style="margin:14px 0 0 0;color:#d6d6d6;font-size:15px;line-height:1.6;font-weight:600;">
                Ton accès à la plateforme équipe est prêt.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
                Bonjour <strong>${safeFullName}</strong>,
              </p>

              <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;">
                Ton compte Lead Factory vient d'être créé. Tu rejoins la plateforme avec le rôle <strong>${safeRole}</strong>.
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
                          <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">À quoi sert la plateforme</div>
                          <p style="margin:0;font-size:14px;line-height:1.7;">
                            Lead Factory centralise les briefs clients, le pipeline des projets, les informations opérationnelles et le suivi interne de l'équipe.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border:3px solid #111111;min-height:180px;">
                      <tr>
                        <td style="padding:20px;">
                          <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Ce que tu vas y retrouver</div>
                          <p style="margin:0;font-size:14px;line-height:1.7;">
                            ${safeRoleDescription}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#ffffff;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="display:inline-block;background:#0047FF;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
                      Première action
                    </div>
                    <p style="margin:16px 0 10px 0;font-size:18px;font-weight:900;line-height:1.4;text-transform:uppercase;">
                      Connecte-toi et vérifie tes projets attribués
                    </p>
                    <p style="margin:0;font-size:14px;line-height:1.7;">
                      Utilise la page de récupération pour choisir ton mot de passe, puis connecte-toi. Si aucun email de récupération n’arrive, contacte l’administrateur pour vérifier la configuration Auth et email.
                    </p>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;">
                <tr>
                  <td align="left">
                    <a
                      href="${safeLoginUrl}"
                      style="display:inline-block;background:#0047FF;color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:0.6px;padding:16px 22px;border:3px solid #111111;"
                    >
                      Accéder à la plateforme
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.7;color:#555555;">
                <strong>URL de connexion :</strong>
                <a href="${safeLoginUrl}" style="color:#0047FF;font-weight:700;text-decoration:none;">${safeLoginUrl}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.7;color:#555555;">
                Pense à garder ce lien sous la main et à sauvegarder cet espace dans tes favoris.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px;background:#111111;color:#ffffff;border-top:3px solid #111111;">
              <p style="margin:0 0 6px 0;font-size:14px;font-weight:800;">Lead Factory</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#b7b7b7;">
                Email automatique envoyé depuis la plateforme interne.
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
