/**
 * Reels data layer — conversations + scripts persistence.
 * Mirror direct de linkedin-data.ts, adapté pour les scripts Reels.
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface ReelsChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface ReelsConversation {
  id: string;
  client_id: string;
  title: string;
  messages: ReelsChatMessage[];
  context_override: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type ReelFormat = "reel" | "tiktok" | "short";
export type ReelPlatform = "instagram" | "tiktok" | "youtube";
export type ReelStatus = "draft" | "scheduled" | "published" | "archived";

export interface ReelScript {
  id: string;
  conversation_id: string;
  client_id: string;
  order_index: number;
  body: string;
  hook: string | null;
  framework: string | null;
  format: ReelFormat;
  platform: ReelPlatform;
  duration_seconds: number | null;
  metrics: Record<string, unknown>;
  status: ReelStatus;
  created_at: string;
  updated_at: string;
}

export async function listConversations(clientId: string): Promise<ReelsConversation[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reels_conversations")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReelsConversation[];
}

export async function getConversation(
  clientId: string,
  conversationId: string
): Promise<ReelsConversation | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reels_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReelsConversation) ?? null;
}

export async function createConversation(
  clientId: string,
  title: string
): Promise<ReelsConversation> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reels_conversations")
    .insert({ client_id: clientId, title })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ReelsConversation;
}

export async function updateConversation(
  clientId: string,
  conversationId: string,
  patch: Partial<Pick<ReelsConversation, "title" | "messages" | "context_override">>
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("reels_conversations")
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
    .from("reels_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

export async function listScripts(
  clientId: string,
  conversationId: string
): Promise<ReelScript[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reels_scripts")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("client_id", clientId)
    .order("order_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReelScript[];
}

export async function listAllScripts(clientId: string): Promise<ReelScript[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reels_scripts")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReelScript[];
}

export interface ScriptInput {
  body: string;
  hook?: string | null;
  framework?: string | null;
  format?: ReelFormat;
  platform?: ReelPlatform;
  durationSeconds?: number | null;
  metrics?: Record<string, unknown>;
}

/**
 * Remplace les scripts d'une conversation par une nouvelle série.
 */
export async function replaceScriptsForConversation(
  clientId: string,
  conversationId: string,
  scripts: ScriptInput[]
): Promise<ReelScript[]> {
  const admin = createAdminClient();

  const { error: delError } = await admin
    .from("reels_scripts")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("client_id", clientId);
  if (delError) throw new Error(delError.message);

  if (scripts.length === 0) return [];

  const rows = scripts.map((s, i) => ({
    conversation_id: conversationId,
    client_id: clientId,
    order_index: i,
    body: s.body,
    hook: s.hook ?? null,
    framework: s.framework ?? null,
    format: s.format ?? "reel",
    platform: s.platform ?? "instagram",
    duration_seconds: s.durationSeconds ?? null,
    metrics: s.metrics ?? {},
    status: "draft" as const,
  }));

  const { data, error } = await admin
    .from("reels_scripts")
    .insert(rows)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as ReelScript[];
}

export async function updateScript(
  clientId: string,
  scriptId: string,
  patch: Partial<Pick<ReelScript, "body" | "hook" | "framework" | "format" | "platform" | "duration_seconds" | "status" | "metrics">>
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("reels_scripts")
    .update(patch)
    .eq("id", scriptId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

export async function deleteScript(clientId: string, scriptId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("reels_scripts")
    .delete()
    .eq("id", scriptId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}
