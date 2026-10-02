"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, Pencil, X } from "lucide-react";
import {
  BRIEF_SECTIONS,
  type BriefField,
  type BriefSection,
  summarizeFieldValue,
} from "./brief-sections";

interface Props {
  initialResponses: Record<string, unknown> | null;
}

export function MyBriefClient({ initialResponses }: Props) {
  const [responses, setResponses] = useState<Record<string, unknown>>(
    initialResponses ?? {}
  );
  const [editingSection, setEditingSection] = useState<BriefSection | null>(null);
  const [savedSectionId, setSavedSectionId] = useState<string | null>(null);

  const hasBrief = initialResponses !== null;

  const handleSaveSection = useCallback(
    async (sectionId: string, patch: Record<string, unknown>) => {
      const r = await fetch("/api/client/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "Erreur serveur");
      }
      const data = (await r.json()) as { responses: Record<string, unknown> };
      setResponses(data.responses);
      setEditingSection(null);
      setSavedSectionId(sectionId);
      setTimeout(() => setSavedSectionId(null), 3000);
    },
    []
  );

  if (!hasBrief) {
    return (
      <div className="card-brutal p-8 bg-white">
        <div className="flex items-start gap-4">
          <AlertCircle className="w-8 h-8 flex-shrink-0 text-lf-gray" />
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight mb-2">
              Pas encore de brief
            </h2>
            <p className="text-sm font-medium text-lf-gray">
              Aucun brief d&apos;onboarding n&apos;est associé à votre compte pour le moment.
              Contactez votre interlocuteur Lead Factory si vous pensez que c&apos;est une
              erreur.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card-brutal p-4 bg-lf-yellow/40">
        <p className="text-sm font-medium">
          Les modifications de ton brief sont prises en compte automatiquement par
          <strong> Outbound IA</strong> et <strong>Personal Brand IA</strong> à la
          prochaine génération. Pas besoin de prévenir l&apos;équipe.
        </p>
      </div>

      {BRIEF_SECTIONS.map((section) => {
        const summary = section.fields
          .map((f) => ({
            field: f,
            value: summarizeFieldValue(f, responses[f.key]),
          }))
          .filter((s) => s.value !== "");
        const filled = summary.length;
        const total = section.fields.length;

        return (
          <div key={section.id} className="card-brutal p-0 bg-white overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b-3 border-black">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
                  Section {section.id.toUpperCase()} · {filled} / {total} rempli
                  {filled > 1 ? "s" : ""}
                </p>
                <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
                  {section.title}
                </h3>
                <p className="text-xs font-medium text-lf-gray mt-0.5">
                  {section.subtitle}
                </p>
              </div>
              <button
                onClick={() => setEditingSection(section)}
                className="flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all flex-shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
                Éditer
              </button>
            </div>

            {savedSectionId === section.id && (
              <div className="px-5 py-2 bg-lf-green text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
                <Check className="w-3.5 h-3.5" />
                Section enregistrée
              </div>
            )}

            <div className="p-5">
              {summary.length === 0 ? (
                <p className="text-sm font-medium text-lf-gray italic">
                  Aucune réponse pour cette section.
                </p>
              ) : (
                <dl className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {summary.map(({ field, value }) => (
                    <div key={field.key}>
                      <dt className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                        {field.label}
                      </dt>
                      <dd className="text-sm font-medium whitespace-pre-wrap line-clamp-4">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        );
      })}

      {editingSection && (
        <EditSectionModal
          section={editingSection}
          responses={responses}
          onCancel={() => setEditingSection(null)}
          onSave={(patch) => handleSaveSection(editingSection.id, patch)}
        />
      )}
    </div>
  );
}

function EditSectionModal({
  section,
  responses,
  onCancel,
  onSave,
}: {
  section: BriefSection;
  responses: Record<string, unknown>;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of section.fields) {
      const v = responses[f.key];
      if (v === null || v === undefined) out[f.key] = "";
      else if (Array.isArray(v)) out[f.key] = (v as unknown[]).map(String).join(", ");
      else out[f.key] = String(v);
    }
    return out;
  }, [section, responses]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const f of section.fields) {
        const raw = values[f.key] ?? "";
        if (f.type === "multi-csv") {
          patch[f.key] = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (f.type === "number") {
          patch[f.key] = raw.trim();
        } else {
          patch[f.key] = raw;
        }
      }
      await onSave(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-canvas border-3 border-black shadow-[8px_8px_0_#000] flex flex-col">
        <div className="flex-shrink-0 border-b-3 border-black px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
              Édition section {section.id.toUpperCase()}
            </p>
            <h3 className="text-lg font-black uppercase tracking-tight">{section.title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-lf-yellow border-3 border-black flex-shrink-0"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {section.fields.map((field) => (
            <FieldEditor
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          ))}
        </div>

        <div className="flex-shrink-0 border-t-3 border-black px-5 py-3 flex items-center justify-between gap-3 bg-white">
          <div className="min-w-0">
            {error && (
              <p className="text-xs font-black text-red-600 uppercase tracking-wider">
                {error}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 bg-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-gray-100 transition-all disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: BriefField;
  value: string;
  onChange: (v: string) => void;
}) {
  const baseInput =
    "w-full px-3 py-2 border-3 border-black font-medium text-sm bg-white focus:outline-none focus:bg-lf-yellow/10";

  return (
    <div>
      <label className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1 block">
        {field.label}
      </label>
      {field.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={`${baseInput} resize-y`}
        />
      ) : field.type === "select" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={baseInput}
        >
          <option value="">— Choisir —</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "number" ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={baseInput}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={baseInput}
        />
      )}
      {field.help && (
        <p className="text-[10px] font-medium text-lf-gray mt-1">{field.help}</p>
      )}
    </div>
  );
}
