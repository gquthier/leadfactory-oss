"use client";

import { useState } from "react";
import {
  X,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  Calendar,
  FormInput,
  Zap,
  Workflow,
  Globe,
} from "lucide-react";

interface ApiKey {
  id: string;
  label: string;
  key_prefix: string;
  provider: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface Props {
  onClose: () => void;
  onCreated: (key: ApiKey) => void;
}

const PROVIDERS = [
  { key: "calcom", label: "Cal.com", icon: Calendar, hint: "Bookings, reschedules" },
  { key: "typeform", label: "Typeform", icon: FormInput, hint: "Form responses" },
  { key: "zapier", label: "Zapier", icon: Zap, hint: "Catch hook" },
  { key: "n8n", label: "n8n", icon: Workflow, hint: "HTTP request" },
  { key: "make", label: "Make", icon: Workflow, hint: "Webhook" },
  { key: "generic", label: "Webhook générique", icon: Globe, hint: "Tout outil custom" },
];

export function CreateKeyModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<"form" | "display">("form");
  const [provider, setProvider] = useState("calcom");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullKey, setFullKey] = useState<string | null>(null);
  const [keyData, setKeyData] = useState<ApiKey | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Donne un nom à ta clé (ex: 'Cal.com prod')");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/client/integrations/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed, provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la création");
        return;
      }
      setFullKey(data.full_key);
      setKeyData(data.key);
      onCreated(data.key);
      setStep("display");
    } catch {
      setError("Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  };

  // Pour les URL webhook montrées au client, on utilise TOUJOURS le domaine
  // public de prod (example.invalid), même en dev — le client va coller
  // cette URL dans Cal.com / Typeform qui ne peuvent pas appeler localhost.
  // Override possible via NEXT_PUBLIC_APP_URL si on déploie sur un autre domaine.
  const publicAppUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://example.invalid";
  const webhookUrl = fullKey
    ? `${publicAppUrl}/api/integrations/webhook/${fullKey}`
    : "";

  const copy = async (text: string, type: "key" | "url") => {
    await navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-canvas border-3 border-black shadow-[8px_8px_0_#000] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-3 border-black bg-lf-black text-white">
          <h2 className="font-black uppercase tracking-wider text-sm">
            {step === "form" ? "Nouvelle clé d'intégration" : "Clé créée ✓"}
          </h2>
          <button onClick={onClose} className="hover:text-lf-yellow">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === "form" && (
          <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-2">
                Outil de destination
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((p) => {
                  const Icon = p.icon;
                  const active = p.key === provider;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setProvider(p.key)}
                      className={`flex items-center gap-2 px-3 py-2.5 border-3 text-left transition-all ${
                        active
                          ? "border-black bg-lf-yellow shadow-[3px_3px_0_#000]"
                          : "border-black bg-white hover:bg-lf-yellow/30"
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-black text-xs uppercase truncate">{p.label}</p>
                        <p className="text-[10px] text-lf-gray font-medium truncate">{p.hint}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-2">
                Nom de la clé
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder='ex: "Cal.com prod", "Formulaire site"'
                maxLength={80}
                className="w-full px-3 py-2.5 border-3 border-black bg-white font-medium text-sm focus:outline-none focus:border-lf-blue"
                autoFocus
              />
              <p className="text-[10px] text-lf-gray font-medium mt-1">
                Pour t'aider à identifier cette clé dans la liste
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 border-3 border-red-500 bg-red-50 text-red-800 text-xs font-bold">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <div className="flex items-center gap-2 justify-end pt-2 border-t-2 border-black">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-black uppercase bg-white border-3 border-black hover:bg-gray-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !label.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase bg-lf-black text-white border-3 border-black hover:bg-lf-blue disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Générer la clé
              </button>
            </div>
          </form>
        )}

        {step === "display" && fullKey && keyData && (
          <div className="p-5 flex flex-col gap-4">
            {/* Warning one-time display */}
            <div className="flex items-start gap-2 p-3 border-3 border-lf-yellow bg-lf-yellow/30">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-black" />
              <p className="text-xs font-bold leading-snug">
                Cette clé ne sera <span className="uppercase font-black">plus jamais</span>{" "}
                affichée. Copie-la maintenant dans ton outil — tu pourras toujours
                en regénérer une si tu la perds.
              </p>
            </div>

            {/* Full key */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1.5">
                API Key
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fullKey}
                  readOnly
                  className="flex-1 px-3 py-2.5 border-3 border-black bg-white font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={() => copy(fullKey, "key")}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-black uppercase bg-lf-yellow border-3 border-black hover:bg-white"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey ? "Copié" : "Copier"}
                </button>
              </div>
            </div>

            {/* Webhook URL — ce que le client met dans son outil */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wider mb-1.5">
                URL Webhook (à coller dans ton outil)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="flex-1 px-3 py-2.5 border-3 border-black bg-white font-mono text-[11px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={() => copy(webhookUrl, "url")}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-black uppercase bg-lf-yellow border-3 border-black hover:bg-white"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUrl ? "Copié" : "Copier"}
                </button>
              </div>
              <ProviderHint provider={keyData.provider} />
            </div>

            <div className="flex items-center justify-end pt-3 border-t-2 border-black">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-black uppercase bg-lf-black text-white border-3 border-black hover:bg-lf-blue"
              >
                Terminer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderHint({ provider }: { provider: string }) {
  const HINTS: Record<string, string> = {
    calcom:
      "Cal.com → Settings → Developer → Webhooks → Add Webhook → colle l'URL → coche BOOKING_CREATED",
    typeform:
      "Typeform → Connect → Webhooks → Add a webhook → colle l'URL → activate",
    zapier: "Zapier → New Zap → Webhooks by Zapier → POST → colle l'URL en URL cible",
    n8n: "n8n → HTTP Request node → Method POST → URL = colle l'URL ci-dessus",
    make: "Make → Webhook module → custom webhook → colle l'URL",
    generic:
      "Envoie un POST JSON à cette URL. Champs auto-détectés : email, full_name, phone, company.",
    custom:
      "Envoie un POST JSON à cette URL. Champs auto-détectés : email, full_name, phone, company.",
  };
  const hint = HINTS[provider];
  if (!hint) return null;
  return (
    <p className="text-[10px] text-lf-gray font-medium mt-2 leading-snug">
      💡 <span className="font-bold">Comment configurer :</span> {hint}
    </p>
  );
}
