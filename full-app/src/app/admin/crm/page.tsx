import { createAdminClient, createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { AdminCRMClient, type AdminCrmLead, type AdminCrmMetrics } from "./AdminCRMClient";

export default async function AdminCRMPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") redirect("/client/overview");

  const [{ data: leads, error: leadsError }, { data: metrics, error: metricsError }] = await Promise.all([
    adminSupabase
      .from("crm_leads")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500),
    adminSupabase
      .rpc("get_crm_metrics", {
        from_date: null,
        to_date: null,
      })
      .single(),
  ]);

  return (
    <AdminCRMClient
      initialLeads={(leads as AdminCrmLead[]) ?? []}
      initialMetrics={(metrics as AdminCrmMetrics | null) ?? null}
      schemaWarning={leadsError?.message || metricsError?.message || null}
    />
  );
}
