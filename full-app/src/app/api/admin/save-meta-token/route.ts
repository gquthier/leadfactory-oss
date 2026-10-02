import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function PATCH(req: Request) {
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

  const { meta_access_token } = await req.json();

  const { error } = await adminSupabase
    .from("profiles")
    .update({
      meta_access_token: meta_access_token || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Inject into running process so it takes effect immediately (no restart needed)
  if (meta_access_token) {
    process.env.META_ACCESS_TOKEN = meta_access_token;
  }

  return NextResponse.json({ success: true });
}
