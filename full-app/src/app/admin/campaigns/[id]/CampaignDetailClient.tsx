"use client";

import { useState, useEffect, useCallback } from "react";
import { StatusUpdateModal } from "@/components/admin/StatusUpdateModal";
import { useSearchParams } from "next/navigation";
import { Copy, Zap, Check, Loader2, ChevronDown, ChevronUp, Save, X, KeyRound, MessageSquare, Video, Film, Image, Sparkles, Link2, Instagram, Facebook, Edit3, RefreshCw, Send, Bell, Download } from "lucide-react";
import {
  CANONICAL_CAMPAIGN_STATUSES,
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  type Campaign,
  type CanonicalCampaignStatus,
  type LeadAggregate,
} from "@/types/index";
import { buildBasePrompt } from "@/lib/generate-creative-prompt";
import { AIDeliveryPanel } from "@/components/admin/AIDeliveryPanel";
import { CampaignProposalEditor } from "@/components/admin/CampaignProposalEditor";
import { CampaignCreativeBriefEditor } from "@/components/admin/CampaignCreativeBriefEditor";
import { ClientCallsSection } from "@/components/admin/ClientCallsSection";
import { MetaStatsBlock } from "@/components/meta/MetaStatsBlock";
import { SpendLeadsChart } from "@/components/meta/SpendLeadsChart";
import { CampaignBreakdown } from "@/components/meta/CampaignBreakdown";
import { AdCreativeBreakdown } from "@/components/meta/AdCreativeBreakdown";
import type { MetaAdAccount, MetaPage, DatePreset } from "@/lib/meta-api";

const ALL_STATUSES: CanonicalCampaignStatus[] = CANONICAL_CAMPAIGN_STATUSES;

function BriefSection({ title, items }: { title: string; items: Array<[string, string | null | undefined]> }) {
  const [open, setOpen] = useState(true);
  const filtered = items.filter(([, v]) => v && String(v).trim() && String(v) !== "—");
  if (!filtered.length) return null;
  return (
    <div className="border-3 border-black overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 bg-lf-black text-white font-black uppercase text-sm tracking-wider">
        {title}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-white">
          {filtered.map(([label, value]) => (
            <div key={label} className="bg-gray-50 border-3 border-black p-3">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">{label}</p>
              <p className="text-sm font-medium whitespace-pre-wrap">{String(value)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2">
      {copied ? <Check className="w-3 h-3 text-lf-green" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copié !" : "Copier"}
    </button>
  );
}

interface AIPromptsState {
  adCopy: string | null;
  videoAd: string | null;
  vsl: string | null;
  static: string | null;
  generatedAt: string | null;
}

interface AIPromptCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  headerClass: string;
  content: string | null;
}

function AIPromptCard({ icon, title, subtitle, headerClass, content }: AIPromptCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card-brutal overflow-hidden">
      <div className={`flex items-center justify-between px-5 py-4 border-b-3 border-black ${headerClass}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">{icon}</div>
          <div>
            <p className="font-black uppercase tracking-wider text-sm">{title}</p>
            <p className="text-xs font-medium opacity-70 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {content && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 border-3 border-current font-black uppercase text-xs tracking-wider transition-all hover:bg-white/20"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copié ✓" : "Copier le prompt"}
          </button>
        )}
      </div>
      <div className="bg-gray-50 border-0 p-0">
        {content ? (
          <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 max-h-[400px] overflow-y-auto bg-gray-50 border-0 p-4 leading-relaxed">
            {content}
          </pre>
        ) : (
          <div className="p-6 text-center">
            <p className="text-sm text-lf-gray font-medium">Prompt non généré</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface IATabProps {
  aiPrompts: AIPromptsState;
  generatingAI: boolean;
  genAIError: string | null;
  onGenerate: () => void;
}

function IATab({ aiPrompts, generatingAI, genAIError, onGenerate }: IATabProps) {
  const hasPrompts = aiPrompts.adCopy || aiPrompts.videoAd || aiPrompts.vsl || aiPrompts.static;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header area */}
      <div className="card-brutal-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="sticker-blue text-xs font-black uppercase tracking-wider px-2 py-1 bg-lf-blue text-white border-3 border-black">
                IA
              </span>
              <h2 className="font-black uppercase tracking-tight text-xl">
                Assets IA — Génération de prompts
              </h2>
            </div>
            <p className="text-sm font-medium text-lf-gray">
              Prompts prêts à copier-coller dans votre IA favorite pour générer les créatives
            </p>
            {aiPrompts.generatedAt && (
              <p className="text-xs text-lf-gray mt-1">
                Généré le {formatDate(aiPrompts.generatedAt)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 items-start sm:items-end">
            {hasPrompts && (
              <button
                onClick={onGenerate}
                disabled={generatingAI}
                className={`btn-secondary flex items-center gap-2 text-xs px-4 py-2 ${
                  generatingAI ? "opacity-60 cursor-not-allowed" : ""
                }`}
              >
                {generatingAI ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Zap className="w-3 h-3" />
                )}
                {generatingAI ? "Génération en cours..." : "Régénérer"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error state */}
      {genAIError && (
        <div className="border-3 border-red-500 bg-red-50 p-4">
          <p className="font-black uppercase text-xs tracking-wider text-red-700 mb-1">Erreur</p>
          <p className="text-sm text-red-600 font-medium">{genAIError}</p>
        </div>
      )}

      {/* Loading state */}
      {generatingAI && (
        <div className="card-brutal-sm p-8 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-lf-blue mx-auto mb-4" />
          <p className="font-black uppercase tracking-wider text-sm">Génération en cours...</p>
          <p className="text-xs text-lf-gray font-medium mt-2">
            L'IA génère vos 4 assets créatifs. Cela peut prendre 10 à 15 secondes.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!hasPrompts && !generatingAI && (
        <div className="card-brutal p-12 text-center">
          <Sparkles className="w-16 h-16 text-lf-blue mx-auto mb-5 opacity-60" />
          <p className="font-black text-xl uppercase tracking-tight mb-2">
            Aucun asset IA généré
          </p>
          <p className="text-lf-gray font-medium text-sm max-w-md mx-auto mb-8">
            Cliquez sur "Générer les assets IA" pour créer automatiquement tous les prompts créatifs basés sur le brief de ce client.
          </p>
          <button
            onClick={onGenerate}
            disabled={generatingAI}
            className="btn-primary flex items-center gap-2 text-sm mx-auto"
          >
            <Sparkles className="w-4 h-4" />
            Générer les assets IA
          </button>
        </div>
      )}

      {/* Prompt cards */}
      {hasPrompts && !generatingAI && (
        <div className="flex flex-col gap-5">
          <AIPromptCard
            icon={<MessageSquare className="w-5 h-5" />}
            title="Copy Ads — 15 Variations"
            subtitle="Texte principal · Titres · Descriptions"
            headerClass="bg-lf-blue text-white"
            content={aiPrompts.adCopy}
          />
          <AIPromptCard
            icon={<Video className="w-5 h-5" />}
            title="Script Vidéo 30-60s"
            subtitle="5 scripts vidéo · Format court"
            headerClass="bg-lf-black text-white"
            content={aiPrompts.videoAd}
          />
          <AIPromptCard
            icon={<Film className="w-5 h-5" />}
            title="Script VSL 5-10 min"
            subtitle="Video Sales Letter complète"
            headerClass="bg-lf-yellow text-black"
            content={aiPrompts.vsl}
          />
          <AIPromptCard
            icon={<Image className="w-5 h-5" />}
            title="Créatives Statiques"
            subtitle="8 layouts · Briefs détaillés"
            headerClass="bg-lf-green text-white"
            content={aiPrompts.static}
          />
        </div>
      )}

    </div>
  );
}

interface Props {
  campaign: Campaign & { profiles: { id: string; full_name: string; company: string; email: string; phone: string } };
  onboarding: { responses: Record<string, unknown> } | null;
  adAccounts?: MetaAdAccount[];
  isSuperAdmin?: boolean;
}

export function CampaignDetailClient({ campaign, onboarding, adAccounts = [], isSuperAdmin = false }: Props) {
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const newEmail = searchParams.get("email") ?? "";
  const newPwd = searchParams.get("pwd") ?? "";
  const [showNewBanner, setShowNewBanner] = useState(isNew);

  const [tab, setTab] = useState<"brief" | "stats" | "prompt" | "pipeline" | "ia" | "creative_brief" | "proposition" | "delivery">("brief");
  const [status, setStatus] = useState<CanonicalCampaignStatus>(
    getCanonicalCampaignStatus(campaign)
  );
  const [savedStatus, setSavedStatus] = useState(false);
  const [notes, setNotes] = useState(campaign.notes ?? "");
  const [aiPrompt, setAiPrompt] = useState(campaign.ai_creative_prompt ?? "");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusModal, setStatusModal] = useState<{
    open: boolean;
    campaignId: string;
    campaignName: string;
    clientName: string;
    clientEmail: string;
    clientId: string;
    oldStatus: string;
    newStatus: string;
  } | null>(null);
  const [statusModalLoading, setStatusModalLoading] = useState(false);

  const [aiPrompts, setAiPrompts] = useState({
    adCopy: campaign.ai_ad_copy_prompt ?? null,
    videoAd: campaign.ai_video_ad_prompt ?? null,
    vsl: campaign.ai_vsl_prompt ?? null,
    static: (campaign.ai_static_prompt && typeof campaign.ai_static_prompt === "string" && campaign.ai_static_prompt.startsWith("CREATIVE_BRIEF_JSON:")) ? null : (campaign.ai_static_prompt ?? null),
    generatedAt: campaign.ai_generated_at ?? null,
  });
  const [generatingAI, setGeneratingAI] = useState(false);
  const [genAIError, setGenAIError] = useState<string | null>(null);

  const handleGenerateAI = async () => {
    setGeneratingAI(true);
    setGenAIError(null);
    try {
      const res = await fetch("/api/admin/generate-ai-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur de génération");
      setAiPrompts({
        adCopy: data.ai_ad_copy_prompt ?? null,
        videoAd: data.ai_video_ad_prompt ?? null,
        vsl: data.ai_vsl_prompt ?? null,
        static: (data.ai_static_prompt && typeof data.ai_static_prompt === "string" && data.ai_static_prompt.startsWith("CREATIVE_BRIEF_JSON:")) ? null : (data.ai_static_prompt ?? null),
        generatedAt: data.ai_generated_at ?? new Date().toISOString(),
      });
    } catch (e: unknown) {
      setGenAIError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setGeneratingAI(false);
    }
  };

  const responses = onboarding?.responses ?? {};
  const basePrompt = onboarding ? buildBasePrompt(responses) : "";

  const r = responses as Record<string, string | string[]>;
  const val = (v: string | string[] | undefined) => {
    if (!v) return undefined;
    if (Array.isArray(v)) return v.join(", ");
    return v || undefined;
  };

  const [generatingBriefPdf, setGeneratingBriefPdf] = useState(false);

  const handleExportOnboardingPdf = useCallback(async () => {
    if (!onboarding) return;
    setGeneratingBriefPdf(true);
    try {
      const clientFullName = campaign.profiles?.company || campaign.profiles?.full_name || campaign.name;
      const sections: Array<{ title: string; items: Array<[string, string | undefined]> }> = [
        { title: "A — Infos de base", items: [
          ["Entreprise", val(r.a_entreprise)], ["Pays / Langue", val(r.a_pays_langues)], ["Réseaux", val(r.a_reseaux)],
          ["Type d'offre", val(r.a_type)], ["Prix / Panier moyen", val(r.a_prix)], ["Cycle de décision", val(r.a_cycle_decision)],
          ["Résumé de l'offre", val(r.a_resume_offre)], ["CAB", val(r.a_cab)], ["Problèmes résolus", val(r.a_problemes)],
          ["Différenciants", val(r.a_differenciants)], ["Bénéfices clients", val(r.a_benefices)], ["Concurrents", val(r.a_concurrents)],
          ["Différenciation", val(r.a_differenciation)],
        ]},
        { title: "B — Objectifs & Conversion", items: [
          ["Objectif principal", val(r.b_objectif)], ["Conversion", val(r.b_conversion)], ["Événement", val(r.b_event_name)],
          ["KPI principal", val(r.b_kpi)], ["Objectif chiffré", val(r.b_objectif_chiffre)],
          ["Critère qualité 1", val(r.b_qualite_critere1)], ["Critère qualité 2", val(r.b_qualite_critere2)],
        ]},
        { title: "C — Message & Offre", items: [
          ["CTA / Offre", val(r.c_cta_type)], ["Promesse principale", val(r.c_promesse)],
          ["Bénéfice 1", val(r.c_benefice1)], ["Bénéfice 2", val(r.c_benefice2)], ["Bénéfice 3", val(r.c_benefice3)],
          ["Preuve", `${val(r.c_preuve_type) || ""} — ${val(r.c_preuve_detail) || ""}`],
          ["NO-GO", val(r.c_nogo)],
        ]},
        { title: "D — Ciblage", items: [
          ["Cible 1", val(r.d_cible1_description)], ["Secteur 1", val(r.d_cible1_secteur)],
          ["Fonctions 1", val(r.d_cible1_fonctions)], ["Problèmes 1", val(r.d_cible1_problemes)],
          ["Motivations 1", val(r.d_cible1_motivations)], ["Freins 1", val(r.d_cible1_freins)],
          ["Cible 2", val(r.d_cible2_description)], ["Exclusions", val(r.d_exclusions)],
        ]},
        { title: "E-H — Parcours, Tracking, Budget, Accès", items: [
          ["Destination", val(r.e_destination_principale)], ["URL", val(r.e_url)], ["CTA exact", val(r.e_cta_exact)],
          ["Pixel Meta", val(r.f_pixel)], ["CAPI", val(r.f_capi)], ["CRM", val(r.f_crm)],
          ["Budget mensuel", val(r.g_budget) ? `${val(r.g_budget)}€` : undefined],
          ["Timing", val(r.g_timing)], ["Qui valide", val(r.h_qui_valide)],
        ]},
      ];

      const sectionsHtml = sections.map(s => {
        const rows = s.items
          .filter(([, v]) => v && String(v).trim() && String(v) !== "—")
          .map(([label, value]) => `
            <tr>
              <td style="border:2px solid #000;padding:8px 12px;font-weight:700;font-size:11px;text-transform:uppercase;background:#f5f5f5;width:35%;vertical-align:top;">${label}</td>
              <td style="border:2px solid #000;padding:8px 12px;font-size:12px;white-space:pre-wrap;">${String(value)}</td>
            </tr>`)
          .join("");
        if (!rows) return "";
        return `
          <div style="page-break-inside:avoid;margin-bottom:24px;">
            <h2 style="font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:1px;border-bottom:3px solid #000;padding-bottom:6px;margin-bottom:12px;">
              ${s.title}
            </h2>
            <table style="width:100%;border-collapse:collapse;">${rows}</table>
          </div>`;
      }).join("");

      const fullHtml = `
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#000;line-height:1.5;">
          <div style="text-align:center;padding:50px 20px 40px;border-bottom:3px solid #000;margin-bottom:30px;">
            <p style="font-size:11px;text-transform:uppercase;letter-spacing:3px;color:#666;margin-bottom:8px;">LeadFactory</p>
            <h1 style="font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px 0;">
              Brief d'onboarding
            </h1>
            <p style="font-size:18px;font-weight:700;margin:0 0 20px 0;">${clientFullName}</p>
            <p style="font-size:11px;color:#888;">${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
          ${sectionsHtml}
          <div style="margin-top:40px;padding-top:16px;border-top:3px solid #000;text-align:center;">
            <p style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:2px;">
              Document généré par LeadFactory · ${new Date().toLocaleDateString("fr-FR")}
            </p>
          </div>
        </div>`;

      const html2pdfModule = await import("html2pdf.js");
      const html2pdf = html2pdfModule.default;

      const container = document.createElement("div");
      container.innerHTML = fullHtml;
      container.style.position = "fixed";
      container.style.left = "0";
      container.style.top = "0";
      container.style.width = "794px";
      container.style.background = "#ffffff";
      container.style.zIndex = "-1";
      container.style.opacity = "0";
      container.style.pointerEvents = "none";
      document.body.appendChild(container);

      await new Promise((resolve) => setTimeout(resolve, 300));

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (html2pdf() as any)
          .set({
            margin: [12, 12, 12, 12],
            filename: `Brief-Onboarding-${clientFullName.replace(/\s+/g, "-")}.pdf`,
            image: { type: "jpeg", quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff", windowWidth: 794 },
            jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
            pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "td"] },
          })
          .from(container)
          .save();
      } finally {
        document.body.removeChild(container);
      }
    } catch (err) {
      console.error("Onboarding PDF generation error:", err);
    } finally {
      setGeneratingBriefPdf(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding, campaign]);

  const handleGeneratePrompt = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/admin/generate-creative-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur de génération");
      setAiPrompt(data.prompt);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setGenerating(false);
    }
  };

  const doSaveStatus = async (targetStatus: CanonicalCampaignStatus) => {
    setSavingStatus(true);
    await fetch(`/api/admin/update-campaign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaign.id, status: targetStatus, notes }),
    });
    setSavingStatus(false);
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const handleSaveStatus = () => {
    const originalStatus = getCanonicalCampaignStatus(campaign);
    if (status !== originalStatus) {
      setStatusModal({
        open: true,
        campaignId: campaign.id,
        campaignName: campaign.name,
        clientName: campaign.profiles?.company || campaign.profiles?.full_name || "—",
        clientEmail: campaign.profiles?.email || "",
        clientId: campaign.client_id,
        oldStatus: originalStatus,
        newStatus: status,
      });
    } else {
      void doSaveStatus(status);
    }
  };

  const [linkedAdAccount, setLinkedAdAccount] = useState(campaign.ad_account_id ?? "");
  const [linkedFbPageId, setLinkedFbPageId] = useState(campaign.facebook_page_id ?? "");
  const [linkedFbPageName, setLinkedFbPageName] = useState(campaign.facebook_page_name ?? "");
  const [linkedIgId, setLinkedIgId] = useState(campaign.instagram_account_id ?? "");
  const [linkedIgName, setLinkedIgName] = useState(campaign.instagram_account_name ?? "");

  const [chartPeriod] = useState<DatePreset>("last_30d");

  // ─── Lead aggregates for breakdowns ──────────────────────────────
  const [leadStatsByCampaign, setLeadStatsByCampaign] = useState<Record<string, LeadAggregate> | undefined>(undefined);
  const [leadStatsByAdId, setLeadStatsByAdId] = useState<Record<string, LeadAggregate> | undefined>(undefined);

  const fetchLeadAggregates = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/leads/aggregated?campaign_id=${campaign.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setLeadStatsByCampaign(data.byCampaignName ?? {});
      setLeadStatsByAdId(data.byAdId ?? {});
    } catch {
      // silent fail
    }
  }, [campaign.id]);

  useEffect(() => {
    if (tab === "stats") fetchLeadAggregates();
  }, [tab, fetchLeadAggregates]);

  // ─── Notes client ────────────────────────────────────────────────
  interface ClientNote { id: string; content: string; is_read: boolean; created_at: string; }
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([]);
  const [loadingClientNotes, setLoadingClientNotes] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [sendingNote, setSendingNote] = useState(false);
  const [noteSent, setNoteSent] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const loadClientNotes = useCallback(async () => {
    setLoadingClientNotes(true);
    try {
      const res = await fetch(`/api/admin/client-notes?campaign_id=${campaign.id}`);
      const data = await res.json();
      if (data.notes) setClientNotes(data.notes);
    } finally {
      setLoadingClientNotes(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    if (tab === "pipeline") loadClientNotes();
  }, [tab, loadClientNotes]);

  const handleSendNote = async () => {
    if (!noteInput.trim() || sendingNote) return;
    setSendingNote(true);
    setNoteError(null);
    try {
      const res = await fetch("/api/admin/client-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaign.id,
          client_id: campaign.client_id,
          content: noteInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setClientNotes((prev) => [data.note, ...prev]);
      setNoteInput("");
      setNoteSent(true);
      setTimeout(() => setNoteSent(false), 2500);
    } catch (e: unknown) {
      setNoteError(e instanceof Error ? e.message : "Erreur lors de l'envoi");
    } finally {
      setSendingNote(false);
    }
  };

  // ─── Attribution Meta (enrichie) ────────────────────────────────
  const [attributionEditing, setAttributionEditing] = useState(false);
  const [editAdAccount, setEditAdAccount] = useState(campaign.ad_account_id ?? "");
  const [editPageId, setEditPageId] = useState(campaign.facebook_page_id ?? "");
  const [editPageName, setEditPageName] = useState(campaign.facebook_page_name ?? "");
  const [editIgId, setEditIgId] = useState(campaign.instagram_account_id ?? "");
  const [editIgName, setEditIgName] = useState(campaign.instagram_account_name ?? "");
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [savingAttribution, setSavingAttribution] = useState(false);
  const [attributionSaved, setAttributionSaved] = useState(false);

  const loadPages = async () => {
    if (pages.length > 0) return;
    setLoadingPages(true);
    try {
      const res = await fetch("/api/meta/pages");
      const data = await res.json();
      setPages(data.pages || []);
    } catch {
      // ignore
    } finally {
      setLoadingPages(false);
    }
  };

  const handleEditAttribution = () => {
    setEditAdAccount(linkedAdAccount);
    setEditPageId(linkedFbPageId);
    setEditPageName(linkedFbPageName);
    setEditIgId(linkedIgId);
    setEditIgName(linkedIgName);
    setAttributionEditing(true);
    loadPages();
  };

  const handlePageSelect = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    setEditPageId(pageId);
    setEditPageName(page?.name ?? "");
    if (page?.instagram_business_account) {
      setEditIgId(page.instagram_business_account.id);
      setEditIgName(`@${page.instagram_business_account.username || page.instagram_business_account.name}`);
    } else {
      setEditIgId("");
      setEditIgName("");
    }
  };

  const handleSaveAttribution = async () => {
    setSavingAttribution(true);
    await fetch("/api/admin/link-meta-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaign.id,
        ad_account_id: editAdAccount,
        facebook_page_id: editPageId,
        facebook_page_name: editPageName,
        instagram_account_id: editIgId,
        instagram_account_name: editIgName,
      }),
    });
    setLinkedAdAccount(editAdAccount);
    setLinkedFbPageId(editPageId);
    setLinkedFbPageName(editPageName);
    setLinkedIgId(editIgId);
    setLinkedIgName(editIgName);
    setSavingAttribution(false);
    setAttributionEditing(false);
    setAttributionSaved(true);
    setTimeout(() => setAttributionSaved(false), 3000);
  };

  // Legacy: keep for MetaStatsBlock compat (no linking inside block now)
  const handleLinkMetaAccount = async (adAccountId: string) => {
    await fetch("/api/admin/link-meta-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaign.id, ad_account_id: adAccountId }),
    });
    setLinkedAdAccount(adAccountId);
  };

  const TABS = [
    { id: "brief" as const, label: "Brief client" },
    { id: "stats" as const, label: "Stats Meta ✦" },
    { id: "prompt" as const, label: "Prompt créatives" },
    { id: "pipeline" as const, label: "Pipeline" },
    { id: "ia" as const, label: "IA ✦" },
    { id: "creative_brief" as const, label: "Brief Créatif" },
    { id: "proposition" as const, label: "Proposition" },
    ...(isSuperAdmin ? [{ id: "delivery" as const, label: "Delivery" }] : []),
  ];

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      {/* Banner nouveau client */}
      {showNewBanner && newEmail && (
        <div className="mb-6 card-brutal-sm p-5 bg-lf-green relative">
          <button onClick={() => setShowNewBanner(false)} className="absolute top-3 right-3 p-1 hover:bg-black/10 rounded">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-black uppercase text-sm tracking-wider mb-2">Client créé avec succès !</p>
              <p className="text-sm font-medium mb-1">Transmettez ces identifiants au client :</p>
              <div className="bg-white border-3 border-black p-3 font-mono text-sm">
                <p><strong>Email :</strong> {newEmail}</p>
                <p><strong>Mot de passe :</strong> {newPwd}</p>
              </div>
              <p className="text-xs font-medium mt-2 opacity-80">⚠️ Le client devra changer son mot de passe à la première connexion.</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Campagne</p>
          <h1 className="text-3xl font-black uppercase tracking-tight">{campaign.name}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className={`text-xs font-black px-3 py-1 border-3 border-black ${getCampaignStatusColor(campaign)}`}>
              {getCampaignStatusLabel(campaign)}
            </span>
            {campaign.budget_monthly && (
              <span className="text-sm font-bold text-lf-gray">{campaign.budget_monthly}€/mois</span>
            )}
          </div>
        </div>
        {/* Client card */}
        <div className="card-brutal-sm p-4 min-w-48">
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">Client</p>
          <p className="font-black text-sm uppercase">{campaign.profiles?.company || campaign.profiles?.full_name}</p>
          <p className="text-xs text-lf-gray mt-0.5">{campaign.profiles?.email}</p>
          {campaign.profiles?.phone && <p className="text-xs text-lf-gray">{campaign.profiles.phone}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-3 border-black mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 font-black text-xs uppercase tracking-wider transition-colors border-r-3 last:border-r-0 border-black ${
              tab === t.id ? "bg-lf-black text-white" : "bg-white text-black hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── TAB: BRIEF ─── */}
      {tab === "brief" && (
        <div className="flex flex-col gap-4">
          {/* Appels & meetings — au-dessus du brief d'onboarding */}
          <ClientCallsSection clientId={campaign.client_id} />

          {!onboarding && (
            <div className="card-brutal p-8 text-center">
              <p className="font-black text-lg">Aucun brief associé</p>
              <p className="text-lf-gray font-medium mt-1 text-sm">Cette campagne n'a pas de questionnaire d'onboarding lié.</p>
            </div>
          )}
          {onboarding && (
            <>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleExportOnboardingPdf}
                  disabled={generatingBriefPdf}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-yellow hover:shadow-brutal transition-all disabled:opacity-50"
                >
                  {generatingBriefPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {generatingBriefPdf ? "Génération..." : "Exporter PDF"}
                </button>
              </div>
              <BriefSection title="A — Infos de base" items={[
                ["Entreprise", val(r.a_entreprise)],
                ["Pays / Langue", val(r.a_pays_langues)],
                ["Réseaux", val(r.a_reseaux)],
                ["Type d'offre", val(r.a_type)],
                ["Prix / Panier moyen", val(r.a_prix)],
                ["Cycle de décision", val(r.a_cycle_decision)],
                ["Résumé de l'offre", val(r.a_resume_offre)],
                ["CAB", val(r.a_cab)],
                ["Problèmes résolus", val(r.a_problemes)],
                ["Différenciants", val(r.a_differenciants)],
                ["Bénéfices clients", val(r.a_benefices)],
                ["Concurrents", val(r.a_concurrents)],
                ["Différenciation", val(r.a_differenciation)],
              ]} />
              <BriefSection title="B — Objectifs & Conversion" items={[
                ["Objectif principal", val(r.b_objectif)],
                ["Conversion", val(r.b_conversion)],
                ["Événement", val(r.b_event_name)],
                ["KPI principal", val(r.b_kpi)],
                ["Objectif chiffré", val(r.b_objectif_chiffre)],
                ["Critère qualité 1", val(r.b_qualite_critere1)],
                ["Critère qualité 2", val(r.b_qualite_critere2)],
              ]} />
              <BriefSection title="C — Message & Offre" items={[
                ["CTA / Offre", val(r.c_cta_type)],
                ["Promesse principale", val(r.c_promesse)],
                ["Bénéfice 1", val(r.c_benefice1)],
                ["Bénéfice 2", val(r.c_benefice2)],
                ["Bénéfice 3", val(r.c_benefice3)],
                ["Preuve", `${val(r.c_preuve_type) || ""} — ${val(r.c_preuve_detail) || ""}`],
                ["NO-GO", val(r.c_nogo)],
              ]} />
              <BriefSection title="D — Ciblage" items={[
                ["Cible 1", val(r.d_cible1_description)],
                ["Secteur 1", val(r.d_cible1_secteur)],
                ["Fonctions 1", val(r.d_cible1_fonctions)],
                ["Problèmes 1", val(r.d_cible1_problemes)],
                ["Motivations 1", val(r.d_cible1_motivations)],
                ["Freins 1", val(r.d_cible1_freins)],
                ["Cible 2", val(r.d_cible2_description)],
                ["Exclusions", val(r.d_exclusions)],
              ]} />
              <BriefSection title="E-H — Parcours, Tracking, Budget, Accès" items={[
                ["Destination", val(r.e_destination_principale)],
                ["URL", val(r.e_url)],
                ["CTA exact", val(r.e_cta_exact)],
                ["Pixel Meta", val(r.f_pixel)],
                ["CAPI", val(r.f_capi)],
                ["CRM", val(r.f_crm)],
                ["Budget mensuel", val(r.g_budget) ? `${val(r.g_budget)}€` : undefined],
                ["Timing", val(r.g_timing)],
                ["Qui valide", val(r.h_qui_valide)],
              ]} />
            </>
          )}
        </div>
      )}

      {/* ─── TAB: STATS META ─── */}
      {tab === "stats" && (
        <div className="flex flex-col gap-4">
          {/* ── Attribution Meta Panel (admin) ── */}
          <div className="card-brutal-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-lf-black text-white border-b-3 border-black">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-lf-yellow" />
                <span className="font-black uppercase text-xs tracking-wider">Attribution Meta</span>
              </div>
              <div className="flex items-center gap-2">
                {attributionSaved && (
                  <span className="flex items-center gap-1 text-lf-green text-xs font-bold">
                    <Check className="w-3 h-3" /> Sauvegardé !
                  </span>
                )}
                {!attributionEditing ? (
                  <button
                    onClick={handleEditAttribution}
                    className="flex items-center gap-1.5 text-xs font-black uppercase px-3 py-1.5 border-2 border-white/30 text-white hover:border-lf-yellow hover:text-lf-yellow transition-colors"
                  >
                    <Edit3 className="w-3 h-3" />
                    Modifier
                  </button>
                ) : (
                  <button
                    onClick={() => setAttributionEditing(false)}
                    className="flex items-center gap-1.5 text-xs font-black uppercase px-3 py-1.5 border-2 border-white/30 text-white hover:border-red-400 hover:text-red-400 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Annuler
                  </button>
                )}
              </div>
            </div>

            {!attributionEditing ? (
              /* View mode */
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y-3 sm:divide-y-0 sm:divide-x-3 divide-black">
                {/* Ad Account */}
                <div className="px-4 py-3 flex flex-col gap-1">
                  <p className="text-xs font-black uppercase tracking-wider text-lf-gray flex items-center gap-1.5">
                    <span className="w-4 h-4 inline-flex">💼</span> Compte Ads
                  </p>
                  {linkedAdAccount ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-lf-green border border-black rounded-full flex-shrink-0" />
                      <span className="text-sm font-bold truncate">
                        {adAccounts.find((a) => a.id === linkedAdAccount)?.name || linkedAdAccount}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-lf-gray font-medium italic">Non lié</span>
                  )}
                </div>
                {/* Facebook Page */}
                <div className="px-4 py-3 flex flex-col gap-1">
                  <p className="text-xs font-black uppercase tracking-wider text-lf-gray flex items-center gap-1.5">
                    <Facebook className="w-3.5 h-3.5 text-lf-blue" /> Page Facebook
                  </p>
                  {linkedFbPageName ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-lf-green border border-black rounded-full flex-shrink-0" />
                      <span className="text-sm font-bold truncate">{linkedFbPageName}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-lf-gray font-medium italic">Non liée</span>
                  )}
                </div>
                {/* Instagram */}
                <div className="px-4 py-3 flex flex-col gap-1">
                  <p className="text-xs font-black uppercase tracking-wider text-lf-gray flex items-center gap-1.5">
                    <Instagram className="w-3.5 h-3.5 text-pink-500" /> Compte Instagram
                  </p>
                  {linkedIgName ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-lf-green border border-black rounded-full flex-shrink-0" />
                      <span className="text-sm font-bold truncate">{linkedIgName}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-lf-gray font-medium italic">Non lié</span>
                  )}
                </div>
              </div>
            ) : (
              /* Edit mode */
              <div className="p-5 flex flex-col gap-4 bg-gray-50">
                {/* Ad Account */}
                <div>
                  <label className="label-brutal mb-1 flex items-center gap-1.5">
                    💼 Compte publicitaire Meta
                  </label>
                  <div className="relative">
                    <select
                      value={editAdAccount}
                      onChange={(e) => setEditAdAccount(e.target.value)}
                      className="w-full input-brutal appearance-none pr-8 text-sm"
                    >
                      <option value="">— Sélectionner un compte Ads —</option>
                      {adAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.account_id}) · {acc.currency}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
                  </div>
                </div>

                {/* Facebook Page */}
                <div>
                  <label className="label-brutal mb-1 flex items-center gap-1.5">
                    <Facebook className="w-3.5 h-3.5 text-lf-blue" /> Page Facebook
                  </label>
                  <div className="relative">
                    <select
                      value={editPageId}
                      onChange={(e) => handlePageSelect(e.target.value)}
                      disabled={loadingPages}
                      className="w-full input-brutal appearance-none pr-8 text-sm disabled:opacity-60"
                    >
                      <option value="">— Sélectionner une page —</option>
                      {pages.map((page) => (
                        <option key={page.id} value={page.id}>
                          {page.name}
                          {page.instagram_business_account ? " (IG lié)" : ""}
                        </option>
                      ))}
                    </select>
                    {loadingPages ? (
                      <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin pointer-events-none" />
                    ) : (
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
                    )}
                  </div>
                </div>

                {/* Instagram */}
                <div>
                  <label className="label-brutal mb-1 flex items-center gap-1.5">
                    <Instagram className="w-3.5 h-3.5 text-pink-500" /> Compte Instagram
                  </label>
                  {editIgName ? (
                    <div className="flex items-center gap-3 px-4 py-3 border-3 border-black bg-white">
                      <span className="w-2 h-2 bg-lf-green border border-black rounded-full flex-shrink-0" />
                      <span className="text-sm font-bold">{editIgName}</span>
                      <span className="text-xs text-lf-gray font-medium ml-auto">Auto via page FB</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={editIgId}
                      onChange={(e) => { setEditIgId(e.target.value); setEditIgName(e.target.value); }}
                      placeholder="ID ou @username Instagram (optionnel)"
                      className="input-brutal text-sm w-full"
                    />
                  )}
                </div>

                <button
                  onClick={handleSaveAttribution}
                  disabled={savingAttribution || !editAdAccount}
                  className="btn-primary flex items-center gap-2 text-sm self-start disabled:opacity-40"
                >
                  {savingAttribution ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Sauvegarder l'attribution
                </button>
              </div>
            )}
          </div>

          {/* ── Stats Meta ── */}
          <MetaStatsBlock
            adAccountId={linkedAdAccount || null}
            campaignId={campaign.id}
            isAdmin={true}
            availableAccounts={linkedAdAccount ? [] : adAccounts}
            onLinkAccount={handleLinkMetaAccount}
          />
          {linkedAdAccount && (
            <SpendLeadsChart adAccountId={linkedAdAccount} period={chartPeriod} />
          )}

          {/* ── Par campagne ── */}
          {linkedAdAccount && (
            <div className="card-brutal-sm p-5">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-lf-blue border border-black rounded-full" />
                Breakdown par campagne
              </p>
              <CampaignBreakdown adAccountId={linkedAdAccount} period={chartPeriod} leadStats={leadStatsByCampaign} />
            </div>
          )}

          {/* ── Par créative (admin only) ── */}
          {linkedAdAccount && (
            <div className="card-brutal-sm p-5">
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-lf-pink border border-black rounded-full" />
                Breakdown par créative / ad
              </p>
              <AdCreativeBreakdown adAccountId={linkedAdAccount} period={chartPeriod} leadStats={leadStatsByAdId} />
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: PROMPT CRÉATIVES ─── */}
      {tab === "prompt" && (
        <div className="flex flex-col gap-6">
          {/* Prompt de base */}
          <div className="card-brutal-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b-3 border-black">
              <span className="font-black uppercase text-sm tracking-wider">Prompt de base</span>
              {basePrompt && <CopyButton text={basePrompt} />}
            </div>
            <div className="p-4 bg-gray-50">
              {basePrompt ? (
                <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 max-h-80 overflow-y-auto">{basePrompt}</pre>
              ) : (
                <p className="text-sm text-lf-gray font-medium">Aucun brief associé — le prompt de base ne peut pas être généré.</p>
              )}
            </div>
          </div>

          {/* Prompt enrichi Claude */}
          <div className="card-brutal overflow-hidden">
            <div className="px-5 py-4 bg-lf-black text-white border-b-3 border-black flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-black uppercase tracking-wider">Prompt enrichi par Claude ✦</span>
                <p className="text-xs text-white/60 font-medium mt-0.5">Stratégie créative complète + angles + copywriting + directives visuelles</p>
              </div>
              <div className="flex items-center gap-2">
                {aiPrompt && <CopyButton text={aiPrompt} />}
                <button
                  onClick={handleGeneratePrompt}
                  disabled={generating || !onboarding}
                  className={`flex items-center gap-2 px-5 py-2 font-black uppercase text-xs tracking-wider border-3 transition-all ${
                    generating || !onboarding
                      ? "bg-gray-600 text-gray-400 border-gray-600 cursor-not-allowed"
                      : "bg-lf-blue text-white border-lf-blue hover:bg-blue-600 shadow-brutal-xs"
                  }`}
                >
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  {generating ? "Génération..." : aiPrompt ? "Regénérer" : "Générer"}
                </button>
              </div>
            </div>

            {genError && (
              <div className="px-5 py-3 bg-red-50 border-b-3 border-red-400 text-red-700 text-sm font-bold">{genError}</div>
            )}

            <div className="p-5 bg-gray-50 min-h-48">
              {generating && (
                <div className="flex items-center gap-3 text-lf-gray font-medium">
                  <Loader2 className="w-5 h-5 animate-spin text-lf-blue" />
                  Claude génère votre prompt créatif...
                </div>
              )}
              {!generating && aiPrompt && (
                <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 max-h-[600px] overflow-y-auto">{aiPrompt}</pre>
              )}
              {!generating && !aiPrompt && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Zap className="w-10 h-10 text-lf-blue mb-3 opacity-50" />
                  <p className="font-black text-lg">Prêt à générer</p>
                  <p className="text-lf-gray font-medium text-sm mt-1 max-w-sm">
                    Claude va analyser le brief et générer un prompt créatif ultra-détaillé : angles, copywriting, directives visuelles, checklist.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB: IA ─── */}
      {tab === "ia" && (
        <IATab
          aiPrompts={aiPrompts}
          generatingAI={generatingAI}
          genAIError={genAIError}
          onGenerate={handleGenerateAI}
        />
      )}

      {/* ─── TAB: PIPELINE ─── */}
      {tab === "pipeline" && (
        <div className="flex flex-col gap-6">
          <div className="card-brutal-sm p-6">
            <h3 className="font-black uppercase tracking-wider text-sm mb-5">Statut de la campagne</h3>
            <div className="flex flex-wrap gap-3 mb-6">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-4 py-3 border-3 border-black font-bold text-xs uppercase tracking-wide transition-all duration-100 ${
                    status === s
                      ? `${getCampaignStatusColor(s)} shadow-brutal-xs translate-x-[2px] translate-y-[2px]`
                      : "bg-white text-black shadow-brutal-sm hover:shadow-brutal-xs hover:translate-x-[2px] hover:translate-y-[2px]"
                  }`}
                >
                  {getCampaignStatusLabel(s)}
                </button>
              ))}
            </div>

            <div className="mb-5">
              <label className="label-brutal">Notes internes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder="Notes internes sur la campagne (non visibles par le client)..."
                className="textarea-brutal"
              />
            </div>

            <button onClick={handleSaveStatus} disabled={savingStatus} className="btn-primary flex items-center gap-2 text-sm">
              {savingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : savedStatus ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {savedStatus ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>

          {/* ── Messages client ──────────────────────────────────────── */}
          <div className="card-brutal-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 bg-lf-black text-white border-b-3 border-black">
              <Bell className="w-4 h-4 text-lf-yellow" />
              <p className="font-black uppercase text-xs tracking-wider">Message au client</p>
              <span className="text-white/40 text-xs font-medium ml-1">· visible dans son espace</span>
            </div>

            <div className="p-5">
              <textarea
                value={noteInput}
                onChange={(e) => { setNoteInput(e.target.value); setNoteError(null); }}
                rows={4}
                placeholder="Écrivez un message au client (mise à jour, validation, demande d'info...)&#10;Il recevra une notification email + verra ce message dans son espace."
                className="textarea-brutal mb-3 text-sm"
              />
              {noteError && (
                <p className="text-xs font-bold text-red-500 mb-3">{noteError}</p>
              )}
              <button
                onClick={handleSendNote}
                disabled={!noteInput.trim() || sendingNote}
                className="btn-blue flex items-center gap-2 text-sm disabled:opacity-40"
              >
                {sendingNote
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : noteSent
                  ? <Check className="w-4 h-4" />
                  : <Send className="w-4 h-4" />}
                {noteSent ? "Envoyé !" : sendingNote ? "Envoi..." : "Envoyer au client"}
              </button>
            </div>

            {/* Historique */}
            {(loadingClientNotes || clientNotes.length > 0) && (
              <div className="border-t-3 border-black">
                <p className="px-5 py-3 text-xs font-black uppercase tracking-wider text-lf-gray bg-gray-50 border-b-3 border-black">
                  Historique des messages
                </p>
                {loadingClientNotes ? (
                  <div className="p-5 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-lf-gray" />
                    <span className="text-sm text-lf-gray font-medium">Chargement...</span>
                  </div>
                ) : (
                  <div className="divide-y-3 divide-black max-h-72 overflow-y-auto">
                    {clientNotes.map((note) => (
                      <div key={note.id} className="px-5 py-4 bg-white">
                        <div className="flex items-center gap-2 mb-1.5">
                          <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
                            {new Date(note.created_at).toLocaleDateString("fr-FR", {
                              day: "numeric", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </p>
                          {!note.is_read && (
                            <span className="text-[10px] font-black uppercase tracking-wide text-lf-blue border border-lf-blue px-1.5 py-0.5">
                              Non lu
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium whitespace-pre-wrap">{note.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Access info */}
          {onboarding && (
            <div className="card-brutal-sm p-6">
              <h3 className="font-black uppercase tracking-wider text-sm mb-4">Accès & Tracking</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ["Business Manager", r.h_bm],
                  ["Compte pub", r.h_compte_pub],
                  ["Pixel + CAPI", r.h_pixel_capi],
                  ["Page FB/IG", r.h_page_fb_ig],
                  ["Domaine", r.h_domaine],
                  ["Pixel Meta", r.f_pixel],
                  ["CAPI", r.f_capi],
                  ["GA4", r.f_ga4],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-white border-3 border-black p-3">
                    <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">{label}</p>
                    <span className={`text-xs font-black px-2 py-1 border-2 border-black ${
                      String(value) === "ok" || String(value) === "oui" ? "bg-lf-green text-white" :
                      String(value) === "non" ? "bg-red-400 text-white" :
                      "bg-lf-yellow text-black"
                    }`}>{String(value || "—")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: BRIEF CRÉATIF ─── */}
      {tab === "creative_brief" && (
        <CampaignCreativeBriefEditor
          campaignId={campaign.id}
          clientId={campaign.client_id}
          initialData={(() => {
            const raw = campaign.ai_static_prompt;
            if (raw && typeof raw === "string" && raw.startsWith("CREATIVE_BRIEF_JSON:")) return raw.slice("CREATIVE_BRIEF_JSON:".length);
            return null;
          })()}
          clientName={campaign.profiles?.company || campaign.profiles?.full_name || campaign.name}
          onboardingData={onboarding?.responses ?? null}
        />
      )}

      {/* ─── TAB: PROPOSITION ─── */}
      {tab === "proposition" && (
        <CampaignProposalEditor
          campaignId={campaign.id}
          initialMarkdown={(() => {
            const raw = campaign.ai_vsl_prompt;
            if (raw && typeof raw === "string" && raw.startsWith("PROPOSAL_JSON:")) return raw.slice("PROPOSAL_JSON:".length);
            return null;
          })()}
          clientName={campaign.profiles?.company || campaign.profiles?.full_name || campaign.name}
          onboardingData={onboarding?.responses ?? null}
        />
      )}

      {/* ─── TAB: DELIVERY ─── */}
      {tab === "delivery" && isSuperAdmin && (
        <AIDeliveryPanel
          clientId={campaign.client_id}
          clientName={campaign.profiles?.company || campaign.profiles?.full_name || campaign.name}
        />
      )}

      {statusModal && (
        <StatusUpdateModal
          open={statusModal.open}
          onClose={() => setStatusModal(null)}
          onConfirm={async ({ sendEmail, customMessage, deliverables }) => {
            setStatusModalLoading(true);
            try {
              await doSaveStatus(statusModal.newStatus as CanonicalCampaignStatus);
              if (sendEmail) {
                await fetch("/api/admin/send-status-update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    campaignId: statusModal.campaignId,
                    campaignName: statusModal.campaignName,
                    clientId: statusModal.clientId,
                    clientName: statusModal.clientName,
                    clientEmail: statusModal.clientEmail,
                    oldStatus: statusModal.oldStatus,
                    newStatus: statusModal.newStatus,
                    customMessage,
                    deliverables,
                  }),
                });
              }
            } finally {
              setStatusModalLoading(false);
              setStatusModal(null);
            }
          }}
          onCancel={() => setStatusModal(null)}
          campaignName={statusModal.campaignName}
          clientName={statusModal.clientName}
          clientEmail={statusModal.clientEmail}
          newStatus={statusModal.newStatus}
          oldStatus={statusModal.oldStatus}
          loading={statusModalLoading}
        />
      )}
    </div>
  );
}
