"use client";

import { useEffect, useState, useCallback } from "react";
import { Facebook, CheckCircle2, Loader2, RefreshCw, AlertTriangle, ExternalLink, Trash2, Radio } from "lucide-react";

interface MetaPage {
  pageId: string;
  pageName: string | null;
  instagramAccountId: string | null;
  scopes: string[] | null;
  subscribedLeadgen: boolean;
  connectedAt: string;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
}

interface MetaState {
  connected: boolean;
  pages: MetaPage[];
}

const CALLBACK_STATUS_MAP: Record<string, { type: "success" | "error"; text: string }> = {
  connected: { type: "success", text: "Page Facebook connectée — leads en temps réel activés." },
  connected_no_sub: { type: "error", text: "Page connectée mais l'abonnement leadgen a échoué. Cliquez sur Reconnecter." },
  no_pages: { type: "error", text: "Aucune Page Facebook trouvée sur ce compte." },
  csrf_failed: { type: "error", text: "Échec de sécurité (CSRF). Réessayez." },
  exchange_failed: { type: "error", text: "Échec de l'échange OAuth. Réessayez ou contactez le support." },
  db_error: { type: "error", text: "Erreur DB pendant la sauvegarde. Contactez le support." },
};

export function MetaConnectionSection() {
  const [state, setState] = useState<MetaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meta/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MetaState;
      setState(data);
    } catch (err) {
      console.error("[MetaConnection] status fetch failed", err);
      setState({ connected: false, pages: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("meta");
    if (status) {
      const known = CALLBACK_STATUS_MAP[status];
      if (known) setFlash(known);
      else if (status.startsWith("error_")) setFlash({ type: "error", text: `Meta a renvoyé une erreur : ${status.slice(6)}` });
      url.searchParams.delete("meta");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  function handleConnect() {
    window.location.href = "/api/meta/auth/start";
  }

  async function handleDisconnect(pageId: string, pageName: string | null) {
    if (!confirm(`Déconnecter la page "${pageName ?? pageId}" ? Ses leads Meta cesseront d'arriver automatiquement.`)) return;
    setDisconnecting(pageId);
    try {
      const res = await fetch(`/api/meta/disconnect?pageId=${encodeURIComponent(pageId)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setFlash({ type: "success", text: "Page déconnectée." });
      await refresh();
    } catch (err) {
      setFlash({ type: "error", text: err instanceof Error ? err.message : "Échec de la déconnexion." });
    } finally {
      setDisconnecting(null);
    }
  }

  const pages = state?.pages ?? [];

  return (
    <section className="card-brutal p-5 bg-white">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1877F2] border-3 border-black flex items-center justify-center">
            <Facebook className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">Facebook Lead Ads</h2>
            <p className="text-xs text-lf-gray font-medium">
              Connectez votre Page : vos leads Meta arrivent automatiquement dans le CRM, sans Make.
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
            flash.type === "success" ? "border-lf-green bg-lf-green/10 text-lf-green" : "border-red-400 bg-red-50 text-red-600"
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
            Aucune page connectée. Connectez votre Page Facebook une seule fois : tous vos futurs leads Lead Ads
            tomberont automatiquement dans votre CRM, en temps réel.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1877F2] text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:shadow-[4px_4px_0_#000] transition-all"
          >
            <Facebook className="w-4 h-4" />
            Connecter Facebook
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((p) => (
            <div key={p.pageId} className="flex items-start gap-3 border-3 border-lf-green bg-lf-green/5 p-3">
              <div className="w-10 h-10 bg-[#1877F2] border-2 border-black flex items-center justify-center flex-shrink-0">
                <Facebook className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-lf-green flex-shrink-0" />
                  <span className="font-black text-sm truncate">{p.pageName ?? p.pageId}</span>
                </div>
                <p className="text-xs mt-1 flex items-center gap-1">
                  <Radio className={`w-3 h-3 ${p.subscribedLeadgen ? "text-lf-green" : "text-red-500"}`} />
                  {p.subscribedLeadgen ? (
                    <span className="text-lf-gray">Webhook leadgen actif — leads en temps réel.</span>
                  ) : (
                    <span className="text-red-600 font-bold">Abonnement leadgen inactif — reconnectez.</span>
                  )}
                </p>
                {p.lastError && (
                  <p className="text-[10px] text-red-600 mt-0.5 font-medium break-words">Erreur : {p.lastError}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDisconnect(p.pageId, p.pageName)}
                disabled={disconnecting === p.pageId}
                className="p-2 text-red-500 hover:bg-red-50 border-2 border-transparent hover:border-red-500 transition-all disabled:opacity-50"
                title="Déconnecter cette page"
              >
                {disconnecting === p.pageId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={handleConnect}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-bold text-xs uppercase hover:bg-lf-yellow"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Connecter une autre page / Reconnecter
          </button>
        </div>
      )}
    </section>
  );
}
