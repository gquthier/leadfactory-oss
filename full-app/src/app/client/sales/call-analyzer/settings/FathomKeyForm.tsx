"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Loader2, Trash2, Check, AlertCircle } from "lucide-react";

interface ExistingKey {
  id: string;
  label: string | null;
  key_preview: string;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export function FathomKeyForm({ existing }: { existing: ExistingKey | null }) {
  const router = useRouter();
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
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        setSubmitting(false);
        return;
      }
      setSuccess(`Clé enregistrée (…${data.preview})`);
      setApiKey("");
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!confirm("Supprimer la clé Fathom de ton compte ?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/client/sales/key", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erreur");
        setSubmitting(false);
        return;
      }
      setSuccess("Clé supprimée");
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {existing && (
        <div className="card-brutal p-4 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-lf-green rounded-full" />
              <span className="font-black uppercase text-sm">Clé active</span>
              <span className="text-xs font-bold text-lf-gray">…{existing.key_preview}</span>
            </div>
            <div className="text-xs text-lf-gray font-medium">
              {existing.label ?? "Ma clé Fathom"} ·{" "}
              {existing.last_used_at
                ? `dernière utilisation ${new Date(existing.last_used_at).toLocaleString("fr-FR")}`
                : "jamais utilisée"}
            </div>
            {existing.last_error && (
              <div className="text-xs text-red-600 font-medium mt-1">
                Dernière erreur : {existing.last_error.slice(0, 100)}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={submitting}
            className="border-3 border-black p-2 bg-lf-pink hover:shadow-brutal-xs transition-all"
            title="Supprimer la clé"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      <form onSubmit={save} className="card-brutal p-6 space-y-4">
        <div>
          <label className="label-brutal">
            {existing ? "Remplacer la clé Fathom" : "Coller ta clé Fathom"}
          </label>
          <input
            type="password"
            className="input-brutal font-mono"
            placeholder="fathom_xxxxxxxxxxxxxxxx"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={submitting}
            autoComplete="off"
          />
          <p className="hint-brutal">
            La clé est validée auprès de l&apos;API Fathom avant d&apos;être chiffrée et enregistrée.
          </p>
        </div>

        {error && (
          <div className="border-3 border-black bg-lf-pink p-3 text-sm font-medium flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="border-3 border-black bg-lf-green text-white p-3 text-sm font-medium flex items-start gap-2">
            <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> {success}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || apiKey.trim().length < 10}
          className={clsx(
            apiKey.trim().length >= 10 && !submitting ? "btn-primary" : "btn-disabled",
            "w-full inline-flex items-center justify-center gap-2"
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Validation…
            </>
          ) : existing ? (
            "Remplacer la clé"
          ) : (
            "Enregistrer la clé"
          )}
        </button>
      </form>
    </div>
  );
}
