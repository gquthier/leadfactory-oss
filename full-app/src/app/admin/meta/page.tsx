import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getAdminScope, scopeCampaignsQuery } from "@/lib/admin-scope";
import { redirect } from "next/navigation";
import { getAllAccountsInsights, getAdAccounts } from "@/lib/meta-api";
import { MetaHubClient } from "./MetaHubClient";
import { initMetaToken } from "@/lib/meta-token";

export default async function AdminMetaHub() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  if(process.env.LEADFACTORY_DATA_MODE!=='supabase'||process.env.LEADFACTORY_ENABLE_EXTERNAL!=='1')return <div className="p-8"><h1 className="text-3xl font-black">Meta Ads</h1><p className="my-4">Connecteur fourni, synchronisation distante désactivée. Le test d’accès dans Start Here vérifie uniquement l’identité du compte. Configurez puis recettez votre propre projet avant toute synchronisation.</p><a className="btn-primary" href="/admin/start-here">Ouvrir Start Here</a></div>;
  const scope = await getAdminScope(session.user.id);
  const adminSupabase = createAdminClient();
  await initMetaToken(adminSupabase);

  if (!process.env.META_ACCESS_TOKEN) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl">
        <div className="sticker bg-red-400 -rotate-1 inline-block mb-3">ERREUR</div>
        <h1 className="text-3xl font-black uppercase mb-4">Meta Ads</h1>
        <div className="card-brutal p-6 bg-lf-yellow">
          <p className="font-black mb-2">Token Meta manquant</p>
          <p className="text-sm font-medium">Ajoutez <code className="bg-white px-1 border border-black">META_ACCESS_TOKEN</code> dans vos variables d'environnement Railway.</p>
        </div>
      </div>
    );
  }

  // Charger les données server-side pour le premier affichage (30j par défaut)
  let accounts: Awaited<ReturnType<typeof getAdAccounts>> = [];
  let allWithInsights: Awaited<ReturnType<typeof getAllAccountsInsights>> = [];
  let metaError: string | null = null;

  try {
    [accounts, allWithInsights] = await Promise.all([
      getAdAccounts(),
      getAllAccountsInsights("last_30d"),
    ]);
  } catch (err) {
    metaError = err instanceof Error ? err.message : "Erreur Meta inconnue";
  }

  // Récupérer les campagnes LF liées à des comptes Meta
  const campaignsQ = scopeCampaignsQuery(
    adminSupabase
      .from("campaigns")
      .select("id, name, ad_account_id, profiles:profiles!campaigns_client_id_fkey(company, full_name)")
      .not("ad_account_id", "is", null),
    scope
  );
  const { data: campaigns } = await campaignsQ;

  if (metaError) {
    const isExpired = metaError.includes("Session has expired") || metaError.includes("OAuthException");
    return (
      <div className="p-6 lg:p-8 max-w-3xl">
        <div className="sticker-blue -rotate-1 inline-block mb-3">META ADS</div>
        <h1 className="text-3xl font-black uppercase tracking-tight mb-6">Tableau de bord publicitaire</h1>
        <div className="card-brutal p-6 bg-lf-yellow">
          <p className="font-black text-lg mb-2 uppercase">
            {isExpired ? "Token Meta expiré" : "Erreur de connexion Meta"}
          </p>
          <p className="text-sm font-medium mb-4">
            {isExpired
              ? "Votre token d'accès Meta a expiré. Générez-en un nouveau depuis le Meta Graph API Explorer, puis mettez à jour META_ACCESS_TOKEN dans vos variables d'environnement."
              : metaError}
          </p>
          <a
            href="https://developers.facebook.com/tools/explorer/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 btn-primary text-sm"
          >
            Ouvrir Graph API Explorer →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="mb-8">
        <div className="sticker-blue -rotate-1 inline-block mb-3">META ADS</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Tableau de bord publicitaire</h1>
        <p className="text-lf-gray font-medium mt-1">
          {accounts.length === 0
            ? "Token Meta : aucun compte accessible — vérifiez les paramètres"
            : `${accounts.length} compte${accounts.length > 1 ? "s" : ""} accessible${accounts.length > 1 ? "s" : ""} · ${allWithInsights.length} actif${allWithInsights.length > 1 ? "s" : ""} · Données en temps réel`}
        </p>
      </div>

      <MetaHubClient
        initialAccounts={allWithInsights}
        allAccounts={accounts}
        linkedCampaigns={(campaigns ?? []) as unknown as Array<{ id: string; name: string; ad_account_id: string; profiles: { company?: string; full_name: string } }>}
      />
    </div>
  );
}
