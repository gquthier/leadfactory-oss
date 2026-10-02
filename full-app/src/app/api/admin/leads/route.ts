import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope } from "@/lib/admin-scope";

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Accès admin requis" }, { status: 403 });

  const scope = await getAdminScope(session.user.id);
  const { searchParams } = new URL(req.url);
  const campaign_id = searchParams.get("campaign_id");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") ?? "100", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  let query = adminSupabase
    .from("leads")
    .select("*, campaigns!inner(name, ad_account_id, managed_by), profiles(full_name, company)", { count: "exact" })
    .order("meta_created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (!scope.isSuperAdmin) {
    query =
      scope.assignedCampaignIds.length > 0
        ? query.or(
            `managed_by.eq.${scope.adminId},id.in.(${scope.assignedCampaignIds.join(",")})`,
            { referencedTable: "campaigns" }
          )
        : query.eq("campaigns.managed_by", scope.adminId);
  }
  if (campaign_id) query = query.eq("campaign_id", campaign_id);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ leads: data ?? [], total: count ?? 0 });
}
