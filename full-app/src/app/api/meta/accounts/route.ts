import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAllAccountsInsights } from "@/lib/meta-api";
import type { DatePreset } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const datePreset = (searchParams.get("period") ?? "last_30d") as DatePreset;

  await initMetaToken(adminSupabase);

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN manquant" }, { status: 500 });
  }

  const accounts = await getAllAccountsInsights(datePreset);
  return NextResponse.json({ accounts });
}
