import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";

export async function getSuperAdminRouteContext() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { error: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_super_admin")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "admin" || !profile?.is_super_admin) {
    return { error: NextResponse.json({ error: "Accès super admin requis" }, { status: 403 }) };
  }

  return {
    admin,
    session,
  };
}
