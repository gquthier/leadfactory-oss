import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { ActivityClient } from "./ActivityClient";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adminSupabase = createAdminClient();

  // Check super admin
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role, is_super_admin")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") redirect("/client/overview");
  if (!profile?.is_super_admin) redirect("/admin/dashboard");

  // Fetch recent activity logs (last 200)
  const { data: logs } = await adminSupabase
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  // Fetch all profiles for filters
  const { data: profiles } = await adminSupabase
    .from("profiles")
    .select("id, full_name, company, email, role, is_active, first_login_at, last_seen_at")
    .order("created_at", { ascending: false });

  return (
    <ActivityClient
      logs={logs ?? []}
      profiles={profiles ?? []}
    />
  );
}
