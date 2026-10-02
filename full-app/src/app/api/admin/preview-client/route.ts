import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { PREVIEW_COOKIE } from "@/lib/client-preview";

/** POST { client_id } — active le mode aperçu client pour l'admin */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const { client_id } = await req.json();
  if (!client_id) return NextResponse.json({ error: "client_id requis" }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PREVIEW_COOKIE, client_id, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60, // 1h
  });
  return res;
}

/** DELETE — quitte le mode aperçu client */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PREVIEW_COOKIE, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 0,
  });
  return res;
}
