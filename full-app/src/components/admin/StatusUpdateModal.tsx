"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Link2,
  FileText,
  File,
  ArrowRight,
  Mail,
} from "lucide-react";
import { getCampaignStatusLabel, getCampaignStatusColor } from "@/types/index";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Deliverable {
  type: "link" | "text" | "pdf";
  label: string;
  url?: string;
  content?: string;
}

interface StatusUpdateModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: {
    sendEmail: boolean;
    customMessage: string;
    deliverables: Deliverable[];
  }) => void;
  onCancel: () => void;
  campaignName: string;
  clientName: string;
  clientEmail: string;
  newStatus: string;
  oldStatus: string;
  loading?: boolean;
}

// ─── Deliverable type icon helper ────────────────────────────────────────────

function DeliverableIcon({ type }: { type: Deliverable["type"] }) {
  if (type === "link") return <Link2 className="w-3.5 h-3.5" />;
  if (type === "pdf") return <File className="w-3.5 h-3.5" />;
  return <FileText className="w-3.5 h-3.5" />;
}

// ─── Inline status badge (reusable) ──────────────────────────────────────────

function StatusBadge({ status, size = "sm" }: { status: string; size?: "xs" | "sm" }) {
  const color = getCampaignStatusColor(status);
  const label = getCampaignStatusLabel(status);
  const px = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs";
  return (
    <span className={`font-black border-2 border-black uppercase tracking-wide ${px} ${color}`}>
      {label}
    </span>
  );
}

// ─── Email Preview ────────────────────────────────────────────────────────────

function EmailPreview({
  clientName,
  campaignName,
  newStatus,
  customMessage,
  deliverables,
}: {
  clientName: string;
  campaignName: string;
  newStatus: string;
  customMessage: string;
  deliverables: Deliverable[];
}) {
  return (
    <div className="bg-white border-2 border-gray-200 rounded text-sm overflow-hidden">
      {/* Email header bar */}
      <div className="bg-lf-blue px-4 py-3 flex items-center justify-between">
        <span className="font-black text-white text-xs uppercase tracking-widest">
          LeadFactory
        </span>
        <Mail className="w-4 h-4 text-white/70" />
      </div>

      {/* Email body */}
      <div className="p-4 space-y-3">
        {/* Greeting */}
        <p className="text-gray-700 font-medium text-xs">
          Bonjour{" "}
          <span className="font-black text-black">
            {clientName || "Client"}
          </span>
          ,
        </p>

        {/* Status update line */}
        <div className="space-y-1">
          <p className="text-gray-500 text-[11px] font-medium">
            Votre campagne
          </p>
          <p className="font-black text-black text-xs uppercase tracking-wide">
            {campaignName || "—"}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-gray-500 font-medium">
              passe au statut :
            </span>
            <StatusBadge status={newStatus} size="xs" />
          </div>
        </div>

        {/* Custom message */}
        {customMessage.trim() && (
          <div className="border-l-2 border-lf-blue pl-3 py-1">
            <p className="text-gray-700 text-[11px] font-medium whitespace-pre-wrap leading-relaxed">
              {customMessage}
            </p>
          </div>
        )}

        {/* Deliverables */}
        {deliverables.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">
              Livrables
            </p>
            <div className="space-y-1">
              {deliverables.map((d, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 bg-gray-50 border border-gray-200 rounded px-2 py-1.5"
                >
                  <span className="text-lf-blue mt-0.5">
                    <DeliverableIcon type={d.type} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-[11px] text-black truncate">
                      {d.label || "Sans titre"}
                    </p>
                    {d.type === "link" && d.url && (
                      <p className="text-[10px] text-lf-blue truncate">{d.url}</p>
                    )}
                    {d.type === "text" && d.content && (
                      <p className="text-[10px] text-gray-500 truncate">{d.content}</p>
                    )}
                    {d.type === "pdf" && d.url && (
                      <p className="text-[10px] text-lf-blue truncate">{d.url}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="pt-1">
          <span className="inline-block bg-lf-blue text-white text-[10px] font-black uppercase tracking-wider px-3 py-1.5 border-2 border-black">
            Voir ma campagne
          </span>
        </div>

        {/* Footer */}
        <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2">
          Cet email a été envoyé par LeadFactory · {clientName || "Client"} &lt;{" "}
          <span className="text-gray-500">contact@example.com</span>
          {" "}&gt;
        </p>
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function StatusUpdateModal({
  open,
  onClose,
  onConfirm,
  onCancel,
  campaignName,
  clientName,
  clientEmail,
  newStatus,
  oldStatus,
  loading = false,
}: StatusUpdateModalProps) {
  const [customMessage, setCustomMessage] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  if (!open) return null;

  // ── Deliverable helpers ──────────────────────────────────────────────────

  const addDeliverable = () => {
    setDeliverables((prev) => [
      ...prev,
      { type: "link", label: "", url: "" },
    ]);
  };

  const removeDeliverable = (index: number) => {
    setDeliverables((prev) => prev.filter((_, i) => i !== index));
  };

  const updateDeliverable = (index: number, patch: Partial<Deliverable>) => {
    setDeliverables((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  };

  const handleTypeChange = (index: number, type: Deliverable["type"]) => {
    updateDeliverable(index, { type, url: "", content: "" });
  };

  // ── Submit helpers ───────────────────────────────────────────────────────

  const handleConfirm = (sendEmail: boolean) => {
    onConfirm({ sendEmail, customMessage, deliverables });
  };

  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="card-brutal bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b-3 border-black bg-lf-blue text-white sticky top-0 z-10">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="font-black uppercase tracking-wider text-sm whitespace-nowrap">
              Mise à jour du statut
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <StatusBadge status={oldStatus} />
              <ArrowRight className="w-3.5 h-3.5 opacity-70 shrink-0" />
              <StatusBadge status={newStatus} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 ml-3 hover:opacity-70 transition-opacity"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Email preview ────────────────────────────────────────── */}
          <div>
            <p className="label-brutal mb-3">
              Aperçu de l&apos;email
            </p>
            <EmailPreview
              clientName={clientName}
              campaignName={campaignName}
              newStatus={newStatus}
              customMessage={customMessage}
              deliverables={deliverables}
            />
            <p className="hint-brutal mt-2">
              Envoi vers{" "}
              <span className="font-black text-black">{clientEmail}</span>
            </p>
          </div>

          {/* ── Custom message ───────────────────────────────────────── */}
          <div>
            <label className="label-brutal" htmlFor="custom-message">
              Message personnalisé{" "}
              <span className="text-gray-400 font-medium normal-case tracking-normal">
                (optionnel)
              </span>
            </label>
            <textarea
              id="custom-message"
              className="textarea-brutal"
              rows={4}
              placeholder="Ajoutez un message à inclure dans l'email du client..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
            />
          </div>

          {/* ── Deliverables ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label-brutal mb-0">
                Livrables{" "}
                <span className="text-gray-400 font-medium normal-case tracking-normal">
                  (optionnel)
                </span>
              </p>
              <button
                type="button"
                onClick={addDeliverable}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-lf-blue hover:text-white hover:shadow-brutal-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter
              </button>
            </div>

            {deliverables.length === 0 && (
              <div className="border-3 border-dashed border-gray-300 px-4 py-6 text-center">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Aucun livrable
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Cliquez sur &ldquo;Ajouter&rdquo; pour joindre un lien, texte ou PDF.
                </p>
              </div>
            )}

            {deliverables.length > 0 && (
              <div className="space-y-3">
                {deliverables.map((d, index) => (
                  <div
                    key={index}
                    className="border-3 border-black bg-gray-50 p-4 space-y-3"
                  >
                    {/* Row: type selector + label + remove */}
                    <div className="flex items-start gap-3">
                      {/* Type selector */}
                      <div className="shrink-0">
                        <p className="text-[10px] font-black uppercase tracking-wider mb-1.5 text-gray-500">
                          Type
                        </p>
                        <div className="flex gap-1">
                          {(["link", "text", "pdf"] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => handleTypeChange(index, t)}
                              className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 border-black transition-all ${
                                d.type === t
                                  ? "bg-lf-black text-white"
                                  : "bg-white hover:bg-gray-100"
                              }`}
                            >
                              {t === "link" && <Link2 className="w-3 h-3" />}
                              {t === "text" && <FileText className="w-3 h-3" />}
                              {t === "pdf" && <File className="w-3 h-3" />}
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Label */}
                      <div className="flex-1 min-w-0">
                        <label
                          className="text-[10px] font-black uppercase tracking-wider mb-1.5 block text-gray-500"
                          htmlFor={`deliverable-label-${index}`}
                        >
                          Titre du livrable
                        </label>
                        <input
                          id={`deliverable-label-${index}`}
                          type="text"
                          className="input-brutal text-sm"
                          placeholder="Ex : Proposition de campagne Meta…"
                          value={d.label}
                          onChange={(e) =>
                            updateDeliverable(index, { label: e.target.value })
                          }
                        />
                      </div>

                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removeDeliverable(index)}
                        className="shrink-0 mt-6 p-1.5 border-2 border-black bg-white hover:bg-red-600 hover:text-white transition-all"
                        aria-label="Supprimer le livrable"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* URL field (link or pdf) */}
                    {(d.type === "link" || d.type === "pdf") && (
                      <div>
                        <label
                          className="text-[10px] font-black uppercase tracking-wider mb-1.5 block text-gray-500"
                          htmlFor={`deliverable-url-${index}`}
                        >
                          {d.type === "pdf" ? "Lien vers le PDF" : "URL"}
                        </label>
                        <input
                          id={`deliverable-url-${index}`}
                          type="url"
                          className="input-brutal text-sm"
                          placeholder={
                            d.type === "pdf"
                              ? "https://… (lien Google Drive, Dropbox, etc.)"
                              : "https://…"
                          }
                          value={d.url ?? ""}
                          onChange={(e) =>
                            updateDeliverable(index, { url: e.target.value })
                          }
                        />
                      </div>
                    )}

                    {/* Text content */}
                    {d.type === "text" && (
                      <div>
                        <label
                          className="text-[10px] font-black uppercase tracking-wider mb-1.5 block text-gray-500"
                          htmlFor={`deliverable-content-${index}`}
                        >
                          Contenu
                        </label>
                        <textarea
                          id={`deliverable-content-${index}`}
                          className="textarea-brutal text-sm"
                          rows={3}
                          placeholder="Saisissez votre texte ici…"
                          value={d.content ?? ""}
                          onChange={(e) =>
                            updateDeliverable(index, { content: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Action buttons ───────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t-3 border-black">
            {/* Cancel the status update entirely */}
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="btn-secondary flex-1 text-sm py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Annuler la mise à jour
            </button>

            {/* Update without notifying */}
            <button
              type="button"
              onClick={() => handleConfirm(false)}
              disabled={loading}
              className="btn-secondary flex-1 text-sm py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
                  En cours…
                </span>
              ) : (
                "Mettre à jour sans notifier"
              )}
            </button>

            {/* Send email + update */}
            <button
              type="button"
              onClick={() => handleConfirm(true)}
              disabled={loading}
              className="btn-blue flex-1 text-sm py-3 px-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  Envoi…
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  Envoyer et mettre à jour
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
