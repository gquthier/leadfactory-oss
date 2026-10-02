import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getConversation } from "@/lib/cold-call-script-writer/chat-data";
import { loadClientSequenceContext, summarizeContextForUI } from "@/lib/sequence-context";
import { ChatLayout } from "./ChatLayout";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ColdCallConversationPage(props: PageProps) {
  const params = await props.params;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const conv = await getConversation(session.user.id, params.id);
  if (!conv) notFound();

  const ctx = await loadClientSequenceContext(session.user.id, null);
  const contextSummary = summarizeContextForUI(ctx);

  return (
    <ChatLayout
      conversationId={conv.id}
      initialTitle={conv.title}
      initialMessages={conv.messages ?? []}
      initialScript={conv.current_script ?? null}
      initialPinned={conv.pinned}
      contextSummary={contextSummary}
    />
  );
}
