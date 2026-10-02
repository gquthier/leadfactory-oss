"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, FileText, Loader2, Play, X } from "lucide-react";
import type { TeamResource, TeamResourceKind } from "@/types/index";

function kindBadge(kind: TeamResourceKind) {
  return kind === "sop"
    ? { label: "SOP", cls: "bg-lf-blue text-white border-lf-blue" }
    : { label: "Ressource", cls: "bg-lf-pink text-black border-black" };
}

export function TeamResourcesReader() {
  const [resources, setResources] = useState<TeamResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<TeamResource | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/team/resources");
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Chargement impossible");
        }
        const { resources } = await res.json();
        setResources(resources ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // SOP d'abord, puis ressources écrites, en respectant order_index.
  const sorted = useMemo(() => {
    const rank = (k: TeamResourceKind) => (k === "sop" ? 0 : 1);
    return [...resources].sort(
      (a, b) => rank(a.kind) - rank(b.kind) || a.order_index - b.order_index,
    );
  }, [resources]);

  // Sélectionne la première ressource par défaut (desktop).
  useEffect(() => {
    if (!active && sorted.length > 0) setActive(sorted[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  return (
    <div className="max-w-7xl space-y-6 p-6 lg:p-8">
      <div>
        <div className="sticker-yellow -rotate-1 mb-3 inline-block">RESSOURCES</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Mes ressources &amp; SOP</h1>
        <p className="mt-1 max-w-2xl font-medium text-lf-gray">
          Les procédures, documents et accès qui vous ont été attribués par l&apos;équipe.
        </p>
      </div>

      {err && (
        <div className="flex items-start gap-2 border-3 border-red-400 bg-red-50 p-3 text-sm font-bold text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 border-3 border-black bg-white p-6 text-sm font-bold">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : sorted.length === 0 ? (
        <div className="border-3 border-dashed border-black bg-gray-50 p-8 text-center">
          <BookOpen className="mx-auto mb-2 h-6 w-6 opacity-40" />
          <p className="text-sm font-bold">Aucune ressource attribuée pour le moment.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          {/* ── Sidebar — liste des ressources (nom + catégorie) ─────────── */}
          <div className={`flex flex-col gap-2 ${active ? "lg:w-[340px] lg:min-w-[340px]" : "w-full"} transition-all`}>
            {sorted.map((r) => {
              const isActive = active?.id === r.id;
              const badge = kindBadge(r.kind);
              return (
                <button
                  key={r.id}
                  onClick={() => setActive(r)}
                  className={`card-brutal-sm w-full p-4 text-left transition-all ${
                    isActive ? "border-lf-blue bg-lf-blue/5 shadow-brutal-sm" : "hover:shadow-brutal-xs"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {isActive ? (
                        <Play className="h-5 w-5 text-lf-blue" />
                      ) : r.kind === "sop" ? (
                        <Play className="h-5 w-5 text-gray-300" />
                      ) : (
                        <FileText className="h-5 w-5 text-gray-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className={`inline-block border-2 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <p className={`mt-1 truncate text-sm font-bold ${isActive ? "text-lf-blue" : ""}`}>
                        {r.title}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Contenu — vidéo + texte en dessous ───────────────────────── */}
          {active && (
            <div className="min-w-0 flex-1">
              <div className="card-brutal overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b-3 border-black bg-lf-black px-5 py-3 text-white">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-xs font-black uppercase tracking-wider text-white/60">
                      {kindBadge(active.kind).label}
                    </span>
                    <span className="truncate text-sm font-bold">{active.title}</span>
                  </div>
                  <button
                    onClick={() => setActive(null)}
                    className="flex-shrink-0 p-1 transition-colors hover:bg-white/10"
                    title="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Player Loom */}
                {active.loom_url && (
                  <div className="relative w-full bg-black" style={{ paddingBottom: "62.5%" }}>
                    <iframe
                      src={active.loom_url}
                      className="absolute inset-0 h-full w-full"
                      allow="autoplay; encrypted-media; fullscreen"
                      allowFullScreen
                      title={active.title}
                    />
                  </div>
                )}

                {/* Contenu sous la vidéo */}
                <div className="space-y-4 p-5">
                  {/* Lien document */}
                  {active.document_url && (
                    <a
                      href={active.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 border-3 border-black bg-lf-yellow px-4 py-3 text-sm font-black uppercase tracking-wider transition-all hover:shadow-brutal"
                    >
                      <FileText className="h-4 w-4 flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate">Ouvrir le document</span>
                    </a>
                  )}

                  {/* Texte riche */}
                  {active.body_html && active.body_html.trim() !== "" && (
                    <div
                      className="prose prose-sm max-w-none [&_a]:text-lf-blue [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-black [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-bold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                      dangerouslySetInnerHTML={{ __html: active.body_html }}
                    />
                  )}

                  {!active.loom_url &&
                    !active.document_url &&
                    (!active.body_html || active.body_html.trim() === "") && (
                      <p className="text-sm font-medium text-lf-gray">
                        Cette ressource est vide pour le moment.
                      </p>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* Empty state desktop */}
          {!active && (
            <div className="hidden flex-1 items-center justify-center lg:flex">
              <div className="text-center text-lf-gray">
                <Play className="mx-auto mb-4 h-16 w-16 opacity-20" />
                <p className="text-lg font-bold">Sélectionnez une ressource</p>
                <p className="mt-1 text-sm">Cliquez sur une ressource à gauche pour l&apos;afficher.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
