import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { abortRun } from "@/lib/scraper/apify";
import type { ScrapeJob } from "@/types/scraper";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("scrape_jobs")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job || job.client_id !== session.user.id) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  return NextResponse.json({ job: job as ScrapeJob });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("scrape_jobs")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job || job.client_id !== session.user.id) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (job.status !== "queued" && job.status !== "running") {
    return NextResponse.json({ error: "Job déjà terminé" }, { status: 400 });
  }

  if (job.apify_run_id) {
    try {
      await abortRun(job.apify_run_id);
    } catch {
      // Swallow: cron poller will mark failed if Apify is unreachable.
    }
  }

  const { data: updated, error: updateError } = await admin
    .from("scrape_jobs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ job: updated as ScrapeJob });
}
