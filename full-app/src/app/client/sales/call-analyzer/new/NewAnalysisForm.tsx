"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { Loader2, FileText, AlertCircle, Link2, Settings as SettingsIcon } from "lucide-react";

// Liste statique alignée sur providers/index.ts (côté serveur).
const PROVIDER_INFOS = [
  {
    id: "fathom",
    label: "Fathom",
    sourceType: "fathom_url",
    meetingUrlPlaceholder: "https://fathom.video/share/abc123…",
  },
  {
    id: "fireflies",
    label: "Fireflies.ai",
    sourceType: "fireflies_url",
    meetingUrlPlaceholder: "https://app.fireflies.ai/view/AbCdEf123 ou ID brut",
  },
  {
    id: "granola",
    label: "Granola",
    sourceType: "granola_url",
    meetingUrlPlaceholder: "https://granola.ai/notes/not_xyz123 ou ID brut",
  },
  {
    id: "tldv",
    label: "tl;dv",
    sourceType: "tldv_url",
    meetingUrlPlaceholder: "https://tldv.io/app/meetings/<id> ou ID brut",
  },
] as const;

type ProviderId = (typeof PROVIDER_INFOS)[number]["id"];
type SourceType =
  | (typeof PROVIDER_INFOS)[number]["sourceType"]
  | "paste";

interface Props {
  /** Map providerId → keyPreview pour les providers connectés. */
  connectedProviders: Record<string, string>;
}

export function NewAnalysisForm({ connectedProviders }: Props) {
  const router = useRouter();
  const connectedList = PROVIDER_INFOS.filter((p) => p.id in connectedProviders);
  const hasAnyKey = connectedList.length > 0;

  const initialMode: SourceType = hasAnyKey ? connectedList[0].sourceType : "paste";
  const [mode, setMode] = useState<SourceType>(initialMode);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [prospectCompany, setProspectCompany] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => PROVIDER_INFOS.find((p) => p.sourceType === mode) ?? null,
    [mode]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/client/sales/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: mode,
          meetingUrl: mode !== "paste" ? meetingUrl.trim() : undefined,
          transcript: mode === "paste" ? transcript.trim() : undefined,
          meetingTitle: meetingTitle.trim() || undefined,
          prospectCompany: prospectCompany.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        setSubmitting(false);
        return;
      }
      if (data.id) {
        router.push(`/client/sales/call-analyzer/${data.id}`);
        return;
      }
      setSubmitting(false);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting &&
    ((mode !== "paste" && meetingUrl.trim().length > 5) ||
      (mode === "paste" && transcript.trim().length > 200));

  return (
    <form onSubmit={handleSubmit} className="card-brutal p-6 space-y-6">
      {/* Mode switcher */}
      <div>
        <p className="label-brutal">Source du transcript</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PROVIDER_INFOS.map((p) => {
            const isConnected = p.id in connectedProviders;
            const isActive = mode === p.sourceType;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setMode(p.sourceType)}
                disabled={!isConnected}
                className={clsx(
                  "border-3 border-black p-3 text-left transition-all flex flex-col gap-1",
                  isActive
                    ? "bg-lf-blue text-white shadow-brutal-sm"
                    : "bg-white hover:bg-gray-50",
                  !isConnected && "opacity-40 cursor-not-allowed"
                )}
                title={isConnected ? undefined : `Branche ta clé ${p.label} dans les paramètres`}
              >
                <Link2 className="w-4 h-4" />
                <div className="font-black uppercase text-xs">{p.label}</div>
                <div className={clsx("text-[10px]", isActive ? "text-white/80" : "text-lf-gray")}>
                  {isConnected ? `…${connectedProviders[p.id]}` : "Non connecté"}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={clsx(
              "border-3 border-black p-3 text-left transition-all flex flex-col gap-1",
              mode === "paste" ? "bg-lf-yellow text-black shadow-brutal-sm" : "bg-white hover:bg-gray-50"
            )}
          >
            <FileText className="w-4 h-4" />
            <div className="font-black uppercase text-xs">Paste</div>
            <div className={clsx("text-[10px]", mode === "paste" ? "text-black/70" : "text-lf-gray")}>
              Transcript brut
            </div>
          </button>
        </div>
        {!hasAnyKey && (
          <div className="border-3 border-black bg-lf-yellow/40 p-3 text-sm font-medium mt-3 inline-flex items-center gap-2">
            <SettingsIcon className="w-4 h-4" />
            Aucun notetaker branché —{" "}
            <Link href="/client/settings?tab=integrations" className="underline font-black">
              brancher Fathom / Fireflies / Granola / tl;dv
            </Link>
          </div>
        )}
      </div>

      {/* Input selon mode */}
      {mode === "paste" ? (
        <div>
          <label className="label-brutal">Transcript du call</label>
          <textarea
            className="textarea-brutal h-64"
            placeholder="Colle ici le transcript brut (200 caractères minimum)..."
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={submitting}
          />
          <p className="hint-brutal">
            {transcript.length.toLocaleString()} caractères · minimum 200.
          </p>
        </div>
      ) : (
        <div>
          <label className="label-brutal">URL ou ID du meeting {selectedProvider?.label}</label>
          <input
            type="text"
            className="input-brutal"
            placeholder={selectedProvider?.meetingUrlPlaceholder ?? ""}
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            disabled={submitting}
          />
          <p className="hint-brutal">
            Le meeting doit être accessible avec la clé API branchée pour {selectedProvider?.label}.
          </p>
        </div>
      )}

      {/* Meta optionnelle */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label-brutal">Société du prospect (optionnel)</label>
          <input
            type="text"
            className="input-brutal"
            placeholder="Ex: Acme Conseil"
            value={prospectCompany}
            onChange={(e) => setProspectCompany(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <label className="label-brutal">Titre du meeting (optionnel)</label>
          <input
            type="text"
            className="input-brutal"
            placeholder="Ex: Découverte Acme"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      {error && (
        <div className="border-3 border-black bg-lf-pink p-3 text-sm font-medium flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className={clsx(canSubmit ? "btn-primary" : "btn-disabled", "w-full inline-flex items-center justify-center gap-2")}
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Analyse en cours… (30-90 s)
          </>
        ) : (
          "Lancer l'analyse"
        )}
      </button>
    </form>
  );
}
