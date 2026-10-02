/**
 * GET /api/client/sales/cold-call-script/conversations
 *
 * Liste les conversations cold call du client.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { listConversations } from "@/lib/cold-call-script-writer/chat-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("archived") === "1";

  try {
    const items = await listConversations(session.user.id, { includeArchived });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
