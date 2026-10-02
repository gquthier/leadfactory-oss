import { NextResponse } from "next/server";
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

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const context = await getSuperAdminRouteContext();
  if ("error" in context) return context.error;

  const memberId = params.id;
  if (!memberId) {
    return NextResponse.json({ error: "Identifiant membre manquant" }, { status: 400 });
  }

  const {
    full_name,
    team_role,
    team_status,
    assigned_campaign_ids = [],
    client_rates = [],
  } = await req.json();

  if (!full_name?.trim()) {
    return NextResponse.json({ error: "full_name requis" }, { status: 400 });
  }

  const { data: existingMember, error: memberError } = await context.admin
    .from("profiles")
    .select("id, role, is_super_admin")
    .eq("id", memberId)
    .single();

  if (memberError || !existingMember || existingMember.role !== "admin") {
    return NextResponse.json({ error: "Membre introuvable" }, { status: 404 });
  }

  const isExistingSuperAdmin = existingMember.is_super_admin ?? false;

  if (isExistingSuperAdmin) {
    return NextResponse.json(
      { error: "Les comptes super admin se gèrent en dehors de cet écran." },
      { status: 400 }
    );
  }

  if (!MANAGEABLE_TEAM_ROLES.includes(team_role)) {
    return NextResponse.json({ error: "Rôle d'équipe invalide" }, { status: 400 });
  }

  if (!TEAM_STATUSES.includes(team_status)) {
    return NextResponse.json({ error: "Statut d'équipe invalide" }, { status: 400 });
  }

  const normalizedCampaignIds = Array.from(
    new Set(
      Array.isArray(assigned_campaign_ids)
        ? assigned_campaign_ids.map((value: unknown) => String(value)).filter(Boolean)
        : []
    )
  );

  const campaignRows =
    normalizedCampaignIds.length === 0
      ? []
      : (
          (
            await context.admin
              .from("campaigns")
              .select("id, client_id")
              .in("id", normalizedCampaignIds)
          ).data ?? []
        );

  if (campaignRows.length !== normalizedCampaignIds.length) {
    return NextResponse.json({ error: "Une ou plusieurs campagnes sont invalides" }, { status: 400 });
  }

  const allowedClientIds = new Set(campaignRows.map((campaign) => campaign.client_id));
  const normalizedRates = Array.isArray(client_rates)
    ? client_rates.reduce<
        Array<{ client_id: string; monthly_rate: number; notes: string | null }>
      >((acc, entry) => {
        const clientId = String(entry?.client_id ?? "").trim();
        if (!clientId || !allowedClientIds.has(clientId)) return acc;

        const monthlyRate = Number(entry?.monthly_rate ?? 0);
        if (!Number.isFinite(monthlyRate) || monthlyRate < 0) return acc;

        acc.push({
          client_id: clientId,
          monthly_rate: monthlyRate,
          notes:
            typeof entry?.notes === "string" && entry.notes.trim()
              ? entry.notes.trim()
              : null,
        });
        return acc;
      }, [])
    : [];

  const normalizedName = String(full_name).trim();
  const nextStatus = team_status as TeamStatus;
  const nextRole = team_role as TeamRole;
  const nextIsActive = nextStatus !== "disabled";

  let updateMemberError = (
    await context.admin
      .from("profiles")
      .update({
        full_name: normalizedName,
        team_role: nextRole,
        team_status: nextStatus,
        is_active: nextIsActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId)
  ).error;

  const legacySchema = isMissingSchemaError(updateMemberError);

  if (legacySchema) {
    updateMemberError = (
      await context.admin
        .from("profiles")
        .update({
          full_name: normalizedName,
          is_active: nextIsActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", memberId)
    ).error;
  }

  if (updateMemberError) {
    return NextResponse.json({ error: updateMemberError.message }, { status: 400 });
  }

  const { error: updateAuthUserError } = await context.admin.auth.admin.updateUserById(memberId, {
    user_metadata: { full_name: normalizedName },
  });

  if (updateAuthUserError) {
    return NextResponse.json({ error: updateAuthUserError.message }, { status: 400 });
  }

  if (!legacySchema) {
    const { error: deleteAssignmentsError } = await context.admin
      .from("campaign_team_members")
      .delete()
      .eq("team_member_id", memberId);

    if (deleteAssignmentsError && !isMissingSchemaError(deleteAssignmentsError)) {
      return NextResponse.json({ error: deleteAssignmentsError.message }, { status: 400 });
    }

    if (normalizedCampaignIds.length > 0) {
      const { error: insertAssignmentsError } = await context.admin
        .from("campaign_team_members")
        .insert(
          normalizedCampaignIds.map((campaignId) => ({
            campaign_id: campaignId,
            team_member_id: memberId,
            assigned_by: context.session.user.id,
          }))
        );

      if (insertAssignmentsError && !isMissingSchemaError(insertAssignmentsError)) {
        return NextResponse.json({ error: insertAssignmentsError.message }, { status: 400 });
      }
    }

    const { error: deleteRatesError } = await context.admin
      .from("team_member_client_rates")
      .delete()
      .eq("team_member_id", memberId);

    if (deleteRatesError && !isMissingSchemaError(deleteRatesError)) {
      return NextResponse.json({ error: deleteRatesError.message }, { status: 400 });
    }

    if (normalizedRates.length > 0) {
      const { error: upsertRatesError } = await context.admin
        .from("team_member_client_rates")
        .insert(
          normalizedRates.map((rate) => ({
            team_member_id: memberId,
            client_id: rate.client_id,
            monthly_rate: rate.monthly_rate,
            notes: rate.notes,
            updated_at: new Date().toISOString(),
          }))
        );

      if (upsertRatesError && !isMissingSchemaError(upsertRatesError)) {
        return NextResponse.json({ error: upsertRatesError.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ success: true, schema_mode: legacySchema ? "legacy" : "team" });
}
