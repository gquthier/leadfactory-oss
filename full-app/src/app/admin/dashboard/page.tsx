import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, scopeCampaignsQuery, scopeProfilesQuery } from "@/lib/admin-scope";
import { getVisibleOnboardingResponses } from "@/lib/onboarding-briefs";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users,
  Megaphone,
  ClipboardList,
  TrendingUp,
  ArrowRight,
  Clock,
  AlertCircle,
} from "lucide-react";
import {
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  type Campaign,
  type OnboardingResponse,
} from "@/types/index";
import { QuickStats } from "@/components/admin/QuickStats";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className={`card-brutal-sm p-5 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wider opacity-70 mb-1">
            {label}
          </p>
          <p className="text-4xl font-black leading-none">{value}</p>
        </div>
        <Icon className="w-8 h-8 opacity-30" />
      </div>
    </div>
  );
}

export default async function AdminDashboard() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();

  // Compute first day of this month and last month
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Base queries — scoped to managed_by + team assignments unless super admin
  const buildProfilesQ = () =>
    scopeProfilesQuery(
      adminSupabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "client"),
      scope
    );
  const buildCampaignsQ = () =>
    scopeCampaignsQuery(
      adminSupabase.from("campaigns").select("*", { count: "exact", head: true }),
      scope
    );

  const [
    { count: clientsCount },
    { count: campaignsCount },
    { data: onboardingResponses },
    { data: allCampaigns },
    { count: clientsThisMonth },
    { count: clientsLastMonth },
  ] = await Promise.all([
    buildProfilesQ(),
    buildCampaignsQ(),
    adminSupabase
      .from("onboarding_responses")
      .select("id, submitted_at, responses, client_id, campaign_id")
      .order("submitted_at", { ascending: false }),
    scopeCampaignsQuery(
      adminSupabase
        .from("campaigns")
        .select("id, name, status, budget_monthly, created_at, ad_account_id, ai_creative_prompt, profiles:profiles!campaigns_client_id_fkey(full_name, company)")
        .order("created_at", { ascending: false }),
      scope
    ),
    // Clients created this month
    scopeProfilesQuery(adminSupabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "client").gte("created_at", startOfThisMonth), scope),
    // Clients created last month
    scopeProfilesQuery(adminSupabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "client").gte("created_at", startOfLastMonth).lt("created_at", endOfLastMonth), scope),
  ]);

  const visibleOnboarding = getVisibleOnboardingResponses(
    (onboardingResponses ?? []) as OnboardingResponse[]
  );
  const pendingCount = visibleOnboarding.filter((response) => !response.client_id).length;
  const recentOnboarding = visibleOnboarding.slice(0, 5);
  const campaignsList = (allCampaigns ?? []) as unknown as CampaignWithProfile[];
  const liveCount = campaignsList.filter(
    (campaign) => getCanonicalCampaignStatus(campaign) === "live_optimizing"
  ).length;
  const recentCampaigns = campaignsList.slice(0, 6);
  const todoProfiles = campaignsList
    .filter((campaign) => !campaign.ad_account_id)
    .filter((campaign) =>
      ["brief_received", "campaign_proposal", "ad_creative", "meta_account_setup"].includes(
        getCanonicalCampaignStatus(campaign)
      )
    )
    .slice(0, 5);

  type CampaignWithProfile = Campaign & {
    profiles: { full_name: string; company: string };
  };

  type TodoCampaign = {
    id: string;
    name: string;
    status: string;
    profiles: { full_name: string; company: string } | null;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">ADMIN</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Dashboard</h1>
        <p className="text-lf-gray font-medium mt-1">Vue d&apos;ensemble Lead Factory</p>
      </div>

      {/* Quick Stats banner */}
      <QuickStats
        clientsThisMonth={clientsThisMonth ?? 0}
        clientsLastMonth={clientsLastMonth ?? 0}
        totalClientsAll={clientsCount ?? 0}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="Clients actifs"
          value={clientsCount ?? 0}
          icon={Users}
          color="bg-white"
        />
        <StatCard
          label="Campagnes"
          value={campaignsCount ?? 0}
          icon={Megaphone}
          color="bg-lf-blue text-white"
        />
        <StatCard
          label="Briefs en attente"
          value={pendingCount ?? 0}
          icon={ClipboardList}
          color="bg-lf-yellow"
        />
        <StatCard
          label="En ligne"
          value={liveCount ?? 0}
          icon={TrendingUp}
          color="bg-lf-green text-white"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Recent onboarding — improved with "Traiter" button */}
        <div className="card-brutal p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b-3 border-black bg-lf-black text-white">
            <span className="font-black uppercase text-sm tracking-wider">
              Derniers briefs reçus
            </span>
            <Link
              href="/admin/onboarding"
              className="text-lf-yellow text-xs font-bold uppercase hover:underline flex items-center gap-1"
            >
              Voir tout <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y-3 divide-black">
            {recentOnboarding.map(
              (o) => {
                const r = o.responses as Record<string, unknown>;
                const entreprise = String(r.a_entreprise || "Sans nom");
                const isProcessed = !!o.client_id;
                const linkedCampaignId = o.campaign_id ?? null;
                return (
                  <div
                    key={o.id}
                    className="flex items-center justify-between px-5 py-4 hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-black text-sm uppercase">{entreprise}</p>
                      <p className="text-xs text-lf-gray font-medium flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {new Date(o.submitted_at).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-black px-2 py-1 border-2 border-black ${
                          isProcessed
                            ? "bg-lf-green text-white"
                            : "bg-lf-yellow text-black"
                        }`}
                      >
                        {isProcessed ? "Traité" : "À traiter"}
                      </span>
                      {linkedCampaignId ? (
                        <Link
                          href={`/admin/campaigns/${linkedCampaignId}`}
                          className="btn-primary text-xs py-1 px-2 whitespace-nowrap"
                        >
                          Traiter →
                        </Link>
                      ) : (
                        <Link
                          href="/admin/onboarding"
                          className="text-lf-blue font-bold text-xs uppercase hover:underline"
                        >
                          Voir →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              }
            )}
            {!recentOnboarding?.length && (
              <div className="px-5 py-8 text-center text-lf-gray font-medium text-sm">
                Aucun brief reçu pour l&apos;instant.
              </div>
            )}
          </div>
        </div>

        {/* Recent campaigns */}
        <div className="card-brutal p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b-3 border-black bg-lf-black text-white">
            <span className="font-black uppercase text-sm tracking-wider">
              Campagnes récentes
            </span>
            <Link
              href="/admin/campaigns"
              className="text-lf-yellow text-xs font-bold uppercase hover:underline flex items-center gap-1"
            >
              Voir tout <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y-3 divide-black">
            {(recentCampaigns as unknown as CampaignWithProfile[])?.map(
              (c) => (
                <Link
                  key={c.id}
                  href={`/admin/campaigns/${c.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 block"
                >
                  <div>
                    <p className="font-black text-sm uppercase">{c.name}</p>
                    <p className="text-xs text-lf-gray font-medium mt-0.5">
                      {c.profiles?.company || c.profiles?.full_name} ·{" "}
                      {c.budget_monthly
                        ? `${c.budget_monthly}€/mois`
                        : "Budget N/A"}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-black px-2 py-1 border-2 border-black ${
                      getCampaignStatusColor(c)
                    }`}
                  >
                    {getCampaignStatusLabel(c)}
                  </span>
                </Link>
              )
            )}
            {!recentCampaigns?.length && (
              <div className="px-5 py-8 text-center text-lf-gray font-medium text-sm">
                Aucune campagne créée.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* À faire : campaigns without Meta account */}
      {todoProfiles && todoProfiles.length > 0 && (
        <div className="card-brutal p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b-3 border-black bg-lf-yellow text-black">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <span className="font-black uppercase text-sm tracking-wider">
                À faire — Comptes Meta manquants
              </span>
            </div>
            <Link
              href="/admin/campaigns"
              className="text-black text-xs font-bold uppercase hover:underline flex items-center gap-1"
            >
              Voir tout <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y-2 divide-black">
            {(todoProfiles as unknown as TodoCampaign[]).map((c) => (
              <Link
                key={c.id}
                href={`/admin/campaigns/${c.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-lf-yellow/10 transition-colors"
              >
                <div>
                  <p className="font-black text-sm uppercase">{c.name}</p>
                  <p className="text-xs text-lf-gray font-medium mt-0.5">
                    {c.profiles?.company || c.profiles?.full_name || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-black px-2 py-1 border-2 border-black ${
                      getCampaignStatusColor(c)
                    }`}
                  >
                    {getCampaignStatusLabel(c)}
                  </span>
                  <span className="text-lf-blue font-black text-xs uppercase">
                    Lier Meta →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
