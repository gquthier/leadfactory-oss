"use client";

import { useEffect, useState } from "react";
import {
  Webhook,
  Sparkles,
  Loader2,
  Copy,
  Check,
  Download,
  ExternalLink,
  AlertTriangle,
  KeyRound,
  RefreshCw,
} from "lucide-react";

interface KeyInfo {
  id: string;
  label: string;
  key_prefix: string;
  provider: string;
  last_used_at: string | null;
  created_at: string;
}

interface ProvisionedReveal {
  full_key: string;
  webhook_url: string;
  blueprint: unknown;
}

interface Props {
  clientId: string;
  clientLabel: string;
  /** If you already have the keys list from the server, pass it to skip the initial fetch. */
  initialKeys?: KeyInfo[];
}

export function WebhookProvisionCard({ clientId, clientLabel, initialKeys }: Props) {
  const [keys, setKeys] = useState<KeyInfo[] | null>(initialKeys ?? null);
  const [loading, setLoading] = useState(initialKeys === undefined);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<ProvisionedReveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/webhook`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { keys?: KeyInfo[] };
        setKeys(data.keys ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialKeys === undefined) void loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function provision() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Make · Meta Lead Ads", provider: "make" }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ProvisionedReveal> & {
        error?: string;
        key?: KeyInfo;
      };
      if (!res.ok || !data.full_key || !data.webhook_url || !data.blueprint) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setReveal({
        full_key: data.full_key,
        webhook_url: data.webhook_url,
        blueprint: data.blueprint,
      });
      if (data.key) {
        setKeys((prev) => [data.key!, ...(prev ?? [])]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, slot: string) {
    navigator.clipboard.writeText(text);
    setCopied(slot);
    setTimeout(() => setCopied(null), 1500);
  }

  function downloadBlueprint() {
    if (!reveal) return;
    const slug = clientLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "client";
    const filename = `leadfactory-meta-${slug}.json`;
    const blob = new Blob([JSON.stringify(reveal.blueprint, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeKeys = keys ?? [];

  return (
    <div className="border-3 border-black bg-white shadow-brutal p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-lf-yellow border-3 border-black flex items-center justify-center flex-shrink-0">
            <Webhook className="w-5 h-5 text-black" />
          </div>
          <div>
            <h3 className="text-base font-black uppercase tracking-tight">
              Webhook · Make.com
            </h3>
            <p className="text-xs text-lf-gray font-medium">
              Provisionne en 1 clic l&apos;intégration Meta Lead Ads → CRM client.
            </p>
          </div>
        </div>
        <button
          onClick={() => void loadKeys()}
          disabled={loading}
          className="w-8 h-8 border-2 border-black bg-white hover:bg-lf-yellow flex items-center justify-center disabled:opacity-50"
          title="Rafraîchir"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </header>

      {/* Existing keys list */}
      <div className="mb-4">
        <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-2">
          Clés actives ({activeKeys.length})
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-lf-gray">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…
          </div>
        ) : activeKeys.length === 0 ? (
          <p className="text-xs text-lf-gray italic">Aucune clé webhook pour ce client.</p>
        ) : (
          <div className="space-y-1">
            {activeKeys.slice(0, 5).map((k) => (
              <div
                key={k.id}
                className="text-[11px] font-medium flex items-center gap-2 border border-black/20 bg-canvas px-2 py-1"
              >
                <KeyRound className="w-3 h-3 text-lf-gray flex-shrink-0" />
                <code className="text-[10px]">{k.key_prefix}…</code>
                <span className="text-lf-gray">·</span>
                <span className="flex-1 truncate">{k.label}</span>
                <span className="text-[10px] text-lf-gray uppercase">{k.provider}</span>
              </div>
            ))}
            {activeKeys.length > 5 && (
              <p className="text-[10px] text-lf-gray italic mt-1">
                +{activeKeys.length - 5} autres
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="border-3 border-red-400 bg-red-50 text-red-700 px-3 py-2 mb-3 flex items-start gap-2 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <button
        onClick={provision}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border-3 border-black bg-lf-black text-white hover:bg-lf-blue hover:shadow-[4px_4px_0_#000] font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
        Provisionner une nouvelle clé Make
      </button>

      {reveal && (
        <RevealModal
          reveal={reveal}
          onClose={() => setReveal(null)}
          onCopy={copy}
          copiedSlot={copied}
          onDownload={downloadBlueprint}
        />
      )}
    </div>
  );
}

function RevealModal({
  reveal,
  onClose,
  onCopy,
  copiedSlot,
  onDownload,
}: {
  reveal: ProvisionedReveal;
  onClose: () => void;
  onCopy: (text: string, slot: string) => void;
  copiedSlot: string | null;
  onDownload: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-3 border-black shadow-brutal max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b-3 border-black bg-lf-yellow">
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5" />
            <h2 className="text-lg font-black uppercase tracking-tight">
              Webhook provisionné
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 border-2 border-black hover:bg-white"
            aria-label="Fermer"
          >
            <span className="font-black px-1">×</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="border-3 border-red-400 bg-red-50 p-3 text-sm">
            <p className="font-black uppercase text-xs mb-1 text-red-700">
              ⚠ À sauvegarder maintenant
            </p>
            <p className="text-red-700">
              La clé complète n&apos;est affichée qu&apos;une seule fois. Téléchargez
              le blueprint maintenant, ou copiez la clé pour la stocker en sécurité.
            </p>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">
              URL webhook (contient la clé)
            </p>
            <div className="flex gap-2 items-stretch">
              <code className="flex-1 border-2 border-black bg-canvas px-3 py-2 text-xs font-mono break-all">
                {reveal.webhook_url}
              </code>
              <button
                onClick={() => onCopy(reveal.webhook_url, "url")}
                className="px-3 py-2 border-2 border-black bg-white hover:bg-lf-yellow font-bold text-xs uppercase flex items-center gap-1"
              >
                {copiedSlot === "url" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedSlot === "url" ? "Copié" : "Copier"}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">
              Clé complète (token brut)
            </p>
            <div className="flex gap-2 items-stretch">
              <code className="flex-1 border-2 border-black bg-canvas px-3 py-2 text-xs font-mono break-all">
                {reveal.full_key}
              </code>
              <button
                onClick={() => onCopy(reveal.full_key, "key")}
                className="px-3 py-2 border-2 border-black bg-white hover:bg-lf-yellow font-bold text-xs uppercase flex items-center gap-1"
              >
                {copiedSlot === "key" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedSlot === "key" ? "Copié" : "Copier"}
              </button>
            </div>
          </div>

          <div className="border-3 border-black bg-canvas p-4">
            <p className="text-xs font-black uppercase tracking-wider mb-2">
              Template Make.com — Meta Lead Ads → LeadFactory
            </p>
            <p className="text-xs text-lf-gray mb-3 leading-relaxed">
              Téléchargez le JSON, puis dans Make.com : <strong>Create a new scenario</strong>{" "}
              → menu <strong>···</strong> → <strong>Import Blueprint</strong> → sélectionnez ce
              fichier. Connectez ensuite le compte Facebook du client, choisissez la Page et le
              formulaire, puis activez. L&apos;URL webhook est déjà pré-remplie.
            </p>
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-2 px-3 py-2 border-3 border-black bg-lf-blue text-white hover:shadow-[3px_3px_0_#000] font-black text-xs uppercase tracking-wider transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Télécharger le blueprint
            </button>
          </div>

          <div className="text-xs text-lf-gray space-y-1">
            <p className="font-bold">Aussi utilisable avec :</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>n8n — node HTTP Request en POST avec body JSON</li>
              <li>Zapier — Webhooks by Zapier · POST</li>
              <li>Pipedream — http.request POST</li>
              <li>Toute intégration capable d&apos;envoyer un POST JSON</li>
            </ul>
          </div>
        </div>

        <footer className="border-t-3 border-black p-4 flex gap-2 bg-canvas">
          <a
            href="https://www.make.com/en/scenarios/create"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Ouvrir Make.com
          </a>
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 border-3 border-black bg-lf-black text-white hover:bg-lf-blue font-black uppercase text-xs tracking-wider"
          >
            J&apos;ai sauvegardé
          </button>
        </footer>
      </div>
    </div>
  );
}
