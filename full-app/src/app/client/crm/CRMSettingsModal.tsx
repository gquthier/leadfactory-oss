"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Settings,
  GripVertical,
  Trash2,
  Plus,
  Star,
  Check,
  X,
  Eye,
  Bell,
} from "lucide-react";
import type { PipelineStage } from "@/types/index";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  stages: PipelineStage[];
  onClose: () => void;
  onStagesUpdate: (stages: PipelineStage[]) => void;
}

type Tab = "pipeline" | "preferences";
type ViewMode = "pipeline" | "table" | "stats";

interface CardOptions {
  showPhone: boolean;
  showEmail: boolean;
  showSource: boolean;
  showQuality: boolean;
  showRevenue: boolean;
  showTags: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#3B82F6",
  "#FDE047",
  "#A855F7",
  "#F97316",
  "#EC4899",
  "#58BC82",
  "#6B7280",
  "#EF4444",
];

const DEFAULT_CARD_OPTIONS: CardOptions = {
  showPhone: true,
  showEmail: true,
  showSource: true,
  showQuality: true,
  showRevenue: true,
  showTags: true,
};

const LS_VIEW_KEY = "lf-crm-default-view";
const LS_CARD_KEY = "lf-crm-card-options";

// ── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const show = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return { toasts, show };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 border-3 border-black shadow-brutal text-sm font-black uppercase tracking-wide transition-all ${
            t.type === "success"
              ? "bg-lf-green text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Color Picker ─────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-7 h-7 border-3 border-black shadow-brutal-xs flex-shrink-0 hover:scale-110 transition-transform"
        style={{ backgroundColor: value }}
        title="Changer la couleur"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 p-2 bg-white border-3 border-black shadow-brutal grid grid-cols-4 gap-1.5">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              className={`w-6 h-6 border-2 hover:scale-110 transition-transform ${
                value === color ? "border-black scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stage Row ────────────────────────────────────────────────────────────────

interface StageRowProps {
  stage: PipelineStage;
  allStages: PipelineStage[];
  autoFocus: boolean;
  onUpdate: (id: string, updates: Partial<PipelineStage>) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  isDraggingOver: boolean;
}

function StageRow({
  stage,
  allStages,
  autoFocus,
  onUpdate,
  onDelete,
  onSetDefault,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDraggingOver,
}: StageRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [autoFocus]);

  const handleWonToggle = () => {
    if (stage.is_won) {
      onUpdate(stage.id, { is_won: false });
    } else {
      // Unset any existing won stage first (handled by parent)
      onUpdate(stage.id, { is_won: true, is_lost: false });
    }
  };

  const handleLostToggle = () => {
    if (stage.is_lost) {
      onUpdate(stage.id, { is_lost: false });
    } else {
      onUpdate(stage.id, { is_lost: true, is_won: false });
    }
  };

  const canDelete = !stage.is_default && allStages.length > 2;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, stage.id)}
      onDragOver={(e) => onDragOver(e, stage.id)}
      onDrop={(e) => onDrop(e, stage.id)}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-2 p-2.5 border-2 border-black bg-white transition-all ${
        isDraggingOver ? "border-lf-blue bg-lf-blue/5 shadow-brutal" : "shadow-brutal-xs hover:shadow-brutal"
      }`}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 flex-shrink-0 touch-none"
        title="Réordonner"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Color picker */}
      <ColorPicker
        value={stage.color}
        onChange={(color) => onUpdate(stage.id, { color })}
      />

      {/* Name input */}
      <input
        ref={inputRef}
        type="text"
        value={stage.name}
        onChange={(e) => onUpdate(stage.id, { name: e.target.value })}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed && trimmed !== stage.name) {
            onUpdate(stage.id, { name: trimmed });
          } else if (!trimmed) {
            onUpdate(stage.id, { name: stage.name });
          }
        }}
        className="flex-1 min-w-0 px-2 py-1 border-2 border-black font-bold text-sm bg-white focus:outline-none focus:border-lf-blue focus:bg-lf-blue/5"
        placeholder="Nom de l'étape"
      />

      {/* Default star */}
      <button
        type="button"
        onClick={() => onSetDefault(stage.id)}
        title={stage.is_default ? "Étape par défaut" : "Définir par défaut"}
        className={`flex-shrink-0 p-1 transition-colors ${
          stage.is_default
            ? "text-lf-yellow"
            : "text-gray-300 hover:text-lf-yellow"
        }`}
      >
        <Star
          className={`w-4 h-4 ${stage.is_default ? "fill-lf-yellow" : ""}`}
        />
      </button>

      {/* Won toggle */}
      <button
        type="button"
        onClick={handleWonToggle}
        title={stage.is_won ? "Étape Gagné (cliquer pour désactiver)" : "Marquer comme Gagné"}
        className={`flex-shrink-0 p-1 border-2 transition-all ${
          stage.is_won
            ? "border-lf-green bg-lf-green text-white"
            : "border-gray-200 text-gray-400 hover:border-lf-green hover:text-lf-green"
        }`}
      >
        <Check className="w-3.5 h-3.5" />
      </button>

      {/* Lost toggle */}
      <button
        type="button"
        onClick={handleLostToggle}
        title={stage.is_lost ? "Étape Perdu (cliquer pour désactiver)" : "Marquer comme Perdu"}
        className={`flex-shrink-0 p-1 border-2 transition-all ${
          stage.is_lost
            ? "border-red-500 bg-red-500 text-white"
            : "border-gray-200 text-gray-400 hover:border-red-500 hover:text-red-500"
        }`}
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(stage.id)}
        disabled={!canDelete}
        title={
          stage.is_default
            ? "L'étape par défaut ne peut pas être supprimée"
            : allStages.length <= 2
            ? "Minimum 2 étapes requises"
            : "Supprimer l'étape"
        }
        className={`flex-shrink-0 p-1 transition-colors ${
          canDelete
            ? "text-gray-400 hover:text-red-500 hover:bg-red-50"
            : "text-gray-200 cursor-not-allowed"
        }`}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Pipeline Tab ─────────────────────────────────────────────────────────────

interface PipelineTabProps {
  stages: PipelineStage[];
  onStagesChange: (stages: PipelineStage[]) => void;
  toast: (msg: string, type?: Toast["type"]) => void;
}

function PipelineTab({ stages, onStagesChange, toast }: PipelineTabProps) {
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);
  const [newStageId, setNewStageId] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const dragId = useRef<string | null>(null);
  const dragOverId = useRef<string | null>(null);
  const [draggingOver, setDraggingOver] = useState<string | null>(null);

  // Sync up if parent stages change (e.g., initial load)
  useEffect(() => {
    setLocalStages(stages);
  }, [stages]);

  // ── API Calls ──────────────────────────────────────────────────────────

  const patchStage = useCallback(
    async (id: string, updates: Partial<PipelineStage>) => {
      setSaving((prev) => ({ ...prev, [id]: true }));
      try {
        const res = await fetch(`/api/client/pipeline-stages/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Erreur serveur");
        }
        const data = await res.json();
        return data.stage as PipelineStage;
      } finally {
        setSaving((prev) => ({ ...prev, [id]: false }));
      }
    },
    []
  );

  const createStage = useCallback(
    async (payload: { name: string; color: string; display_order: number }) => {
      const res = await fetch("/api/client/pipeline-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erreur serveur");
      }
      const data = await res.json();
      return data.stage as PipelineStage;
    },
    []
  );

  const deleteStageApi = useCallback(async (id: string) => {
    const res = await fetch(`/api/client/pipeline-stages/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Erreur serveur");
    }
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleUpdate = useCallback(
    async (id: string, updates: Partial<PipelineStage>) => {
      // Handle mutual exclusivity of is_won / is_lost
      let updatedStages = localStages.map((s) => {
        if (s.id === id) return { ...s, ...updates };
        // Unset won from other stages if we're setting this one
        if (updates.is_won && s.is_won) return { ...s, is_won: false };
        // Unset lost from other stages if we're setting this one
        if (updates.is_lost && s.is_lost) return { ...s, is_lost: false };
        return s;
      });

      setLocalStages(updatedStages);
      onStagesChange(updatedStages);

      try {
        await patchStage(id, updates);

        // If we toggled is_won on this stage, also clear it on others via API
        if (updates.is_won) {
          const others = localStages.filter(
            (s) => s.id !== id && s.is_won
          );
          await Promise.all(
            others.map((s) => patchStage(s.id, { is_won: false }))
          );
        }
        if (updates.is_lost) {
          const others = localStages.filter(
            (s) => s.id !== id && s.is_lost
          );
          await Promise.all(
            others.map((s) => patchStage(s.id, { is_lost: false }))
          );
        }

        toast("Étape mise à jour");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Erreur", "error");
        setLocalStages(localStages);
        onStagesChange(localStages);
      }
    },
    [localStages, onStagesChange, patchStage, toast]
  );

  const handleSetDefault = useCallback(
    (id: string) => {
      // is_default is not exposed via PATCH API — managed as local optimistic state only.
      // The parent CRMClient re-fetches stages on next load to get the server truth.
      const updated = localStages.map((s) => ({
        ...s,
        is_default: s.id === id,
      }));
      setLocalStages(updated);
      onStagesChange(updated);
      toast("Étape par défaut modifiée");
    },
    [localStages, onStagesChange, toast]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const stage = localStages.find((s) => s.id === id);
      if (!stage) return;
      if (stage.is_default) {
        toast("L'étape par défaut ne peut pas être supprimée", "error");
        return;
      }
      if (localStages.length <= 2) {
        toast("Minimum 2 étapes requises", "error");
        return;
      }

      const previous = localStages;
      const updated = localStages.filter((s) => s.id !== id);
      setLocalStages(updated);
      onStagesChange(updated);

      try {
        await deleteStageApi(id);
        toast("Étape supprimée");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Erreur", "error");
        setLocalStages(previous);
        onStagesChange(previous);
      }
    },
    [localStages, onStagesChange, deleteStageApi, toast]
  );

  const handleAddStage = useCallback(async () => {
    const nextOrder = localStages.length;
    const optimisticId = `temp-${Date.now()}`;
    const optimistic: PipelineStage = {
      id: optimisticId,
      client_id: "",
      name: "Nouvelle étape",
      color: "#3B82F6",
      display_order: nextOrder,
      is_default: false,
      is_won: false,
      is_lost: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updated = [...localStages, optimistic];
    setLocalStages(updated);
    setNewStageId(optimisticId);

    try {
      const created = await createStage({
        name: optimistic.name,
        color: optimistic.color,
        display_order: nextOrder,
      });
      const replaced = updated.map((s) =>
        s.id === optimisticId ? created : s
      );
      setLocalStages(replaced);
      onStagesChange(replaced);
      setNewStageId(created.id);
      toast("Étape créée");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Erreur", "error");
      setLocalStages(localStages);
      onStagesChange(localStages);
      setNewStageId(null);
    }
  }, [localStages, onStagesChange, createStage, toast]);

  // ── Drag & Drop ────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      dragId.current = id;
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dragOverId.current = id;
      setDraggingOver(id);
    },
    []
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      setDraggingOver(null);
      const sourceId = dragId.current;
      if (!sourceId || sourceId === targetId) return;

      const sourceIdx = localStages.findIndex((s) => s.id === sourceId);
      const targetIdx = localStages.findIndex((s) => s.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;

      const reordered = [...localStages];
      const [moved] = reordered.splice(sourceIdx, 1);
      reordered.splice(targetIdx, 0, moved);

      const withOrder = reordered.map((s, i) => ({
        ...s,
        display_order: i,
      }));

      setLocalStages(withOrder);
      onStagesChange(withOrder);
      dragId.current = null;

      // Persist new display orders
      try {
        await Promise.all(
          withOrder.map((s, i) => {
            if (s.display_order !== localStages.find((ls) => ls.id === s.id)?.display_order) {
              return patchStage(s.id, { display_order: i });
            }
            return Promise.resolve();
          })
        );
        toast("Ordre mis à jour");
      } catch {
        toast("Erreur lors de la réorganisation", "error");
      }
    },
    [localStages, onStagesChange, patchStage, toast]
  );

  const handleDragEnd = useCallback(() => {
    dragId.current = null;
    dragOverId.current = null;
    setDraggingOver(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs font-bold text-gray-500 uppercase tracking-wide border-b-2 border-black/10 pb-3">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 fill-lf-yellow text-lf-yellow" />
          <span>Étape par défaut</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 border-2 border-lf-green bg-lf-green flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" />
          </div>
          <span>Gagné</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 border-2 border-red-500 bg-red-500 flex items-center justify-center">
            <X className="w-2.5 h-2.5 text-white" />
          </div>
          <span>Perdu</span>
        </div>
      </div>

      {/* Stage list */}
      <div className="space-y-2">
        {localStages.map((stage) => (
          <StageRow
            key={stage.id}
            stage={stage}
            allStages={localStages}
            autoFocus={stage.id === newStageId}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            isDraggingOver={draggingOver === stage.id}
          />
        ))}
      </div>

      {/* Add stage button */}
      <button
        type="button"
        onClick={handleAddStage}
        className="flex items-center gap-2 px-4 py-2.5 border-3 border-black border-dashed bg-white hover:bg-lf-blue hover:text-white hover:border-lf-blue hover:border-solid transition-all font-black uppercase text-sm tracking-wide w-full justify-center group"
      >
        <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
        Ajouter une étape
      </button>
    </div>
  );
}

// ── Preferences Tab ───────────────────────────────────────────────────────────

function BrutalToggle({
  checked,
  onChange,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const isMd = size === "md";
  const wrap = isMd ? "w-10 h-5" : "w-8 h-4";
  const knob = isMd ? "w-3 h-3" : "w-2.5 h-2.5";
  const offset = isMd ? (checked ? "left-[22px]" : "left-0.5") : (checked ? "left-[18px]" : "left-0.5");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`${wrap} ${
        checked ? "bg-lf-black border-black" : "bg-white border-black"
      } border-2 relative rounded-none flex-shrink-0 transition-colors ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <span
        className={`absolute top-0.5 ${offset} ${knob} ${
          checked ? "bg-lf-yellow" : "bg-lf-gray"
        } transition-all`}
      />
    </button>
  );
}

function PreferencesTab() {
  const [defaultView, setDefaultView] = useState<ViewMode>("pipeline");
  const [cardOptions, setCardOptions] = useState<CardOptions>(DEFAULT_CARD_OPTIONS);
  const [notifyNewLead, setNotifyNewLead] = useState<boolean>(true);
  const [notifyNewLeadEmail, setNotifyNewLeadEmail] = useState<boolean>(true);
  const [notifLoading, setNotifLoading] = useState<boolean>(true);
  const [notifSaving, setNotifSaving] = useState<boolean>(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedView = localStorage.getItem(LS_VIEW_KEY) as ViewMode | null;
      if (savedView && ["pipeline", "table", "stats"].includes(savedView)) {
        setDefaultView(savedView);
      }
      const savedCards = localStorage.getItem(LS_CARD_KEY);
      if (savedCards) {
        setCardOptions({ ...DEFAULT_CARD_OPTIONS, ...JSON.parse(savedCards) });
      }
    } catch {
      // ignore
    }
  }, []);

  // Load notification preferences from server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client/preferences/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notify_new_lead?: boolean; notify_new_lead_email?: boolean };
        if (cancelled) return;
        if (typeof data.notify_new_lead === "boolean") setNotifyNewLead(data.notify_new_lead);
        if (typeof data.notify_new_lead_email === "boolean") setNotifyNewLeadEmail(data.notify_new_lead_email);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setNotifLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistNotifPref(payload: { notify_new_lead?: boolean; notify_new_lead_email?: boolean }) {
    setNotifSaving(true);
    try {
      await fetch("/api/client/preferences/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // best-effort
    } finally {
      setNotifSaving(false);
    }
  }

  const handleToggleNewLead = (next: boolean) => {
    setNotifyNewLead(next);
    void persistNotifPref({ notify_new_lead: next });
  };

  const handleToggleNewLeadEmail = (next: boolean) => {
    setNotifyNewLeadEmail(next);
    void persistNotifPref({ notify_new_lead_email: next });
  };

  const handleViewChange = (view: ViewMode) => {
    setDefaultView(view);
    try {
      localStorage.setItem(LS_VIEW_KEY, view);
    } catch {
      // ignore
    }
  };

  const handleCardOptionChange = (key: keyof CardOptions, value: boolean) => {
    const updated = { ...cardOptions, [key]: value };
    setCardOptions(updated);
    try {
      localStorage.setItem(LS_CARD_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: "pipeline", label: "Pipeline (Kanban)" },
    { value: "table", label: "Table" },
    { value: "stats", label: "Stats" },
  ];

  const cardOptionItems: { key: keyof CardOptions; label: string }[] = [
    { key: "showPhone", label: "Afficher le téléphone" },
    { key: "showEmail", label: "Afficher l'email" },
    { key: "showSource", label: "Afficher la source" },
    { key: "showQuality", label: "Afficher la qualité" },
    { key: "showRevenue", label: "Afficher le CA" },
    { key: "showTags", label: "Afficher les tags" },
  ];

  const upcomingNotificationItems = [
    { label: "Rappel de suivi" },
    { label: "Résumé hebdomadaire" },
  ];

  return (
    <div className="space-y-6">
      {/* Default view */}
      <section>
        <h3 className="font-black uppercase tracking-wide text-sm border-b-3 border-black pb-2 mb-4 flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Vue par défaut
        </h3>
        <div className="space-y-2">
          {viewOptions.map(({ value, label }) => (
            <label
              key={value}
              className={`flex items-center gap-3 p-3 border-2 cursor-pointer transition-all ${
                defaultView === value
                  ? "border-lf-black bg-lf-black text-white shadow-brutal"
                  : "border-black bg-white hover:bg-gray-50"
              }`}
            >
              <div
                className={`w-4 h-4 border-2 flex items-center justify-center flex-shrink-0 ${
                  defaultView === value
                    ? "border-white bg-white"
                    : "border-black"
                }`}
              >
                {defaultView === value && (
                  <div className="w-2 h-2 bg-lf-black" />
                )}
              </div>
              <input
                type="radio"
                name="defaultView"
                value={value}
                checked={defaultView === value}
                onChange={() => handleViewChange(value)}
                className="sr-only"
              />
              <span className="font-bold text-sm uppercase tracking-wide">
                {label}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Card display options */}
      <section>
        <h3 className="font-black uppercase tracking-wide text-sm border-b-3 border-black pb-2 mb-4">
          Affichage des cartes Kanban
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cardOptionItems.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-3 p-3 border-2 border-black bg-white hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div
                className={`w-5 h-5 border-2 border-black flex items-center justify-center flex-shrink-0 transition-all ${
                  cardOptions[key] ? "bg-lf-black" : "bg-white"
                }`}
                onClick={() => handleCardOptionChange(key, !cardOptions[key])}
              >
                {cardOptions[key] && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
              <input
                type="checkbox"
                checked={cardOptions[key]}
                onChange={(e) => handleCardOptionChange(key, e.target.checked)}
                className="sr-only"
              />
              <span className="font-bold text-sm">{label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section>
        <h3 className="font-black uppercase tracking-wide text-sm border-b-3 border-black pb-2 mb-4 flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Notifications
        </h3>
        <div className="space-y-2">
          {/* New lead — active */}
          <div className="p-3 border-2 border-black bg-white">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-3 cursor-pointer flex-1">
                <BrutalToggle
                  checked={notifyNewLead}
                  onChange={handleToggleNewLead}
                  disabled={notifLoading || notifSaving}
                />
                <div className="flex flex-col">
                  <span className="font-bold text-sm">Notification nouveau lead</span>
                  <span className="text-[11px] text-lf-gray font-medium">
                    Cloche in-app à chaque nouveau lead (webhook ou ajout manuel).
                  </span>
                </div>
              </label>
            </div>
            {notifyNewLead && (
              <div className="mt-3 pl-12">
                <label className="flex items-center gap-3 cursor-pointer">
                  <BrutalToggle
                    checked={notifyNewLeadEmail}
                    onChange={handleToggleNewLeadEmail}
                    disabled={notifLoading || notifSaving}
                    size="sm"
                  />
                  <span className="text-xs font-bold">
                    Recevoir aussi un email
                  </span>
                </label>
              </div>
            )}
          </div>

          {upcomingNotificationItems.map(({ label }) => (
            <div
              key={label}
              className="flex items-center justify-between p-3 border-2 border-black/30 bg-gray-50"
            >
              <div className="flex items-center gap-3">
                {/* Disabled toggle */}
                <div className="w-10 h-5 bg-gray-200 border-2 border-gray-300 relative rounded-none flex-shrink-0">
                  <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-gray-400" />
                </div>
                <span className="font-bold text-sm text-gray-500">{label}</span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 border border-gray-300 px-2 py-0.5">
                Bientôt disponible
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export function CRMSettingsModal({ stages, onClose, onStagesUpdate }: Props) {
  const [tab, setTab] = useState<Tab>("pipeline");
  const { toasts, show: showToast } = useToast();

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline", label: "Pipeline" },
    { id: "preferences", label: "Préférences" },
  ];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[900] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-[901] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Paramètres CRM"
      >
        <div
          className="relative w-full max-w-2xl bg-canvas border-3 border-black shadow-brutal flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b-3 border-black bg-lf-black text-white flex-shrink-0">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-lf-yellow" />
              <h2 className="text-lg font-black uppercase tracking-widest">
                Paramètres CRM
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 transition-colors border border-white/20"
              aria-label="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab navigation */}
          <div className="flex border-b-3 border-black flex-shrink-0">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 px-6 py-3 text-sm font-black uppercase tracking-widest transition-colors border-r-2 border-black last:border-r-0 ${
                  tab === id
                    ? "bg-lf-yellow text-black"
                    : "bg-white text-gray-500 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-6 min-h-0">
            {tab === "pipeline" && (
              <PipelineTab
                stages={stages}
                onStagesChange={onStagesUpdate}
                toast={showToast}
              />
            )}
            {tab === "preferences" && <PreferencesTab />}
          </div>

          {/* Footer */}
          <div className="flex justify-end px-6 py-3 border-t-3 border-black bg-gray-50 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border-3 border-black font-black uppercase text-sm tracking-wide bg-white hover:bg-lf-black hover:text-white transition-colors shadow-brutal-xs hover:shadow-brutal"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>

      {/* Toasts */}
      <ToastList toasts={toasts} />
    </>
  );
}
