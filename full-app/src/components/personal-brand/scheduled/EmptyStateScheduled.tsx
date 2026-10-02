"use client";

import Link from "next/link";
import { Linkedin, Calendar, Sparkles, Plus } from "lucide-react";

export function EmptyStateScheduled({
  isConnected,
  onCreateClick,
}: {
  isConnected: boolean;
  onCreateClick: () => void;
}) {
  if (!isConnected) {
    return (
      <div className="card-brutal p-10 text-center bg-white">
        <div className="w-14 h-14 mx-auto mb-4 bg-[#0A66C2] border-3 border-black flex items-center justify-center">
          <Linkedin className="w-7 h-7 text-white" />
        </div>
        <h3 className="text-xl font-black uppercase tracking-tight mb-2">
          Connectez LinkedIn pour commencer
        </h3>
        <p className="text-sm font-medium text-lf-gray mb-6 max-w-md mx-auto">
          Pour programmer la publication automatique de vos posts, vous devez
          d&apos;abord connecter votre compte LinkedIn (OAuth officiel, zéro risque
          de ban). Vous pourrez ensuite programmer en 1 clic vos posts générés par
          Personal Brand IA ou Surprises.
        </p>
        <Link
          href="/client/settings?tab=integrations"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0A66C2] text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:shadow-[4px_4px_0_#000] transition-all"
        >
          <Linkedin className="w-4 h-4" />
          Connecter LinkedIn
        </Link>
      </div>
    );
  }

  return (
    <div className="card-brutal p-10 text-center bg-white">
      <div className="w-14 h-14 mx-auto mb-4 bg-lf-yellow border-3 border-black flex items-center justify-center">
        <Calendar className="w-7 h-7" />
      </div>
      <h3 className="text-xl font-black uppercase tracking-tight mb-2">
        Aucun post programmé
      </h3>
      <p className="text-sm font-medium text-lf-gray mb-6 max-w-md mx-auto">
        Vous êtes prêt à publier. Choisissez un post depuis Personal Brand IA ou
        Surprises, ou créez un nouveau post directement ici.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={onCreateClick}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[4px_4px_0_#000] transition-all"
        >
          <Plus className="w-4 h-4" />
          Nouveau post
        </button>
        <Link
          href="/client/surprises"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-3 border-black font-bold text-xs uppercase tracking-wider hover:bg-lf-yellow"
        >
          <Sparkles className="w-4 h-4" />
          Voir mes Surprises
        </Link>
        <Link
          href="/client/personal-brand/linkedin"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-3 border-black font-bold text-xs uppercase tracking-wider hover:bg-lf-yellow"
        >
          Personal Brand IA
        </Link>
      </div>
    </div>
  );
}
