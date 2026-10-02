import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { startGoogleMapsRun } from "@/lib/scraper/apify";
import type { ScrapeJob, CreateJobRequest } from "@/types/scraper";

const GMAPS_URL_RE = /^https?:\/\/(www\.|maps\.)?google\.[a-z.]+\/maps\//i;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = (await req.json()) as CreateJobRequest;

  if (!body.url || !GMAPS_URL_RE.test(body.url)) {
    return NextResponse.json({ error: "URL Google Maps invalide" }, { status: 400 });
  }

  const envCap = Number(process.env.SCRAPER_MAX_RESULTS_PER_JOB ?? "2000");
  const maxResults = Math.max(10, Math.min(body.maxResults ?? 1000, envCap));
  const enrichEmails = body.enrichEmails ?? true;

  const admin = createAdminClient();
  const clientId = session.user.id;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("scrape_jobs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", since);

  if ((recentCount ?? 0) >= 5) {
    return NextResponse.json(
      { error: "Limite quotidienne atteinte (5 scrapes/jour)" },
      { status: 429 },
    );
  }

  const { data: job, error: insertError } = await admin
    .from("scrape_jobs")
    .insert({
      client_id: clientId,
      source: "google_maps",
      input_url: body.url,
      input_options: { maxResults, enrichEmails },
      status: "queued",
    })
    .select()
    .single();

  if (insertError || !job) {
    return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
  }

  try {
    const run = await startGoogleMapsRun({ url: body.url, maxResults, enrichEmails });
    const { data: updated, error: updateError } = await admin
      .from("scrape_jobs")
      .update({
        apify_run_id: run.runId,
        apify_dataset_id: run.defaultDatasetId,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message ?? "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ job: updated as ScrapeJob });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Apify start failed";
    await admin
      .from("scrape_jobs")
      .update({
        status: "failed",
        error_message: msg,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ error: "Échec du démarrage du scraper" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scrape_jobs")
    .select("*")
    .eq("client_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ jobs: (data ?? []) as ScrapeJob[] });
}
