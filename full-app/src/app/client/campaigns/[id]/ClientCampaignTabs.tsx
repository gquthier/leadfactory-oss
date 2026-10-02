"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle, Clock, Zap, FileText, MessageCircle, BarChart2, Bell } from "lucide-react";
import { getCanonicalCampaignStatus } from "@/types/index";
import { ClientMetaStats } from "@/components/meta/ClientMetaStats";

interface PipelineStep {
  status: string;
  label: string;
  desc: string;
}

interface ClientNote {
  id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface Props {
  campaign: {
    id: string;
    name: string;
    status: string;
    budget_monthly?: number;
    platform?: string;
    objective?: string;
    created_at: string;
    notes?: string;
    ad_account_id?: string | null;
  };
  onboarding: { responses: Record<string, unknown> } | null;
  pipeline: readonly PipelineStep[];
  statusIdx: number;
}

function BriefField({ label, value }: { label: string; value?: string }) {
  if (!value || !value.trim() || value === "—") return null;
  return (
    <div className="bg-gray-50 border-3 border-black p-3">
      <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">{label}</p>
      <p className="text-sm font-medium whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function BriefSection({ title, fields }: { title: string; fields: Array<[string, string | undefined]> }) {
  const filtered = fields.filter(([, v]) => v && v.trim() && v !== "—");
  if (!filtered.length) return null;
  return (
    <div className="mb-6">
      <h3 className="font-black uppercase text-xs tracking-wider text-lf-gray mb-3 border-b-3 border-black pb-2">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map(([label, value]) => (
          <BriefField key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClientCampaignTabs({ campaign, onboarding, pipeline, statusIdx }: Props) {
  const hasMetaAccount = !!campaign.ad_account_id;
  const isLive = getCanonicalCampaignStatus(campaign.status) === "live_optimizing";

  const [tab, setTab] = useState<"pipeline" | "stats" | "brief">(
    isLive && hasMetaAccount ? "stats" : "pipeline"
  );
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const r = (onboarding?.responses ?? {}) as Record<string, string | string[]>;
  const val = (v: string | string[] | undefined): string | undefined => {
    if (!v) return undefined;
    if (Array.isArray(v)) return v.join(", ");
    return v || undefined;
  };

  const unreadNotes = clientNotes.filter((n) => !n.is_read).length;

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const res = await fetch(`/api/client/notes?campaign_id=${campaign.id}`);
      const data = await res.json();
      if (data.notes) setClientNotes(data.notes);
    } finally {
      setLoadingNotes(false);
    }
  }, [campaign.id]);

  // Charger les notes quand on affiche l'onglet pipeline
  useEffect(() => {
    if (tab === "pipeline") {
      loadNotes();
    }
  }, [tab, loadNotes]);

  // Marquer les notes non-lues comme lues après 1s sur l'onglet
  useEffect(() => {
    if (tab !== "pipeline") return;
    const unreadIds = clientNotes.filter((n) => !n.is_read).map((n) => n.id);
    if (!unreadIds.length) return;
    const timer = setTimeout(async () => {
      await fetch("/api/client/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unreadIds }),
      });
      setClientNotes((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }, 1000);
    return () => clearTimeout(timer);
  }, [tab, clientNotes]);

  const TABS = isLive && hasMetaAccount
    ? [
        { id: "stats" as const, label: "Mes stats", badge: 0 },
        { id: "pipeline" as const, label: "Avancement", badge: unreadNotes },
        ...(onboarding ? [{ id: "brief" as const, label: "Mon brief", badge: 0 }] : []),
      ]
    : [
        { id: "pipeline" as const, label: "Avancement", badge: unreadNotes },
        ...(hasMetaAccount ? [{ id: "stats" as const, label: "Mes stats", badge: 0 }] : []),
        ...(onboarding ? [{ id: "brief" as const, label: "Mon brief", badge: 0 }] : []),
      ];

  return (
    <>
      {/* Tabs — visible dès qu'il y a plusieurs onglets */}
      {TABS.length > 1 && (
        <div className="flex border-3 border-black mb-6">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 py-3 font-black text-xs uppercase tracking-wider transition-colors ${i < TABS.length - 1 ? "border-r-3 border-black" : ""} ${
                tab === t.id ? "bg-lf-black text-white" : "bg-white text-black hover:bg-gray-50"
              }`}
            >
              {t.label}
              {t.badge > 0 && (
                <span className="absolute top-1.5 right-2 min-w-[16px] h-[16px] bg-red-500 text-white text-[9px] font-black flex items-center justify-center px-0.5">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ─── TAB: PIPELINE ─── */}
      {tab === "pipeline" && (
        <>
          <div className="card-brutal p-6 mb-6">
            <h2 className="font-black uppercase text-sm tracking-wider mb-5">Avancement de votre campagne</h2>
            <div className="flex flex-col gap-3">
              {pipeline.map((step, i) => {
                const done = i < statusIdx;
                const current = i === statusIdx;
                return (
                  <div key={step.status} className={`flex items-start gap-4 p-4 border-3 transition-all ${
                    current ? "border-lf-blue bg-lf-blue/5" :
                    done    ? "border-lf-green bg-lf-green/5" :
                    "border-gray-200 bg-white opacity-40"
                  }`}>
                    <div className={`w-8 h-8 flex-shrink-0 border-3 border-black flex items-center justify-center ${
                      done ? "bg-lf-green" : current ? "bg-lf-blue" : "bg-gray-100"
                    }`}>
                      {done    ? <CheckCircle className="w-4 h-4 text-white" /> :
                       current ? <Zap className="w-4 h-4 text-white" /> :
                                 <Clock className="w-4 h-4 text-gray-400" />}
                    </div>
                    <div>
                      <p className={`font-black text-sm uppercase tracking-wide ${
                        current ? "text-lf-blue" : done ? "text-lf-green" : "text-gray-400"
                      }`}>{step.label}</p>
                      <p className="text-xs font-medium text-lf-gray mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Infos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="card-brutal-sm p-4">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Plateforme</p>
              <p className="font-black text-sm uppercase">{campaign.platform || "Meta (Facebook / Instagram)"}</p>
            </div>
            <div className="card-brutal-sm p-4">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Créée le</p>
              <p className="font-black text-sm">{new Date(campaign.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
            {campaign.objective && (
              <div className="card-brutal-sm p-4">
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Objectif</p>
                <p className="font-black text-sm uppercase">{campaign.objective}</p>
              </div>
            )}
            {campaign.budget_monthly && (
              <div className="card-brutal-sm p-4">
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Budget mensuel</p>
                <p className="font-black text-sm">{campaign.budget_monthly}€ / mois</p>
              </div>
            )}
          </div>

          {/* Messages du gestionnaire */}
          <div className="card-brutal-sm overflow-hidden mb-6">
            <div className="flex items-center gap-3 px-5 py-4 bg-lf-black text-white border-b-3 border-black">
              <Bell className="w-4 h-4 text-lf-yellow" />
              <p className="font-black uppercase text-xs tracking-wider">Messages de votre gestionnaire</p>
              {unreadNotes > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 border border-white/20">
                  {unreadNotes} nouveau{unreadNotes > 1 ? "x" : ""}
                </span>
              )}
            </div>

            {loadingNotes ? (
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-lf-gray">Chargement des messages...</p>
              </div>
            ) : clientNotes.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-lf-gray">Aucun message pour l&apos;instant.</p>
                <p className="text-xs text-lf-gray mt-1">Votre gestionnaire vous contactera ici pour les mises à jour importantes.</p>
              </div>
            ) : (
              <div className="divide-y-3 divide-black">
                {clientNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`px-5 py-4 ${!note.is_read ? "bg-lf-yellow/20" : "bg-white"}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {!note.is_read && (
                        <span className="w-2 h-2 bg-lf-blue rounded-full flex-shrink-0" />
                      )}
                      <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
                        {formatDate(note.created_at)}
                      </p>
                      {!note.is_read && (
                        <span className="text-[10px] font-black uppercase tracking-wide text-lf-blue border border-lf-blue px-1.5 py-0.5">
                          Nouveau
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Contact */}
          <div className="card-brutal-sm p-5 bg-lf-blue text-white">
            <div className="flex items-start gap-3">
              <MessageCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-black uppercase text-sm tracking-wide mb-1">Une question ?</p>
                <p className="text-sm font-medium opacity-90">
                  Contactez votre gestionnaire Lead Factory. Nous répondons sous 24h.
                </p>
                <a
                  href="mailto:contact@example.com"
                  className="mt-3 inline-flex items-center gap-2 bg-white text-lf-black border-3 border-black px-4 py-2 text-xs font-black uppercase hover:bg-lf-yellow transition-colors shadow-brutal-xs"
                >
                  Envoyer un email
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── TAB: MES STATS META ─── */}
      {tab === "stats" && (
        hasMetaAccount ? (
          <ClientMetaStats
            adAccountId={campaign.ad_account_id!}
            campaignId={campaign.id}
          />
        ) : (
          <div className="card-brutal p-10 text-center">
            <BarChart2 className="w-12 h-12 mx-auto text-lf-gray opacity-30 mb-4" />
            <p className="font-black text-lg uppercase mb-2">Données en cours de liaison</p>
            <p className="text-sm font-medium text-lf-gray max-w-sm mx-auto">
              Votre compte Meta Ads sera lié sous peu par votre gestionnaire.
              Vos statistiques apparaîtront ici dès que la connexion sera établie.
            </p>
          </div>
        )
      )}

      {/* ─── TAB: MON BRIEF ─── */}
      {tab === "brief" && onboarding && (
        <div className="card-brutal p-6">
          <div className="flex items-center gap-2 mb-6">
            <FileText className="w-5 h-5 text-lf-blue" />
            <p className="font-black uppercase tracking-wide">Récapitulatif de votre brief</p>
          </div>

          <BriefSection title="Votre entreprise" fields={[
            ["Entreprise", val(r.a_entreprise)],
            ["Résumé de l'offre", val(r.a_resume_offre)],
            ["Type d'offre", val(r.a_type)],
            ["Prix / Panier moyen", val(r.a_prix)],
            ["Promesse principale", val(r.c_promesse)],
            ["Problèmes résolus", val(r.a_problemes)],
            ["Différenciants", val(r.a_differenciants)],
          ]} />

          <BriefSection title="Objectifs & Conversion" fields={[
            ["Objectif principal", val(r.b_objectif)],
            ["KPI principal", val(r.b_kpi)],
            ["Objectif chiffré", val(r.b_objectif_chiffre)],
            ["Conversion souhaitée", val(r.b_conversion)],
          ]} />

          <BriefSection title="Cibles" fields={[
            ["Cible principale", val(r.d_cible1_description)],
            ["Secteur", val(r.d_cible1_secteur)],
            ["Fonctions visées", val(r.d_cible1_fonctions)],
            ["Cible secondaire", val(r.d_cible2_description)],
          ]} />

          <BriefSection title="Budget & Timing" fields={[
            ["Budget mensuel", val(r.g_budget) ? `${val(r.g_budget)}€` : undefined],
            ["Timing de lancement", val(r.g_timing)],
            ["Destination des annonces", val(r.e_destination_principale)],
            ["URL", val(r.e_url)],
          ]} />

          <div className="mt-4 p-4 bg-gray-50 border-3 border-black">
            <p className="text-xs font-bold text-lf-gray">
              Ces informations ont été transmises à l&apos;équipe Lead Factory lors de votre onboarding. Pour toute modification, contactez votre gestionnaire.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
