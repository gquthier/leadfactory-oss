import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getFinanceDashboard } from "@/lib/finance";
import { FinancesWorkspaceClient } from "./FinancesWorkspaceClient";

export default async function AdminFinances(
  props: {
    searchParams?: Promise<{ month?: string; from?: string; to?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_super_admin")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") redirect("/client/overview");
  if (!profile?.is_super_admin) redirect("/admin/dashboard");

  const dashboard = await getFinanceDashboard({
    month: searchParams?.month,
    from: searchParams?.from,
    to: searchParams?.to,
  });

  return (
    <FinancesWorkspaceClient
      from={dashboard.from}
      to={dashboard.to}
      rangeLabel={dashboard.rangeLabel}
      rows={dashboard.rows}
      entries={dashboard.entries}
      teamMembers={dashboard.teamMembers}
      summary={dashboard.summary}
      metaConnected={dashboard.metaConnected}
    />
  );
}
