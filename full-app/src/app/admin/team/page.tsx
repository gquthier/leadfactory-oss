import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getTeamDashboard } from "@/lib/team";
import { TeamWorkspaceClient } from "./TeamWorkspaceClient";

export default async function AdminTeamPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_super_admin, is_active")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") redirect("/client/overview");
  if (!profile?.is_active) redirect("/login?disabled=1");
  if (!profile?.is_super_admin) redirect("/admin/dashboard");

  const dashboard = await getTeamDashboard();

  return (
    <TeamWorkspaceClient
      members={dashboard.members}
      campaigns={dashboard.campaigns}
      summary={dashboard.summary}
    />
  );
}
