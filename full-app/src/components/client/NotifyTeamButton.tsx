"use client";

import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";

interface Props {
  action: string;       // e.g. 'testimonial' | 'referral' | 'lazyrank' | 'gohighlevel'
  message?: string;     // optional context message
}

export function NotifyTeamButton({ action, message }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleClick = async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      const res = await fetch("/api/client/notify-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message }),
      });
      if (!res.ok) throw new Error();
      setState("done");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading" || state === "done"}
      className={`flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
        state === "done"
          ? "bg-lf-green text-white cursor-default"
          : state === "error"
          ? "bg-red-500 text-white"
          : "bg-white hover:bg-lf-yellow hover:shadow-brutal-xs"
      }`}
    >
      {state === "loading" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : state === "done" ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Bell className="w-3.5 h-3.5" />
      )}
      {state === "done" ? "Équipe notifiée !" : state === "error" ? "Erreur" : "Prévenir l'équipe"}
    </button>
  );
}
