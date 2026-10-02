"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  Loader2,
  Trash2,
  Check,
  AlertCircle,
  ExternalLink,
  Plus,
} from "lucide-react";

// Liste statique pour éviter d'importer du code serveur dans un composant client.
const PROVIDERS = [
  {
    id: "fathom",
    label: "Fathom",
    keyPlaceholder: "fathom_xxxxxxxxxxxx",
    keyDocsUrl: "https://fathom.video/api_settings/new",
  },
  {
    id: "fireflies",
    label: "Fireflies.ai",
    keyPlaceholder: "Fireflies API key (Bearer)",
    keyDocsUrl: "https://app.fireflies.ai/settings/developer",
  },
  {
    id: "granola",
    label: "Granola",
    keyPlaceholder: "grn_xxxxxxxxxxxx",
    keyDocsUrl: "https://docs.granola.ai/introduction",
  },
  {
    id: "tldv",
    label: "tl;dv",
    keyPlaceholder: "tl;dv API key",
    keyDocsUrl: "https://tldv.io/app/settings/personal-settings/api-keys",
  },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

interface KeyStatus {
  id: string;
  provider: ProviderId;
  label: string | null;
  key_preview: string;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export function NotetakerKeysSection() {
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [openProvider, setOpenProvider] = useState<ProviderId | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/client/sales/key");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const keyByProvider = new Map<ProviderId, KeyStatus>();
  keys.forEach((k) => keyByProvider.set(k.provider, k));

  return (
    <section className="card-brutal p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-lf-blue text-white border-3 border-black flex items-center justify-center shadow-brutal-xs">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">
              AI Notetakers — Sales Call Analyzer
            </h2>
            <p className="text-xs text-lf-gray font-medium">
              Branche les clés API de tes outils de notetaking pour analyser tes calls
              automatiquement. Clés chiffrées AES-GCM 256.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-lf-blue" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {PROVIDERS.map((p) => {
            const k = keyByProvider.get(p.id);
            const isOpen = openProvider === p.id;
            return (
              <ProviderRow
                key={p.id}
                provider={p}
                existing={k ?? null}
                expanded={isOpen}
                onToggle={() => setOpenProvider(isOpen ? null : p.id)}
                onChanged={load}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

interface RowProps {
  provider: (typeof PROVIDERS)[number];
  existing: KeyStatus | null;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}

function ProviderRow({ provider, existing, expanded, onToggle, onChanged }: RowProps) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/client/sales/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        setSubmitting(false);
        return;
      }
      setSuccess(`Clé enregistrée (…${data.preview})`);
      setApiKey("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!confirm(`Supprimer la clé ${provider.label} de ton compte ?`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/client/sales/key?provider=${provider.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erreur");
        return;
      }
      setSuccess("Clé supprimée");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-3 border-black bg-white">
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
          expanded ? "bg-lf-yellow/30" : "hover:bg-gray-50"
        }`}
      >
        <div
          className={`w-9 h-9 border-2 border-black flex items-center justify-center font-black text-xs uppercase tracking-wider flex-shrink-0 ${
            existing ? "bg-lf-green text-white" : "bg-canvas"
          }`}
        >
          {existing ? <Check className="w-4 h-4" /> : provider.label[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-black text-sm">{provider.label}</p>
            {existing && (
              <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-lf-green text-white border-2 border-black">
                Connectée
              </span>
            )}
          </div>
          <p className="text-[11px] text-lf-gray font-medium">
            {existing ? (
              <>
                <code className="font-mono">…{existing.key_preview}</code>
                {" · "}
                {existing.last_used_at
                  ? `utilisée le ${new Date(existing.last_used_at).toLocaleDateString("fr-FR")}`
                  : "jamais utilisée"}
              </>
            ) : (
              "Pas de clé branchée"
            )}
          </p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
          {expanded ? "Refermer" : existing ? "Modifier" : "Brancher"}
        </span>
      </button>

      {/* Form body (expand) */}
      {expanded && (
        <div className="border-t-3 border-black p-4 bg-canvas">
          {existing?.last_error && (
            <div className="border-3 border-black bg-lf-pink/40 p-2 text-xs font-medium mb-3">
              Dernière erreur API : {existing.last_error.slice(0, 200)}
            </div>
          )}

          <form onSubmit={save} className="flex flex-col gap-3">
            <label className="text-[10px] font-black uppercase tracking-wider">
              {existing ? "Remplacer la clé" : "Coller ta clé"}
            </label>
            <input
              type="password"
              className="input-brutal font-mono"
              placeholder={provider.keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={submitting}
              autoComplete="off"
            />
            <a
              href={provider.keyDocsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-lf-blue hover:underline w-fit"
            >
              <ExternalLink className="w-3 h-3" /> Où trouver ma clé {provider.label} ?
            </a>

            {error && (
              <div className="border-3 border-black bg-lf-pink p-2 text-xs font-medium flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}
            {success && (
              <div className="border-3 border-black bg-lf-green text-white p-2 text-xs font-medium flex items-start gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {success}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={submitting || apiKey.trim().length < 10}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black ${
                  apiKey.trim().length >= 10 && !submitting
                    ? "bg-lf-black text-white hover:bg-lf-blue"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                } transition-colors`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Validation…
                  </>
                ) : existing ? (
                  "Remplacer"
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" /> Enregistrer
                  </>
                )}
              </button>
              {existing && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
