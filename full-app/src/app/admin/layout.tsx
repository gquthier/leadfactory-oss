import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getVisibleOnboardingResponses } from "@/lib/onboarding-briefs";
import { AdminLayoutClient } from "./AdminLayoutClient";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role, is_super_admin, is_active")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") redirect("/client/overview");
  if (!profile?.is_active) redirect("/login?disabled=1");

  const isSuperAdmin = profile?.is_super_admin ?? false;

  // Pending onboarding count — visible to all admins
  const { data: onboardingResponses } = await adminSupabase
    .from("onboarding_responses")
    .select("id, client_id, responses")
    .is("client_id", null);

  const pendingCount = getVisibleOnboardingResponses(onboardingResponses).length;

  return (
    <AdminLayoutClient pendingCount={pendingCount} isSuperAdmin={isSuperAdmin}>
      {children}
    </AdminLayoutClient>
  );
}
