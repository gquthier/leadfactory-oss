"use client";

import { useEffect, useState, useCallback } from "react";
import { Linkedin, CheckCircle2, Loader2, RefreshCw, AlertTriangle, ExternalLink, Trash2 } from "lucide-react";

interface ConnectionState {
  connected: boolean;
  linkedinUserId?: string;
  fullName?: string | null;
  profilePicture?: string | null;
  scopes?: string[];
  connectedAt?: string;
  expiresAt?: string;
  refreshExpiresAt?: string | null;
  lastRefreshedAt?: string | null;
  lastError?: string | null;
}

const CALLBACK_STATUS_MAP: Record<string, { type: "success" | "error"; text: string }> = {
  connected: { type: "success", text: "Compte LinkedIn connecté avec succès." },
  csrf_failed: { type: "error", text: "Échec de sécurité (CSRF). Réessayez." },
  exchange_failed: { type: "error", text: "Échec de l'échange du code OAuth. Réessayez ou contactez le support." },
  db_error: { type: "error", text: "Erreur DB pendant la sauvegarde. Contactez le support." },
};

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function LinkedInConnectionSection() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/linkedin/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ConnectionState;
      setState(data);
    } catch (err) {
      console.error("[LinkedInConnection] status fetch failed", err);
      setState({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Read ?linkedin=<status> from URL set by the OAuth callback
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("linkedin");
    if (status) {
      const known = CALLBACK_STATUS_MAP[status];
      if (known) {
        setFlash(known);
      } else if (status.startsWith("error_")) {
        setFlash({ type: "error", text: `LinkedIn a renvoyé une erreur : ${status.slice(6)}` });
      }
      url.searchParams.delete("linkedin");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  async function handleConnect() {
    window.location.href = "/api/linkedin/auth/start";
  }

  async function handleDisconnect() {
    if (!confirm("Déconnecter votre compte LinkedIn ? Vos posts programmés non publiés ne pourront plus partir.")) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch("/api/linkedin/disconnect", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setFlash({ type: "success", text: "Compte LinkedIn déconnecté." });
      await refresh();
    } catch (err) {
      setFlash({
        type: "error",
        text: err instanceof Error ? err.message : "Échec de la déconnexion.",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  const expiresInDays = state ? daysUntil(state.expiresAt) : null;
  const refreshExpiresInDays = state ? daysUntil(state.refreshExpiresAt) : null;
  const needsReconnect = refreshExpiresInDays !== null && refreshExpiresInDays <= 30;

  return (
    <section className="card-brutal p-5 bg-white">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#0A66C2] border-3 border-black flex items-center justify-center">
            <Linkedin className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">LinkedIn</h2>
            <p className="text-xs text-lf-gray font-medium">
              Connectez votre profil pour programmer vos posts depuis LeadFactory.
            </p>
          </div>
        </div>
        {state?.connected && (
          <button
            onClick={refresh}
            className="text-xs flex items-center gap-1 px-2 py-1 border-2 border-black bg-white hover:bg-lf-yellow"
            title="Rafraîchir le statut"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </header>

      {flash && (
        <div
          className={`flex items-start gap-2 text-sm border-3 px-3 py-2 mb-4 ${
            flash.type === "success"
              ? "border-lf-green bg-lf-green/10 text-lf-green"
              : "border-red-400 bg-red-50 text-red-600"
          }`}
        >
          {flash.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span className="font-medium">{flash.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-lf-gray">
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement…
        </div>
      ) : !state?.connected ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Aucun compte connecté. Connectez votre profil LinkedIn pour pouvoir programmer la publication
            automatique de vos posts générés par Personal Brand IA et Surprises.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0A66C2] text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:shadow-[4px_4px_0_#000] transition-all"
          >
            <Linkedin className="w-4 h-4" />
            Connecter LinkedIn
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 border-3 border-lf-green bg-lf-green/5 p-3">
            {state.profilePicture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.profilePicture}
                alt={state.fullName ?? "profil"}
                className="w-10 h-10 border-2 border-black object-cover"
              />
            ) : (
              <div className="w-10 h-10 bg-[#0A66C2] border-2 border-black flex items-center justify-center">
                <Linkedin className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-lf-green flex-shrink-0" />
                <span className="font-black text-sm">
                  Connecté{state.fullName ? ` en tant que ${state.fullName}` : ""}
                </span>
              </div>
              <p className="text-xs text-lf-gray mt-1">
                {state.scopes && state.scopes.includes("w_member_social")
                  ? "Permission de publication accordée."
                  : "⚠ Permission de publication manquante."}
              </p>
              {expiresInDays !== null && (
                <p className="text-xs text-lf-gray mt-0.5">
                  Token valide encore {expiresInDays} jour{expiresInDays > 1 ? "s" : ""}{" "}
                  (rafraîchissement automatique).
                </p>
              )}
            </div>
          </div>

          {needsReconnect && (
            <div className="flex items-start gap-2 text-sm border-3 border-lf-yellow bg-lf-yellow/20 px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="font-medium">
                Reconnexion bientôt nécessaire (
                {refreshExpiresInDays !== null && refreshExpiresInDays > 0
                  ? `dans ${refreshExpiresInDays} jour${refreshExpiresInDays > 1 ? "s" : ""}`
                  : "expiré"}
                ). Cliquez sur Reconnecter pour renouveler votre accès.
              </span>
            </div>
          )}

          {state.lastError && (
            <div className="flex items-start gap-2 text-sm border-3 border-red-400 bg-red-50 text-red-700 px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="font-medium break-words">Dernière erreur : {state.lastError}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleConnect}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-bold text-xs uppercase hover:bg-lf-yellow"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Reconnecter
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-bold text-xs uppercase hover:bg-red-50 hover:border-red-500 hover:text-red-600 disabled:opacity-50"
            >
              {disconnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Déconnecter
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
