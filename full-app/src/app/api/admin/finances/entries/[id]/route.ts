import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";
import type { FinanceEntryType } from "@/types/index";

async function getSuperAdminContext() {
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

  return { admin };
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSuperAdminContext();
  if ("error" in context) return context.error;

  const {
    client_id,
    team_member_id,
    entry_type,
    category,
    label,
    amount,
    entry_date,
    received_by,
    notes,
  } = await req.json();

  if (!label?.trim() || !entry_date || !["revenue", "expense"].includes(entry_type)) {
    return NextResponse.json({ error: "label, entry_date et entry_type valides sont requis" }, { status: 400 });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
  }

  let resolvedReceivedBy = received_by?.trim() || null;
  if (team_member_id) {
    const { data: teamMember } = await context.admin
      .from("profiles")
      .select("full_name")
      .eq("id", team_member_id)
      .single();
    resolvedReceivedBy = teamMember?.full_name ?? resolvedReceivedBy;
  }

  const { data, error } = await context.admin
    .from("finance_entries")
    .update({
      client_id: client_id || null,
      team_member_id: team_member_id || null,
      entry_type: entry_type as FinanceEntryType,
      category: category?.trim() || "other",
      label: label.trim(),
      amount: numericAmount,
      entry_date,
      received_by: resolvedReceivedBy,
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ entry: data });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSuperAdminContext();
  if ("error" in context) return context.error;

  const { error } = await context.admin
    .from("finance_entries")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
