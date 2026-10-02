import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { getPreviewClientId } from "@/lib/client-preview";

export const dynamic = "force-dynamic";

export default async function ClientCampaigns() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;
  const admin = createAdminClient();

  const { data: campaigns } = await admin
    .from("campaigns")
    .select("id")
    .eq("client_id", effectiveId)
    .limit(1)
    .single();

  if (campaigns?.id) redirect(`/client/campaigns/${campaigns.id}`);
  redirect("/client/overview");
}
