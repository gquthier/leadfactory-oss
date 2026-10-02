"use client";

import { ExternalLink, FileText, Video } from "lucide-react";
import type { TeamResource } from "@/types/index";

/**
 * Rendu d'une ressource (Loom embed + lien document + corps HTML).
 * Partagé entre la vue admin et la vue team member — lecture seule.
 */
export function TeamResourceView({ resource }: { resource: TeamResource }) {
  const hasLoom = !!resource.loom_url;
  const hasDoc = !!resource.document_url;
  const hasBody = !!resource.body_html && resource.body_html.trim() !== "";

  return (
    <div className="space-y-5">
      {/* Bloc 1 — Loom embed */}
      {hasLoom && (
        <div className="border-3 border-black bg-black">
          <div className="relative w-full" style={{ paddingBottom: "62.5%" }}>
            <iframe
              src={resource.loom_url!}
              title={`Loom — ${resource.title}`}
              allowFullScreen
              className="absolute inset-0 h-full w-full"
              frameBorder={0}
            />
          </div>
        </div>
      )}

      {/* Bloc 2 — Lien document */}
      {hasDoc && (
        <a
          href={resource.document_url!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 border-3 border-black bg-lf-yellow px-4 py-3 text-sm font-black uppercase tracking-wider transition-all hover:shadow-brutal"
        >
          <FileText className="h-4 w-4 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">Ouvrir le document</span>
          <ExternalLink className="h-4 w-4 flex-shrink-0" />
        </a>
      )}

      {/* Bloc 3 — Corps texte riche */}
      {hasBody && (
        <div
          className="prose prose-sm max-w-none border-3 border-black bg-white p-5 [&_a]:text-lf-blue [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-black [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-bold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: resource.body_html! }}
        />
      )}

      {!hasLoom && !hasDoc && !hasBody && (
        <div className="flex items-center gap-2 border-3 border-dashed border-black bg-gray-50 px-4 py-6 text-sm font-medium text-lf-gray">
          <Video className="h-4 w-4" /> Cette ressource est vide pour le moment.
        </div>
      )}
    </div>
  );
}
