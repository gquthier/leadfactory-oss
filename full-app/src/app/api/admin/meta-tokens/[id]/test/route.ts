import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

async function assertAdmin() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return null;

  return admin;
}

/** POST /api/admin/meta-tokens/[id]/test — vérifie que le token est valide */
export async function POST(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { data: tokenRecord } = await admin
    .from("meta_tokens")
    .select("token, name")
    .eq("id", params.id)
    .single();

  if (!tokenRecord?.token) {
    return NextResponse.json({ error: "Token introuvable" }, { status: 404 });
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(tokenRecord.token)}`,
      { cache: "no-store" }
    );
    const data = await res.json() as Record<string, unknown>;

    if (!res.ok || data.error) {
      const err = data.error as { message?: string } | undefined;
      return NextResponse.json({
        ok: false,
        error: err?.message ?? "Token invalide",
      });
    }

    // Compter les comptes pub accessibles
    const accountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${encodeURIComponent(tokenRecord.token)}`,
      { cache: "no-store" }
    );
    const accountsData = await accountsRes.json() as { data?: Array<{ id: string; name: string; account_status: number }> };
    const accounts = accountsData.data ?? [];
    const activeAccounts = accounts.filter(a => a.account_status === 1);

    return NextResponse.json({
      ok: true,
      user: { id: String(data.id), name: String(data.name) },
      adAccountsTotal: accounts.length,
      adAccountsActive: activeAccounts.length,
      adAccounts: activeAccounts.slice(0, 10).map(a => ({ id: a.id, name: a.name })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) });
  }
}
