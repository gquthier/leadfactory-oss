import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { FormationDetailClient } from "./FormationDetailClient";

export const dynamic = "force-dynamic";

export default async function AdminFormationDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role, is_super_admin").eq("id", session.user.id).single();
  if (profile?.role !== "admin") redirect("/client/overview");
  if (!profile?.is_super_admin) redirect("/admin/dashboard");

  const [
    { data: formation },
    { data: modules },
    { data: access },
    { data: clients },
  ] = await Promise.all([
    adminSupabase.from("formations").select("*").eq("id", params.id).single(),
    adminSupabase
      .from("formation_modules")
      .select("*")
      .eq("formation_id", params.id)
      .order("display_order", { ascending: true })
      .order("module_number", { ascending: true }),
    adminSupabase.from("client_formation_access").select("*, profiles:client_id(id, full_name, company, email)").eq("formation_id", params.id),
    adminSupabase.from("profiles").select("id, full_name, company, email").eq("role", "client").order("full_name"),
  ]);

  const moduleIds = (modules ?? []).map((m: { id: string }) => m.id);
  const { data: progress } = moduleIds.length > 0
    ? await adminSupabase.from("client_formation_progress").select("*").in("module_id", moduleIds)
    : { data: [] };

  if (!formation) redirect("/admin/formations");

  return (
    <FormationDetailClient
      formation={formation}
      modules={modules ?? []}
      access={access ?? []}
      allClients={clients ?? []}
      progress={progress ?? []}
    />
  );
}
