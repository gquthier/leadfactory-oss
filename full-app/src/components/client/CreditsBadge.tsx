"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Coins, AlertTriangle, Loader2 } from "lucide-react";

interface CreditsState {
  balance: number;
  warning_threshold: number;
  low: boolean;
  empty: boolean;
}

/**
 * Badge cliquable qui affiche le solde de crédits courant.
 * Re-fetch automatiquement sur :
 *   - mount
 *   - focus de la fenêtre
 *   - événement custom "lf-credits-updated" (les API calls peuvent en dispatcher
 *     pour rafraîchir immédiatement après une consommation)
 */
export function CreditsBadge({ collapsed = false }: { collapsed?: boolean }) {
  const [state, setState] = useState<CreditsState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    try {
      const r = await fetch("/api/client/credits", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as CreditsState;
      setState(data);
    } catch (e) {
      console.error("[credits-badge] fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBalance();
    const onFocus = () => void fetchBalance();
    const onUpdate = () => void fetchBalance();
    window.addEventListener("focus", onFocus);
    window.addEventListener("lf-credits-updated", onUpdate);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("lf-credits-updated", onUpdate);
    };
  }, [fetchBalance]);

  if (loading) {
    return (
      <div
        className={`flex items-center ${
          collapsed ? "justify-center" : "justify-between gap-2"
        } px-3 py-2 border-3 border-black bg-white`}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {!collapsed && (
          <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
            Crédits…
          </span>
        )}
      </div>
    );
  }

  if (!state) {
    return null;
  }

  const tone = state.empty
    ? "bg-lf-pink text-black"
    : state.low
    ? "bg-lf-yellow text-black"
    : "bg-white text-black";

  if (collapsed) {
    return (
      <Link
        href="/client/settings?tab=credits"
        title={`Crédits restants : ${state.balance}`}
        className={`flex items-center justify-center w-10 h-10 border-3 border-black ${tone} hover:shadow-[3px_3px_0_#000] transition-all`}
      >
        {state.empty ? (
          <AlertTriangle className="w-4 h-4" />
        ) : (
          <Coins className="w-4 h-4" />
        )}
      </Link>
    );
  }

  return (
    <Link
      href="/client/settings?tab=credits"
      className={`flex items-center justify-between gap-3 px-3 py-2 border-3 border-black ${tone} hover:shadow-[3px_3px_0_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {state.empty ? (
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Coins className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span className="text-[10px] font-black uppercase tracking-wider">Crédits</span>
      </span>
      <span className="font-black text-sm leading-none flex-shrink-0">
        {state.balance.toLocaleString("fr-FR")}
      </span>
    </Link>
  );
}
