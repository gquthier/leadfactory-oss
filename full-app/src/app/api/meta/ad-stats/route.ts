import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdInsights } from "@/lib/meta-api";
import type { DatePreset } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  await initMetaToken(adminSupabase);

  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("ad_account_id");
  const datePreset = (searchParams.get("period") ?? "last_30d") as DatePreset;

  if (!adAccountId) {
    return NextResponse.json({ error: "ad_account_id requis" }, { status: 400 });
  }

  // Clients can only see their own linked ad account
  if (profile?.role !== "admin") {
    const variants = [adAccountId];
    if (adAccountId.startsWith("act_")) {
      variants.push(adAccountId.slice(4));
    } else {
      variants.push(`act_${adAccountId}`);
    }
    const { data: campaign } = await adminSupabase
      .from("campaigns")
      .select("id")
      .eq("client_id", session.user.id)
      .in("ad_account_id", variants)
      .limit(1)
      .maybeSingle();

    if (!campaign) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }
  }

  const ads = await getAdInsights(adAccountId, datePreset);
  return NextResponse.json({ ads });
}
