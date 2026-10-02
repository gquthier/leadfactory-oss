import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope, scopeProfilesQuery } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import { getClientResultsRatingPriority } from "@/types/index";
import { ResultsClient } from "./ResultsClient";

type CampaignRef = {
  id: string;
  name: string;
  status: string;
  ad_account_id: string | null;
};

export type ResultsClientRow = {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  is_active: boolean;
  results_rating: string | null;
  results_rating_note: string | null;
  results_rating_updated_at: string | null;
  campaigns: CampaignRef[];
};

type ResultsClientRowWithoutCampaigns = Omit<ResultsClientRow, "campaigns">;

export default async function AdminResults() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  const selectBase = "id, full_name, company, email, is_active, results_rating, results_rating_note, results_rating_updated_at";
  const selectWithCampaigns = `${selectBase}, campaigns:campaigns!campaigns_client_id_fkey(id, name, status, ad_account_id)`;

  const buildQuery = (selectClause: string) => {
    const query = adminSupabase
      .from("profiles")
      .select(selectClause)
      .eq("role", "client")
      .order("created_at", { ascending: false });
    return scopeProfilesQuery(query, scope);
  };

  const { data: clientsWithCampaigns, error: clientsError } = await buildQuery(selectWithCampaigns);

  let clients: ResultsClientRow[] = (clientsWithCampaigns as unknown as ResultsClientRow[]) ?? [];

  if (clientsError) {
    console.error("Failed to load clients with campaigns relation", clientsError);
    const { data: fallbackClients, error: fallbackError } = await buildQuery(selectBase);
    if (fallbackError) {
      console.error("Failed to load clients fallback", fallbackError);
      clients = [];
    } else {
      clients = ((fallbackClients as unknown as ResultsClientRowWithoutCampaigns[]) ?? []).map(
        (client): ResultsClientRow => ({ ...client, campaigns: [] })
      );
    }
  }

  // Tri du plus urgent (very_bad / payment_terror) au moins urgent (amazing).
  // À priorité égale, on garde un ordre alphabétique stable.
  clients = [...clients].sort((a, b) => {
    const pa = getClientResultsRatingPriority(a.results_rating);
    const pb = getClientResultsRatingPriority(b.results_rating);
    if (pa !== pb) return pa - pb;
    return (a.company ?? a.full_name).localeCompare(b.company ?? b.full_name);
  });

  return <ResultsClient clients={clients} />;
}
