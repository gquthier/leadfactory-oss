"use client";

import { useState } from "react";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import type { DatePreset } from "@/lib/meta-api";

interface Props {
  adAccountId: string;
  period: DatePreset;
  accountName?: string;
}

export function ExportBriefButton({ adAccountId, period, accountName }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/export-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId, period }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");

      // Download .md file
      const blob = new Blob([data.brief], { type: "text/markdown;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const slug = (accountName ?? adAccountId).replace(/\s+/g, "-").toLowerCase();
      a.href     = url;
      a.download = `brief-${slug}-${period}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors de la génération");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleExport}
        disabled={loading}
        className={`flex items-center gap-2 px-3 py-1.5 border-2 border-black text-xs font-black uppercase tracking-wider transition-all ${
          loading ? "opacity-50 cursor-not-allowed bg-gray-50" : "bg-white hover:bg-lf-yellow"
        }`}
        title="Générer un brief IA complet via Gemini"
      >
        {loading
          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Génération IA…</>
          : <><Sparkles className="w-3.5 h-3.5" /><Download className="w-3.5 h-3.5" /> Brief IA</>
        }
      </button>
      {error && <p className="text-[10px] text-red-600 font-bold max-w-48 text-right">{error}</p>}
    </div>
  );
}
