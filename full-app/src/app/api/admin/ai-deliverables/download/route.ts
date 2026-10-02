import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

const BUCKET = "ai-deliverables";

/**
 * GET /api/admin/ai-deliverables/download?id={deliverable_uuid}
 * Génère une signed URL Storage via REST (service_role, bypass RLS) et redirige.
 * Super-admin only.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const scope = await getAdminScope(session.user.id);
  if (!scope.isSuperAdmin) {
    return NextResponse.json({ error: "Accès super-admin requis" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const adminSupabase = createAdminClient();
  const { data: deliverable, error } = await adminSupabase
    .from("ai_deliverables")
    .select("relative_path, deliverable_name")
    .eq("id", id)
    .single();

  if (error || !deliverable) {
    return NextResponse.json({ error: "Livrable introuvable", debug: error?.message }, { status: 404 });
  }

  // Appel REST direct au Storage avec service_role key (bypass RLS)
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const signEndpoint = `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${deliverable.relative_path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  const signRes = await fetch(signEndpoint, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 }),
  });

  if (!signRes.ok) {
    const debug = await signRes.text();
    return NextResponse.json(
      { error: "Fichier introuvable dans Storage", debug, path: deliverable.relative_path, status: signRes.status },
      { status: 404 }
    );
  }

  const json = (await signRes.json()) as { signedURL?: string; signedUrl?: string };
  const relativeSigned = json.signedURL || json.signedUrl;
  if (!relativeSigned) {
    return NextResponse.json({ error: "Réponse Storage invalide", debug: JSON.stringify(json) }, { status: 500 });
  }

  // Le signedURL retourné est un path relatif (/object/sign/...), on le préfixe
  const fullUrl = relativeSigned.startsWith("http")
    ? relativeSigned
    : `${SUPABASE_URL}/storage/v1${relativeSigned}&download=${encodeURIComponent(deliverable.deliverable_name)}`;

  return NextResponse.redirect(fullUrl, 302);
}
