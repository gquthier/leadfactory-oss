import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase-server";
import type { FinancePhase } from "@/types/index";

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

export async function POST(req: Request) {
  const context = await getSuperAdminContext();
  if ("error" in context) return context.error;

  const {
    client_id,
    phase,
    trial_amount,
    trial_start_date,
    trial_end_date,
    mrr_amount,
    next_payment_date,
    last_payment_date,
    notes,
    payment_entry_id,
    payment_amount,
    payment_date,
  } = await req.json();

  if (!client_id || !["trial", "mrr"].includes(phase)) {
    return NextResponse.json({ error: "client_id et phase valides sont requis" }, { status: 400 });
  }

  const payload = {
    client_id: String(client_id),
    phase: phase as FinancePhase,
    trial_amount: trial_amount == null ? null : Number(trial_amount),
    trial_start_date: trial_start_date || null,
    trial_end_date: trial_end_date || null,
    mrr_amount: mrr_amount == null ? null : Number(mrr_amount),
    next_payment_date: next_payment_date || null,
    last_payment_date: last_payment_date || null,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await context.admin
    .from("client_finance_profiles")
    .upsert(payload, { onConflict: "client_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let payment = null;
  const normalizedPaymentAmount =
    payment_amount == null || payment_amount === "" ? null : Number(payment_amount);
  const hasPaymentDate = Boolean(payment_date);

  if (payment_entry_id && normalizedPaymentAmount == null && !hasPaymentDate) {
    const { error: deleteError } = await context.admin
      .from("finance_entries")
      .delete()
      .eq("id", payment_entry_id)
      .eq("entry_type", "revenue");

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }
  } else if (normalizedPaymentAmount != null || hasPaymentDate) {
    if (normalizedPaymentAmount == null || !Number.isFinite(normalizedPaymentAmount) || normalizedPaymentAmount < 0) {
      return NextResponse.json({ error: "Montant de paiement invalide" }, { status: 400 });
    }
    if (!payment_date) {
      return NextResponse.json({ error: "Date de paiement requise" }, { status: 400 });
    }

    const paymentPayload = {
      client_id: String(client_id),
      entry_type: "revenue" as const,
      category: "client_payment",
      label: "Paiement client",
      amount: normalizedPaymentAmount,
      entry_date: payment_date,
      received_by: null,
      notes: null,
      updated_at: new Date().toISOString(),
    };

    if (payment_entry_id) {
      const { data: updatedPayment, error: paymentError } = await context.admin
        .from("finance_entries")
        .update(paymentPayload)
        .eq("id", payment_entry_id)
        .select("*")
        .single();

      if (paymentError) {
        return NextResponse.json({ error: paymentError.message }, { status: 400 });
      }
      payment = updatedPayment;
    } else {
      const { data: insertedPayment, error: paymentError } = await context.admin
        .from("finance_entries")
        .insert(paymentPayload)
        .select("*")
        .single();

      if (paymentError) {
        return NextResponse.json({ error: paymentError.message }, { status: 400 });
      }
      payment = insertedPayment;
    }
  }

  return NextResponse.json({ profile: data, payment });
}
