import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import {
  loadClientSequenceContext,
  summarizeContextForUI,
} from "@/lib/sequence-context";
import { listConversations, listPosts } from "@/lib/linkedin-data";
import { LinkedInGeneratorClient } from "./LinkedInGeneratorClient";

export const dynamic = "force-dynamic";

export default async function LinkedInGeneratorPage() {
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

  const clientId =
    profile?.role === "admin" && previewId ? previewId : session.user.id;

  const [ctx, conversations] = await Promise.all([
    loadClientSequenceContext(clientId, null),
    listConversations(clientId),
  ]);

  // Pré-charge les posts de la conversation la plus récente si elle existe
  const latestPosts = conversations[0]
    ? await listPosts(clientId, conversations[0].id)
    : [];

  const contextSummary = summarizeContextForUI(ctx);
  const hasOnboarding = contextSummary.length >= 3;

  return (
    <LinkedInGeneratorClient
      initialConversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updated_at: c.updated_at,
      }))}
      initialActiveConversationId={conversations[0]?.id ?? null}
      initialMessages={
        conversations[0]
          ? ((conversations[0].messages ?? []) as Array<{
              role: "user" | "assistant";
              content: string;
              timestamp?: string;
            }>)
          : []
      }
      initialPosts={latestPosts.map((p) => ({
        id: p.id,
        body: p.body,
        hook: p.hook,
        framework: p.framework,
        format: p.format,
        metrics: (p.metrics as { length?: number }) ?? {},
      }))}
      contextSummary={contextSummary}
      hasOnboarding={hasOnboarding}
      firstName={profile?.full_name?.split(" ")[0] ?? "Client"}
    />
  );
}
