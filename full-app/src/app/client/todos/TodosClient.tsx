"use client";

import { useState } from "react";
import { CheckSquare, Square, CheckCircle2, ClipboardList } from "lucide-react";

type ClientTask = {
  id: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
};

interface Props {
  tasks: ClientTask[];
}

export function TodosClient({ tasks: initialTasks }: Props) {
  const [tasks, setTasks] = useState(initialTasks);
  const [saving, setSaving] = useState<string | null>(null);

  const pendingCount = tasks.filter(t => !t.is_completed).length;
  const completedCount = tasks.filter(t => t.is_completed).length;

  const toggle = async (task: ClientTask) => {
    const newValue = !task.is_completed;
    setSaving(task.id);

    // Optimistic update
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
      // Notify layout to update sidebar badge
      window.dispatchEvent(new CustomEvent("task-status-changed", { detail: { delta: newValue ? -1 : 1 } }));
    } catch {
      // Revert on error
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, is_completed: task.is_completed, completed_at: task.completed_at } : t
      ));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-lf-yellow border-3 border-black flex items-center justify-center flex-shrink-0">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight leading-none">À faire</h1>
            <p className="text-sm font-medium text-lf-gray mt-0.5">
              {pendingCount > 0
                ? `${pendingCount} action${pendingCount > 1 ? "s" : ""} à réaliser`
                : "Tout est complété !"}
            </p>
          </div>
        </div>
        {/* Progress bar */}
        {tasks.length > 0 && (
          <div className="h-2 bg-gray-100 border-2 border-black mt-4">
            <div
              className="h-full bg-lf-green transition-all duration-500"
              style={{ width: `${(completedCount / tasks.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Hint */}
      {pendingCount > 0 && (
        <p className="text-xs font-medium text-lf-gray mb-4 p-3 bg-gray-50 border-2 border-dashed border-gray-300">
          Cliquez sur une tâche pour la marquer comme complétée. Votre gestionnaire sera notifié automatiquement.
        </p>
      )}

      {/* Task list */}
      <div className="flex flex-col gap-3">
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => toggle(task)}
            disabled={saving === task.id}
            className={`w-full text-left border-3 border-black p-4 flex items-start gap-4 transition-all ${
              task.is_completed
                ? "bg-gray-50 opacity-60"
                : "bg-white hover:bg-lf-yellow/10 hover:shadow-[4px_4px_0_#000] active:translate-x-0.5 active:translate-y-0.5"
            } ${saving === task.id ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
          >
            <div className="mt-0.5 flex-shrink-0">
              {task.is_completed ? (
                <CheckSquare className="w-5 h-5 text-lf-green" />
              ) : (
                <Square className="w-5 h-5 text-lf-gray" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-black text-sm uppercase tracking-wide ${task.is_completed ? "line-through text-lf-gray" : ""}`}>
                {task.title}
              </p>
              {task.description && (
                <p className="text-xs font-medium text-lf-gray mt-1.5 leading-relaxed">{task.description}</p>
              )}
              {task.is_completed && task.completed_at && (
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-green mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Complété le {new Date(task.completed_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* All done state */}
      {pendingCount === 0 && completedCount > 0 && (
        <div className="mt-8 p-6 border-3 border-lf-green bg-lf-green/5 text-center">
          <CheckCircle2 className="w-10 h-10 text-lf-green mx-auto mb-3" />
          <p className="font-black uppercase tracking-wide text-lg">Tout est complété !</p>
          <p className="text-sm font-medium text-lf-gray mt-1">
            Votre gestionnaire a été notifié. Continuez vers votre tableau de bord.
          </p>
        </div>
      )}
    </div>
  );
}
