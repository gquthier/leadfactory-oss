"use client";

import { useState, useRef, useEffect } from "react";
import {
  X,
  Phone,
  Mail,
  MapPin,
  Star,
  Euro,
  MessageSquare,
  Video,
  MessageCircle,
  ArrowRight,
  RefreshCw,
  Smartphone,
  CheckSquare,
  MoreHorizontal,
  Plus,
  Calendar,
  Tag,
  Building2,
  Zap,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LeadActivity {
  id: string;
  activity_type:
    | "note"
    | "call"
    | "email"
    | "meeting"
    | "stage_change"
    | "status_change"
    | "task"
    | "whatsapp"
    | "sms"
    | "other";
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

interface PipelineStage {
  id: string;
  name: string;
  color: string;
  display_order: number;
  is_won: boolean;
  is_lost: boolean;
}

interface LeadDetail {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  status: "new" | "contacted" | "qualified" | "converted" | "lost";
  pipeline_stage_id: string | null;
  quality_score: number | null;
  revenue: number | null;
  cash_collected: number | null;
  notes: string | null;
  tags: string[];
  preferred_contact: string | null;
  city: string | null;
  last_contacted_at: string | null;
  next_follow_up: string | null;
  created_at: string;
  updated_at: string;
  campaigns?: { name: string } | null;
}

interface Props {
  lead: LeadDetail;
  stages: PipelineStage[];
  activities: LeadActivity[];
  onClose: () => void;
  onUpdate: (leadId: string, updates: Partial<LeadDetail>) => void;
  onAddActivity: (
    leadId: string,
    activity: { activity_type: string; title: string; description?: string }
  ) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  if (weeks > 0) return `il y a ${weeks} sem`;
  if (days > 0) return `il y a ${days}j`;
  if (hours > 0) return `il y a ${hours}h`;
  if (minutes > 0) return `il y a ${minutes}min`;
  return "à l'instant";
}

const SOURCE_COLORS: Record<string, string> = {
  meta: "bg-lf-blue text-white",
  facebook: "bg-lf-blue text-white",
  instagram: "bg-lf-pink text-black",
  google: "bg-lf-yellow text-black",
  email: "bg-purple-500 text-white",
  referral: "bg-lf-green text-white",
  organic: "bg-lf-green text-white",
  other: "bg-gray-300 text-black",
};

function getSourceColor(source: string | null): string {
  if (!source) return "bg-gray-200 text-black";
  const key = source.toLowerCase();
  return SOURCE_COLORS[key] ?? "bg-gray-200 text-black";
}

const ACTIVITY_CONFIG: Record<
  LeadActivity["activity_type"],
  { icon: React.ReactNode; color: string; label: string }
> = {
  note: {
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    color: "text-lf-blue bg-blue-50 border-lf-blue",
    label: "Note",
  },
  call: {
    icon: <Phone className="w-3.5 h-3.5" />,
    color: "text-lf-green bg-green-50 border-lf-green",
    label: "Appel",
  },
  email: {
    icon: <Mail className="w-3.5 h-3.5" />,
    color: "text-purple-600 bg-purple-50 border-purple-400",
    label: "Email",
  },
  meeting: {
    icon: <Video className="w-3.5 h-3.5" />,
    color: "text-orange-600 bg-orange-50 border-orange-400",
    label: "Réunion",
  },
  stage_change: {
    icon: <ArrowRight className="w-3.5 h-3.5" />,
    color: "text-yellow-700 bg-yellow-50 border-lf-yellow",
    label: "Changement d'étape",
  },
  status_change: {
    icon: <RefreshCw className="w-3.5 h-3.5" />,
    color: "text-lf-pink bg-pink-50 border-lf-pink",
    label: "Changement de statut",
  },
  whatsapp: {
    icon: <MessageCircle className="w-3.5 h-3.5" />,
    color: "text-lf-green bg-green-50 border-lf-green",
    label: "WhatsApp",
  },
  sms: {
    icon: <Smartphone className="w-3.5 h-3.5" />,
    color: "text-lf-blue bg-blue-50 border-lf-blue",
    label: "SMS",
  },
  task: {
    icon: <CheckSquare className="w-3.5 h-3.5" />,
    color: "text-gray-600 bg-gray-50 border-gray-400",
    label: "Tâche",
  },
  other: {
    icon: <MoreHorizontal className="w-3.5 h-3.5" />,
    color: "text-gray-600 bg-gray-50 border-gray-400",
    label: "Autre",
  },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function QualityStars({
  score,
  onChange,
}: {
  score: number | null;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = hovered !== null ? n <= hovered : score !== null && n <= score;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(null)}
            className="cursor-pointer"
            title={`Qualité ${n}`}
          >
            <Star
              className={`w-4 h-4 transition-colors ${
                active
                  ? (score !== null && score >= 4) || (hovered !== null && hovered >= 4)
                    ? "fill-lf-green text-lf-green"
                    : (score !== null && score >= 3) || (hovered !== null && hovered >= 3)
                    ? "fill-lf-yellow text-lf-yellow"
                    : "fill-red-400 text-red-400"
                  : "text-gray-300"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function InlineMoneyEditor({
  value,
  onSave,
  accentColor = "lf-green",
  placeholder = "Saisir",
}: {
  value: number | null;
  onSave: (val: number | null) => void;
  accentColor?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  const commit = () => {
    const parsed =
      draft.trim() === "" ? null : parseFloat(draft.replace(",", "."));
    onSave(isNaN(parsed as number) ? null : parsed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 border-2 border-lf-blue px-2 py-1 text-xs font-bold focus:outline-none bg-white"
          placeholder="0.00"
        />
        <span className="text-xs text-gray-400">€</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value != null ? String(value) : "");
        setEditing(true);
      }}
      className={`flex items-center gap-1 text-xs font-bold px-2 py-1 border-2 transition-colors ${
        value != null
          ? `border-${accentColor} bg-green-50 text-${accentColor} hover:opacity-80`
          : "border-dashed border-gray-300 text-gray-400 hover:border-lf-blue hover:text-lf-blue"
      }`}
      title="Cliquer pour modifier"
    >
      <Euro className="w-3 h-3" />
      {value != null ? fmt(value, 2) : placeholder}
    </button>
  );
}

function TagPill({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 border-2 border-black bg-lf-yellow px-2 py-0.5 text-xs font-bold">
      {tag}
      <button
        type="button"
        onClick={onRemove}
        className="hover:text-red-600 transition-colors"
        title="Supprimer le tag"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

function ActivityIcon({ type }: { type: LeadActivity["activity_type"] }) {
  const cfg = ACTIVITY_CONFIG[type];
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 border-2 flex-shrink-0 ${cfg.color}`}
    >
      {cfg.icon}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function LeadDetailPanel({
  lead,
  stages,
  activities,
  onClose,
  onUpdate,
  onAddActivity,
}: Props) {
  // Notes state
  const [notes, setNotes] = useState(lead.notes ?? "");

  // Tags state
  const [tags, setTags] = useState<string[]>(lead.tags ?? []);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Quick action form state
  const [activeAction, setActiveAction] = useState<{
    type: string;
    title: string;
  } | null>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDesc, setActionDesc] = useState("");

  // Follow-up date state
  const [followUp, setFollowUp] = useState(
    lead.next_follow_up ? lead.next_follow_up.slice(0, 10) : ""
  );

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus tag input when opened
  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  // ── Handlers ──

  const handleStageChange = (stageId: string) => {
    onUpdate(lead.id, { pipeline_stage_id: stageId });
  };

  const handleQualityChange = (score: number) => {
    onUpdate(lead.id, { quality_score: score });
  };

  const handleRevenueSave = (val: number | null) => {
    onUpdate(lead.id, { revenue: val });
  };

  const handleCashSave = (val: number | null) => {
    onUpdate(lead.id, { cash_collected: val });
  };

  const handleNotesBlur = () => {
    if (notes !== lead.notes) {
      onUpdate(lead.id, { notes });
    }
  };

  const handleFollowUpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFollowUp(val);
    onUpdate(lead.id, { next_follow_up: val || null });
  };

  const handleAddTag = () => {
    const trimmed = tagDraft.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setTagDraft("");
      setAddingTag(false);
      return;
    }
    const next = [...tags, trimmed];
    setTags(next);
    onUpdate(lead.id, { tags: next });
    setTagDraft("");
    setAddingTag(false);
  };

  const handleRemoveTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    onUpdate(lead.id, { tags: next });
  };

  const openAction = (type: string, title: string) => {
    if (activeAction?.type === type) {
      setActiveAction(null);
      return;
    }
    setActiveAction({ type, title });
    setActionTitle(title);
    setActionDesc("");
  };

  const submitAction = () => {
    if (!activeAction || !actionTitle.trim()) return;
    onAddActivity(lead.id, {
      activity_type: activeAction.type,
      title: actionTitle.trim(),
      description: actionDesc.trim() || undefined,
    });
    setActiveAction(null);
    setActionTitle("");
    setActionDesc("");
  };

  // ── Derived values ──

  const currentStage = stages.find((s) => s.id === lead.pipeline_stage_id);
  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const quickActions = [
    { type: "call", title: "Appel", icon: <Phone className="w-4 h-4" /> },
    { type: "email", title: "Email", icon: <Mail className="w-4 h-4" /> },
    { type: "note", title: "Note", icon: <MessageSquare className="w-4 h-4" /> },
    { type: "meeting", title: "Réunion", icon: <Video className="w-4 h-4" /> },
    {
      type: "whatsapp",
      title: "WhatsApp",
      icon: <MessageCircle className="w-4 h-4" />,
    },
  ];

  // ── Render ──

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Détails de ${lead.full_name ?? "lead"}`}
        className="fixed top-0 right-0 h-full w-full max-w-lg xl:max-w-xl z-50 bg-white border-l-3 border-black flex flex-col overflow-hidden animate-slide-in"
        style={{ animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>

        {/* ── Header ── */}
        <div className="flex-shrink-0 border-b-3 border-black bg-canvas">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-black uppercase tracking-tight leading-none truncate">
                {lead.full_name ?? <span className="text-gray-400 font-normal normal-case">Sans nom</span>}
              </h2>
              {lead.company && (
                <p className="flex items-center gap-1 mt-1 text-sm font-bold text-gray-600">
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  {lead.company}
                </p>
              )}
              {lead.campaigns?.name && (
                <p className="mt-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Campagne: {lead.campaigns.name}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 p-1.5 border-2 border-transparent hover:border-black hover:bg-lf-yellow transition-colors"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Pipeline stages */}
          {stages.length > 0 && (
            <div className="px-5 pb-4">
              <p className="text-xs font-black uppercase tracking-wider text-gray-400 mb-2">
                Etape pipeline
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...stages]
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((stage) => {
                    const isCurrent = stage.id === lead.pipeline_stage_id;
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => handleStageChange(stage.id)}
                        className={`px-2.5 py-1 text-xs font-black uppercase tracking-wide border-2 border-black transition-all ${
                          isCurrent
                            ? "shadow-brutal-xs translate-x-[-1px] translate-y-[-1px]"
                            : "bg-white hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-brutal-xs"
                        }`}
                        style={
                          isCurrent
                            ? { backgroundColor: stage.color, color: "#000" }
                            : {}
                        }
                        title={stage.name}
                      >
                        {stage.name}
                        {stage.is_won && " "}
                        {stage.is_lost && " "}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Contact info */}
          <section className="px-5 py-4 border-b-3 border-black space-y-2.5">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
              Contact
            </h3>

            <div className="grid grid-cols-1 gap-2">
              {lead.phone && (
                <a
                  href={`tel:${lead.phone}`}
                  className="flex items-center gap-2 text-sm font-bold hover:text-lf-blue transition-colors group"
                >
                  <span className="flex items-center justify-center w-7 h-7 border-2 border-black bg-lf-green text-white group-hover:bg-lf-blue transition-colors">
                    <Phone className="w-3.5 h-3.5" />
                  </span>
                  {lead.phone}
                  {lead.preferred_contact === "phone" && (
                    <span className="text-xs font-black uppercase bg-lf-yellow border border-black px-1.5 py-0.5">
                      Préféré
                    </span>
                  )}
                </a>
              )}

              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="flex items-center gap-2 text-sm font-bold hover:text-lf-blue transition-colors group"
                >
                  <span className="flex items-center justify-center w-7 h-7 border-2 border-black bg-lf-blue text-white group-hover:opacity-80 transition-opacity">
                    <Mail className="w-3.5 h-3.5" />
                  </span>
                  <span className="truncate">{lead.email}</span>
                  {lead.preferred_contact === "email" && (
                    <span className="text-xs font-black uppercase bg-lf-yellow border border-black px-1.5 py-0.5 flex-shrink-0">
                      Préféré
                    </span>
                  )}
                </a>
              )}

              {lead.city && (
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <span className="flex items-center justify-center w-7 h-7 border-2 border-black bg-gray-100">
                    <MapPin className="w-3.5 h-3.5" />
                  </span>
                  {lead.city}
                </div>
              )}
            </div>

            {/* Source + Tags */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {lead.source && (
                <span
                  className={`inline-block text-xs font-black uppercase tracking-wide px-2 py-0.5 border border-black ${getSourceColor(lead.source)}`}
                >
                  {lead.source}
                </span>
              )}

              {tags.map((tag) => (
                <TagPill
                  key={tag}
                  tag={tag}
                  onRemove={() => handleRemoveTag(tag)}
                />
              ))}

              {addingTag ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTag();
                      if (e.key === "Escape") {
                        setAddingTag(false);
                        setTagDraft("");
                      }
                    }}
                    onBlur={handleAddTag}
                    placeholder="Nouveau tag"
                    className="border-2 border-black px-2 py-0.5 text-xs font-bold w-24 focus:outline-none focus:border-lf-blue"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTag(true)}
                  className="inline-flex items-center gap-0.5 border-2 border-dashed border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-400 hover:border-black hover:text-black transition-colors"
                  title="Ajouter un tag"
                >
                  <Tag className="w-3 h-3" />
                  <Plus className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </section>

          {/* Key metrics */}
          <section className="px-5 py-4 border-b-3 border-black">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-3">
              Indicateurs clés
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Quality */}
              <div className="border-2 border-black p-3 bg-white">
                <p className="text-xs font-black uppercase tracking-wide text-gray-400 mb-2">
                  Qualité
                </p>
                <QualityStars
                  score={lead.quality_score}
                  onChange={handleQualityChange}
                />
                <p className="text-xs text-gray-400 mt-1 font-medium">
                  {lead.quality_score != null
                    ? `${lead.quality_score}/5`
                    : "Non noté"}
                </p>
              </div>

              {/* Follow-up */}
              <div className="border-2 border-black p-3 bg-white">
                <p className="text-xs font-black uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Suivi
                </p>
                <input
                  type="date"
                  value={followUp}
                  onChange={handleFollowUpChange}
                  className="w-full border-2 border-black px-2 py-1 text-xs font-bold focus:outline-none focus:border-lf-blue bg-white"
                />
              </div>

              {/* Revenue */}
              <div className="border-2 border-black p-3 bg-white">
                <p className="text-xs font-black uppercase tracking-wide text-gray-400 mb-2">
                  CA généré
                </p>
                <InlineMoneyEditor
                  value={lead.revenue ?? null}
                  onSave={handleRevenueSave}
                  accentColor="lf-green"
                />
              </div>

              {/* Cash collected */}
              <div className="border-2 border-black p-3 bg-white">
                <p className="text-xs font-black uppercase tracking-wide text-gray-400 mb-2">
                  Cash reçu
                </p>
                <InlineMoneyEditor
                  value={lead.cash_collected ?? null}
                  onSave={handleCashSave}
                  accentColor="lf-blue"
                />
              </div>
            </div>
          </section>

          {/* Quick actions */}
          <section className="px-5 py-4 border-b-3 border-black">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Actions rapides
            </h3>

            <div className="flex gap-2 flex-wrap">
              {quickActions.map((action) => {
                const isActive = activeAction?.type === action.type;
                return (
                  <button
                    key={action.type}
                    type="button"
                    onClick={() => openAction(action.type, action.title)}
                    className={`flex items-center gap-1.5 px-3 py-2 border-2 border-black text-xs font-black uppercase tracking-wide transition-all ${
                      isActive
                        ? "bg-lf-black text-white shadow-brutal-xs translate-x-[-1px] translate-y-[-1px]"
                        : "bg-white hover:bg-gray-50 hover:shadow-brutal-xs hover:translate-x-[-1px] hover:translate-y-[-1px]"
                    }`}
                    title={`Enregistrer un(e) ${action.title}`}
                  >
                    {action.icon}
                    {action.title}
                  </button>
                );
              })}
            </div>

            {/* Inline activity form */}
            {activeAction && (
              <div className="mt-3 border-2 border-black p-3 bg-gray-50 space-y-2">
                <input
                  type="text"
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="Titre..."
                  className="w-full border-2 border-black px-3 py-2 text-sm font-medium focus:outline-none focus:border-lf-blue bg-white"
                />
                <textarea
                  value={actionDesc}
                  onChange={(e) => setActionDesc(e.target.value)}
                  placeholder="Description (optionnel)..."
                  rows={2}
                  className="textarea-brutal text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={submitAction}
                    disabled={!actionTitle.trim()}
                    className="btn-primary text-xs px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAction(null)}
                    className="btn-secondary text-xs px-4 py-2"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Activity timeline */}
          <section className="px-5 py-4 border-b-3 border-black">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4">
              Historique ({sortedActivities.length})
            </h3>

            {sortedActivities.length === 0 ? (
              <p className="text-sm text-gray-400 font-medium italic">
                Aucune activité enregistrée.
              </p>
            ) : (
              <ol className="relative space-y-0">
                {sortedActivities.map((activity, index) => {
                  const cfg = ACTIVITY_CONFIG[activity.activity_type];
                  const isLast = index === sortedActivities.length - 1;
                  return (
                    <li key={activity.id} className="flex gap-3 pb-5 relative">
                      {/* Timeline line */}
                      {!isLast && (
                        <div className="absolute left-3 top-7 bottom-0 w-px bg-black/10" />
                      )}

                      {/* Icon dot */}
                      <ActivityIcon type={activity.activity_type} />

                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold leading-tight">
                              {activity.title}
                            </p>
                            <p className="text-xs text-gray-400 font-medium mt-0.5">
                              {cfg.label}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 font-medium flex-shrink-0">
                            {relativeTime(activity.created_at)}
                          </span>
                        </div>
                        {activity.description && (
                          <p className="mt-1.5 text-xs text-gray-600 font-medium border-l-2 border-black pl-2 bg-gray-50 py-1 pr-2">
                            {activity.description}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Notes */}
          <section className="px-5 py-4 border-b-3 border-black">
            <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-3">
              Notes générales
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Ajouter des notes sur ce lead..."
              rows={4}
              className="textarea-brutal text-sm w-full"
            />
            <p className="text-xs text-gray-400 font-medium mt-1">
              Sauvegarde automatique à la perte de focus.
            </p>
          </section>

          {/* Footer */}
          <footer className="px-5 py-4 bg-gray-50">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400 font-medium">
              <span>
                Créé le{" "}
                <span className="font-bold text-gray-600">
                  {new Date(lead.created_at).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </span>
              <span>
                Dernière mise à jour{" "}
                <span className="font-bold text-gray-600">
                  {new Date(lead.updated_at).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </span>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
