import { getCanonicalCampaignStatus, type CanonicalCampaignStatus } from "@/types/index";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Hex colors matching the lf-* Tailwind palette defined in tailwind.config.ts
const STATUS_BADGE_STYLES: Record<
  CanonicalCampaignStatus,
  { background: string; color: string }
> = {
  brief_received:      { background: "#FDE047", color: "#111111" },
  campaign_proposal:   { background: "#3B82F6", color: "#ffffff" },
  ad_creative:         { background: "#FFC4EB", color: "#111111" },
  meta_account_setup:  { background: "#FED7AA", color: "#111111" },
  live_optimizing:     { background: "#58BC82", color: "#ffffff" },
  reworks:             { background: "#F97316", color: "#ffffff" },
  paused:              { background: "#D1D5DB", color: "#111111" },
  completed_project:   { background: "#047857", color: "#ffffff" },
};

// Default personalized messages shown below the status badge
const STATUS_MESSAGES: Record<CanonicalCampaignStatus, string> = {
  brief_received:
    "Nous avons bien reçu ton brief. L'équipe est en train de le prendre en charge et reviendra vers toi très prochainement pour la suite.",
  campaign_proposal:
    "La proposition de campagne est prête. Nous l'avons préparée en fonction de ton brief et des objectifs définis ensemble. Tu peux la consulter et nous faire tes retours.",
  ad_creative:
    "Les créatives publicitaires sont en cours de production. Tu vas bientôt pouvoir les valider avant le lancement officiel de la campagne.",
  meta_account_setup:
    "La mise en place technique de ton compte Meta est en cours. Une fois les accès vérifiés et les paramètres configurés, ta campagne sera prête à démarrer.",
  live_optimizing:
    "Ta campagne est maintenant en ligne. L'équipe suit les performances en temps réel et procède aux ajustements nécessaires pour maximiser tes résultats.",
  reworks:
    "Ta campagne entre en phase de reworks : l'équipe ajuste les créatives, le ciblage ou la proposition de valeur pour relancer les performances. On revient vers toi dès qu'on a du nouveau.",
  paused:
    "Ta campagne est mise en pause. Aucun budget n'est consommé pendant cette période. Préviens-nous quand tu souhaites la relancer et on s'occupe du redémarrage.",
  completed_project:
    "Ta campagne est officiellement clôturée. Merci pour ta confiance ! Tu peux retrouver le bilan complet et les livrables associés dans ton espace.",
};

export interface CampaignStatusUpdateDeliverable {
  type: "link" | "text" | "pdf";
  label: string;
  url?: string;
  content?: string;
}

export interface BuildCampaignStatusUpdateEmailOptions {
  clientName: string;
  campaignName: string;
  newStatus: string;
  statusLabel: string;
  customMessage?: string;
  deliverables?: CampaignStatusUpdateDeliverable[];
  appUrl: string;
}

function buildDeliverablesSection(
  deliverables: CampaignStatusUpdateDeliverable[]
): string {
  const rows = deliverables
    .map((d) => {
      if (d.type === "link") {
        const safeUrl = escapeHtml(d.url || "#");
        const safeLabel = escapeHtml(d.label);
        return `
          <tr>
            <td style="padding:8px 0;">
              <a
                href="${safeUrl}"
                style="display:inline-block;background:#0047FF;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:12px 16px;border:3px solid #111111;"
              >
                ${safeLabel}
              </a>
            </td>
          </tr>`;
      }

      if (d.type === "pdf") {
        const safeUrl = escapeHtml(d.url || "#");
        const safeLabel = escapeHtml(d.label);
        return `
          <tr>
            <td style="padding:8px 0;">
              <a
                href="${safeUrl}"
                style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:12px 16px;border:3px solid #111111;"
              >
                Telecharger — ${safeLabel}
              </a>
            </td>
          </tr>`;
      }

      // type === "text"
      const safeLabel = escapeHtml(d.label);
      const safeContent = escapeHtml(d.content || "");
      return `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border:3px solid #111111;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${safeLabel}</div>
                    <p style="margin:0;font-size:14px;line-height:1.7;white-space:pre-wrap;">${safeContent}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
    })
    .join("");

  return `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#ffffff;border:3px solid #111111;">
        <tr>
          <td style="padding:22px 24px;">
            <div style="display:inline-block;background:#111111;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
              Documents et livrables
            </div>
            <p style="margin:14px 0 18px 0;font-size:14px;line-height:1.7;color:#555555;">
              Les éléments suivants sont disponibles pour cette étape.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${rows}
            </table>
          </td>
        </tr>
      </table>`;
}

export function buildCampaignStatusUpdateEmail({
  clientName,
  campaignName,
  newStatus,
  statusLabel,
  customMessage,
  deliverables,
  appUrl,
}: BuildCampaignStatusUpdateEmailOptions): string {
  const canonical = getCanonicalCampaignStatus(newStatus);
  const badgeStyle = STATUS_BADGE_STYLES[canonical];
  const defaultMessage = STATUS_MESSAGES[canonical];

  const safeClientName = escapeHtml(clientName);
  const safeCampaignName = escapeHtml(campaignName);
  const safeStatusLabel = escapeHtml(statusLabel);
  const safeMessage = escapeHtml(customMessage || defaultMessage);
  const portalUrl = escapeHtml(`${appUrl}/client/overview`);

  const deliverablesHtml =
    deliverables && deliverables.length > 0
      ? buildDeliverablesSection(deliverables)
      : "";

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mise a jour de ta campagne — Lead Factory</title>
</head>
<body style="margin:0;padding:0;background:#f3efe6;font-family:Arial,sans-serif;color:#111111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3efe6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:3px solid #111111;box-shadow:10px 10px 0 #111111;">

          <!-- Header -->
          <tr>
            <td style="background:#0047FF;padding:28px 32px;border-bottom:3px solid #111111;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left">
                    <div style="display:inline-block;background:#FFE45C;color:#111111;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
                      Mise a jour campagne
                    </div>
                    <div style="margin-top:16px;color:#ffffff;font-size:34px;font-weight:900;line-height:1;text-transform:uppercase;letter-spacing:-1px;">
                      Nouveau statut disponible
                    </div>
                    <p style="margin:14px 0 0 0;color:#dfe8ff;font-size:15px;line-height:1.6;font-weight:600;">
                      L'avancement de ta campagne vient d'être mis à jour par l'équipe Lead Factory.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">

              <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
                Bonjour <strong>${safeClientName}</strong>,
              </p>

              <!-- Campaign name + status badge -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#ffffff;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#555555;margin-bottom:10px;">
                      Campagne
                    </div>
                    <div style="font-size:20px;font-weight:900;line-height:1.2;margin-bottom:16px;">
                      ${safeCampaignName}
                    </div>
                    <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#555555;margin-bottom:10px;">
                      Statut actuel
                    </div>
                    <div style="display:inline-block;background:${badgeStyle.background};color:${badgeStyle.color};font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:8px 14px;border:3px solid #111111;">
                      ${safeStatusLabel}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Status message -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#fff6bf;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px 0;">
                      Message de l'équipe
                    </div>
                    <p style="margin:0;font-size:15px;line-height:1.8;">
                      ${safeMessage}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Deliverables (conditional) -->
              ${deliverablesHtml}

              <!-- CTA button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;">
                <tr>
                  <td align="left">
                    <a
                      href="${portalUrl}"
                      style="display:inline-block;background:#0047FF;color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:0.6px;padding:16px 22px;border:3px solid #111111;"
                    >
                      Voir ma campagne
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.7;color:#555555;">
                <strong>Lien vers ton espace :</strong>
                <a href="${portalUrl}" style="color:#0047FF;font-weight:700;text-decoration:none;">${portalUrl}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.7;color:#555555;">
                Tu retrouves tous les détails de ta campagne et les prochaines étapes directement depuis ton espace client.
              </p>

            </td>
          </tr>

          <!-- Footer -->
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
