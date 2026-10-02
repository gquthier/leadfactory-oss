import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { getPreviewClientId } from "@/lib/client-preview";
import type { Lead } from "@/types/index";
import { ClientLeadsClient } from "./ClientLeadsClient";

export default async function ClientLeadsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;

  const adminSupabase = createAdminClient();
  const { data: leads } = await adminSupabase
    .from("leads")
    .select("*, campaigns(name, ad_account_id)")
    .eq("client_id", effectiveId)
    .order("meta_created_at", { ascending: false })
    .limit(500);

  return <ClientLeadsClient leads={(leads as unknown as Lead[]) ?? []} />;
}
