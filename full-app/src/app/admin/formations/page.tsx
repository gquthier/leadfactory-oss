import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { FormationsAdminClient } from "./FormationsAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminFormationsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role, is_super_admin").eq("id", session.user.id).single();
  if (profile?.role !== "admin") redirect("/client/overview");
  if (!profile?.is_super_admin) redirect("/admin/dashboard");

  const { data: formations } = await adminSupabase
    .from("formations")
    .select("*, formation_modules(id), client_formation_access(id)")
    .order("display_order", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (formations ?? []).map((f: any) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    slug: f.slug,
    cover_image_url: f.cover_image_url,
    is_published: f.is_published,
    display_order: f.display_order,
    created_at: f.created_at,
    updated_at: f.updated_at,
    modules_count: Array.isArray(f.formation_modules) ? f.formation_modules.length : 0,
    clients_count: Array.isArray(f.client_formation_access) ? f.client_formation_access.length : 0,
  }));

  return <FormationsAdminClient formations={result} />;
}
