import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  // ── Auth — admin only ────────────────────────────────────────────
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });
  }

  // ── Parse body ───────────────────────────────────────────────────
  let html: string;
  try {
    const body = await req.json();
    html = body.html;
    if (!html?.trim()) throw new Error("HTML vide");
  } catch {
    return NextResponse.json({ error: "HTML requis" }, { status: 400 });
  }

  // ── Puppeteer screenshot ─────────────────────────────────────────
  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });

    // Extra wait to ensure Google Fonts have loaded and rendered
    await page.evaluate(() => document.fonts.ready);

    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1080, height: 1080 },
      encoding: "base64",
    });

    await browser.close();

    return NextResponse.json({
      imageBase64: screenshot as string,
      mimeType: "image/png",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    console.error("[html-to-image] Error:", msg);
    return NextResponse.json({ error: `Screenshot failed: ${msg}` }, { status: 500 });
  }
}
