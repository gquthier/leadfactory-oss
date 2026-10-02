"use client";

import { useEffect, useState, useCallback } from "react";
import { FileText, Download, Inbox } from "lucide-react";

type Deliverable = {
  id: string;
  skill_name: string;
  deliverable_type: string;
  deliverable_name: string;
  relative_path: string;
  file_size_bytes: number | null;
  file_extension: string | null;
  status: "available" | "archived" | "error" | "missing";
  generated_at: string;
};

const STAGE_LABELS: Record<string, { label: string; order: number; description: string }> = {
  onboarding_form: {
    label: "Onboarding",
    order: 0,
    description: "Le formulaire d'onboarding qui a servi de brief pour toute la campagne.",
  },
  deep_search_market_awareness: {
    label: "Deep Search — Études marché",
    order: 1,
    description: "Analyse conscience marché, concurrents, psychographie de votre cible.",
  },
  deep_search_competitor_research: {
    label: "Deep Search — Études marché",
    order: 1,
    description: "Analyse conscience marché, concurrents, psychographie de votre cible.",
  },
  deep_search_psychographic: {
    label: "Deep Search — Études marché",
    order: 1,
    description: "Analyse conscience marché, concurrents, psychographie de votre cible.",
  },
  competitor_ads_brief: {
    label: "Brief concurrents",
    order: 2,
    description: "Analyse des ads Meta actives de vos concurrents + angles morts à exploiter.",
  },
  competitor_ads_data: {
    label: "Brief concurrents",
    order: 2,
    description: "Analyse des ads Meta actives de vos concurrents + angles morts à exploiter.",
  },
  competitor_ads_analysis: {
    label: "Brief concurrents",
    order: 2,
    description: "Analyse des ads Meta actives de vos concurrents + angles morts à exploiter.",
  },
  competitor_ads_creative: {
    label: "Brief concurrents",
    order: 2,
    description: "Analyse des ads Meta actives de vos concurrents + angles morts à exploiter.",
  },
  campaign_proposal: {
    label: "Proposition de campagne",
    order: 3,
    description: "Structure de campagne Meta : ad sets, audiences, budget, hypothèses A/B.",
  },
  vsl_script: {
    label: "VSL",
    order: 4,
    description: "Script vidéo de vente + strategy doc + mapping vers les ads.",
  },
  vsl_strategy: {
    label: "VSL",
    order: 4,
    description: "Script vidéo de vente + strategy doc + mapping vers les ads.",
  },
  vsl_docx: {
    label: "VSL",
    order: 4,
    description: "Script vidéo de vente + strategy doc + mapping vers les ads.",
  },
  meta_ads_copy: {
    label: "Meta Ads",
    order: 5,
    description: "Copies publicitaires Meta : texte principal, titre, description, scripts UGC.",
  },
  meta_ads_docx: {
    label: "Meta Ads",
    order: 5,
    description: "Copies publicitaires Meta : texte principal, titre, description, scripts UGC.",
  },
  readme_index: {
    label: "Récapitulatif",
    order: 99,
    description: "Index complet et récapitulatif stratégique de tous les livrables.",
  },
  other: {
    label: "Autre",
    order: 100,
    description: "",
  },
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function ClientDeliverablesPanel() {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeliverables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/ai-deliverables`);
      if (res.ok) {
        const data = await res.json();
        setDeliverables(data.deliverables ?? []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Erreur de chargement");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeliverables();
  }, [fetchDeliverables]);

  const handleDownload = (id: string) => {
    window.location.href = `/api/client/ai-deliverables/download?id=${id}`;
  };

  const grouped = deliverables.reduce<Record<string, Deliverable[]>>((acc, d) => {
    const stage = STAGE_LABELS[d.deliverable_type]?.label ?? "Autre";
    if (!acc[stage]) acc[stage] = [];
    acc[stage].push(d);
    return acc;
  }, {});

  const sortedStages = Object.keys(grouped).sort((a, b) => {
    const oa = Object.values(STAGE_LABELS).find((s) => s.label === a)?.order ?? 999;
    const ob = Object.values(STAGE_LABELS).find((s) => s.label === b)?.order ?? 999;
    return oa - ob;
  });

  if (loading) {
    return (
      <div className="border-3 border-black bg-white p-6">
        <p className="text-sm text-lf-gray font-medium">Chargement des livrables…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-3 border-red-600 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-900">{error}</p>
      </div>
    );
  }

  if (deliverables.length === 0) {
    return (
      <div className="border-3 border-dashed border-black bg-white p-10 text-center">
        <Inbox className="w-10 h-10 mx-auto mb-3 text-lf-gray" />
        <p className="text-base font-black uppercase tracking-tight mb-1">Aucun livrable pour le moment</p>
        <p className="text-sm text-lf-gray max-w-md mx-auto">
          Vos livrables apparaîtront ici dès qu'ils seront produits par l'équipe LeadFactory.
        </p>
      </div>
    );
  }

  const totalBytes = deliverables.reduce((acc, d) => acc + (d.file_size_bytes ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="border-3 border-black bg-lf-yellow p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-black">Dossier complet</p>
            <p className="text-sm font-bold">
              {deliverables.length} document{deliverables.length > 1 ? "s" : ""} · {formatBytes(totalBytes)}
            </p>
          </div>
        </div>
      </div>

      {sortedStages.map((stage) => {
        const stageMeta = Object.values(STAGE_LABELS).find((s) => s.label === stage);
        return (
          <div key={stage} className="border-3 border-black bg-white">
            <div className="px-5 py-4 border-b-3 border-black bg-canvas">
              <h2 className="text-base font-black uppercase tracking-tight">{stage}</h2>
              {stageMeta?.description && (
                <p className="text-xs text-lf-gray mt-0.5">{stageMeta.description}</p>
              )}
            </div>
            <div className="divide-y-2 divide-black/10">
              {grouped[stage].map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 border-2 border-black bg-white flex items-center justify-center flex-shrink-0 font-black text-[10px] uppercase">
                      {d.file_extension?.toUpperCase().slice(0, 4) || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate">{d.deliverable_name}</p>
                      <p className="text-xs text-lf-gray mt-0.5">
                        {formatBytes(d.file_size_bytes)} · généré le {formatDate(d.generated_at)}
                        {d.status !== "available" && (
                          <span className="ml-2 text-red-600 font-bold uppercase">[{d.status}]</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(d.id)}
                    disabled={d.status !== "available"}
                    className="flex items-center gap-2 px-3 py-2 bg-lf-black text-white border-2 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Télécharger
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
