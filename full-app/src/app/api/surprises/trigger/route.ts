import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { loadClientSequenceContext } from "@/lib/sequence-context";
import { openRouterChat, loadOutboundModel, DEFAULT_OUTBOUND_MODEL } from "@/lib/openrouter";
import {
  buildLinkedInPostPrompt,
  buildColdEmailSequencePrompt,
  buildCallScriptPrompt,
  LINKEDIN_POST_PLAN,
  COLD_EMAIL_ANGLES,
} from "@/lib/surprises/prompts";
import { sendEmail } from "@/lib/email";
import { buildSurprisesReadyEmail } from "@/lib/surprises/email-template";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const m1 = raw.match(/\{[\s\S]*\}/);
  if (!m1) return null;
  try {
    return JSON.parse(m1[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { client_id?: string };
  try {
    body = (await req.json()) as { client_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const clientId = body.client_id;
  if (!clientId) return NextResponse.json({ error: "Missing client_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: surpriseRow } = await admin
    .from("client_surprises")
    .select("id, status")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!surpriseRow) {
    return NextResponse.json({ error: "No client_surprises row found" }, { status: 404 });
  }
  if (surpriseRow.status === "generating" || surpriseRow.status === "ready") {
    return NextResponse.json({ skipped: true, reason: `already ${surpriseRow.status}` });
  }

  await admin
    .from("client_surprises")
    .update({ status: "generating", progress_pct: 5, started_at: new Date().toISOString(), error_message: null })
    .eq("id", surpriseRow.id);

  const ctx = await loadClientSequenceContext(clientId, null);
  if (!ctx) {
    await admin
      .from("client_surprises")
      .update({ status: "failed", error_message: "Onboarding incomplet — aucun contexte client" })
      .eq("id", surpriseRow.id);
    return NextResponse.json({ error: "No onboarding context" }, { status: 400 });
  }

  const model = (await loadOutboundModel().catch(() => DEFAULT_OUTBOUND_MODEL)) || DEFAULT_OUTBOUND_MODEL;

  // Build all prompts upfront, then run in parallel.
  const linkedInPlans = LINKEDIN_POST_PLAN.map((p, idx) => ({
    idx,
    prompt: buildLinkedInPostPrompt(ctx, p.angle, p.framework),
    framework: p.framework,
    angle: p.angle,
  }));
  const emailPlans = COLD_EMAIL_ANGLES.map((a, idx) => ({
    idx,
    prompt: buildColdEmailSequencePrompt(ctx, a.angle),
    name: a.name,
    angle: a.angle,
  }));
  const callScriptPrompt = buildCallScriptPrompt(ctx);

  const tasks: Array<Promise<{ ok: boolean; row?: Record<string, unknown>; error?: string }>> = [];

  for (const p of linkedInPlans) {
    tasks.push(
      openRouterChat({
        model,
        messages: [{ role: "user", content: p.prompt }],
        temperature: 0.8,
        maxTokens: 1500,
      })
        .then((resp) => {
          const parsed = parseJsonLoose(resp.text);
          if (!parsed) return { ok: false, error: "LinkedIn parse failed" };
          return {
            ok: true,
            row: {
              surprise_id: surpriseRow.id,
              client_id: clientId,
              asset_type: "linkedin_post",
              order_index: p.idx,
              title: (parsed.hook as string) ?? `Post LinkedIn #${p.idx + 1}`,
              body: (parsed.body as string) ?? "",
              hook: (parsed.hook as string) ?? null,
              framework: (parsed.framework as string) ?? p.framework,
              angle: (parsed.angle as string) ?? p.angle,
              payload: parsed,
              model_used: resp.modelUsed,
            },
          };
        })
        .catch((e) => ({ ok: false, error: `LinkedIn ${p.idx}: ${e.message}` })),
    );
  }

  for (const e of emailPlans) {
    tasks.push(
      openRouterChat({
        model,
        messages: [{ role: "user", content: e.prompt }],
        temperature: 0.7,
        maxTokens: 2000,
      })
        .then((resp) => {
          const parsed = parseJsonLoose(resp.text);
          if (!parsed) return { ok: false, error: "Email parse failed" };
          return {
            ok: true,
            row: {
              surprise_id: surpriseRow.id,
              client_id: clientId,
              asset_type: "cold_email_sequence",
              order_index: e.idx,
              title: (parsed.name as string) ?? e.name,
              body: JSON.stringify(parsed.emails ?? [], null, 2),
              hook: null,
              framework: null,
              angle: (parsed.angle as string) ?? e.angle,
              payload: parsed,
              model_used: resp.modelUsed,
            },
          };
        })
        .catch((err) => ({ ok: false, error: `Email ${e.idx}: ${err.message}` })),
    );
  }

  tasks.push(
    openRouterChat({
      model,
      messages: [{ role: "user", content: callScriptPrompt }],
      temperature: 0.7,
      maxTokens: 2000,
    })
      .then((resp) => {
        const parsed = parseJsonLoose(resp.text);
        if (!parsed) return { ok: false, error: "Call script parse failed" };
        return {
          ok: true,
          row: {
            surprise_id: surpriseRow.id,
            client_id: clientId,
            asset_type: "call_script",
            order_index: 0,
            title: (parsed.name as string) ?? "Script Cold Call",
            body: typeof parsed.pitch === "string" ? parsed.pitch : "",
            hook: null,
            framework: null,
            angle: null,
            payload: parsed,
            model_used: resp.modelUsed,
          },
        };
      })
      .catch((e) => ({ ok: false, error: `CallScript: ${e.message}` })),
  );

  const results = await Promise.all(tasks);
  const successRows = results.filter((r) => r.ok && r.row).map((r) => r.row!) as Array<Record<string, unknown>>;
  const errors = results.filter((r) => !r.ok).map((r) => r.error);

  if (successRows.length > 0) {
    const { error: insertErr } = await admin.from("surprise_assets").insert(successRows);
    if (insertErr) {
      console.error("[surprises] insert error:", insertErr);
    }
  }

  const finalStatus = successRows.length >= 5 ? "ready" : successRows.length > 0 ? "ready" : "failed";

  await admin
    .from("client_surprises")
    .update({
      status: finalStatus,
      progress_pct: 100,
      finished_at: new Date().toISOString(),
      error_message: errors.length > 0 ? errors.slice(0, 3).join(" | ") : null,
    })
    .eq("id", surpriseRow.id);

  if (finalStatus === "ready") {
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", clientId)
        .maybeSingle();
      if (profile?.email) {
        await sendEmail({
          to: profile.email,
          subject: "🎁 Tes surprises LeadFactory sont prêtes",
          html: buildSurprisesReadyEmail({
            firstName: profile.full_name?.split(" ")[0] ?? "Client",
            appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid",
            counts: {
              linkedinPosts: successRows.filter((r) => r.asset_type === "linkedin_post").length,
              emailSequences: successRows.filter((r) => r.asset_type === "cold_email_sequence").length,
              callScripts: successRows.filter((r) => r.asset_type === "call_script").length,
            },
          }),
        });
        await admin
          .from("client_surprises")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", surpriseRow.id);
      }
    } catch (err) {
      console.error("[surprises] email notification failed:", err);
    }
  }

  return NextResponse.json({
    status: finalStatus,
    assets_created: successRows.length,
    errors_count: errors.length,
    errors: errors.slice(0, 5),
  });
}
