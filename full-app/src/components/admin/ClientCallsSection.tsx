"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Phone, Plus, Copy, Check, Loader2, Trash2, Edit3, Save, X,
  ChevronDown, ChevronUp, Link2, FileText, ExternalLink,
} from "lucide-react";

interface ClientCall {
  id: string;
  client_id: string;
  title: string;
  transcript: string | null;
  link: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

interface DraftCall {
  title: string;
  transcript: string;
  link: string;
}

const EMPTY_DRAFT: DraftCall = { title: "", transcript: "", link: "" };

function CopyInline({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copier ${label}`}
      className="flex items-center gap-1 px-2 py-1 border-2 border-black bg-white hover:bg-lf-yellow transition-all text-[11px] font-black uppercase tracking-wider shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-lf-green" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

function CallForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
}: {
  draft: DraftCall;
  setDraft: (d: DraftCall) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  return (
    <div className="border-3 border-black bg-white p-4 flex flex-col gap-3">
      <div>
        <label className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1 block">
          Titre de l'appel <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Ex : Call de découverte — 03/06"
          className="w-full border-3 border-black px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-lf-blue"
        />
      </div>
      <div>
        <label className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1 block">
          Lien de l'enregistrement <span className="font-medium normal-case text-lf-gray">(optionnel)</span>
        </label>
        <input
          type="text"
          value={draft.link}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          placeholder="https://..."
          className="w-full border-3 border-black px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-lf-blue"
        />
      </div>
      <div>
        <label className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1 block">
          Transcription <span className="font-medium normal-case text-lf-gray">(optionnel)</span>
        </label>
        <textarea
          value={draft.transcript}
          onChange={(e) => setDraft({ ...draft, transcript: e.target.value })}
          placeholder="Collez ici la transcription de l'appel…"
          rows={5}
          className="w-full border-3 border-black px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-lf-blue resize-y"
        />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-gray-100 transition-all disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" /> Annuler
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || !draft.title.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-blue text-white hover:shadow-brutal transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CallCard({
  call,
  onUpdate,
  onDelete,
}: {
  call: ClientCall;
  onUpdate: (id: string, draft: DraftCall) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftCall>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startEdit = () => {
    setDraft({ title: call.title, transcript: call.transcript ?? "", link: call.link ?? "" });
    setEditing(true);
    setOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(call.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer l'appel "${call.title}" ?`)) return;
    setDeleting(true);
    try {
      await onDelete(call.id);
    } finally {
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <CallForm
        draft={draft}
        setDraft={setDraft}
        onSubmit={handleSave}
        onCancel={() => setEditing(false)}
        saving={saving}
        submitLabel="Enregistrer"
      />
    );
  }

  return (
    <div className="border-3 border-black bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b-3 border-black">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <Phone className="w-4 h-4 text-lf-blue shrink-0" />
          <span className="font-black uppercase text-sm tracking-wide truncate">{call.title}</span>
          {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={startEdit}
            title="Modifier"
            className="p-1.5 border-2 border-black bg-white hover:bg-lf-yellow transition-all"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Supprimer"
            className="p-1.5 border-2 border-black bg-white hover:bg-red-500 hover:text-white transition-all disabled:opacity-50"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-4 flex flex-col gap-3">
          <p className="text-[11px] text-lf-gray font-medium">Ajouté le {formatDate(call.created_at)}</p>

          {/* Lien */}
          <div className="border-3 border-black bg-gray-50">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b-3 border-black bg-lf-black text-white">
              <span className="flex items-center gap-1.5 font-black uppercase text-[11px] tracking-wider">
                <Link2 className="w-3.5 h-3.5" /> Lien
              </span>
              {call.link && <CopyInline value={call.link} label="le lien" />}
            </div>
            <div className="px-3 py-2">
              {call.link ? (
                <a
                  href={call.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium text-lf-blue underline break-all hover:opacity-70"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  {call.link}
                </a>
              ) : (
                <p className="text-sm text-lf-gray font-medium italic">Aucun lien</p>
              )}
            </div>
          </div>

          {/* Transcription */}
          <div className="border-3 border-black bg-gray-50">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b-3 border-black bg-lf-black text-white">
              <span className="flex items-center gap-1.5 font-black uppercase text-[11px] tracking-wider">
                <FileText className="w-3.5 h-3.5" /> Transcription
              </span>
              {call.transcript && <CopyInline value={call.transcript} label="la transcription" />}
            </div>
            <div className="px-3 py-2">
              {call.transcript ? (
                <pre className="text-sm font-medium whitespace-pre-wrap text-gray-700 max-h-[320px] overflow-y-auto leading-relaxed">
                  {call.transcript}
                </pre>
              ) : (
                <p className="text-sm text-lf-gray font-medium italic">Aucune transcription</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientCallsSection({ clientId }: { clientId: string }) {
  const [calls, setCalls] = useState<ClientCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftCall>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/client-calls?client_id=${clientId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur de chargement");
      setCalls(data.calls ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/client-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          title: draft.title.trim(),
          transcript: draft.transcript.trim() || null,
          link: draft.link.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setCalls((prev) => [data.call, ...prev]);
      setDraft(EMPTY_DRAFT);
      setAdding(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'ajout");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string, d: DraftCall) => {
    setError(null);
    const res = await fetch("/api/admin/client-calls", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        title: d.title.trim(),
        transcript: d.transcript.trim() || null,
        link: d.link.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Erreur lors de la modification");
      throw new Error(data.error);
    }
    setCalls((prev) => prev.map((c) => (c.id === id ? data.call : c)));
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/admin/client-calls?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Erreur lors de la suppression");
      throw new Error(data.error);
    }
    setCalls((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="card-brutal overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 bg-lf-blue text-white border-b-3 border-black">
        <div className="flex items-center gap-3 min-w-0">
          <Phone className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-black uppercase tracking-wider text-sm">Appels & meetings</p>
            <p className="text-xs font-medium opacity-80 mt-0.5">
              Enregistrements et transcriptions des calls avec le client
            </p>
          </div>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => { setDraft(EMPTY_DRAFT); setAdding(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-yellow text-black hover:shadow-brutal transition-all shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter un appel
          </button>
        )}
      </div>

      <div className="p-4 bg-white flex flex-col gap-3">
        {error && (
          <div className="border-3 border-red-500 bg-red-50 px-4 py-2">
            <p className="text-sm text-red-600 font-medium">{error}</p>
          </div>
        )}

        {adding && (
          <CallForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleAdd}
            onCancel={() => { setAdding(false); setDraft(EMPTY_DRAFT); }}
            saving={saving}
            submitLabel="Ajouter l'appel"
          />
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-lf-gray py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Chargement des appels…</span>
          </div>
        ) : calls.length === 0 && !adding ? (
          <div className="text-center py-6">
            <p className="text-sm text-lf-gray font-medium">Aucun appel enregistré pour ce client.</p>
            <p className="text-xs text-lf-gray font-medium mt-1">
              Cliquez sur « Ajouter un appel » pour stocker le lien et la transcription d'un meeting.
            </p>
          </div>
        ) : (
          calls.map((call) => (
            <CallCard key={call.id} call={call} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))
        )}
      </div>
    </div>
  );
}
