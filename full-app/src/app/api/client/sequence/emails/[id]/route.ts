import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getPreviewClientId } from "@/lib/client-preview";
import { updateEmail, deleteEmail } from "@/lib/sequence-data";

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

// PATCH /api/client/sequence/emails/[id]
// Mise à jour d'un email (subject/body/wait_days/status/order_index/ab_variants)
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = (await req.json()) as {
    subject?: string | null;
    body?: string;
    wait_days?: number;
    status?: "draft" | "scheduled" | "sent" | "action_needed";
    order_index?: number;
    ab_variants?: unknown[];
  };

  const updated = await updateEmail(clientId, params.id, body);
  return NextResponse.json({ email: updated });
}

// DELETE /api/client/sequence/emails/[id]
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const clientId = await getEffectiveClientId();
  if (!clientId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  await deleteEmail(clientId, params.id);
  return NextResponse.json({ success: true });
}
