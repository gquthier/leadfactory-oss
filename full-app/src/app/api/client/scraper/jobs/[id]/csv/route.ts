import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

function slugFromUrl(inputUrl: string): string {
  let raw = "scrape";
  try {
    const u = new URL(inputUrl);
    const m = u.pathname.match(/\/search\/([^/?]+)/i);
    if (m && m[1]) raw = decodeURIComponent(m[1]);
  } catch {
    // fall through to default
  }
  const slug = raw
    .toLowerCase()
    .replace(/\+/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "scrape";
}

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
  if (
    !job ||
    job.client_id !== session.user.id ||
    job.status !== "done" ||
    !job.csv_storage_path
  ) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const { data: blob, error: dlError } = await admin.storage
    .from("scraper-csvs")
    .download(job.csv_storage_path);

  if (dlError || !blob) {
    return NextResponse.json({ error: "Téléchargement impossible" }, { status: 500 });
  }

  const slug = slugFromUrl(job.input_url);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `gmaps_${slug}_${date}_${job.results_count}rows.csv`;

  return new Response(blob, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
