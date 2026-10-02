import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { ClientLayoutClient } from "./ClientLayoutClient";
import { getPreviewClientId } from "@/lib/client-preview";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewClientId = await getPreviewClientId();
  const adminSupabase = createAdminClient();

  const [{ data: profile }, { count: pendingTasksCount }] = await Promise.all([
    // En mode aperçu : charge le profil du client prévisualisé
    adminSupabase
      .from("profiles")
      .select("role, company, full_name, next_catchup, is_active")
      .eq("id", previewClientId ?? session.user.id)
      .single(),
    adminSupabase
      .from("client_tasks")
      .select("id", { count: "exact", head: true })
      .eq("client_id", previewClientId ?? session.user.id)
      .eq("is_completed", false),
  ]);

  // Admin sans mode aperçu → renvoyer sur admin
  if (profile?.role === "admin" && !previewClientId) redirect("/admin/dashboard");

  // Profil introuvable (problème DB/RLS/timing) → rediriger vers login sans message trompeur
  if (!profile) redirect("/login?error=profile_not_found");

  // Compte explicitement désactivé
  if (profile.is_active === false) redirect("/login?disabled=1");

  return (
    <ClientLayoutClient
      companyName={profile?.company || profile?.full_name || ""}
      nextCatchup={profile?.next_catchup ?? null}
      clientId={previewClientId ?? session.user.id}
      pendingTasksCount={pendingTasksCount ?? 0}
      isPreview={!!previewClientId}
      previewClientName={previewClientId ? (profile?.company || profile?.full_name || "") : null}
      adminClientId={previewClientId ? session.user.id : null}
    >
      {children}
    </ClientLayoutClient>
  );
}
