import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { is_completed } = await req.json();
  const adminSupabase = createAdminClient();

  // Verify task belongs to client
  const { data: task } = await adminSupabase
    .from("client_tasks")
    .select("client_id")
    .eq("id", params.id)
    .single();

  if (!task || task.client_id !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { error } = await adminSupabase
    .from("client_tasks")
    .update({
      is_completed,
      completed_at: is_completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
