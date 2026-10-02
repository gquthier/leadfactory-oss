import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { decryptToken } from "@/lib/linkedin/encryption";
import { unsubscribePageFromLeadgen } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function DELETE(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  // ?pageId= pour déconnecter une page précise ; sinon toutes les pages du client.
  const pageId = req.nextUrl.searchParams.get("pageId");

  let sel = admin
    .from("meta_connections")
    .select("page_id, page_token_encrypted, page_token_iv, page_token_tag")
    .eq("client_id", session.user.id);
  if (pageId) sel = sel.eq("page_id", pageId);
  const { data: conns } = await sel;

  // Best-effort : désabonner chaque page du webhook leadgen.
  for (const c of conns ?? []) {
    if (c.page_token_encrypted && c.page_token_iv && c.page_token_tag) {
      try {
        const pageToken = decryptToken({
          encrypted: c.page_token_encrypted,
          iv: c.page_token_iv,
          tag: c.page_token_tag,
        });
        await unsubscribePageFromLeadgen(c.page_id, pageToken);
      } catch (e) {
        console.error("[meta/disconnect] unsubscribe failed:", e);
      }
    }
  }

  let del = admin.from("meta_connections").delete().eq("client_id", session.user.id);
  if (pageId) del = del.eq("page_id", pageId);
  const { error } = await del;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ disconnected: true });
}
