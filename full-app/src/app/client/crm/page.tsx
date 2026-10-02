import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { getPreviewClientId } from "@/lib/client-preview";
import type { Lead, PipelineStage } from "@/types/index";
import { CRMClient } from "./CRMClient";

export default async function CRMPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;

  const adminSupabase = createAdminClient();

  // Seed default pipeline stages if needed
  await adminSupabase.rpc("seed_default_pipeline_stages", { p_client_id: effectiveId });

  // Fetch leads + stages + campaigns in parallel
  const [leadsRes, stagesRes, campaignsRes] = await Promise.all([
    adminSupabase
      .from("leads")
      .select("*, campaigns(name, ad_account_id)")
      .eq("client_id", effectiveId)
      .order("created_at", { ascending: false })
      .limit(1000),
    adminSupabase
      .from("pipeline_stages")
      .select("*")
      .eq("client_id", effectiveId)
      .order("display_order", { ascending: true }),
    adminSupabase
      .from("campaigns")
      .select("id, name")
      .eq("client_id", effectiveId)
      .order("name"),
  ]);

  return (
    <CRMClient
      leads={(leadsRes.data as unknown as Lead[]) ?? []}
      stages={(stagesRes.data as unknown as PipelineStage[]) ?? []}
      campaigns={campaignsRes.data ?? []}
    />
  );
}
