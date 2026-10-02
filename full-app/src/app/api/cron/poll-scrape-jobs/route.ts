import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { getRunStatus, fetchDataset } from "@/lib/scraper/apify";
import { buildCsv } from "@/lib/scraper/csv-builder";
import type { ScrapeJobOptions } from "@/types/scraper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RUNNING_MS = 30 * 60 * 1000;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: jobs, error: queryError } = await admin
    .from("scrape_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .not("apify_run_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (queryError) {
    console.error("[poll-scrape-jobs] query error:", queryError);
    return NextResponse.json(
      { processed: 0, finalized: 0, failed: 0, queryError: queryError.message },
      { status: 500 },
    );
  }

  console.log(`[poll-scrape-jobs] found ${jobs?.length ?? 0} jobs to process`);

  let processed = 0;
  let finalized = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    processed++;

    if (job.started_at) {
      const ageMs = Date.now() - new Date(job.started_at).getTime();
      if (ageMs > MAX_RUNNING_MS) {
        await admin
          .from("scrape_jobs")
          .update({
            status: "failed",
            error_message: "Timeout (>30min)",
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        failed++;
        continue;
      }
    }

    try {
      const s = await getRunStatus(job.apify_run_id!);
      if (s.status === "SUCCEEDED") {
        const items = await fetchDataset(s.datasetId ?? job.apify_dataset_id!);
        const csv = buildCsv(items, {
          scraped_at: new Date().toISOString(),
          input_url: job.input_url,
        });
        const path = `${job.client_id}/${job.id}.csv`;
        const { error: uploadErr } = await admin.storage
          .from("scraper-csvs")
          .upload(path, new Blob([csv], { type: "text/csv; charset=utf-8" }), {
            contentType: "text/csv; charset=utf-8",
            upsert: true,
          });
        if (uploadErr) throw uploadErr;
        await admin
          .from("scrape_jobs")
          .update({
            status: "done",
            results_count: items.length,
            cost_usd: s.costUsd,
            csv_storage_path: path,
            progress_pct: 100,
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        finalized++;
      } else if (s.status === "RUNNING") {
        const opts = job.input_options as ScrapeJobOptions | null;
        const maxResults = opts?.maxResults ?? 1000;
        const pct = Math.min(95, Math.round((s.itemCount / maxResults) * 100));
        await admin
          .from("scrape_jobs")
          .update({
            status: "running",
            progress_pct: pct,
            results_count: s.itemCount,
          })
          .eq("id", job.id);
      } else if (["FAILED", "TIMING-OUT", "ABORTED"].includes(s.status)) {
        await admin
          .from("scrape_jobs")
          .update({
            status: s.status === "ABORTED" ? "cancelled" : "failed",
            error_message: `Apify run ${s.status}`,
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        failed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      await admin
        .from("scrape_jobs")
        .update({
          status: "failed",
          error_message: msg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      failed++;
    }
  }

  return NextResponse.json({ processed, finalized, failed });
}
