"use client";

import { OnboardingData } from "@/types/onboarding";
import { BrutalistInput } from "@/components/ui/BrutalistInput";
import { BrutalistTextarea } from "@/components/ui/BrutalistTextarea";

interface Props {
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
}

export function StepG({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">G</span>
        <div>
          <h2 className="section-title">Budget + Timing</h2>
          <p className="section-desc mt-1">Définissez votre budget publicitaire et les contraintes de calendrier éventuelles.</p>
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal p-8 bg-lf-green">
        <div className="flex flex-col gap-6">
          <div>
            <label className="label-brutal text-white">Budget publicitaire idéal par mois *</label>
            <div className="relative mt-2">
              <input
                type="text"
                placeholder="Ex : 750"
                value={data.g_budget}
                onChange={(e) => onChange({ g_budget: e.target.value })}
                className="w-full bg-white border-3 border-black px-4 py-4 pr-12 font-black text-2xl text-black placeholder:text-gray-400 focus:outline-none focus:shadow-brutal-sm transition-all"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-2xl text-lf-gray">€</span>
            </div>
            <p className="text-xs font-bold text-white/80 mt-2">Budget média uniquement, hors frais d'agence.</p>
          </div>
        </div>
      </div>

      <BrutalistTextarea
        label="Deadline / Période importante / Saisonnalité"
        placeholder={"Exemples :\n- Pas de contrainte particulière\n- Lancement prévu pour le 1er mars\n- Forte activité en septembre (rentrée), creux en août\n- Événement clé : Salon du BTP en juin"}
        value={data.g_timing}
        onChange={(e) => onChange({ g_timing: e.target.value })}
        rows={6}
        hint="Décrivez en détail si vous avez des contraintes de calendrier ou des pics d'activité à prendre en compte."
      />
    </div>
  );
}
