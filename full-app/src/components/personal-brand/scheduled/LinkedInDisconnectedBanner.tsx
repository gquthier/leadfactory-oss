"use client";

import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";

export function LinkedInDisconnectedBanner({ queuedCount }: { queuedCount: number }) {
  if (queuedCount === 0) return null;
  return (
    <div className="border-3 border-red-500 bg-red-50 p-4 mb-6 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-black uppercase tracking-wider text-red-700 mb-1">
          LinkedIn non connecté
        </p>
        <p className="text-sm text-red-700">
          Vous avez <strong>{queuedCount} post{queuedCount > 1 ? "s" : ""} en attente</strong> qui ne
          partiront pas tant que votre compte LinkedIn n&apos;est pas reconnecté.
        </p>
      </div>
      <Link
        href="/client/settings?tab=integrations"
        className="flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 border-3 border-red-500 bg-white hover:bg-red-100 text-xs font-black uppercase tracking-wider text-red-700"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Reconnecter
      </Link>
    </div>
  );
}
