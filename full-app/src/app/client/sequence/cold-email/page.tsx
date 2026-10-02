import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import {
  loadClientSequenceContext,
  summarizeContextForUI,
} from "@/lib/sequence-context";
import { listConversations } from "@/lib/sequence-data";
import { SequenceClient } from "./SequenceClient";

export const dynamic = "force-dynamic";

export default async function SequencePage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role, full_name, company")
    .eq("id", session.user.id)
    .single();

  const clientId = profile?.role === "admin" && previewId ? previewId : session.user.id;

  // En parallèle : contexte, conversations existantes
  const [ctx, conversations] = await Promise.all([
    loadClientSequenceContext(clientId, null),
    listConversations(clientId),
  ]);

  const contextSummary = summarizeContextForUI(ctx);
  const hasOnboarding = contextSummary.length >= 3;

  return (
    <SequenceClient
      initialConversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updated_at: c.updated_at,
      }))}
      contextSummary={contextSummary}
      hasOnboarding={hasOnboarding}
      firstName={profile?.full_name?.split(" ")[0] ?? "Client"}
    />
  );
}
