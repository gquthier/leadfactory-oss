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

const RESEAUX = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
];

const TYPES = [
  { value: "service", label: "Service" },
  { value: "saas", label: "SaaS" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "app", label: "App" },
  { value: "local", label: "Local" },
  { value: "autre", label: "Autre" },
];

export function StepA({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      {/* Section header */}
      <div className="flex items-start gap-4">
        <span className="section-letter">A</span>
        <div>
          <h2 className="section-title">Infos de base</h2>
          <p className="section-desc mt-1">Présentez votre entreprise et votre offre en quelques lignes.</p>
        </div>
      </div>

      <div className="divider" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BrutalistInput
          label="Entreprise / Marque"
          placeholder="Ex : Acme Corp"
          value={data.a_entreprise}
          onChange={(e) => onChange({ a_entreprise: e.target.value })}
          required
        />
        <BrutalistInput
          label="Pays / Langues ciblés"
          placeholder="Ex : France / Français"
          value={data.a_pays_langues}
          onChange={(e) => onChange({ a_pays_langues: e.target.value })}
          required
        />
      </div>

      <BrutalistCheckboxGroup
        label="Réseaux"
        options={RESEAUX}
        selected={data.a_reseaux}
        onChange={(v) => onChange({ a_reseaux: v })}
        hint="Sélectionnez les réseaux sur lesquels vous souhaitez diffuser."
      />

      <div className="divider" />

      <BrutalistRadioGroup
        label="Type d'offre"
        options={TYPES}
        value={data.a_type}
        onChange={(v) => onChange({ a_type: v })}
        withOther
        otherValue={data.a_type_autre}
        onOtherChange={(v) => onChange({ a_type_autre: v })}
        otherPlaceholder="Précisez votre type d'offre..."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BrutalistInput
          label="Prix / Panier moyen"
          placeholder="Ex : 2 300 €"
          value={data.a_prix}
          onChange={(e) => onChange({ a_prix: e.target.value })}
          required
        />
        <BrutalistInput
          label="Cycle de décision / Achat"
          placeholder="Ex : R1, voir R2 — environ 7 jours"
          value={data.a_cycle_decision}
          onChange={(e) => onChange({ a_cycle_decision: e.target.value })}
        />
      </div>

      <BrutalistTextarea
        label="Résumé de l'offre"
        placeholder="Décrivez votre offre en 3-5 phrases. Qu'est-ce que vous vendez, à qui, et pourquoi ça marche ?"
        value={data.a_resume_offre}
        onChange={(e) => onChange({ a_resume_offre: e.target.value })}
        rows={4}
        required
      />

      <div className="divider" />

      <BrutalistTextarea
        label="Caractéristique — Avantage — Bénéfice"
        placeholder="Ex : Expertise rare (caract.) → Meilleur taux de conversion (avantage) → Plus de CA (bénéfice)"
        value={data.a_cab}
        onChange={(e) => onChange({ a_cab: e.target.value })}
        rows={4}
      />

      <BrutalistTextarea
        label="Quels problèmes résolvez-vous pour vos clients ?"
        placeholder="Décrivez les problèmes directs et indirects que vous résolvez..."
        value={data.a_problemes}
        onChange={(e) => onChange({ a_problemes: e.target.value })}
        rows={4}
        required
      />

      <BrutalistTextarea
        label="Fonctionnalités / Éléments différenciants"
        placeholder="Qu'est-ce qui vous rend unique par rapport à la concurrence ?"
        value={data.a_differenciants}
        onChange={(e) => onChange({ a_differenciants: e.target.value })}
        rows={3}
      />

      <BrutalistTextarea
        label="Bénéfices concrets obtenus par vos clients"
        placeholder="Ex : CA, gain de temps, pérennisation de l'activité..."
        value={data.a_benefices}
        onChange={(e) => onChange({ a_benefices: e.target.value })}
        rows={3}
      />

      <div className="divider" />

      <BrutalistTextarea
        label="Principaux concurrents"
        placeholder="Listez vos concurrents principaux et secondaires..."
        value={data.a_concurrents}
        onChange={(e) => onChange({ a_concurrents: e.target.value })}
        rows={3}
      />

      <BrutalistTextarea
        label="Comment vous différenciez-vous de chacun ?"
        placeholder="Pour chaque concurrent, expliquez votre avantage comparatif..."
        value={data.a_differenciation}
        onChange={(e) => onChange({ a_differenciation: e.target.value })}
        rows={4}
      />

      <BrutalistTextarea
        label="Pitch / Démo / Message commercial clé"
        placeholder="Partagez votre pitch principal, un lien vers une démo, ou votre message clé..."
        value={data.a_pitch}
        onChange={(e) => onChange({ a_pitch: e.target.value })}
        rows={3}
      />
    </div>
  );
}
