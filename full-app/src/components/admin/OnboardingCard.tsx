"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OnboardingResponse } from "@/types/index";

interface Props {
  response: OnboardingResponse & { profiles?: { full_name: string; company: string } };
  processed?: boolean;
}

export function OnboardingCard({ response, processed = false }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const r = response.responses as Record<string, string | string[]>;
  const entreprise = String(r.a_entreprise || "Sans nom");
  const budget = r.g_budget ? `${r.g_budget}€/mois` : null;
  const objectif = Array.isArray(r.b_objectif) ? r.b_objectif.join(", ") : r.b_objectif;

  const handleProcess = async () => {
    if (!confirm(`Créer un compte client + campagne pour "${entreprise}" ?`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/process-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_response_id: response.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      router.push(`/admin/campaigns/${data.campaign_id}?new=1&email=${encodeURIComponent(data.email)}&pwd=${encodeURIComponent(data.temp_password)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  const SECTIONS: Array<[string, string | string[]]> = [
    ["Offre", r.a_resume_offre],
    ["Prix", r.a_prix],
    ["Objectifs", objectif],
    ["KPIs", Array.isArray(r.b_kpi) ? r.b_kpi.join(", ") : r.b_kpi],
    ["Promesse", r.c_promesse],
    ["Budget", budget ?? "—"],
    ["Cible 1", r.d_cible1_description],
    ["No-go", r.c_nogo],
  ];

  return (
    <div className={`card-brutal-sm overflow-hidden ${processed ? "opacity-70" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
            <span className="font-black text-white text-sm">{entreprise.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="font-black uppercase text-sm">{entreprise}</p>
            <p className="text-xs text-lf-gray font-medium">
              {new Date(response.submitted_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              {budget && ` · ${budget}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {processed && response.campaign_id && (
            <Link href={`/admin/campaigns/${response.campaign_id}`} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1">
              Voir campagne <ExternalLink className="w-3 h-3" />
            </Link>
          )}
          {!processed && (
            <button
              onClick={handleProcess}
              disabled={loading}
              className={`text-xs px-4 py-2 flex items-center gap-2 ${loading ? "btn-disabled" : "btn-primary"}`}
            >
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
              Créer client + campagne
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="p-2 border-3 border-black bg-white shadow-brutal-xs hover:bg-gray-50">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && <div className="px-5 py-2 bg-red-50 border-t-3 border-red-400 text-red-700 text-xs font-bold">{error}</div>}

      {/* Expanded brief */}
      {expanded && (
        <div className="border-t-3 border-black bg-gray-50 p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SECTIONS.map(([label, value]) =>
              value ? (
                <div key={label} className="bg-white border-3 border-black p-3">
                  <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">{label}</p>
                  <p className="text-sm font-medium">{String(value)}</p>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  );
}
