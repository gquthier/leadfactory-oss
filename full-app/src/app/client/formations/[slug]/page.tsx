import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { redirect } from "next/navigation";
import { FormationDetailClientPage } from "./FormationDetailClientPage";
import type { FormationModuleWithProgress } from "@/types";

export const dynamic = "force-dynamic";

export default async function ClientFormationDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;
  const adminSupabase = createAdminClient();

  // Get formation by slug
  const { data: formation } = await adminSupabase
    .from("formations")
    .select("*")
    .eq("slug", params.slug)
    .eq("is_published", true)
    .single();

  if (!formation) redirect("/client/formations");

  // Get modules + progress
  const [{ data: modules }, { data: progressData }] = await Promise.all([
    adminSupabase
      .from("formation_modules")
      .select("*")
      .eq("formation_id", formation.id)
      .eq("is_published", true)
      .order("display_order", { ascending: true })
      .order("module_number", { ascending: true }),
    adminSupabase
      .from("client_formation_progress")
      .select("*")
      .eq("client_id", effectiveId),
  ]);

  const progressMap = new Map(
    (progressData ?? []).map((p: { module_id: string; is_completed: boolean; completed_at: string | null }) => [p.module_id, p])
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modulesWithProgress: FormationModuleWithProgress[] = (modules ?? []).map((m: any) => ({
    ...m,
    is_completed: progressMap.get(m.id)?.is_completed ?? false,
    completed_at: progressMap.get(m.id)?.completed_at ?? null,
  }));

  const completedCount = modulesWithProgress.filter((m) => m.is_completed).length;

  return (
    <FormationDetailClientPage
      formation={formation}
      modules={modulesWithProgress}
      completedCount={completedCount}
    />
  );
}
