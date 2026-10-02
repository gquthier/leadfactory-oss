import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getCampaignInsights, getAdAccounts } from "@/lib/meta-api";
import type { DatePreset } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";

const VALID_PERIODS: DatePreset[] = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "maximum",
];

function escapeCSV(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCSVRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(escapeCSV).join(",");
}

export async function GET(req: Request) {
  // Auth: vérifier que l'utilisateur est admin
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  await initMetaToken(adminSupabase);

  // Query params
  const { searchParams } = new URL(req.url);
  const adAccountIdParam = searchParams.get("ad_account_id");
  const periodParam = searchParams.get("period") ?? "last_30d";

  const period: DatePreset = VALID_PERIODS.includes(periodParam as DatePreset)
    ? (periodParam as DatePreset)
    : "last_30d";

  // Déterminer les comptes à interroger
  let accountIds: string[] = [];

  if (adAccountIdParam) {
    accountIds = [adAccountIdParam];
  } else {
    try {
      const accounts = await getAdAccounts();
      accountIds = accounts
        .filter((a) => a.account_status === 1 && a.amount_spent > 0)
        .map((a) => a.id);
    } catch {
      return NextResponse.json(
        { error: "Impossible de récupérer les comptes Meta" },
        { status: 500 }
      );
    }
  }

  // Récupérer les insights par campagne pour chaque compte
  type CampaignRow = {
    campaign_name: string;
    leads: number;
    spend: number;
    cpl: number;
    impressions: number;
    reach: number;
    ctr: number;
    date_start: string;
    date_stop: string;
  };

  const rows: CampaignRow[] = [];

  await Promise.all(
    accountIds.map(async (accountId) => {
      const insights = await getCampaignInsights(accountId, period);
      for (const ins of insights) {
        rows.push({
          campaign_name: ins.campaign_name,
          leads: ins.leads,
          spend: ins.spend,
          cpl: ins.cpl,
          impressions: ins.impressions,
          reach: ins.reach,
          ctr: ins.ctr,
          date_start: ins.date_start,
          date_stop: ins.date_stop,
        });
      }
    })
  );

  // Trier par leads décroissants
  rows.sort((a, b) => b.leads - a.leads);

  // Construire le CSV
  const headers = [
    "Campagne",
    "Leads",
    "Budget dépensé (€)",
    "CPL (€)",
    "Impressions",
    "Reach",
    "CTR (%)",
    "Date début",
    "Date fin",
  ];

  const csvLines: string[] = [headers.join(",")];

  for (const row of rows) {
    csvLines.push(
      buildCSVRow([
        row.campaign_name,
        row.leads,
        row.spend.toFixed(2),
        row.cpl.toFixed(2),
        row.impressions,
        row.reach,
        row.ctr.toFixed(2),
        row.date_start,
        row.date_stop,
      ])
    );
  }

  const csv = csvLines.join("\n");
  const filename = `leads-export-${period}-${new Date().toISOString().split("T")[0]}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
