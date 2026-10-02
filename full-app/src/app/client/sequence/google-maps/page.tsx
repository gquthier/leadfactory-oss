import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import type { ScrapeJob } from "@/types/scraper";
import { ScraperClient } from "./ScraperClient";

export const dynamic = "force-dynamic";

export default async function GoogleMapsScraperPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const clientId =
    profile?.role === "admin" && previewId ? previewId : session.user.id;

  const { data: jobs } = await admin
    .from("scrape_jobs")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <ScraperClient initialJobs={(jobs as unknown as ScrapeJob[]) ?? []} />
  );
}
