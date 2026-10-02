/**
 * CRUD server-side pour les conversations cold call chat.
 * Calqué sur sequence-data.ts.
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ColdCallConversation {
  id: string;
  client_id: string;
  title: string;
  messages: ChatMessage[];
  current_script: unknown | null;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  last_model_used: string | null;
  archived: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

const TABLE = "cold_call_conversations";

export async function listConversations(
  clientId: string,
  options: { includeArchived?: boolean } = {}
): Promise<ColdCallConversation[]> {
  const db = createAdminClient();
  let q = db
    .from(TABLE)
    .select("*")
    .eq("client_id", clientId)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (!options.includeArchived) q = q.eq("archived", false);

  const { data, error } = await q;
  if (error) throw new Error(`listConversations: ${error.message}`);
  return (data ?? []) as ColdCallConversation[];
}

export async function getConversation(
  clientId: string,
  conversationId: string
): Promise<ColdCallConversation | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("client_id", clientId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new Error(`getConversation: ${error.message}`);
  return (data as ColdCallConversation) ?? null;
}

export async function createConversation(
  clientId: string,
  title = "Nouvelle conversation"
): Promise<ColdCallConversation> {
  const db = createAdminClient();
  const { data, error } = await db
    .from(TABLE)
    .insert({ client_id: clientId, title, messages: [] })
    .select("*")
    .single();

  if (error) throw new Error(`createConversation: ${error.message}`);
  return data as ColdCallConversation;
}

export async function updateConversation(
  clientId: string,
  conversationId: string,
  patch: Partial<
    Pick<
      ColdCallConversation,
      | "title"
      | "messages"
      | "current_script"
      | "total_prompt_tokens"
      | "total_completion_tokens"
      | "last_model_used"
      | "archived"
      | "pinned"
    >
  >
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from(TABLE)
    .update(patch)
    .eq("id", conversationId)
    .eq("client_id", clientId);

  if (error) throw new Error(`updateConversation: ${error.message}`);
}

export async function deleteConversation(
  clientId: string,
  conversationId: string
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq("id", conversationId)
    .eq("client_id", clientId);

  if (error) throw new Error(`deleteConversation: ${error.message}`);
}
