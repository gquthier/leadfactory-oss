/**
 * DELETE /api/client/integrations/keys/[id]
 *
 * "Soft delete" : on set revoked_at au lieu de supprimer la row, pour préserver
 * les logs historiques qui référencent cette clé.
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";

export const dynamic = "force-dynamic";

async function getEffectiveClientId() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const previewClientId = await getPreviewClientId();
  return profile?.role === "admin" && previewClientId
    ? previewClientId
    : session.user.id;
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("integration_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("id", params.id)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
