/**
 * CRUD server-side pour les conversations et emails de séquence.
 * Toutes les fonctions exigent que le caller ait déjà validé que clientId
 * correspond à l'utilisateur authentifié (RLS pose une 2e barrière).
 */

import { createAdminClient } from "@/lib/supabase-server";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SequenceConversation {
  id: string;
  client_id: string;
  title: string;
  messages: ChatMessage[];
  context_override: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SequenceEmail {
  id: string;
  conversation_id: string;
  client_id: string;
  order_index: number;
  subject: string | null;
  body: string;
  wait_days: number;
  status: "draft" | "scheduled" | "sent" | "action_needed";
  ab_variants: unknown[];
  created_at: string;
  updated_at: string;
}

// ─── CONVERSATIONS ────────────────────────────────────────────────

export async function listConversations(clientId: string): Promise<SequenceConversation[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sequence_conversations")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`listConversations: ${error.message}`);
  return (data ?? []) as SequenceConversation[];
}

export async function getConversation(
  clientId: string,
  conversationId: string
): Promise<SequenceConversation | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sequence_conversations")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw new Error(`getConversation: ${error.message}`);
  return (data as SequenceConversation) ?? null;
}

export async function createConversation(
  clientId: string,
  title = "Nouvelle séquence"
): Promise<SequenceConversation> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sequence_conversations")
    .insert({ client_id: clientId, title, messages: [] })
    .select("*")
    .single();

  if (error) throw new Error(`createConversation: ${error.message}`);
  return data as SequenceConversation;
}

export async function updateConversation(
  clientId: string,
  conversationId: string,
  patch: Partial<Pick<SequenceConversation, "title" | "messages" | "context_override">>
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("sequence_conversations")
    .update(patch)
    .eq("client_id", clientId)
    .eq("id", conversationId);

  if (error) throw new Error(`updateConversation: ${error.message}`);
}

export async function deleteConversation(
  clientId: string,
  conversationId: string
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("sequence_conversations")
    .delete()
    .eq("client_id", clientId)
    .eq("id", conversationId);

  if (error) throw new Error(`deleteConversation: ${error.message}`);
}

// ─── EMAILS ──────────────────────────────────────────────────────

export async function listEmails(
  clientId: string,
  conversationId: string
): Promise<SequenceEmail[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sequence_emails")
    .select("*")
    .eq("client_id", clientId)
    .eq("conversation_id", conversationId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(`listEmails: ${error.message}`);
  return (data ?? []) as SequenceEmail[];
}

export interface EmailInput {
  subject: string | null;
  body: string;
  wait_days: number;
  order_index?: number;
}

export async function replaceEmailsForConversation(
  clientId: string,
  conversationId: string,
  emails: EmailInput[]
): Promise<SequenceEmail[]> {
  const db = createAdminClient();

  // Stratégie : delete + re-insert. Plus simple que diff et acceptable
  // vu le volume (typiquement < 10 emails par séquence).
  const { error: delErr } = await db
    .from("sequence_emails")
    .delete()
    .eq("client_id", clientId)
    .eq("conversation_id", conversationId);

  if (delErr) throw new Error(`replaceEmails delete: ${delErr.message}`);

  if (emails.length === 0) return [];

  const rows = emails.map((e, i) => ({
    client_id: clientId,
    conversation_id: conversationId,
    order_index: e.order_index ?? i,
    subject: e.subject,
    body: e.body,
    wait_days: e.wait_days,
  }));

  const { data, error } = await db.from("sequence_emails").insert(rows).select("*");
  if (error) throw new Error(`replaceEmails insert: ${error.message}`);
  return (data ?? []) as SequenceEmail[];
}

export async function updateEmail(
  clientId: string,
  emailId: string,
  patch: Partial<Pick<SequenceEmail, "subject" | "body" | "wait_days" | "status" | "order_index" | "ab_variants">>
): Promise<SequenceEmail> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sequence_emails")
    .update(patch)
    .eq("client_id", clientId)
    .eq("id", emailId)
    .select("*")
    .single();

  if (error) throw new Error(`updateEmail: ${error.message}`);
  return data as SequenceEmail;
}

export async function deleteEmail(clientId: string, emailId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("sequence_emails")
    .delete()
    .eq("client_id", clientId)
    .eq("id", emailId);

  if (error) throw new Error(`deleteEmail: ${error.message}`);
}
