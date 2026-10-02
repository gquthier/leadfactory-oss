import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { redirect } from "next/navigation";
import { FormationsClientPage } from "./FormationsClientPage";
import type { FormationWithProgress } from "@/types";

export const dynamic = "force-dynamic";

export default async function ClientFormationsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;
  const adminSupabase = createAdminClient();

  const [{ data: formations }, { data: allModules }, { data: progressData }] = await Promise.all([
    adminSupabase
      .from("formations")
      .select("*")
      .eq("is_published", true)
      .order("display_order", { ascending: true }),
    adminSupabase
      .from("formation_modules")
      .select("id, formation_id")
      .eq("is_published", true),
    adminSupabase
      .from("client_formation_progress")
      .select("module_id, is_completed")
      .eq("client_id", effectiveId)
      .eq("is_completed", true),
  ]);

  const completedModuleIds = new Set((progressData ?? []).map((p: { module_id: string }) => p.module_id));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formationsWithProgress = (formations ?? []).map((f: any) => {
    const fModules = (allModules ?? []).filter((m: any) => m.formation_id === f.id);
    const completedCount = fModules.filter((m: any) => completedModuleIds.has(m.id)).length;
    return { ...f, modules_count: fModules.length, completed_count: completedCount } as FormationWithProgress;
  });

  return <FormationsClientPage formations={formationsWithProgress} />;
}
