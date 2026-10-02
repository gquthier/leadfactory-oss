"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  Calendar,
  FormInput,
  Zap,
  Workflow,
  Globe,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  Loader2,
  Facebook,
} from "lucide-react";
import { CreateKeyModal } from "./CreateKeyModal";
import { NotetakerKeysSection } from "./NotetakerKeysSection";
import { LinkedInConnectionSection } from "./LinkedInConnectionSection";
import { MetaConnectionSection } from "./MetaConnectionSection";

interface ApiKey {
  id: string;
  label: string;
  key_prefix: string;
  provider: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface WebhookLog {
  id: string;
  api_key_id: string | null;
  provider: string | null;
  external_id: string | null;
  status: "accepted" | "duplicate" | "rejected" | "error";
  http_status: number;
  error: string | null;
  lead_id: string | null;
  ip: string | null;
  created_at: string;
}

const PROVIDER_INFO: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  meta: { label: "Meta Lead Ads", icon: Facebook, color: "bg-blue-100 text-blue-800" },
  calcom: { label: "Cal.com", icon: Calendar, color: "bg-purple-100 text-purple-800" },
  typeform: { label: "Typeform", icon: FormInput, color: "bg-blue-100 text-blue-800" },
  zapier: { label: "Zapier", icon: Zap, color: "bg-orange-100 text-orange-800" },
  n8n: { label: "n8n", icon: Workflow, color: "bg-pink-100 text-pink-800" },
  make: { label: "Make", icon: Workflow, color: "bg-indigo-100 text-indigo-800" },
  generic: { label: "Webhook générique", icon: Globe, color: "bg-gray-100 text-gray-800" },
  custom: { label: "Custom", icon: Globe, color: "bg-gray-100 text-gray-800" },
};

const STATUS_INFO: Record<
  WebhookLog["status"],
  { label: string; icon: React.ComponentType<{ className?: string }>; bg: string }
> = {
  accepted: { label: "Accepté", icon: CheckCircle2, bg: "bg-lf-green text-white" },
  duplicate: { label: "Doublon", icon: AlertCircle, bg: "bg-lf-yellow text-black" },
  rejected: { label: "Rejeté", icon: XCircle, bg: "bg-red-500 text-white" },
  error: { label: "Erreur", icon: XCircle, bg: "bg-red-700 text-white" },
};

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function IntegrationsPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const [keysRes, logsRes] = await Promise.all([
        fetch("/api/client/integrations/keys"),
        fetch("/api/client/integrations/logs?limit=50"),
      ]);
      if (keysRes.ok) {
        const data = await keysRes.json();
        setKeys(data.keys ?? []);
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs ?? []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRevoke = async (id: string, label: string) => {
    if (!confirm(`Révoquer la clé "${label}" ? Les webhooks utilisant cette clé seront immédiatement bloqués.`)) {
      return;
    }
    const res = await fetch(`/api/client/integrations/keys/${id}`, { method: "DELETE" });
    if (res.ok) {
      setKeys((prev) =>
        prev.map((k) =>
          k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k
        )
      );
    } else {
      alert("Erreur lors de la révocation. Réessaie.");
    }
  };

  const handleCreated = (newKey: ApiKey) => {
    setKeys((prev) => [newKey, ...prev]);
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-lf-blue" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Meta Lead Ads — self-service OAuth (voie B). Gated : ClawdBot doit être en
          mode Live + OAuth testé avant d'exposer le bouton aux clients (sinon erreur OAuth
          pour un non-rôle en mode dev). Le webhook (voie A) fonctionne indépendamment. ── */}
      {process.env.NEXT_PUBLIC_META_OAUTH_ENABLED === "true" && <MetaConnectionSection />}

      {/* ── LinkedIn connection (Personal Brand IA / Surprises scheduler) ── */}
      <LinkedInConnectionSection />

      {/* ── AI Notetakers (clés sortantes pour Sales Call Analyzer) ────── */}
      <NotetakerKeysSection />

      {/* ── Intro webhooks entrants ──────────────────────────────────── */}
      <div className="card-brutal p-5">
        <h2 className="text-lg font-black uppercase tracking-tight mb-2">
          Pousse tes leads depuis n'importe où
        </h2>
        <p className="text-sm text-lf-gray font-medium leading-relaxed">
          Connecte Cal.com, Typeform, Zapier, n8n ou n'importe quel outil qui envoie
          des webhooks. Chaque lead arrive automatiquement dans ton CRM, prêt à être
          traité. <span className="font-black text-black">Une URL = une clé.</span>
        </p>
      </div>

      {/* ── API Keys ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider">
              Clés d'intégration ({activeKeys.length} active{activeKeys.length > 1 ? "s" : ""})
            </h3>
            <p className="text-xs text-lf-gray font-medium mt-0.5">
              Chaque clé génère une URL webhook unique
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase bg-lf-black text-white border-3 border-black hover:bg-lf-blue transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nouvelle clé
          </button>
        </div>

        {activeKeys.length === 0 && revokedKeys.length === 0 ? (
          <div className="border-3 border-dashed border-black p-8 text-center">
            <Plus className="w-8 h-8 mx-auto mb-2 text-lf-gray" />
            <p className="text-sm font-bold mb-1">Aucune clé créée pour l'instant</p>
            <p className="text-xs text-lf-gray font-medium">
              Crée ta 1re clé pour connecter un outil
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeKeys.map((k) => (
              <KeyRow key={k.id} keyData={k} onRevoke={handleRevoke} />
            ))}
            {revokedKeys.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs font-black uppercase tracking-wider text-lf-gray cursor-pointer hover:text-black">
                  Clés révoquées ({revokedKeys.length})
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  {revokedKeys.map((k) => (
                    <KeyRow key={k.id} keyData={k} onRevoke={handleRevoke} />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ── Webhook Logs ──────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider">
              Logs webhooks ({logs.length})
            </h3>
            <p className="text-xs text-lf-gray font-medium mt-0.5">
              50 derniers events reçus
            </p>
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase bg-white border-3 border-black hover:bg-lf-yellow disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="border-3 border-dashed border-black p-8 text-center">
            <Clock className="w-8 h-8 mx-auto mb-2 text-lf-gray" />
            <p className="text-sm font-bold mb-1">Aucun webhook reçu</p>
            <p className="text-xs text-lf-gray font-medium">
              Les events apparaîtront ici dès que ton outil enverra des données
            </p>
          </div>
        ) : (
          <div className="border-3 border-black bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-canvas border-b-3 border-black">
                  <tr className="text-left text-[10px] font-black uppercase tracking-wider">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2 text-right">HTTP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const provInfo = log.provider
                      ? PROVIDER_INFO[log.provider] ?? PROVIDER_INFO.generic
                      : PROVIDER_INFO.generic;
                    const statusInfo = STATUS_INFO[log.status];
                    const StatusIcon = statusInfo.icon;
                    const ProvIcon = provInfo.icon;
                    return (
                      <tr key={log.id} className="border-b-2 border-black/10 last:border-b-0 hover:bg-canvas/40">
                        <td className="px-3 py-2.5 text-xs font-medium text-lf-gray whitespace-nowrap">
                          {formatRelativeDate(log.created_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs font-bold">
                            <ProvIcon className="w-3 h-3" />
                            {provInfo.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 border-2 border-black ${statusInfo.bg}`}
                          >
                            <StatusIcon className="w-3 h-3" />
                            {statusInfo.label}
                          </span>
                          {log.error && (
                            <p className="text-[10px] text-red-600 mt-0.5 font-medium truncate max-w-xs">
                              {log.error}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {log.lead_id ? (
                            <a
                              href={`/client/leads`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-lf-blue hover:underline"
                            >
                              Voir le lead
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-lf-gray">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-xs font-mono font-bold">
                            {log.http_status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {showCreate && (
        <CreateKeyModal
          onClose={() => setShowCreate(false)}
          onCreated={(k) => {
            handleCreated(k);
          }}
        />
      )}
    </div>
  );
}

// ─── Key row ────────────────────────────────────────────────────────────────

function KeyRow({
  keyData,
  onRevoke,
}: {
  keyData: ApiKey;
  onRevoke: (id: string, label: string) => void;
}) {
  const isRevoked = !!keyData.revoked_at;
  const provInfo = PROVIDER_INFO[keyData.provider] ?? PROVIDER_INFO.generic;
  const ProvIcon = provInfo.icon;

  return (
    <div
      className={`border-3 border-black p-3 flex items-center gap-3 ${
        isRevoked ? "opacity-50 bg-gray-50" : "bg-white"
      }`}
    >
      <div className="w-10 h-10 bg-lf-yellow border-2 border-black flex items-center justify-center flex-shrink-0">
        <ProvIcon className="w-5 h-5 text-black" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-black text-sm truncate">{keyData.label}</p>
          <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-canvas border-2 border-black">
            {provInfo.label}
          </span>
          {isRevoked && (
            <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-red-100 text-red-800 border-2 border-red-300">
              Révoquée
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-lf-gray font-medium">
          <code className="font-mono">{keyData.key_prefix}...</code>
          {keyData.last_used_at ? (
            <span>Utilisée {formatRelativeDate(keyData.last_used_at)}</span>
          ) : (
            <span>Jamais utilisée</span>
          )}
          <span>Créée {formatRelativeDate(keyData.created_at)}</span>
        </div>
      </div>
      {!isRevoked && (
        <button
          onClick={() => onRevoke(keyData.id, keyData.label)}
          className="p-2 text-red-500 hover:bg-red-50 border-2 border-transparent hover:border-red-500 transition-all"
          title="Révoquer cette clé"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
