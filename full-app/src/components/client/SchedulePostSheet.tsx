"use client";

import { useEffect, useState } from "react";
import { Calendar, Send, Loader2, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { LinkedInPreviewPane } from "@/components/personal-brand/LinkedInPreviewPane";
import { QuickSlotsPicker } from "@/components/personal-brand/QuickSlotsPicker";

interface Props {
  open: boolean;
  onClose: () => void;
  postBody: string;
  sourceType?: "linkedin_post" | "surprise_asset" | "manual";
  sourceId?: string | null;
  onScheduled?: (postId: string) => void;
  /** ISO string YYYY-MM-DDTHH:mm (local). If omitted, defaults to tomorrow 9am. */
  defaultScheduledAt?: string;
  /** When true, the body becomes editable in a textarea. */
  allowEditBody?: boolean;
  /** LinkedIn profile shown in the preview pane (best-effort). */
  authorName?: string | null;
  authorPicture?: string | null;
}

function defaultScheduledAtIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function SchedulePostSheet({
  open,
  onClose,
  postBody,
  sourceType = "manual",
  sourceId = null,
  onScheduled,
  defaultScheduledAt: defaultIso,
  allowEditBody,
  authorName,
  authorPicture,
}: Props) {
  const isBodyEditable = allowEditBody ?? postBody.trim().length === 0;
  const [bodyDraft, setBodyDraft] = useState(postBody);
  const [scheduledAt, setScheduledAt] = useState(defaultIso ?? defaultScheduledAtIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBodyDraft(postBody);
      setScheduledAt(defaultIso ?? defaultScheduledAtIso());
      setError(null);
      setDone(null);
    }
  }, [open, postBody, defaultIso]);

  async function submit(when: "scheduled" | "now") {
    const body = (isBodyEditable ? bodyDraft : postBody).trim();
    if (body.length === 0) {
      setError("Le contenu du post est vide.");
      return;
    }
    if (body.length > 3000) {
      setError("Post trop long (max 3000 caractères).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const scheduled = when === "now"
        ? new Date().toISOString()
        : new Date(scheduledAt).toISOString();
      const res = await fetch("/api/client/linkedin/scheduled-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId,
          body,
          scheduled_at: scheduled,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        post?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.post) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDone(data.post.id);
      onScheduled?.(data.post.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const effectiveBody = isBodyEditable ? bodyDraft : postBody;
  const charCount = effectiveBody.length;
  const sweet = charCount >= 1200 && charCount <= 1900;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-3 border-black shadow-brutal w-full sm:max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b-3 border-black bg-canvas">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            <h2 className="text-lg font-black uppercase tracking-tight">
              {isBodyEditable ? "Nouveau post LinkedIn" : "Programmer ce post"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-200 border-2 border-black"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left column: content + schedule */}
            <div className="space-y-4">
              {isBodyEditable ? (
                <div>
                  <label className="block text-xs font-black uppercase mb-1">
                    Contenu du post
                  </label>
                  <textarea
                    value={bodyDraft}
                    onChange={(e) => setBodyDraft(e.target.value)}
                    rows={9}
                    className="w-full border-3 border-black px-3 py-2 font-medium font-sans text-sm leading-relaxed resize-y"
                    placeholder="Écris ton post LinkedIn ici…"
                  />
                </div>
              ) : (
                <div className="border-2 border-black p-3 bg-canvas">
                  <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">
                    Contenu sélectionné
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed max-h-40 overflow-y-auto">
                    {effectiveBody}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs font-bold flex-wrap">
                <span className={sweet ? "text-lf-green" : "text-lf-gray"}>
                  {charCount} caractères
                </span>
                {charCount > 0 && charCount < 210 && (
                  <span className="text-lf-gray">· fold ~210</span>
                )}
                {sweet && <span className="text-lf-green">· sweet 1200-1900</span>}
                {charCount > 1900 && charCount <= 3000 && (
                  <span className="text-lf-yellow">· un peu long, dégrade reach</span>
                )}
                {charCount > 3000 && <span className="text-red-600">· max 3000</span>}
              </div>

              {!done && (
                <>
                  <div>
                    <label className="block text-xs font-black uppercase mb-2">
                      Créneaux rapides
                    </label>
                    <QuickSlotsPicker onPick={(iso) => setScheduledAt(iso)} />
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase mb-1">
                      Ou choisis date &amp; heure
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="w-full border-3 border-black px-3 py-2 font-medium"
                    />
                    <p className="text-xs text-lf-gray mt-1">
                      Heure locale ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Le
                      post partira automatiquement.
                    </p>
                  </div>
                </>
              )}

              {done ? (
                <div className="flex items-start gap-2 text-sm border-3 border-lf-green bg-lf-green/10 text-lf-green px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span className="font-medium">
                    Post programmé. Suivez-le dans Personal Brand &gt; Programmés.
                  </span>
                </div>
              ) : (
                error && (
                  <div className="flex items-start gap-2 text-sm border-3 border-red-400 bg-red-50 text-red-600 px-3 py-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="font-medium">{error}</span>
                  </div>
                )
              )}
            </div>

            {/* Right column: LinkedIn preview */}
            <div className="space-y-3">
              <LinkedInPreviewPane
                body={effectiveBody}
                authorName={authorName}
                authorPicture={authorPicture}
              />
              <p className="text-[11px] text-lf-gray font-medium leading-relaxed">
                Aperçu indicatif. Le rendu réel sur LinkedIn peut varier légèrement
                (police, espacement, miniature des liens).
              </p>
            </div>
          </div>
        </div>

        <footer className="border-t-3 border-black p-4 flex gap-2 bg-canvas">
          {done ? (
            <button
              onClick={onClose}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-sm"
            >
              Fermer
            </button>
          ) : (
            <>
              <button
                onClick={() => submit("now")}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-sm disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Publier maintenant
              </button>
              <button
                onClick={() => submit("scheduled")}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-3 border-black bg-lf-blue text-white hover:bg-lf-blue/90 font-bold uppercase text-sm disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Calendar className="w-4 h-4" />
                )}
                Programmer
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
