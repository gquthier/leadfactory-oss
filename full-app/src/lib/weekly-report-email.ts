function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function formatCurrency(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export interface WeeklyReportOptions {
  clientName: string;
  campaignName: string;
  periodStart: string;
  periodEnd: string;
  stats: {
    spend: number;
    leads: number;
    cpl: number;
    cpm: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
  };
  recentLeads: Array<{
    name: string;
    email: string;
    phone: string;
    status: string;
    date: string;
  }>;
  roas: {
    cashCollected: number;
    spend: number;
    ratio: number | null;
  };
  appUrl: string;
}

function buildKpiCard(label: string, value: string, bgColor: string = "#ffffff"): string {
  return `
    <td width="50%" style="padding:6px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${bgColor};border:3px solid #111111;">
        <tr>
          <td style="padding:16px 14px;">
            <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#555555;margin-bottom:6px;">
              ${escapeHtml(label)}
            </div>
            <div style="font-size:24px;font-weight:900;line-height:1.1;color:#111111;">
              ${escapeHtml(value)}
            </div>
          </td>
        </tr>
      </table>
    </td>`;
}

function buildStatRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eeeeee;font-size:14px;font-weight:700;color:#555555;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eeeeee;font-size:14px;font-weight:900;text-align:right;color:#111111;">
        ${escapeHtml(value)}
      </td>
    </tr>`;
}

function buildLeadRow(lead: WeeklyReportOptions["recentLeads"][number]): string {
  const safeName = escapeHtml(lead.name || "—");
  const safeContact = escapeHtml(lead.email || lead.phone || "—");
  const safeStatus = escapeHtml(lead.status || "nouveau");
  const safeDate = escapeHtml(lead.date);
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eeeeee;">
        <div style="font-size:13px;font-weight:900;color:#111111;">${safeName}</div>
        <div style="font-size:12px;color:#555555;margin-top:2px;">${safeContact}</div>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #eeeeee;text-align:right;">
        <span style="display:inline-block;background:#f3efe6;color:#111111;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px;border:2px solid #111111;">
          ${safeStatus}
        </span>
        <div style="font-size:11px;color:#888888;margin-top:4px;">${safeDate}</div>
      </td>
    </tr>`;
}

export function buildWeeklyReportEmail(options: WeeklyReportOptions): string {
  const {
    clientName,
    campaignName,
    periodStart,
    periodEnd,
    stats,
    recentLeads,
    roas,
    appUrl,
  } = options;

  const safeClientName = escapeHtml(clientName);
  const safeCampaignName = escapeHtml(campaignName);
  const safePeriodStart = escapeHtml(periodStart);
  const safePeriodEnd = escapeHtml(periodEnd);
  const leadsUrl = escapeHtml(`${appUrl}/client/leads`);

  const leadsRows = recentLeads.length > 0
    ? recentLeads.map(buildLeadRow).join("")
    : `<tr><td colspan="2" style="padding:16px 0;text-align:center;font-size:13px;color:#888888;">Aucun lead cette semaine</td></tr>`;

  const roasSection = roas.ratio !== null
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#fff6bf;border:3px solid #111111;">
        <tr>
          <td style="padding:22px 24px;">
            <div style="display:inline-block;background:#111111;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
              Retour sur investissement
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td width="33%" style="text-align:center;">
                  <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#555555;">Cash collecté</div>
                  <div style="font-size:22px;font-weight:900;margin-top:4px;">${escapeHtml(formatCurrency(roas.cashCollected))}</div>
                </td>
                <td width="33%" style="text-align:center;">
                  <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#555555;">Dépensé</div>
                  <div style="font-size:22px;font-weight:900;margin-top:4px;">${escapeHtml(formatCurrency(roas.spend))}</div>
                </td>
                <td width="33%" style="text-align:center;">
                  <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#555555;">ROAS</div>
                  <div style="font-size:22px;font-weight:900;margin-top:4px;color:#0047FF;">${formatNumber(roas.ratio)}x</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
    : `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#fff6bf;border:3px solid #111111;">
        <tr>
          <td style="padding:22px 24px;">
            <div style="display:inline-block;background:#111111;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;">
              Retour sur investissement
            </div>
            <p style="margin:14px 0 0 0;font-size:14px;line-height:1.7;color:#555555;">
              Renseigne le montant encaissé sur tes leads pour calculer ton ROAS automatiquement.
            </p>
            <a
              href="${leadsUrl}"
              style="display:inline-block;margin-top:12px;background:#111111;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;padding:12px 16px;border:3px solid #111111;"
            >
              Mesurer mon ROAS
            </a>
          </td>
        </tr>
      </table>`;

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rapport hebdomadaire — Lead Factory</title>
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
                      Rapport de la semaine
                    </div>
                    <div style="margin-top:16px;color:#ffffff;font-size:30px;font-weight:900;line-height:1.1;text-transform:uppercase;letter-spacing:-1px;">
                      ${safeCampaignName}
                    </div>
                    <p style="margin:14px 0 0 0;color:#dfe8ff;font-size:15px;line-height:1.6;font-weight:600;">
                      Du ${safePeriodStart} au ${safePeriodEnd}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">

              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.7;">
                Bonjour <strong>${safeClientName}</strong>, voici le résumé de ta campagne cette semaine.
              </p>

              <!-- 4 KPI Cards -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px 0;">
                <tr>
                  ${buildKpiCard("Dépensé", formatCurrency(stats.spend))}
                  ${buildKpiCard("Leads", String(stats.leads), "#f0fdf4")}
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  ${buildKpiCard("Coût / Lead", formatCurrency(stats.cpl))}
                  ${buildKpiCard("CPM", formatCurrency(stats.cpm))}
                </tr>
              </table>

              <!-- Secondary Stats -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#ffffff;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="display:inline-block;background:#111111;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;margin-bottom:16px;">
                      Statistiques détaillées
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                      ${buildStatRow("Impressions", formatNumber(stats.impressions))}
                      ${buildStatRow("Clics", formatNumber(stats.clicks))}
                      ${buildStatRow("CTR", formatNumber(stats.ctr) + " %")}
                      ${buildStatRow("CPC", formatCurrency(stats.cpc))}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Recent Leads -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background:#ffffff;border:3px solid #111111;">
                <tr>
                  <td style="padding:22px 24px;">
                    <div style="display:inline-block;background:#0047FF;color:#ffffff;font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:6px 10px;border:2px solid #111111;margin-bottom:16px;">
                      Derniers leads
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                      ${leadsRows}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- ROAS -->
              ${roasSection}

              <!-- CTA principal -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;">
                <tr>
                  <td align="left">
                    <a
                      href="${leadsUrl}"
                      style="display:inline-block;background:#0047FF;color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:0.6px;padding:16px 22px;border:3px solid #111111;"
                    >
                      Accéder à mes leads
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;line-height:1.7;color:#555555;">
                Retrouve tous tes leads et tes performances directement depuis ton espace client.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#111111;color:#ffffff;border-top:3px solid #111111;">
              <p style="margin:0 0 6px 0;font-size:14px;font-weight:800;">L'équipe Lead Factory</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#b7b7b7;">
                Rapport automatique envoyé chaque lundi. Tu peux désactiver cet envoi depuis ton espace admin.
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
