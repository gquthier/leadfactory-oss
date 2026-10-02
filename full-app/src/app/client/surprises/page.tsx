import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { SurprisesClient, type SurpriseAsset } from "./SurprisesClient";

export const dynamic = "force-dynamic";

export default async function SurprisesPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: surprise } = await admin
    .from("client_surprises")
    .select("*")
    .eq("client_id", session.user.id)
    .maybeSingle();

  const { data: assets } = await admin
    .from("surprise_assets")
    .select("*")
    .eq("client_id", session.user.id)
    .order("asset_type", { ascending: true })
    .order("order_index", { ascending: true });

  // Mark viewed_at on first visit when ready
  if (surprise?.status === "ready" && !surprise.viewed_at) {
    await admin
      .from("client_surprises")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", surprise.id);
  }

  return (
    <SurprisesClient
      status={surprise?.status ?? "pending"}
      startedAt={surprise?.started_at ?? null}
      finishedAt={surprise?.finished_at ?? null}
      errorMessage={surprise?.error_message ?? null}
      assets={(assets ?? []) as SurpriseAsset[]}
    />
  );
}
