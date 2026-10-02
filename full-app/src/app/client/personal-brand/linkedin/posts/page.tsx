import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { listAllPosts, listConversations } from "@/lib/linkedin-data";
import { PostsGridClient } from "./PostsGridClient";

export const dynamic = "force-dynamic";

export default async function MyLinkedInPostsPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const clientId =
    profile?.role === "admin" && previewId ? previewId : session.user.id;

  const [posts, conversations] = await Promise.all([
    listAllPosts(clientId),
    listConversations(clientId),
  ]);

  const titleById = new Map(conversations.map((c) => [c.id, c.title]));

  return (
    <PostsGridClient
      posts={posts.map((p) => ({
        id: p.id,
        conversation_id: p.conversation_id,
        conversation_title: titleById.get(p.conversation_id) ?? "Brief supprimé",
        body: p.body,
        hook: p.hook,
        framework: p.framework,
        format: p.format,
        metrics: (p.metrics as { length?: number }) ?? {},
        created_at: p.created_at,
      }))}
    />
  );
}
