"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { X, Plus, AlertTriangle } from "lucide-react";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/types/index";

interface PipelineStage {
  id: string;
  name: string;
  color: string;
}

interface Campaign {
  id: string;
  name: string;
}

interface NewLeadData {
  full_name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  notes: string;
  campaign_id: string | null;
  pipeline_stage_id: string | null;
  tags: string[];
  preferred_contact: string | null;
  city: string;
}

interface Props {
  stages: PipelineStage[];
  campaigns: Campaign[];
  onSave: (lead: NewLeadData) => Promise<{ success: boolean; duplicate?: boolean; lead?: unknown; error?: string }>;
  onClose: () => void;
}

// Ordre d'affichage. Slug DB en `value`, label FR en texte.
const SOURCE_OPTIONS: LeadSource[] = [
  "manual",
  "meta_ads",
  "google_ads",
  "website",
  "referral",
  "phone",
  "email",
  "linkedin",
  "salon",
  "other",
];

// Slugs alignés sur le CHECK constraint preferred_contact IN ('phone','email','whatsapp','sms').
const PREFERRED_CONTACT_OPTIONS: Array<{ slug: string; label: string }> = [
  { slug: "phone", label: "Téléphone" },
  { slug: "email", label: "Email" },
  { slug: "whatsapp", label: "WhatsApp" },
  { slug: "sms", label: "SMS" },
];

const EMPTY_FORM: NewLeadData = {
  full_name: "",
  email: "",
  phone: "",
  company: "",
  source: "manual",
  notes: "",
  campaign_id: null,
  pipeline_stage_id: null,
  tags: [],
  preferred_contact: null,
  city: "",
};

export function AddLeadModal({ stages, campaigns, onSave, onClose }: Props) {
  const [form, setForm] = useState<NewLeadData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof NewLeadData | "contact", string>>>({});
  const [loading, setLoading] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof NewLeadData>(key: K, value: NewLeadData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function addTag(raw: string) {
    const trimmed = raw.trim().replace(/,+$/, "").trim();
    if (!trimmed) return;
    if (form.tags.includes(trimmed)) return;
    set("tags", [...form.tags, trimmed]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    set("tags", form.tags.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && form.tags.length > 0) {
      removeTag(form.tags[form.tags.length - 1]);
    }
  }

  function validate(): boolean {
    const newErrors: typeof errors = {};
    if (!form.full_name.trim()) {
      newErrors.full_name = "Le nom complet est requis.";
    }
    if (!form.email.trim() && !form.phone.trim()) {
      newErrors.contact = "Fournissez au moins un email ou un téléphone.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(force = false) {
    if (!force && !validate()) return;
    setLoading(true);
    setShowDuplicate(false);
    setSubmitError(null);
    try {
      const payload: NewLeadData = force
        ? { ...form, tags: [...form.tags] }
        : { ...form, tags: [...form.tags] };
      const result = await onSave(payload);
      if (!result.success && result.duplicate) {
        setShowDuplicate(true);
        return;
      }
      if (!result.success) {
        setSubmitError(result.error ?? "Impossible de créer le lead. Réessaye.");
        return;
      }
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Erreur réseau, réessaye.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-canvas border-3 border-black shadow-brutal w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-3 border-black flex-none">
          <h2 className="font-black uppercase tracking-tight text-base">Ajouter un Lead</h2>
          <button onClick={onClose} type="button" className="hover:bg-lf-pink p-1 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Submit error */}
          {submitError && (
            <div className="flex items-start gap-3 bg-lf-pink border-3 border-black p-3 shadow-brutal">
              <AlertTriangle className="w-5 h-5 flex-none mt-0.5" />
              <div className="flex-1 text-sm font-bold">{submitError}</div>
            </div>
          )}

          {/* Duplicate warning */}
          {showDuplicate && (
            <div className="flex items-start gap-3 bg-lf-yellow border-3 border-black p-3 shadow-brutal">
              <AlertTriangle className="w-5 h-5 flex-none mt-0.5" />
              <div className="flex-1 text-sm font-bold">
                Un lead avec cet email ou téléphone existe déjà. Voulez-vous quand même l&apos;ajouter&nbsp;?
              </div>
              <div className="flex gap-2 mt-1 flex-none">
                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={loading}
                  className="btn-primary text-xs px-3 py-1"
                >
                  Ajouter quand même
                </button>
                <button
                  type="button"
                  onClick={() => setShowDuplicate(false)}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* Nom complet */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wide mb-1">
              Nom complet <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              className={`input-brutal w-full text-sm ${errors.full_name ? "border-red-500" : ""}`}
              placeholder="Jean Dupont"
            />
            {errors.full_name && (
              <p className="text-red-500 text-xs font-bold mt-1">{errors.full_name}</p>
            )}
          </div>

          {/* Email + Téléphone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black uppercase tracking-wide mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className={`input-brutal w-full text-sm ${errors.contact ? "border-red-500" : ""}`}
                placeholder="contact@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-wide mb-1">Téléphone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={`input-brutal w-full text-sm ${errors.contact ? "border-red-500" : ""}`}
                placeholder="+33 6 00 00 00 00"
              />
            </div>
          </div>
          {errors.contact && (
            <p className="text-red-500 text-xs font-bold -mt-2">{errors.contact}</p>
          )}

          {/* Entreprise + Ville */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black uppercase tracking-wide mb-1">Entreprise</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => set("company", e.target.value)}
                className="input-brutal w-full text-sm"
                placeholder="Acme SAS"
              />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-wide mb-1">Ville</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                className="input-brutal w-full text-sm"
                placeholder="Paris"
              />
            </div>
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wide mb-1">Source</label>
            <select
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              className="input-brutal w-full text-sm"
            >
              {SOURCE_OPTIONS.map((slug) => (
                <option key={slug} value={slug}>{LEAD_SOURCE_LABELS[slug]}</option>
              ))}
            </select>
          </div>

          {/* Campagne */}
          {campaigns.length > 0 && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wide mb-1">Campagne</label>
              <select
                value={form.campaign_id ?? ""}
                onChange={(e) => set("campaign_id", e.target.value || null)}
                className="input-brutal w-full text-sm"
              >
                <option value="">— Aucune campagne —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Étape du pipeline */}
          {stages.length > 0 && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wide mb-1">Étape du pipeline</label>
              <select
                value={form.pipeline_stage_id ?? ""}
                onChange={(e) => set("pipeline_stage_id", e.target.value || null)}
                className="input-brutal w-full text-sm"
              >
                <option value="">— Aucune étape —</option>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
              {/* Color dot preview for selected stage */}
              {form.pipeline_stage_id && (() => {
                const selected = stages.find((s) => s.id === form.pipeline_stage_id);
                return selected ? (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span
                      className="inline-block w-3 h-3 border border-black"
                      style={{ backgroundColor: selected.color }}
                    />
                    <span className="text-xs font-bold text-gray-600">{selected.name}</span>
                  </div>
                ) : null;
              })()}
            </div>
          )}

          {/* Contact préféré */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wide mb-2">Contact préféré</label>
            <div className="flex flex-wrap gap-3">
              {PREFERRED_CONTACT_OPTIONS.map(({ slug, label }) => (
                <label key={slug} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="preferred_contact"
                    value={slug}
                    checked={form.preferred_contact === slug}
                    onChange={() => set("preferred_contact", slug)}
                    className="accent-lf-blue w-4 h-4"
                  />
                  <span className="text-sm font-bold">{label}</span>
                </label>
              ))}
              {form.preferred_contact !== null && (
                <button
                  type="button"
                  onClick={() => set("preferred_contact", null)}
                  className="text-xs text-gray-400 underline hover:text-black"
                >
                  Effacer
                </button>
              )}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wide mb-1">Tags</label>
            <div
              className="input-brutal min-h-[42px] flex flex-wrap gap-1.5 p-2 cursor-text"
              onClick={() => tagInputRef.current?.focus()}
            >
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 bg-lf-blue text-white text-xs font-black px-2 py-0.5 border border-black"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                    className="hover:opacity-70"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.endsWith(",")) {
                    addTag(val);
                  } else {
                    setTagInput(val);
                  }
                }}
                onKeyDown={handleTagKeyDown}
                onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
                className="flex-1 min-w-[100px] bg-transparent outline-none text-sm font-medium placeholder:text-gray-400"
                placeholder={form.tags.length === 0 ? "Ajouter un tag… (Entrée ou virgule)" : ""}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Appuyez sur Entrée ou virgule pour ajouter un tag.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wide mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className="textarea-brutal w-full h-24 text-sm"
              placeholder="Informations complémentaires sur ce lead…"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t-3 border-black flex-none">
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={loading}
            className="btn-primary flex items-center gap-2 flex-1 justify-center text-sm"
          >
            {loading ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Ajout en cours…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Ajouter le lead
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn-secondary text-sm"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
