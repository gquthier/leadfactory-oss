import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

/**
 * POST /api/admin/create-admin
 * Body: { email: string, full_name: string, password: string, is_super_admin?: boolean }
 * Super-admin only — creates a new admin account.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  if (!scope.isSuperAdmin) {
    return NextResponse.json({ error: "Super-admin requis" }, { status: 403 });
  }

  const { email, full_name, password, is_super_admin = false } = await req.json();
  if (!email?.trim() || !full_name?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "email, full_name et password requis" }, { status: 400 });
  }

  // Create auth user
  const { data: newUser, error: userError } = await adminSupabase.auth.admin.createUser({
    email: email.trim(),
    password: password.trim(),
    email_confirm: true,
    user_metadata: { full_name: full_name.trim() },
  });
  if (userError) return NextResponse.json({ error: `Erreur création compte : ${userError.message}` }, { status: 500 });

  const userId = newUser.user.id;

  // Update profile to admin role
  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({
      full_name: full_name.trim(),
      role: "admin",
      is_super_admin: is_super_admin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  return NextResponse.json({ success: true, userId });
}
