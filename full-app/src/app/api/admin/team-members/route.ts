import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { buildTeamMemberWelcomeEmail } from "@/lib/team-member-welcome-email";
import { getSuperAdminRouteContext } from "@/lib/super-admin";
import type { TeamRole, TeamStatus } from "@/types/index";

const MANAGEABLE_TEAM_ROLES: TeamRole[] = ["admin", "designer", "media_buyer"];
const TEAM_STATUSES: TeamStatus[] = ["active", "invited", "disabled"];

function isMissingSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    error.message?.includes("does not exist") === true ||
    error.message?.includes("schema cache") === true
  );
}

export async function POST(req: Request) {
  const context = await getSuperAdminRouteContext();
  if ("error" in context) return context.error;

  const {
    email,
    full_name,
    team_role,
    team_status = "active",
    send_access_email = true,
  } = await req.json();

  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof full_name !== "string" || !full_name.trim()) {
    return NextResponse.json(
      { error: "email et full_name sont requis" },
      { status: 400 }
    );
  }

  if (!MANAGEABLE_TEAM_ROLES.includes(team_role)) {
    return NextResponse.json({ error: "Rôle d'équipe invalide" }, { status: 400 });
  }

  if (!TEAM_STATUSES.includes(team_status)) {
    return NextResponse.json({ error: "Statut d'équipe invalide" }, { status: 400 });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(full_name).trim();
  // Le secret initial reste exclusivement dans Auth ; le membre choisit son mot de passe via récupération.
  const normalizedPassword = `${randomUUID()}-${randomUUID()}`;

  const { data: createdUser, error: createError } = await context.admin.auth.admin.createUser({
    email: normalizedEmail,
    password: normalizedPassword,
    email_confirm: true,
    user_metadata: { full_name: normalizedName },
  });

  if (createError || !createdUser.user) {
    return NextResponse.json(
      { error: `Erreur création compte : ${createError?.message ?? "inconnue"}` },
      { status: 400 }
    );
  }

  const userId = createdUser.user.id;
  const nextIsActive = team_status !== "disabled";
  let usedLegacySchema = false;

  let profileError = (
    await context.admin
      .from("profiles")
      .update({
        full_name: normalizedName,
        role: "admin",
        is_super_admin: false,
        is_active: nextIsActive,
        team_role,
        team_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
  ).error;

  if (isMissingSchemaError(profileError)) {
    usedLegacySchema = true;
    profileError = (
      await context.admin
        .from("profiles")
        .update({
          full_name: normalizedName,
          role: "admin",
          is_super_admin: false,
          is_active: nextIsActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
    ).error;
  }

  if (profileError) {
    await context.admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (send_access_email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.invalid";

    await sendEmail({
      to: normalizedEmail,
      subject: "Bienvenue dans l'équipe Lead Factory",
      html: buildTeamMemberWelcomeEmail({
        fullName: normalizedName,
        email: normalizedEmail,
        role: team_role,
        appUrl,
      }),
    });
  }

  return NextResponse.json({
    member: {
      id: userId,
      email: normalizedEmail,
      full_name: normalizedName,
      team_role,
      team_status,
      is_active: nextIsActive,
    },
    schema_mode: usedLegacySchema ? "legacy" : "team",
  });
}
