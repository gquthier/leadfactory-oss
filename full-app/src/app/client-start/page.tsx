import { createAdminClient, createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ClientStartChat } from "./client-start-client";

export const dynamic = "force-dynamic";

export default async function ClientStartPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.user.id)
    .maybeSingle();

  return <ClientStartChat firstName={profile?.full_name ?? "toi"} />;
}
