"use client";

import { ExternalLink, Play, Presentation, Clock, CheckCircle2, Circle } from "lucide-react";
import type { FormationModuleWithProgress, FormationResource } from "@/types";

interface Props {
  module: FormationModuleWithProgress;
  onToggleComplete: (moduleId: string, completed: boolean) => void;
  loading?: boolean;
}

export function ModuleCard({ module, onToggleComplete, loading }: Props) {
  return (
    <div
      className={`card-brutal p-5 transition-all ${
        module.is_completed ? "bg-lf-green/10 border-lf-green" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-black uppercase tracking-wider text-lf-gray">
              Module {module.module_number}
            </span>
            {module.duration_minutes && (
              <span className="flex items-center gap-1 text-xs text-lf-gray">
                <Clock className="w-3 h-3" />
                {module.duration_minutes} min
              </span>
            )}
          </div>
          <h3 className="text-lg font-black uppercase tracking-tight">{module.title}</h3>
          {module.description && (
            <p className="text-sm text-lf-gray mt-1">{module.description}</p>
          )}
        </div>

        <button
          onClick={() => onToggleComplete(module.id, !module.is_completed)}
          disabled={loading}
          className="flex-shrink-0 mt-1"
          title={module.is_completed ? "Marquer comme non complété" : "Marquer comme complété"}
        >
          {module.is_completed ? (
            <CheckCircle2 className="w-7 h-7 text-lf-green" />
          ) : (
            <Circle className="w-7 h-7 text-gray-300 hover:text-lf-blue transition-colors" />
          )}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {module.video_url && (
          <a
            href={module.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary !py-2 !px-4 !text-xs flex items-center gap-2"
          >
            <Play className="w-3 h-3" />
            Regarder la vidéo
          </a>
        )}
        {module.presentation_url && (
          <a
            href={module.presentation_url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-lf-blue text-white border-3 border-black px-4 py-2 font-bold uppercase text-xs tracking-wider shadow-brutal-xs hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all flex items-center gap-2"
          >
            <Presentation className="w-3 h-3" />
            Voir la présentation
          </a>
        )}
      </div>

      {module.resources && module.resources.length > 0 && (
        <div className="mt-3 pt-3 border-t-2 border-black/10">
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">Ressources</p>
          <div className="flex flex-wrap gap-2">
            {module.resources.map((r: FormationResource, i: number) => (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-lf-blue hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                {r.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
