import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { createCustomAudience } from "@/lib/meta-api";
import { initMetaToken } from "@/lib/meta-token";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin requis" }, { status: 403 });

  await initMetaToken(adminSupabase);

  const { ad_account_id, name, description, subtype } = await req.json();
  if (!ad_account_id || !name) {
    return NextResponse.json({ error: "ad_account_id et name requis" }, { status: 400 });
  }

  try {
    const audience = await createCustomAudience(ad_account_id, { name, description, subtype });
    return NextResponse.json({ success: true, audience });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 500 });
  }
}
