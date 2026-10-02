"use client";

import { OnboardingData } from "@/types/onboarding";
import { BrutalistInput } from "@/components/ui/BrutalistInput";
import { BrutalistTextarea } from "@/components/ui/BrutalistTextarea";
import { BrutalistCheckboxGroup } from "@/components/ui/BrutalistCheckboxGroup";

interface Props {
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
}

const OBJECTIFS = [
  { value: "leads", label: "Leads (formulaire / message / appel)" },
  { value: "rdv", label: "RDV / Démo (prise de rendez-vous)" },
  { value: "ventes", label: "Ventes (achat)" },
  { value: "trafic", label: "Trafic qualifié" },
  { value: "telechargements", label: "Téléchargements / Essais" },
  { value: "autre", label: "Autre" },
];

const CONVERSIONS = [
  { value: "lead", label: "Lead" },
  { value: "rdv", label: "RDV / Booking" },
  { value: "purchase", label: "Purchase" },
  { value: "cart", label: "Add to cart" },
  { value: "contact", label: "Contact (appel / WhatsApp / DM)" },
  { value: "autre", label: "Autre" },
];

const KPIS = [
  { value: "cpl", label: "CPL (coût par lead)" },
  { value: "cout_rdv", label: "Coût par RDV" },
  { value: "cpa", label: "CPA (achat)" },
  { value: "roas", label: "ROAS" },
  { value: "cout_essai", label: "Coût par essai" },
  { value: "autre", label: "Autre" },
];

export function StepB({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">B</span>
        <div>
          <h2 className="section-title">Objectif + Conversion</h2>
          <p className="section-desc mt-1">Définissez ce que vous voulez obtenir de vos campagnes et comment mesurer le succès.</p>
        </div>
      </div>

      <div className="divider" />

      <BrutalistCheckboxGroup
        label="Objectif principal *"
        options={OBJECTIFS}
        selected={data.b_objectif}
        onChange={(v) => onChange({ b_objectif: v })}
        withOther
        otherValue={data.b_objectif_autre}
        onOtherChange={(v) => onChange({ b_objectif_autre: v })}
        otherPlaceholder="Précisez votre objectif..."
      />

      <BrutalistCheckboxGroup
        label="Conversion à optimiser *"
        options={CONVERSIONS}
        selected={data.b_conversion}
        onChange={(v) => onChange({ b_conversion: v })}
        withOther
        otherValue={data.b_conversion_autre}
        onOtherChange={(v) => onChange({ b_conversion_autre: v })}
        otherPlaceholder="Précisez l'événement de conversion..."
      />

      <BrutalistInput
        label="Nom de l'événement de conversion"
        placeholder="Ex : Lead, Purchase, CompleteRegistration..."
        value={data.b_event_name}
        onChange={(e) => onChange({ b_event_name: e.target.value })}
        hint="Indiquez le nom exact de l'événement Meta si vous le connaissez."
      />

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-lf-yellow">
        <h3 className="font-black uppercase text-sm tracking-wider mb-4">Définition qualité du lead</h3>
        <div className="flex flex-col gap-4">
          <BrutalistTextarea
            label="Critère 1 *"
            placeholder="Ex : Société de + de 1M€ de CA annuel, + de 2 ans d'existence..."
            value={data.b_qualite_critere1}
            onChange={(e) => onChange({ b_qualite_critere1: e.target.value })}
            rows={3}
            required
          />
          <BrutalistTextarea
            label="Critère 2 (optionnel)"
            placeholder="Ex : En cours de recrutement d'une force commerciale..."
            value={data.b_qualite_critere2}
            onChange={(e) => onChange({ b_qualite_critere2: e.target.value })}
            rows={3}
          />
        </div>
      </div>

      <div className="divider" />

      <BrutalistCheckboxGroup
        label="KPI principal *"
        options={KPIS}
        selected={data.b_kpi}
        onChange={(v) => onChange({ b_kpi: v })}
        withOther
        otherValue={data.b_kpi_autre}
        onOtherChange={(v) => onChange({ b_kpi_autre: v })}
        otherPlaceholder="Précisez votre KPI..."
      />

      <BrutalistInput
        label="Objectif chiffré"
        placeholder="Ex : Minimum 4 RDV / semaine, CPL < 50€..."
        value={data.b_objectif_chiffre}
        onChange={(e) => onChange({ b_objectif_chiffre: e.target.value })}
        hint="Si vous avez un objectif précis, indiquez-le ici."
      />
    </div>
  );
}
