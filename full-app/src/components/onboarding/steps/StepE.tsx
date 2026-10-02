"use client";

import { OnboardingData } from "@/types/onboarding";
import { BrutalistInput } from "@/components/ui/BrutalistInput";
import { BrutalistTextarea } from "@/components/ui/BrutalistTextarea";
import { BrutalistRadioGroup } from "@/components/ui/BrutalistRadioGroup";

interface Props {
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
}

const DESTINATIONS = [
  { value: "landing", label: "Landing page" },
  { value: "formulaire_meta", label: "Formulaire instantané Meta" },
  { value: "messages", label: "Messages" },
  { value: "appel", label: "Appel" },
  { value: "rdv", label: "Prise de RDV (Calendly / autre)" },
  { value: "boutique", label: "Boutique / Page produit" },
  { value: "app_store", label: "App store" },
  { value: "autre", label: "Autre" },
];

export function StepE({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">E</span>
        <div>
          <h2 className="section-title">Parcours + Expérience après le clic</h2>
          <p className="section-desc mt-1">Où envoyez-vous vos prospects et comment les traitez-vous une fois qu'ils ont cliqué ?</p>
        </div>
      </div>

      <div className="divider" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BrutalistRadioGroup
          label="Destination prioritaire *"
          options={DESTINATIONS}
          value={data.e_destination_principale}
          onChange={(v) => onChange({ e_destination_principale: v })}
          inline={false}
          withOther
          otherValue={data.e_destination_principale_autre}
          onOtherChange={(v) => onChange({ e_destination_principale_autre: v })}
          otherPlaceholder="Précisez la destination..."
        />
        <BrutalistRadioGroup
          label="Destination testable (variante A/B)"
          options={DESTINATIONS}
          value={data.e_destination_testable}
          onChange={(v) => onChange({ e_destination_testable: v })}
          inline={false}
          withOther
          otherValue={data.e_destination_testable_autre}
          onOtherChange={(v) => onChange({ e_destination_testable_autre: v })}
          otherPlaceholder="Précisez..."
        />
      </div>

      <div className="divider" />

      <div className="flex flex-col gap-5">
        <BrutalistInput
          label="URL / Lien principal"
          placeholder="https://calendly.com ou https://votresite.com/landing"
          value={data.e_url}
          onChange={(e) => onChange({ e_url: e.target.value })}
          type="url"
          hint="Lien exact vers lequel les annonces vont rediriger."
        />
        <BrutalistInput
          label="CTA exact affiché sur l'annonce"
          placeholder="Ex : Réservez un appel"
          value={data.e_cta_exact}
          onChange={(e) => onChange({ e_cta_exact: e.target.value })}
          hint="Le texte du bouton tel qu'il apparaîtra dans l'annonce."
        />
      </div>

      <div className="card-brutal-sm p-6 bg-lf-yellow">
        <h3 className="font-black uppercase text-sm tracking-wider mb-4">Ce que voit l'utilisateur après le clic</h3>
        <div className="flex flex-col gap-4">
          <BrutalistInput
            label="Phrase 1 — Message d'accueil"
            placeholder="Ex : Bonjour ! Choisissez un créneau qui vous convient."
            value={data.e_post_clic_phrase1}
            onChange={(e) => onChange({ e_post_clic_phrase1: e.target.value })}
          />
          <BrutalistInput
            label="Phrase 2 — Suite du message"
            placeholder="Ex : Un expert vous appellera dans les 24h."
            value={data.e_post_clic_phrase2}
            onChange={(e) => onChange({ e_post_clic_phrase2: e.target.value })}
          />
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-white">
        <h3 className="font-black uppercase text-sm tracking-wider mb-4">Traitement des leads</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <BrutalistInput
            label="Délai de réponse moyen"
            placeholder="Ex : 1 heure"
            value={data.e_delai_reponse}
            onChange={(e) => onChange({ e_delai_reponse: e.target.value })}
            hint="En heures."
          />
          <BrutalistInput
            label="Qui répond / rappelle ?"
            placeholder="Ex : Jean-Baptiste, commercial"
            value={data.e_qui_repond}
            onChange={(e) => onChange({ e_qui_repond: e.target.value })}
          />
          <BrutalistInput
            label="Capacité (RDV max / semaine)"
            placeholder="Ex : 15 RDV"
            value={data.e_capacite_rdv}
            onChange={(e) => onChange({ e_capacite_rdv: e.target.value })}
            hint="Optionnel."
          />
        </div>
      </div>
    </div>
  );
}
