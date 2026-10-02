"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { ProgressBar } from "@/components/formations/ProgressBar";
import type { FormationWithProgress } from "@/types";

interface Props {
  formations: FormationWithProgress[];
}

export function FormationsClientPage({ formations }: Props) {
  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">ESPACE CLIENT</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Mes Formations</h1>
        <p className="text-lf-gray mt-1">Accédez à vos formations et suivez votre progression</p>
      </div>

      {formations.length === 0 ? (
        <div className="card-brutal p-12 text-center">
          <BookOpen className="w-12 h-12 mx-auto text-lf-gray mb-4" />
          <p className="text-lg font-bold">Aucune formation disponible</p>
          <p className="text-sm text-lf-gray mt-1">Vos formations apparaîtront ici une fois qu&apos;elles seront assignées</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {formations.map((f) => (
            <Link
              key={f.id}
              href={`/client/formations/${f.slug}`}
              className="card-brutal p-6 block group hover:shadow-[10px_10px_0px_0px_#000] transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                {f.completed_count === f.modules_count && f.modules_count > 0 ? (
                  <span className="text-xs font-black uppercase px-2 py-1 border-2 border-black bg-lf-green text-white">
                    Complété
                  </span>
                ) : (
                  <span className="text-xs font-black uppercase px-2 py-1 border-2 border-black bg-lf-blue text-white">
                    En cours
                  </span>
                )}
              </div>
              <h2 className="text-lg font-black uppercase tracking-tight group-hover:text-lf-blue transition-colors">
                {f.title}
              </h2>
              {f.description && (
                <p className="text-sm text-lf-gray mt-1 line-clamp-2">{f.description}</p>
              )}
              <ProgressBar completed={f.completed_count} total={f.modules_count} className="mt-4" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
