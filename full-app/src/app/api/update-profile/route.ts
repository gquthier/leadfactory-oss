import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { full_name, company, phone } = await req.json();

  const adminSupabase = createAdminClient();
  const { error } = await adminSupabase
    .from("profiles")
    .update({
      full_name: full_name?.trim() || undefined,
      company: company?.trim() || undefined,
      phone: phone?.trim() || undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
