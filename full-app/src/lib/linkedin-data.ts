/**
 * LinkedIn data layer — conversations + posts persistence.
 * Mirror direct du pattern sequence-data.ts, adapté pour les posts LinkedIn.
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface LinkedInChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface LinkedInConversation {
  id: string;
  client_id: string;
  title: string;
  messages: LinkedInChatMessage[];
  context_override: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LinkedInPost {
  id: string;
  conversation_id: string;
  client_id: string;
  order_index: number;
  body: string;
  hook: string | null;
  framework: string | null;
  format: "text" | "carousel" | "poll" | "story";
  metrics: Record<string, unknown>;
  status: "draft" | "scheduled" | "published" | "archived";
  created_at: string;
  updated_at: string;
}

export async function listConversations(clientId: string): Promise<LinkedInConversation[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("linkedin_conversations")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LinkedInConversation[];
}

export async function getConversation(
  clientId: string,
  conversationId: string
): Promise<LinkedInConversation | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("linkedin_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LinkedInConversation) ?? null;
}

export async function createConversation(
  clientId: string,
  title: string
): Promise<LinkedInConversation> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("linkedin_conversations")
    .insert({ client_id: clientId, title })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as LinkedInConversation;
}

export async function updateConversation(
  clientId: string,
  conversationId: string,
  patch: Partial<Pick<LinkedInConversation, "title" | "messages" | "context_override">>
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("linkedin_conversations")
    .update(patch)
    .eq("id", conversationId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

export async function deleteConversation(
  clientId: string,
  conversationId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("linkedin_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

export async function listPosts(
  clientId: string,
  conversationId: string
): Promise<LinkedInPost[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("linkedin_posts")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("client_id", clientId)
    .order("order_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LinkedInPost[];
}

export async function listAllPosts(clientId: string): Promise<LinkedInPost[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("linkedin_posts")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LinkedInPost[];
}

export interface PostInput {
  body: string;
  hook?: string | null;
  framework?: string | null;
  format?: "text" | "carousel" | "poll" | "story";
  metrics?: Record<string, unknown>;
}

/**
 * Remplace les posts d'une conversation par une nouvelle série.
 * On garde l'historique en supprimant le run précédent et en insérant le nouveau.
 */
export async function replacePostsForConversation(
  clientId: string,
  conversationId: string,
  posts: PostInput[]
): Promise<LinkedInPost[]> {
  const admin = createAdminClient();

  const { error: delError } = await admin
    .from("linkedin_posts")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("client_id", clientId);
  if (delError) throw new Error(delError.message);

  if (posts.length === 0) return [];

  const rows = posts.map((p, i) => ({
    conversation_id: conversationId,
    client_id: clientId,
    order_index: i,
    body: p.body,
    hook: p.hook ?? null,
    framework: p.framework ?? null,
    format: p.format ?? "text",
    metrics: p.metrics ?? {},
    status: "draft" as const,
  }));

  const { data, error } = await admin
    .from("linkedin_posts")
    .insert(rows)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as LinkedInPost[];
}

export async function updatePost(
  clientId: string,
  postId: string,
  patch: Partial<Pick<LinkedInPost, "body" | "hook" | "framework" | "format" | "status" | "metrics">>
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("linkedin_posts")
    .update(patch)
    .eq("id", postId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

export async function deletePost(clientId: string, postId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("linkedin_posts")
    .delete()
    .eq("id", postId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}
