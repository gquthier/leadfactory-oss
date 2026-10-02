"use client";

import { OnboardingData } from "@/types/onboarding";
import { BrutalistInput } from "@/components/ui/BrutalistInput";
import { BrutalistTextarea } from "@/components/ui/BrutalistTextarea";
import { BrutalistCheckboxGroup } from "@/components/ui/BrutalistCheckboxGroup";
import { BrutalistRadioGroup } from "@/components/ui/BrutalistRadioGroup";

interface Props {
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
}

const CTA_TYPES = [
  { value: "audit", label: "Audit / Diagnostic" },
  { value: "demo", label: "Démo" },
  { value: "essai", label: "Essai" },
  { value: "devis", label: "Devis / Estimation" },
  { value: "achat", label: "Achat direct" },
  { value: "promo", label: "Promo / Bundle" },
  { value: "ressource", label: "Ressource (guide, webinar, checklist)" },
  { value: "autre", label: "Autre" },
];

const PREUVES = [
  { value: "chiffre", label: "Chiffre" },
  { value: "cas", label: "Cas client" },
  { value: "avis", label: "Avis" },
  { value: "logos", label: "Logos" },
  { value: "etude", label: "Étude" },
  { value: "avant_apres", label: "Avant / Après" },
  { value: "autre", label: "Autre" },
];

export function StepC({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">C</span>
        <div>
          <h2 className="section-title">Offre + Message</h2>
          <p className="section-desc mt-1">Définissez le message publicitaire central : promesse, bénéfices, preuve et ce qu'il ne faut pas dire.</p>
        </div>
      </div>

      <div className="divider" />

      <BrutalistCheckboxGroup
        label="Offre / CTA à pousser *"
        options={CTA_TYPES}
        selected={data.c_cta_type}
        onChange={(v) => onChange({ c_cta_type: v })}
        withOther
        otherValue={data.c_cta_autre}
        onOtherChange={(v) => onChange({ c_cta_autre: v })}
        otherPlaceholder="Ex : Appel / Visio..."
      />

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-lf-blue">
        <h3 className="font-black uppercase text-sm tracking-wider mb-4 text-white">La promesse principale</h3>
        <BrutalistTextarea
          label="Phrase principale orientée client *"
          placeholder="Ex : Facilitez votre accès à la commande publique."
          value={data.c_promesse}
          onChange={(e) => onChange({ c_promesse: e.target.value })}
          rows={2}
          required
        />
      </div>

      <div className="flex flex-col gap-4">
        <span className="label-brutal">Les bénéfices clés</span>
        <BrutalistInput
          label="Bénéfice 1"
          placeholder="Ex : Gagnez du temps."
          value={data.c_benefice1}
          onChange={(e) => onChange({ c_benefice1: e.target.value })}
        />
        <BrutalistInput
          label="Bénéfice 2"
          placeholder="Ex : Grâce à une expertise rare, gagnez en pertinence sur chaque réponse..."
          value={data.c_benefice2}
          onChange={(e) => onChange({ c_benefice2: e.target.value })}
        />
        <BrutalistInput
          label="Bénéfice 3"
          placeholder="Ex : Pas d'embauche à gérer, tout en profitant des bénéfices..."
          value={data.c_benefice3}
          onChange={(e) => onChange({ c_benefice3: e.target.value })}
        />
      </div>

      <div className="divider" />

      <div className="flex flex-col gap-4">
        <BrutalistRadioGroup
          label="Preuve la plus forte (1 seule) *"
          options={PREUVES}
          value={data.c_preuve_type}
          onChange={(v) => onChange({ c_preuve_type: v })}
        />
        <BrutalistInput
          label="Détail / Lien de la preuve"
          placeholder="Lien vers une preuve autorisée, sa période et son périmètre. Aucun chiffre à inventer."
          value={data.c_preuve_detail}
          onChange={(e) => onChange({ c_preuve_detail: e.target.value })}
        />
      </div>

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-lf-pink">
        <h3 className="font-black uppercase text-sm tracking-wider mb-4">No-go absolus ⚠️</h3>
        <BrutalistTextarea
          label="3 choses à ne pas dire / ne pas promettre *"
          placeholder={"Ex :\n1. Nous ne pouvons pas promettre de taux de transformation spécifique.\n2. Pas de comparaison avec la concurrence nommée.\n3. Pas de formulation cheap, rester premium."}
          value={data.c_nogo}
          onChange={(e) => onChange({ c_nogo: e.target.value })}
          rows={5}
          required
        />
      </div>
    </div>
  );
}
