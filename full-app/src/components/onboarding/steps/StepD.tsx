"use client";

import { OnboardingData } from "@/types/onboarding";
import { BrutalistInput } from "@/components/ui/BrutalistInput";
import { BrutalistTextarea } from "@/components/ui/BrutalistTextarea";

interface Props {
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
}

function CibleBlock({
  num,
  prefix,
  data,
  onChange,
  bgClass,
}: {
  num: number;
  prefix: "d_cible1" | "d_cible2";
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
  bgClass: string;
}) {
  const f = (key: string) => `${prefix}_${key}` as keyof OnboardingData;
  const val = (key: string) => data[f(key)] as string;
  const set = (key: string) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
    onChange({ [f(key)]: e.target.value } as Partial<OnboardingData>);

  return (
    <div className={`card-brutal-sm p-6 ${bgClass}`}>
      <h3 className="font-black uppercase tracking-wider mb-5">Cible {num}</h3>
      <div className="flex flex-col gap-5">
        <BrutalistInput
          label={`Description de la cible ${num}`}
          placeholder="Ex : Entreprises du BTP"
          value={val("description")}
          onChange={set("description")}
          required={num === 1}
        />
        <BrutalistInput
          label="Secteur d'activité + taille"
          placeholder="Ex : BTP, architectes, maître d'œuvre — 1M€ CA min, 6 employés min"
          value={val("secteur")}
          onChange={set("secteur")}
        />
        <BrutalistInput
          label="Fonctions / Titres visés"
          placeholder="Ex : Dirigeant, Directeur d'agence, Directeur commercial..."
          value={val("fonctions")}
          onChange={set("fonctions")}
        />
        <BrutalistTextarea
          label="Problèmes rencontrés au quotidien"
          placeholder="Quelles douleurs, frustrations ou défis cette cible rencontre-t-elle ?"
          value={val("problemes")}
          onChange={set("problemes")}
          rows={3}
        />
        <BrutalistTextarea
          label="Votre valeur ajoutée pour cette cible"
          placeholder="En quoi votre offre résout spécifiquement leurs problèmes ?"
          value={val("valeur")}
          onChange={set("valeur")}
          rows={3}
        />
        <BrutalistTextarea
          label="Freins / Objections à l'achat"
          placeholder="Qu'est-ce qui pourrait les empêcher d'acheter ou de répondre à vos annonces ?"
          value={val("freins")}
          onChange={set("freins")}
          rows={3}
        />
        <BrutalistTextarea
          label="Motivations psychologiques de l'acheteur"
          placeholder="Ex : Sécurité financière, gain de temps, ambition de croissance..."
          value={val("motivations")}
          onChange={set("motivations")}
          rows={3}
        />
      </div>
    </div>
  );
}

export function StepD({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">D</span>
        <div>
          <h2 className="section-title">Ciblage + Proposition de valeur</h2>
          <p className="section-desc mt-1">Décrivez vos segments cibles, leurs douleurs, et pourquoi votre offre leur correspond.</p>
        </div>
      </div>

      <div className="divider" />

      <CibleBlock
        num={1}
        prefix="d_cible1"
        data={data}
        onChange={onChange}
        bgClass="bg-white"
      />

      <CibleBlock
        num={2}
        prefix="d_cible2"
        data={data}
        onChange={onChange}
        bgClass="bg-lf-pink/20"
      />

      <div className="divider" />

      <BrutalistTextarea
        label="Exclusions importantes (à éviter)"
        placeholder="Ex : Toutes les entreprises dont le domaine n'est pas représenté dans les marchés publics (immobilier, retail, BtoC...)."
        value={data.d_exclusions}
        onChange={(e) => onChange({ d_exclusions: e.target.value })}
        rows={4}
        hint="Précisez les profils à exclure absolument de vos campagnes."
      />
    </div>
  );
}
