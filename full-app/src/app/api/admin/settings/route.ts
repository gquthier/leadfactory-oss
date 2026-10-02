/**
 * GET    /api/admin/settings              → liste toutes les settings
 * GET    /api/admin/settings?key=foo      → une seule setting
 * PATCH  /api/admin/settings              → upsert { key, value }
 *
 * Admin only.
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Non autorisé", status: 401 as const, userId: null };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: "Accès admin requis", status: 403 as const, userId: null };
  }

  return { error: null, status: 200 as const, userId: session.user.id };
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  const admin = createAdminClient();

  if (key) {
    const { data, error } = await admin
      .from("app_settings")
      .select("*")
      .eq("key", key)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ setting: data });
  }

  const { data, error } = await admin
    .from("app_settings")
    .select("*")
    .order("key");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? [] });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { key?: string; value?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  if (!body.key || typeof body.key !== "string") {
    return NextResponse.json({ error: "key requise" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .upsert(
      {
        key: body.key,
        value: body.value as Record<string, unknown> | string | number | boolean,
        updated_by: auth.userId,
      },
      { onConflict: "key" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ setting: data });
}
