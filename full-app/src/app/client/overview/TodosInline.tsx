"use client";

import { useState, useMemo } from "react";
import { CheckSquare, Square, CheckCircle2, ClipboardList, PlayCircle } from "lucide-react";

export type ClientTask = {
  id: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
};

export function TodosInline({ tasks: initialTasks }: { tasks: ClientTask[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [saving, setSaving] = useState<string | null>(null);

  const pendingTasks = tasks.filter(t => !t.is_completed);
  const completedCount = tasks.filter(t => t.is_completed).length;

  const metaAccessDone = useMemo(() =>
    tasks.some(t => t.title.toLowerCase().includes("meta ads") && t.is_completed),
    [tasks]
  );

  if (pendingTasks.length === 0) return null;

  const toggle = async (task: ClientTask) => {
    setSaving(task.id);
    const newValue = !task.is_completed;

    setTasks(prev => prev.map(t =>
      t.id === task.id
        ? { ...t, is_completed: newValue, completed_at: newValue ? new Date().toISOString() : null }
        : t
    ));

    try {
      await fetch(`/api/client/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_completed: newValue }),
      });
      window.dispatchEvent(new CustomEvent("task-status-changed", { detail: { delta: newValue ? -1 : 1 } }));
    } catch {
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, is_completed: task.is_completed, completed_at: task.completed_at } : t
      ));
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {/* Instructions d’accès — aucun tutoriel ou identifiant privé intégré */}
      {!metaAccessDone && (
        <div className="card-brutal p-5 bg-white mb-4">
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle className="w-4 h-4 text-lf-blue" />
            <p className="font-black uppercase text-sm tracking-wider">
              Tuto — Comment partager vos accès Meta Ads
            </p>
          </div>
          <p className="text-sm font-medium text-lf-gray">
            Votre agence doit vous fournir son propre guide et son identifiant Business Meta.
            Aucun accès partenaire n’est préconfiguré dans ce starter.
          </p>
        </div>
      )}

    <div className="card-brutal p-5 bg-lf-yellow mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />
          <p className="font-black uppercase text-sm tracking-wider">
            À faire — {pendingTasks.length} action{pendingTasks.length > 1 ? "s" : ""} en attente
          </p>
        </div>
        {completedCount > 0 && (
          <span className="text-xs font-black text-lf-gray uppercase">
            {completedCount}/{tasks.length} faites
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-black/10 border border-black/20 mb-4">
        <div
          className="h-full bg-black transition-all duration-500"
          style={{ width: `${(completedCount / tasks.length) * 100}%` }}
        />
      </div>

      {/* Tasks */}
      <div className="flex flex-col gap-2">
        {tasks.map(task => (
          <button
            key={task.id}
            onClick={() => toggle(task)}
            disabled={saving === task.id}
            className={`w-full text-left flex items-start gap-3 p-3 border-2 border-black transition-all ${
              task.is_completed
                ? "bg-black/5 opacity-50"
                : "bg-white hover:bg-lf-yellow/30 hover:shadow-[2px_2px_0_#000] active:translate-x-px active:translate-y-px"
            } ${saving === task.id ? "cursor-wait opacity-60" : "cursor-pointer"}`}
          >
            <div className="mt-0.5 flex-shrink-0">
              {task.is_completed
                ? <CheckSquare className="w-4 h-4 text-lf-green" />
                : <Square className="w-4 h-4" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-black text-sm uppercase tracking-wide ${task.is_completed ? "line-through text-lf-gray" : ""}`}>
                {task.title}
              </p>
              {task.description && !task.is_completed && (
                <p className="text-xs font-medium text-black/60 mt-0.5 leading-relaxed">{task.description}</p>
              )}
              {task.is_completed && task.completed_at && (
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-green mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Complété le {new Date(task.completed_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
    </>
  );
}
