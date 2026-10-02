import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { module_id, is_completed } = await req.json();
  if (!module_id || typeof is_completed !== "boolean") {
    return NextResponse.json({ error: "module_id et is_completed requis" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data, error } = await adminSupabase
    .from("client_formation_progress")
    .upsert(
      {
        client_id: session.user.id,
        module_id,
        is_completed,
        completed_at: is_completed ? new Date().toISOString() : null,
        last_viewed_at: new Date().toISOString(),
      },
      { onConflict: "client_id,module_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ progress: data });
}
