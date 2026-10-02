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

const TRACKING_STATUS = [
  { value: "oui", label: "Oui ✓" },
  { value: "non", label: "Non ✗" },
  { value: "sais_pas", label: "Je ne sais pas" },
];

const CRM_OPTIONS = [
  { value: "hubspot", label: "HubSpot" },
  { value: "pipedrive", label: "Pipedrive" },
  { value: "salesforce", label: "Salesforce" },
  { value: "shopify", label: "Shopify" },
  { value: "autre", label: "Autre" },
  { value: "aucun", label: "Aucun" },
];

function TrackingStatus({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 border-3 border-black bg-white">
      <span className="font-bold uppercase text-sm tracking-wide">{label}</span>
      <div className="flex gap-2">
        {TRACKING_STATUS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-2 border-3 border-black text-xs font-bold uppercase tracking-wide transition-all duration-100 ${
              value === opt.value
                ? opt.value === "oui"
                  ? "bg-lf-green text-white shadow-brutal-xs translate-x-[2px] translate-y-[2px]"
                  : opt.value === "non"
                  ? "bg-red-500 text-white shadow-brutal-xs translate-x-[2px] translate-y-[2px]"
                  : "bg-lf-yellow text-black shadow-brutal-xs translate-x-[2px] translate-y-[2px]"
                : "bg-white text-black shadow-brutal-xs hover:bg-gray-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StepF({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">F</span>
        <div>
          <h2 className="section-title">Tracking</h2>
          <p className="section-desc mt-1">Faites le point sur votre configuration actuelle de tracking. Essentiel pour optimiser les campagnes.</p>
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal-sm overflow-hidden">
        <div className="bg-lf-black text-white px-5 py-3">
          <span className="font-black uppercase text-sm tracking-wider">Setup actuel</span>
        </div>
        <div className="flex flex-col divide-y-3 divide-black">
          <TrackingStatus
            label="Pixel Meta"
            value={data.f_pixel}
            onChange={(v) => onChange({ f_pixel: v })}
          />
          <TrackingStatus
            label="CAPI (Conversions API)"
            value={data.f_capi}
            onChange={(v) => onChange({ f_capi: v })}
          />
          <TrackingStatus
            label="GA4 (Google Analytics)"
            value={data.f_ga4}
            onChange={(v) => onChange({ f_ga4: v })}
          />
        </div>
      </div>

      <BrutalistCheckboxGroup
        label="CRM / Outil utilisé"
        options={CRM_OPTIONS}
        selected={data.f_crm}
        onChange={(v) => onChange({ f_crm: v })}
        withOther
        otherValue={data.f_crm_autre}
        onOtherChange={(v) => onChange({ f_crm_autre: v })}
        otherPlaceholder="Précisez votre CRM ou outil..."
      />

      <BrutalistInput
        label="Source de données la plus fiable"
        placeholder="Ex : Calendly, CRM, Shopify, Manuellement..."
        value={data.f_source_fiable}
        onChange={(e) => onChange({ f_source_fiable: e.target.value })}
        hint="Quelle est votre source de vérité pour valider les performances ?"
      />

      <BrutalistTextarea
        label="Comment validez-vous un bon lead / une bonne vente ?"
        placeholder="Ex : Bon lead = critères de qualité respectés + présence à la visio + capacité à signer dans les 30 jours."
        value={data.f_validation_lead}
        onChange={(e) => onChange({ f_validation_lead: e.target.value })}
        rows={4}
        hint="Décrivez votre définition interne d'un lead ou d'une vente de qualité."
      />
    </div>
  );
}
