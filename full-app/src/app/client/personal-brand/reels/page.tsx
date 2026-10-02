import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import {
  loadClientSequenceContext,
  summarizeContextForUI,
} from "@/lib/sequence-context";
import { listConversations, listScripts } from "@/lib/reels-data";
import { ReelsGeneratorClient } from "./ReelsGeneratorClient";

export const dynamic = "force-dynamic";

export default async function ReelsGeneratorPage() {
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

  const latestScripts = conversations[0]
    ? await listScripts(clientId, conversations[0].id)
    : [];

  const contextSummary = summarizeContextForUI(ctx);
  const hasOnboarding = contextSummary.length >= 3;

  return (
    <ReelsGeneratorClient
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
      initialScripts={latestScripts.map((s) => ({
        id: s.id,
        body: s.body,
        hook: s.hook,
        framework: s.framework,
        format: s.format,
        platform: s.platform,
        duration_seconds: s.duration_seconds,
        metrics: (s.metrics as { length?: number }) ?? {},
      }))}
      contextSummary={contextSummary}
      hasOnboarding={hasOnboarding}
      firstName={profile?.full_name?.split(" ")[0] ?? "Client"}
    />
  );
}
