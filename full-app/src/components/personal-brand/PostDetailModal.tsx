"use client";

import { useState } from "react";
import { X, Loader2, ExternalLink, Trash2, RefreshCw, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  type ScheduledPostRow,
  statusColor,
  statusLabel,
  linkedInPostUrl,
} from "./calendar/calendar-utils";

interface Props {
  post: ScheduledPostRow;
  onClose: () => void;
  onChange: () => void;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function PostDetailModal({ post, onClose, onChange }: Props) {
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(post.scheduled_at));
  const [busy, setBusy] = useState<"save" | "cancel" | "retry" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const color = statusColor(post.status);
  const liUrl = linkedInPostUrl(post.linkedin_post_urn);
  const canEdit = post.status === "queued" || post.status === "failed";

  async function reschedule() {
    setBusy("save");
    setErr(null);
    try {
      const res = await fetch(`/api/client/linkedin/scheduled-posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: new Date(scheduledAt).toISOString() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onChange();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm("Annuler ce post programmé ?")) return;
    setBusy("cancel");
    try {
      const res = await fetch(`/api/client/linkedin/scheduled-posts/${post.id}`, { method: "DELETE" });
      if (res.ok) {
        onChange();
        onClose();
      } else {
        setErr(`HTTP ${res.status}`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    // Resetting status to queued + clearing retry_count so the worker picks it up.
    setBusy("retry");
    setErr(null);
    try {
      const res = await fetch(`/api/client/linkedin/scheduled-posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onChange();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-3 border-black shadow-brutal max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b-3 border-black bg-canvas">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-black px-2 py-1 border-2 ${color.border} ${color.bg} ${color.text} uppercase`}>
              {statusLabel(post.status)}
            </span>
            <span className="text-xs font-bold text-lf-gray">
              {post.status === "published" && post.published_at
                ? `Publié le ${new Date(post.published_at).toLocaleString("fr-FR")}`
                : `Prévu le ${new Date(post.scheduled_at).toLocaleString("fr-FR")}`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-200 border-2 border-black"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="border-2 border-black p-3 bg-canvas">
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">
              Contenu du post
            </p>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed max-h-72 overflow-y-auto">
              {post.body_snapshot}
            </pre>
            <p className="text-[11px] text-lf-gray mt-2">
              {post.body_snapshot.length} caractères
              {post.retry_count > 0 && ` · ${post.retry_count} retry`}
            </p>
          </div>

          {post.error_message && (
            <div className="flex items-start gap-2 text-sm border-3 border-red-400 bg-red-50 text-red-700 px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="font-medium break-words">{post.error_message}</span>
            </div>
          )}

          {canEdit && (
            <div>
              <label className="block text-xs font-black uppercase mb-1">
                Reprogrammer
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full border-3 border-black px-3 py-2 font-medium"
              />
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 text-sm border-3 border-red-400 bg-red-50 text-red-600 px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <footer className="border-t-3 border-black p-4 flex flex-wrap gap-2 bg-canvas">
          {liUrl && (
            <a
              href={liUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-3 py-2 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Voir sur LinkedIn
            </a>
          )}
          {canEdit && (
            <button
              onClick={reschedule}
              disabled={busy !== null}
              className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-3 py-2 border-3 border-black bg-lf-blue text-white hover:bg-lf-blue/90 font-bold uppercase text-xs disabled:opacity-50"
            >
              {busy === "save" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Enregistrer
            </button>
          )}
          {post.status === "failed" && (
            <button
              onClick={retry}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 px-3 py-2 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-xs disabled:opacity-50"
            >
              {busy === "retry" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Réessayer
            </button>
          )}
          {(post.status === "queued" || post.status === "failed") && (
            <button
              onClick={cancel}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 px-3 py-2 border-3 border-black bg-white hover:bg-red-50 hover:border-red-500 hover:text-red-600 font-bold uppercase text-xs disabled:opacity-50"
            >
              {busy === "cancel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Annuler
            </button>
          )}
          {post.status === "published" && (
            <div className="flex-1 flex items-center justify-end gap-1 text-xs text-lf-green font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Publié avec succès
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
