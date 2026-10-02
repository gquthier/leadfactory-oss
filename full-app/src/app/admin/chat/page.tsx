import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ChatInterface } from "./ChatInterface";

export default async function AdminChatPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adminClient = createAdminClient();

  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") redirect("/client/overview");

  // Load clients list for context picker
  const { data: clients } = await adminClient
    .from("profiles")
    .select("id, full_name, company, email")
    .eq("role", "client")
    .order("created_at", { ascending: false });

  return <ChatInterface clients={clients ?? []} isAdmin={profile?.role === "admin"} />;
}
