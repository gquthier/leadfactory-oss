import { createClient, createAdminClient } from "@/lib/supabase-server";
import Link from "next/link";
import { getPreviewClientId } from "@/lib/client-preview";

export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import {
  CANONICAL_CAMPAIGN_STATUSES,
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
} from "@/types/index";
import {
  Megaphone,
  Clock,
  ArrowRight,
  Mail,
  Linkedin,
  Headphones,
  TrendingUp,
  Users,
  Eye,
  MousePointerClick,
  Lightbulb,
  Activity,
} from "lucide-react";
import { TodosInline, type ClientTask } from "./TodosInline";
import { ReferralOfferCard } from "@/components/client/ReferralOfferCard";

const PIPELINE_ORDER = CANONICAL_CAMPAIGN_STATUSES;

function PipelineMini({ status }: { status: string }) {
  const idx = PIPELINE_ORDER.indexOf(getCanonicalCampaignStatus(status));
  return (
    <div className="flex gap-1 mt-3">
      {PIPELINE_ORDER.map((s, i) => (
        <div
          key={s}
          title={getCampaignStatusLabel(s)}
          className={`h-2 flex-1 border-2 border-black transition-all ${
            i < idx ? "bg-lf-green" :
            i === idx ? "bg-lf-blue" :
            "bg-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

export default async function ClientOverview() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId = await getPreviewClientId();
  const effectiveId = previewId ?? session.user.id;
  const adminSupabase = createAdminClient();

  // First login detection — fire-and-forget surprises trigger
  if (!previewId) {
    const { data: profileSelf } = await adminSupabase
      .from("profiles")
      .select("first_login_at, role")
      .eq("id", session.user.id)
      .maybeSingle();
    if (profileSelf && !profileSelf.first_login_at && profileSelf.role === "client") {
      await adminSupabase
        .from("profiles")
        .update({ first_login_at: new Date().toISOString() })
        .eq("id", session.user.id);
      const { data: existingSurprise } = await adminSupabase
        .from("client_surprises")
        .select("id")
        .eq("client_id", session.user.id)
        .maybeSingle();
      if (!existingSurprise) {
        await adminSupabase
          .from("client_surprises")
          .insert({ client_id: session.user.id, status: "pending" });
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid";
        fetch(`${appUrl}/api/surprises/trigger`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
          },
          body: JSON.stringify({ client_id: session.user.id }),
        }).catch((err) => {
          console.error("[surprises] fire-and-forget trigger failed:", err);
        });
      }
    }
  }

  // Fenêtre rolling 30 jours pour les stats Meta
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);
  const since30dIso = since30d.toISOString().slice(0, 10);

  const [
    { data: profile },
    { data: campaigns },
    { data: tasks },
    { data: adSpendRows },
    { data: latestAnalysisRow },
  ] = await Promise.all([
    adminSupabase.from("profiles").select("full_name, company").eq("id", effectiveId).single(),
    adminSupabase.from("campaigns").select("*").eq("client_id", effectiveId).order("created_at", { ascending: false }),
    adminSupabase.from("client_tasks").select("id, title, description, is_completed, completed_at").eq("client_id", effectiveId).order("created_at", { ascending: true }),
    // Spend Meta rolling 30j — agrégé côté code
    adminSupabase
      .from("crm_ad_spend_daily")
      .select("spend, impressions, clicks, meta_reported_leads, source")
      .eq("client_id", effectiveId)
      .gte("spend_date", since30dIso),
    // Dernière analyse de call complétée
    adminSupabase
      .from("sales_call_analyses")
      .select("id, meeting_title, meeting_date, analysis_json, created_at")
      .eq("client_id", effectiveId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const firstName = profile?.full_name?.split(" ")[0] ?? "Client";
  const latestCampaign = campaigns?.[0];

  // Détection "Meta connecté" : au moins une campagne avec meta_campaign_id non null
  const hasMetaConnection = (campaigns ?? []).some((c) => c.meta_campaign_id);

  // Agrégats Meta sur 30 jours
  const metaRows = (adSpendRows ?? []).filter((r) => r.source === "meta" || !r.source);
  const metaStats = metaRows.length
    ? metaRows.reduce(
        (acc, r) => ({
          spend: acc.spend + Number(r.spend ?? 0),
          impressions: acc.impressions + Number(r.impressions ?? 0),
          clicks: acc.clicks + Number(r.clicks ?? 0),
          leads: acc.leads + Number(r.meta_reported_leads ?? 0),
        }),
        { spend: 0, impressions: 0, clicks: 0, leads: 0 }
      )
    : null;

  const cpl =
    metaStats && metaStats.leads > 0
      ? Math.round((metaStats.spend / metaStats.leads) * 100) / 100
      : null;
  const ctr =
    metaStats && metaStats.impressions > 0
      ? Math.round((metaStats.clicks / metaStats.impressions) * 10000) / 100
      : null;

  // Extraction des recos sales depuis la dernière analyse
  type SalesAnalysisJson = {
    overall_score?: number;
    deal_temperature?: string;
    call_summary_one_liner?: string;
    top_3_recommendations?: Array<{
      priority: number;
      title: string;
      why: string;
      how_next_call: string;
    }>;
  };
  const latestAnalysis = latestAnalysisRow
    ? {
        id: latestAnalysisRow.id as string,
        meeting_title: (latestAnalysisRow.meeting_title as string | null) ?? "Call",
        meeting_date: (latestAnalysisRow.meeting_date as string | null) ?? latestAnalysisRow.created_at as string,
        json: (latestAnalysisRow.analysis_json as SalesAnalysisJson | null) ?? null,
      }
    : null;

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">ESPACE CLIENT</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Bonjour, {firstName} 👋</h1>
        {profile?.company && (
          <p className="text-lf-gray font-medium mt-1">{profile.company}</p>
        )}
      </div>

      <ReferralOfferCard variant="compact" />

      {/* Outils IA — accès direct */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Link
          href="/client/sequence"
          className="card-brutal p-5 block group hover:shadow-[10px_10px_0px_0px_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all bg-white"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="w-10 h-10 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <span className="text-[10px] font-black px-2 py-1 bg-lf-yellow text-black border-2 border-black uppercase tracking-wider">
              Nouveau
            </span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            Outbound IA
          </p>
          <h3 className="text-lg font-black uppercase tracking-tight leading-tight mb-2">
            Écrivez vos séquences d&apos;outbound
          </h3>
          <p className="text-sm font-medium text-lf-gray mb-3">
            Cold email + scraping Google Maps pour booster votre prospection.
          </p>
          <span className="font-black text-xs uppercase flex items-center gap-1 group-hover:gap-2 transition-all">
            Ouvrir <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>

        <Link
          href="/client/personal-brand"
          className="card-brutal p-5 block group hover:shadow-[10px_10px_0px_0px_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all bg-white"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="w-10 h-10 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
              <Linkedin className="w-5 h-5 text-white" />
            </div>
            <span className="text-[10px] font-black px-2 py-1 bg-lf-yellow text-black border-2 border-black uppercase tracking-wider">
              Nouveau
            </span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            Personal Brand IA
          </p>
          <h3 className="text-lg font-black uppercase tracking-tight leading-tight mb-2">
            Écrivez vos posts LinkedIn
          </h3>
          <p className="text-sm font-medium text-lf-gray mb-3">
            Opti rédige des posts viraux à partir de votre brief et vos angles.
          </p>
          <span className="font-black text-xs uppercase flex items-center gap-1 group-hover:gap-2 transition-all">
            Ouvrir <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>

        <Link
          href="/client/sales"
          className="card-brutal p-5 block group hover:shadow-[10px_10px_0px_0px_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all bg-white"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="w-10 h-10 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
              <Headphones className="w-5 h-5 text-white" />
            </div>
            <span className="text-[10px] font-black px-2 py-1 bg-lf-yellow text-black border-2 border-black uppercase tracking-wider">
              Nouveau
            </span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            Sales IA
          </p>
          <h3 className="text-lg font-black uppercase tracking-tight leading-tight mb-2">
            Analyser mes appels de vente
          </h3>
          <p className="text-sm font-medium text-lf-gray mb-3">
            Score sur 10, leviers à activer et script de cold call sur-mesure pour ton offre.
          </p>
          <span className="font-black text-xs uppercase flex items-center gap-1 group-hover:gap-2 transition-all">
            Ouvrir <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      </div>

      {/* Tâches à faire */}
      {tasks && tasks.filter(t => !t.is_completed).length > 0 && (
        <TodosInline tasks={tasks as ClientTask[]} />
      )}

      {/* ─── Dashboard recommandations & data live ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {/* Bloc Meta data (uniquement si campagne Meta connectée + data dispo) */}
        {hasMetaConnection && metaStats && metaStats.spend > 0 && (
          <div className="card-brutal p-5 lg:col-span-2">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> Données Meta — 30 derniers jours
                </p>
                <h3 className="text-lg font-black uppercase tracking-tight">
                  Performance de tes campagnes
                </h3>
              </div>
              {latestCampaign && (
                <Link
                  href={`/client/campaigns/${latestCampaign.id}`}
                  className="text-[10px] font-black uppercase border-2 border-black px-2 py-1 hover:bg-lf-yellow"
                >
                  Voir détail
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border-3 border-black p-3 bg-white">
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Dépense
                </p>
                <p className="text-xl font-black">{metaStats.spend.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}€</p>
              </div>
              <div className="border-3 border-black p-3 bg-lf-yellow/30">
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Leads
                </p>
                <p className="text-xl font-black">{metaStats.leads}</p>
              </div>
              <div className="border-3 border-black p-3 bg-lf-green/20">
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                  CPL moyen
                </p>
                <p className="text-xl font-black">
                  {cpl !== null ? `${cpl}€` : <span className="text-lf-gray text-sm">N/A</span>}
                </p>
              </div>
              <div className="border-3 border-black p-3 bg-white">
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Impressions
                </p>
                <p className="text-xl font-black">{metaStats.impressions.toLocaleString("fr-FR")}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="border-3 border-black p-3 bg-white">
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 flex items-center gap-1">
                  <MousePointerClick className="w-3 h-3" /> Clics
                </p>
                <p className="text-base font-black">{metaStats.clicks.toLocaleString("fr-FR")}</p>
              </div>
              <div className="border-3 border-black p-3 bg-white">
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                  CTR
                </p>
                <p className="text-base font-black">
                  {ctr !== null ? `${ctr}%` : <span className="text-lf-gray text-sm">N/A</span>}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Bloc dernières recommandations sales */}
        {latestAnalysis && latestAnalysis.json && latestAnalysis.json.top_3_recommendations && latestAnalysis.json.top_3_recommendations.length > 0 && (
          <div className="card-brutal p-5 lg:col-span-2">
            <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 flex items-center gap-2">
                  <Lightbulb className="w-3.5 h-3.5" /> Recommandations sales — dernier call analysé
                </p>
                <h3 className="text-lg font-black uppercase tracking-tight">
                  {latestAnalysis.meeting_title}
                </h3>
                {latestAnalysis.json.call_summary_one_liner && (
                  <p className="text-sm text-lf-gray font-medium mt-1 italic line-clamp-2">
                    {latestAnalysis.json.call_summary_one_liner}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {typeof latestAnalysis.json.overall_score === "number" && (
                  <div className="border-3 border-black px-3 py-1 bg-lf-yellow">
                    <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">Score</span>
                    <p className="text-2xl font-black leading-none mt-1">{latestAnalysis.json.overall_score}/10</p>
                  </div>
                )}
                {latestAnalysis.json.deal_temperature && (
                  <span className="text-[10px] font-black uppercase tracking-wider border-2 border-black px-2 py-0.5 bg-white">
                    {latestAnalysis.json.deal_temperature}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {latestAnalysis.json.top_3_recommendations
                .sort((a, b) => a.priority - b.priority)
                .map((reco, i) => (
                  <div key={i} className="border-3 border-black p-3 bg-white flex items-start gap-3">
                    <div className="w-7 h-7 bg-lf-blue text-white border-2 border-black flex items-center justify-center font-black text-sm flex-shrink-0">
                      {reco.priority}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm leading-tight mb-1">{reco.title}</p>
                      <p className="text-xs text-lf-gray font-medium line-clamp-2">{reco.how_next_call}</p>
                    </div>
                  </div>
                ))}
            </div>

            <Link
              href={`/client/sales/call-analyzer/${latestAnalysis.id}`}
              className="mt-3 inline-flex items-center gap-1 font-black text-xs uppercase tracking-wider hover:gap-2 transition-all"
            >
              Voir l&apos;analyse complète <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Pas de campagne */}
      {!campaigns?.length && (
        <div className="card-brutal p-12 text-center">
          <div className="w-16 h-16 bg-lf-blue border-3 border-black rounded-full flex items-center justify-center mx-auto mb-4">
            <Megaphone className="w-8 h-8 text-white" />
          </div>
          <p className="text-2xl font-black mb-2 uppercase">Campagne en préparation</p>
          <p className="text-lf-gray font-medium max-w-sm mx-auto">Notre équipe prépare votre campagne. Vous serez notifié dès qu'elle est configurée.</p>
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-3 border-3 border-lf-blue text-lf-blue font-black text-sm">
            <Clock className="w-4 h-4" />
            En attente de configuration
          </div>
        </div>
      )}

      {/* Campagne active mise en avant */}
      {latestCampaign && (
        <div className="flex flex-col gap-6">
          {/* Carte principale */}
          <Link href={`/client/campaigns/${latestCampaign.id}`} className="card-brutal p-6 block group hover:shadow-[10px_10px_0px_0px_#000] transition-shadow">
            <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Campagne principale</p>
                <h2 className="text-2xl font-black uppercase tracking-tight">{latestCampaign.name}</h2>
              </div>
              <span className={`text-xs font-black px-3 py-2 border-3 border-black ${getCampaignStatusColor(latestCampaign)}`}>
                {getCampaignStatusLabel(latestCampaign)}
              </span>
            </div>

            <PipelineMini status={latestCampaign.status} />

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-4">
                {latestCampaign.budget_monthly && (
                  <span className="text-sm font-bold text-lf-gray">{latestCampaign.budget_monthly}€/mois</span>
                )}
                <span className="text-sm font-bold text-lf-gray">
                  {latestCampaign.platform || "Meta"}
                </span>
              </div>
              <span className="font-black text-sm uppercase flex items-center gap-1 group-hover:gap-2 transition-all">
                Voir le détail <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </Link>

          {/* Stats rapides */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="card-brutal-sm p-4">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Statut</p>
              <p className="font-black text-sm uppercase">{getCampaignStatusLabel(latestCampaign)}</p>
            </div>
            <div className="card-brutal-sm p-4">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Plateforme</p>
              <p className="font-black text-sm uppercase">{latestCampaign.platform || "Meta"}</p>
            </div>
            <div className="card-brutal-sm p-4 sm:col-span-1 col-span-2">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Démarrée le</p>
              <p className="font-black text-sm">{new Date(latestCampaign.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</p>
            </div>
          </div>

          {/* Note admin si présente */}
          {latestCampaign.notes && (
            <div className="card-brutal-sm p-5 bg-lf-yellow border-3 border-black">
              <p className="text-xs font-black uppercase tracking-wider mb-2">Message de votre gestionnaire</p>
              <p className="text-sm font-medium">{latestCampaign.notes}</p>
            </div>
          )}

          {/* Autres campagnes */}
          {campaigns && campaigns.length > 1 && (
            <div>
              <p className="font-black uppercase text-xs tracking-wider text-lf-gray mb-3">Autres campagnes</p>
              <div className="flex flex-col gap-3">
                {campaigns.slice(1).map((c) => (
                  <Link key={c.id} href={`/client/campaigns/${c.id}`}
                    className="card-brutal-sm p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="font-black text-sm uppercase">{c.name}</p>
                      <p className="text-xs text-lf-gray mt-0.5">{new Date(c.created_at).toLocaleDateString("fr-FR")}</p>
                    </div>
                    <span className={`text-xs font-black px-2 py-1 border-2 border-black ${getCampaignStatusColor(c)}`}>
                      {getCampaignStatusLabel(c)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
