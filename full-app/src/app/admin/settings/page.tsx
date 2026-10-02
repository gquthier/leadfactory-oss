import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminSettingsForm } from "./AdminSettingsForm";
import { MetaTokensManager } from "./MetaTokensManager";
import { OutboundModelSelector } from "./OutboundModelSelector";
import { OPENROUTER_MODELS, DEFAULT_OUTBOUND_MODEL } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

export default async function AdminSettings() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();

  const [{ data: profile }, { data: tokens }, { data: outboundModelSetting }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", session.user.id).single(),
    admin.from("meta_tokens").select("id, name, is_active, created_at").eq("admin_id", session.user.id).order("created_at"),
    admin.from("app_settings").select("value, updated_at").eq("key", "outbound_ai_model").maybeSingle(),
  ]);

  const currentOutboundModel =
    (typeof outboundModelSetting?.value === "string" ? outboundModelSetting.value : null) ??
    DEFAULT_OUTBOUND_MODEL;

  const hasGeminiKey = !!(profile?.gemini_api_key || process.env.GEMINI_API_KEY);
  const hasCustomGeminiKey = !!profile?.gemini_api_key;
  const hasMetaToken = !!(profile?.meta_access_token || process.env.META_ACCESS_TOKEN);
  const hasCustomMetaToken = !!profile?.meta_access_token;
  const isSuperAdmin = profile?.is_super_admin ?? false;

  return (
    <div className="p-6 lg:p-8 max-w-3xl space-y-10">
      <div>
        <div className="sticker -rotate-1 inline-block mb-3">CONFIG</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Paramètres</h1>
        <p className="text-lf-gray font-medium mt-1">Configuration de votre compte admin Lead Factory.</p>
      </div>

      <AdminSettingsForm
        profile={profile}
        email={session.user.email ?? ""}
        hasGeminiKey={hasGeminiKey}
        hasCustomGeminiKey={hasCustomGeminiKey}
        hasMetaToken={hasMetaToken}
        hasCustomMetaToken={hasCustomMetaToken}
      />

      {/* ── Section Outbound IA — modèle LLM ── */}
      <div>
        <div className="divider mb-6" />
        <div className="mb-4">
          <h2 className="text-lg font-black uppercase tracking-wide">Modèle Outbound IA</h2>
          <p className="text-sm text-lf-gray font-medium mt-1">
            Choisis le modèle utilisé par le chat <strong>Outbound IA</strong> côté client.
            Tous les modèles passent par OpenRouter — les prix sont par 1M tokens (input / output).
          </p>
        </div>
        <OutboundModelSelector
          models={OPENROUTER_MODELS}
          currentModel={currentOutboundModel}
          lastUpdated={outboundModelSetting?.updated_at ?? null}
        />
      </div>

      {/* ── Section Tokens Meta ── */}
      <div>
        <div className="divider mb-6" />
        <div className="mb-4">
          <h2 className="text-lg font-black uppercase tracking-wide">Connexions Meta</h2>
          <p className="text-sm text-lf-gray font-medium mt-1">
            Gérez vos tokens d&apos;accès Meta par Business Manager. Chaque campagne peut être associée à un token spécifique.
          </p>
        </div>
        <MetaTokensManager initialTokens={tokens ?? []} />
      </div>

      {/* ── Section Team (super-admin only) ── */}
      {isSuperAdmin && (
        <div>
          <div className="divider mb-6" />
          <div className="mb-4">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-black uppercase tracking-wide">Team</h2>
              <span className="inline-block bg-lf-yellow text-black text-xs font-black uppercase tracking-wider px-2 py-0.5 border-2 border-black">
                SUPER ADMIN
              </span>
            </div>
            <p className="text-sm text-lf-gray font-medium">
              Centralisez la création des comptes équipe, les rôles, les affectations projet et la paye due par client.
            </p>
          </div>
          <div className="card-brutal overflow-hidden">
            <div className="px-5 py-4 bg-lf-black text-white">
              <p className="font-black uppercase tracking-wider text-sm">Nouvel espace Team</p>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <p className="text-sm font-medium text-lf-gray">
                Utilisez l&apos;onglet Team pour créer les comptes internes, envoyer les accès SMTP,
                suivre les projets attribués et calculer la paye due pour chaque membre.
              </p>
              <div>
                <Link
                  href="/admin/team"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-lf-yellow text-black border-3 border-black font-black text-sm uppercase tracking-wider hover:shadow-brutal-sm transition-all"
                >
                  Ouvrir Team
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
