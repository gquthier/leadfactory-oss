import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { buildPasswordResetEmail } from "@/lib/password-reset-email";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function jsonOk() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return jsonOk();
  }

  const rawEmail = body.email?.trim().toLowerCase();
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return jsonOk();
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name, is_active")
    .eq("email", rawEmail)
    .maybeSingle();

  if (!profile || profile.is_active === false) {
    return jsonOk();
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    "https://example.invalid";
  const redirectTo = `${appUrl}/reset-password`;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: rawEmail,
    options: { redirectTo },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("[forgot-password] generateLink failed:", linkErr);
    return jsonOk();
  }

  try {
    await sendEmail({
      to: rawEmail,
      subject: "🔒 Réinitialise ton mot de passe LeadFactory",
      html: buildPasswordResetEmail({
        firstName: (profile.full_name as string | null)?.split(" ")[0] ?? "",
        resetUrl: linkData.properties.action_link,
      }),
    });
  } catch (err) {
    console.error("[forgot-password] sendEmail failed:", err);
  }

  return jsonOk();
}
