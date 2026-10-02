import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

/**
 * GET /api/admin/ai-deliverables?client_id={uuid}
 * Liste tous les livrables AI index\u00e9s pour un client.
 * R\u00e9serv\u00e9 aux super-admins.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autoris\u00e9" }, { status: 401 });

  const scope = await getAdminScope(session.user.id);
  if (!scope.isSuperAdmin) {
    return NextResponse.json({ error: "Acc\u00e8s super-admin requis" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "client_id requis" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from("ai_deliverables")
    .select("*")
    .eq("client_id", clientId)
    .order("relative_path", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deliverables: data ?? [] });
}
