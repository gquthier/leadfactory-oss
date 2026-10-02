"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, CheckCircle2, Circle, Clock, ExternalLink, Presentation, X } from "lucide-react";
import { ProgressBar } from "@/components/formations/ProgressBar";
import type { Formation, FormationModuleWithProgress, FormationResource } from "@/types";

interface Props {
  formation: Formation;
  modules: FormationModuleWithProgress[];
  completedCount: number;
}

function getGoogleDriveEmbedUrl(url: string): string | null {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  return `https://drive.google.com`;
}

function getKeyTakeaways(notes: string | null): string[] {
  if (!notes) return [];

  return notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

function getModuleResources(module: FormationModuleWithProgress): FormationResource[] {
  const primaryResources: FormationResource[] = [];

  if (module.video_url) {
    primaryResources.push({
      label: "Replay vidéo",
      url: module.video_url,
      type: "video",
    });
  }

  if (module.presentation_url) {
    primaryResources.push({
      label: "Support de présentation",
      url: module.presentation_url,
      type: "presentation",
    });
  }

  const merged = [...primaryResources, ...(module.resources ?? [])];
  const seen = new Set<string>();

  return merged.filter((resource) => {
    if (!resource?.url || seen.has(resource.url)) return false;
    seen.add(resource.url);
    return true;
  });
}

export function FormationDetailClientPage({ formation, modules: initial, completedCount: initialCompleted }: Props) {
  const [modules, setModules] = useState(initial);
  const [completed, setCompleted] = useState(initialCompleted);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<FormationModuleWithProgress | null>(null);

  const handleToggle = async (moduleId: string, isCompleted: boolean) => {
    setLoadingId(moduleId);

    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? { ...m, is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null }
          : m
      )
    );
    setCompleted((prev) => prev + (isCompleted ? 1 : -1));

    // Update active module if it's the one being toggled
    if (activeModule?.id === moduleId) {
      setActiveModule((prev) =>
        prev ? { ...prev, is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null } : null
      );
    }

    try {
      const res = await fetch("/api/client/formations/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_id: moduleId, is_completed: isCompleted }),
      });
      if (!res.ok) {
        setModules((prev) =>
          prev.map((m) =>
            m.id === moduleId
              ? { ...m, is_completed: !isCompleted, completed_at: !isCompleted ? new Date().toISOString() : null }
              : m
          )
        );
        setCompleted((prev) => prev + (isCompleted ? -1 : 1));
        if (activeModule?.id === moduleId) {
          setActiveModule((prev) =>
            prev ? { ...prev, is_completed: !isCompleted } : null
          );
        }
      }
    } catch {
      setModules((prev) =>
        prev.map((m) =>
          m.id === moduleId
            ? { ...m, is_completed: !isCompleted, completed_at: !isCompleted ? new Date().toISOString() : null }
            : m
        )
      );
      setCompleted((prev) => prev + (isCompleted ? -1 : 1));
      if (activeModule?.id === moduleId) {
        setActiveModule((prev) =>
          prev ? { ...prev, is_completed: !isCompleted } : null
        );
      }
    }
    setLoadingId(null);
  };

  const embedUrl = activeModule?.video_url ? getGoogleDriveEmbedUrl(activeModule.video_url) : null;
  const activeResources = activeModule ? getModuleResources(activeModule) : [];
  const activeTakeaways = getKeyTakeaways(activeModule?.notes ?? null);

  return (
    <div className="p-4 lg:p-6 max-w-[1400px]">
      <Link href="/client/formations" className="flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4">
        <ArrowLeft className="w-4 h-4" />
        Retour aux formations
      </Link>

      <div className="mb-6">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">FORMATION</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">{formation.title}</h1>
        {formation.description && (
          <p className="text-lf-gray mt-2">{formation.description}</p>
        )}
        <ProgressBar completed={completed} total={modules.length} className="mt-4 max-w-sm" />
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Sidebar — liste des modules */}
        <div className={`flex flex-col gap-2 ${activeModule ? "lg:w-[340px] lg:min-w-[340px]" : "w-full"} transition-all`}>
          {modules.map((mod) => {
            const isActive = activeModule?.id === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => setActiveModule(mod)}
                className={`card-brutal-sm p-4 text-left transition-all w-full ${
                  isActive
                    ? "border-lf-blue bg-lf-blue/5 shadow-brutal-sm"
                    : mod.is_completed
                    ? "border-lf-green bg-lf-green/5 hover:shadow-brutal-xs"
                    : "hover:shadow-brutal-xs"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {mod.is_completed ? (
                      <CheckCircle2 className="w-5 h-5 text-lf-green" />
                    ) : isActive ? (
                      <Play className="w-5 h-5 text-lf-blue" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
                      Module {mod.module_number}
                      {mod.duration_minutes && <span className="ml-2">{mod.duration_minutes} min</span>}
                    </p>
                    <p className={`font-bold text-sm truncate ${isActive ? "text-lf-blue" : ""}`}>
                      {mod.title}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main content — player vidéo + détails */}
        {activeModule && (
          <div className="flex-1 min-w-0">
            <div className="card-brutal overflow-hidden">
              {/* Header module */}
              <div className="flex items-center justify-between px-5 py-3 border-b-3 border-black bg-lf-black text-white">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-black uppercase tracking-wider text-white/60">
                    Module {activeModule.module_number}
                  </span>
                  <span className="font-bold text-sm truncate">{activeModule.title}</span>
                </div>
                <button
                  onClick={() => setActiveModule(null)}
                  className="flex-shrink-0 p-1 hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Player vidéo */}
              {embedUrl ? (
                <div className="relative w-full bg-black" style={{ paddingBottom: "56.25%" }}>
                  <iframe
                    src={embedUrl}
                    className="absolute inset-0 w-full h-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    title={activeModule.title}
                  />
                </div>
              ) : activeModule.video_url ? (
                <div className="p-8 bg-gray-50 text-center">
                  <a
                    href={activeModule.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Ouvrir la vidéo
                  </a>
                </div>
              ) : null}

              {/* Contenu sous la vidéo */}
              <div className="p-5">
                {/* Actions */}
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => handleToggle(activeModule.id, !activeModule.is_completed)}
                    disabled={loadingId === activeModule.id}
                    className={`flex items-center gap-2 px-4 py-2 font-bold text-sm uppercase tracking-wide border-3 transition-all ${
                      activeModule.is_completed
                        ? "bg-lf-green text-white border-lf-green"
                        : "border-black hover:bg-lf-green hover:text-white hover:border-lf-green"
                    }`}
                  >
                    {activeModule.is_completed ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                    {activeModule.is_completed ? "Complété" : "Marquer comme complété"}
                  </button>

                  {activeModule.presentation_url && (
                    <a
                      href={activeModule.presentation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-lf-blue text-white border-3 border-black px-3 py-1.5 font-bold uppercase text-xs tracking-wider shadow-brutal-xs hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all flex items-center gap-1"
                    >
                      <Presentation className="w-3 h-3" />
                      Présentation
                    </a>
                  )}
                </div>

                {/* Description */}
                {activeModule.description && (
                  <div className="mb-4">
                    <p className="text-sm text-lf-gray">{activeModule.description}</p>
                  </div>
                )}

                {/* Key takeaways */}
                {activeTakeaways.length > 0 && (
                  <div className="p-4 bg-lf-yellow/10 border-3 border-lf-yellow/30 mb-4">
                    <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">Key takeaways</p>
                    <ul className="flex flex-col gap-2">
                      {activeTakeaways.map((takeaway, index) => (
                        <li key={`${activeModule.id}-takeaway-${index}`} className="flex items-start gap-2 text-sm">
                          <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-lf-yellow border border-black" />
                          <span>{takeaway}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Ressources */}
                {activeResources.length > 0 && (
                  <div className="pt-4 border-t-2 border-black/10">
                    <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">Ressources</p>
                    <div className="flex flex-wrap gap-2">
                      {activeResources.map((r: FormationResource, i: number) => (
                        <a
                          key={i}
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-bold text-lf-blue hover:underline flex items-center gap-1 bg-lf-blue/5 px-3 py-1.5 border-2 border-lf-blue/20"
                        >
                          {r.type === "presentation" ? (
                            <Presentation className="w-3 h-3" />
                          ) : (
                            <ExternalLink className="w-3 h-3" />
                          )}
                          {r.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Durée */}
                {activeModule.duration_minutes && (
                  <div className="flex items-center gap-1 mt-4 text-xs text-lf-gray">
                    <Clock className="w-3 h-3" />
                    Durée : {activeModule.duration_minutes} minutes
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Empty state — quand aucun module sélectionné (desktop) */}
        {!activeModule && modules.length > 0 && (
          <div className="hidden lg:flex flex-1 items-center justify-center">
            <div className="text-center text-lf-gray">
              <Play className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="font-bold text-lg">Sélectionnez un module</p>
              <p className="text-sm mt-1">Cliquez sur un module à gauche pour regarder la vidéo</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
