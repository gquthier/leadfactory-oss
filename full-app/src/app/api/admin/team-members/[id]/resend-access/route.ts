import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { buildTeamMemberWelcomeEmail } from "@/lib/team-member-welcome-email";
import { getSuperAdminRouteContext } from "@/lib/super-admin";

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSuperAdminRouteContext();
  if ("error" in context) return context.error;

  const memberId = params.id;
  if (!memberId) {
    return NextResponse.json({ error: "Identifiant membre manquant" }, { status: 400 });
  }

  const { data: profile, error: profileError } = await context.admin
    .from("profiles")
    .select("id, email, full_name, role, team_role")
    .eq("id", memberId)
    .single();

  if (profileError || !profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Membre introuvable" }, { status: 404 });
  }

  // Renvoyer les instructions ne change pas le mot de passe existant.
  const { error: updateAuthError } = await context.admin.auth.admin.updateUserById(memberId, {
    user_metadata: { initial_password: null },
  });

  if (updateAuthError) {
    return NextResponse.json(
      { error: `Erreur nettoyage des métadonnées : ${updateAuthError.message}` },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.invalid";

  await sendEmail({
    to: profile.email,
    subject: "Vos accès Lead Factory (renvoi)",
    html: buildTeamMemberWelcomeEmail({
      fullName: profile.full_name,
      email: profile.email,
        role: profile.team_role ?? "admin",
      appUrl,
    }),
  });

  return NextResponse.json({
    success: true,
    access_method: "password_reset",
  });
}
