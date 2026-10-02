"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, Star, AlertCircle } from "lucide-react";
import type { OpenRouterModel } from "@/lib/openrouter";

interface Props {
  models: OpenRouterModel[];
  currentModel: string;
  lastUpdated: string | null;
}

const PROVIDER_COLORS: Record<OpenRouterModel["provider"], string> = {
  anthropic: "bg-orange-100 text-orange-800 border-orange-300",
  openai: "bg-green-100 text-green-800 border-green-300",
  google: "bg-blue-100 text-blue-800 border-blue-300",
  meta: "bg-cyan-100 text-cyan-800 border-cyan-300",
  deepseek: "bg-purple-100 text-purple-800 border-purple-300",
  mistral: "bg-pink-100 text-pink-800 border-pink-300",
  xai: "bg-gray-100 text-gray-800 border-gray-300",
};

function formatPrice(n: number): string {
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(0)}`;
}

export function OutboundModelSelector({ models, currentModel, lastUpdated }: Props) {
  const [selected, setSelected] = useState(currentModel);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const isDirty = selected !== currentModel;

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "outbound_ai_model", value: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg({ type: "err", text: data.error || "Erreur lors de la sauvegarde" });
      } else {
        setSaveMsg({ type: "ok", text: "Modèle enregistré. Tous les nouveaux chats l'utiliseront." });
        // refresh la page pour mettre à jour le currentModel
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch {
      setSaveMsg({ type: "err", text: "Erreur réseau" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Liste des modèles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {models.map((m) => {
          const isSelected = m.id === selected;
          const isActive = m.id === currentModel;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(m.id)}
              className={`relative text-left border-3 p-4 transition-all ${
                isSelected
                  ? "border-black bg-lf-yellow shadow-[4px_4px_0_#000]"
                  : "border-black bg-white hover:bg-lf-yellow/30 hover:shadow-[2px_2px_0_#000]"
              }`}
            >
              {/* Top-right indicators */}
              <div className="absolute top-2 right-2 flex items-center gap-1">
                {m.recommended && !isSelected && (
                  <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-lf-yellow text-black border-2 border-black">
                    Recommandé
                  </span>
                )}
                {isActive && (
                  <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-lf-green text-white border-2 border-black">
                    <Check className="w-2.5 h-2.5" />
                    Actif
                  </span>
                )}
                {isSelected && !isActive && (
                  <span className="w-5 h-5 bg-lf-black text-white flex items-center justify-center border-2 border-black">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </div>

              {/* Provider chip */}
              <span
                className={`inline-block text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 border-2 mb-2 ${
                  PROVIDER_COLORS[m.provider]
                }`}
              >
                {m.provider}
              </span>

              {/* Label */}
              <p className="font-black text-base uppercase tracking-tight mb-1 leading-tight">
                {m.label}
              </p>

              {/* Description */}
              <p className="text-xs text-lf-gray font-medium leading-snug mb-2 min-h-[32px]">
                {m.description}
              </p>

              {/* Prix */}
              <div className="flex items-center gap-3 text-xs font-bold">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-wider text-lf-gray">
                    Input
                  </span>
                  <span className="font-mono">
                    {formatPrice(m.pricePerMTokensInput)}<span className="text-[9px] text-lf-gray">/M</span>
                  </span>
                </div>
                <div className="w-px h-6 bg-black/20" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-wider text-lf-gray">
                    Output
                  </span>
                  <span className="font-mono">
                    {formatPrice(m.pricePerMTokensOutput)}<span className="text-[9px] text-lf-gray">/M</span>
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t-2 border-black/10 pt-4">
        <div className="text-xs text-lf-gray font-medium">
          {lastUpdated ? (
            <>Dernière modification : {new Date(lastUpdated).toLocaleString("fr-FR")}</>
          ) : (
            "Aucune modification enregistrée (valeur par défaut)"
          )}
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span
              className={`flex items-center gap-1 text-xs font-bold ${
                saveMsg.type === "ok" ? "text-lf-green" : "text-red-600"
              }`}
            >
              {saveMsg.type === "ok" ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase bg-lf-black text-white border-3 border-black hover:bg-lf-blue disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-lf-yellow" />
            )}
            Enregistrer
          </button>
        </div>
      </div>

      <div className="text-[10px] text-lf-gray font-medium leading-relaxed border-t-2 border-black/10 pt-3">
        <Star className="inline w-2.5 h-2.5 mr-1 text-lf-yellow" />
        Prix indicatifs en USD pour 1M tokens. Source : openrouter.ai/models. Vérifie régulièrement ; les providers peuvent ajuster.
      </div>
    </div>
  );
}
