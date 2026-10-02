import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope, scopeProfilesQuery } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import { ClientsClient } from "./ClientsClient";

type CampaignRef = {
  id: string;
  name: string;
  status: string;
  ad_account_id: string | null;
};

type ClientRow = {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  created_at: string;
  next_catchup: string | null;
  first_login_at: string | null;
  last_seen_at: string | null;
  campaigns: CampaignRef[];
};

type ClientRowWithoutCampaigns = Omit<ClientRow, "campaigns">;

export default async function AdminClients() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  const selectWithCampaigns = "id, full_name, company, email, created_at, next_catchup, first_login_at, last_seen_at, campaigns:campaigns!campaigns_client_id_fkey(id, name, status, ad_account_id)";
  const selectWithoutCampaigns = "id, full_name, company, email, created_at, next_catchup, first_login_at, last_seen_at";

  const buildQuery = (selectClause: string) => {
    const query = adminSupabase
      .from("profiles")
      .select(selectClause)
      .eq("role", "client")
      .order("created_at", { ascending: false });
    return scopeProfilesQuery(query, scope);
  };

  const { data: clientsWithCampaigns, error: clientsError } = await buildQuery(selectWithCampaigns);

  let clients: ClientRow[] = (clientsWithCampaigns as unknown as ClientRow[]) ?? [];

  if (clientsError) {
    console.error("Failed to load clients with campaigns relation", clientsError);
    const { data: fallbackClients, error: fallbackError } = await buildQuery(selectWithoutCampaigns);
    if (fallbackError) {
      console.error("Failed to load clients fallback", fallbackError);
      clients = [];
    } else {
      const fallbackRows = ((fallbackClients as unknown as ClientRowWithoutCampaigns[]) ?? []).map((client): ClientRow => ({
        ...client,
        campaigns: [],
      }));
      clients = fallbackRows;
    }
  }

  return (
    <ClientsClient clients={clients} />
  );
}
