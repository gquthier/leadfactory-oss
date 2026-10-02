"use client";

import { OnboardingData } from "@/types/onboarding";
import { BrutalistInput } from "@/components/ui/BrutalistInput";
import { BrutalistTextarea } from "@/components/ui/BrutalistTextarea";
import { BrutalistRadioGroup } from "@/components/ui/BrutalistRadioGroup";

interface Props {
  data: OnboardingData;
  onChange: (patch: Partial<OnboardingData>) => void;
}

const BM_OPTIONS = [
  { value: "a_donner", label: "À donner" },
  { value: "ok", label: "OK ✓" },
];

const PIXEL_CAPI_OPTIONS = [
  { value: "a_donner", label: "À donner" },
  { value: "a_verifier", label: "À vérifier" },
  { value: "ok", label: "OK ✓" },
];

const OUTIL_OPTIONS = [
  { value: "acces", label: "Accès complet" },
  { value: "exports", label: "Exports uniquement" },
];

function AccessRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b-3 border-black last:border-b-0">
      <span className="font-bold uppercase text-sm tracking-wide sm:w-48 flex-shrink-0">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function StepH({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <span className="section-letter">H</span>
        <div>
          <h2 className="section-title">Assets + Validation + Accès</h2>
          <p className="section-desc mt-1">Dernière étape — partagez vos ressources et précisez les accès à nous donner.</p>
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-white">
        <h3 className="font-black uppercase text-sm tracking-wider mb-5">Assets disponibles</h3>
        <div className="flex flex-col gap-5">
          <BrutalistInput
            label="Logo / Charte graphique / Brand guidelines"
            placeholder="Lien Drive, Dropbox, WeTransfer ou description..."
            value={data.h_logo}
            onChange={(e) => onChange({ h_logo: e.target.value })}
          />
          <BrutalistInput
            label="Visuels / UGC / Vidéos / Démos"
            placeholder="Lien vers les fichiers ou 'Aucun'"
            value={data.h_visuels}
            onChange={(e) => onChange({ h_visuels: e.target.value })}
          />
          <BrutalistTextarea
            label="Preuves (cas clients, avis, chiffres)"
            placeholder="Lien vers les témoignages, captures d'écran, études de cas..."
            value={data.h_preuves}
            onChange={(e) => onChange({ h_preuves: e.target.value })}
            rows={3}
          />
          <BrutalistInput
            label="Pages à promouvoir"
            placeholder="URLs des pages de destination, landing pages..."
            value={data.h_pages}
            onChange={(e) => onChange({ h_pages: e.target.value })}
          />
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-lf-yellow">
        <h3 className="font-black uppercase text-sm tracking-wider mb-2">Ressources créatives</h3>
        <p className="text-sm text-lf-gray font-medium mb-5">
          Nous allons réaliser des créatifs sur mesure pour vos campagnes. Partagez-nous vos ressources visuelles et typographiques pour que nos designs soient alignés avec votre marque.
        </p>
        <div className="flex flex-col gap-5">
          <BrutalistTextarea
            label="Drive / dossier de ressources visuelles (facultatif)"
            placeholder="Collez ici le lien vers un Google Drive, Dropbox ou WeTransfer contenant vos images, photos, vidéos, logos, mockups et tout autre visuel que nous pourrions utiliser pour créer vos publicités."
            value={data.h_drive_creatifs}
            onChange={(e) => onChange({ h_drive_creatifs: e.target.value })}
            rows={3}
          />
          <BrutalistInput
            label="Police(s) de caractères utilisée(s) (facultatif)"
            placeholder="Ex : Montserrat, Inter, Poppins..."
            value={data.h_police}
            onChange={(e) => onChange({ h_police: e.target.value })}
          />
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal-sm p-6 bg-lf-pink">
        <h3 className="font-black uppercase text-sm tracking-wider mb-5">Processus de validation</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <BrutalistInput
            label="Qui valide les créatives ?"
            placeholder="Ex : Nathan et Vincent"
            value={data.h_qui_valide}
            onChange={(e) => onChange({ h_qui_valide: e.target.value })}
          />
          <BrutalistInput
            label="Délai moyen de validation"
            placeholder="Ex : 1 jour ouvré"
            value={data.h_delai_validation}
            onChange={(e) => onChange({ h_delai_validation: e.target.value })}
          />
        </div>
      </div>

      <div className="divider" />

      <div className="card-brutal-sm overflow-hidden">
        <div className="bg-lf-black text-white px-5 py-3">
          <span className="font-black uppercase text-sm tracking-wider">Accès à donner</span>
        </div>
        <div className="px-5 py-2">
          <AccessRow label="Business Manager">
            <BrutalistRadioGroup
              label=""
              options={BM_OPTIONS}
              value={data.h_bm}
              onChange={(v) => onChange({ h_bm: v })}
            />
          </AccessRow>
          <AccessRow label="Compte publicitaire">
            <BrutalistRadioGroup
              label=""
              options={BM_OPTIONS}
              value={data.h_compte_pub}
              onChange={(v) => onChange({ h_compte_pub: v })}
            />
          </AccessRow>
          <AccessRow label="Pixel + CAPI">
            <BrutalistRadioGroup
              label=""
              options={PIXEL_CAPI_OPTIONS}
              value={data.h_pixel_capi}
              onChange={(v) => onChange({ h_pixel_capi: v })}
            />
          </AccessRow>
          <AccessRow label="Page Facebook / Instagram">
            <BrutalistRadioGroup
              label=""
              options={BM_OPTIONS}
              value={data.h_page_fb_ig}
              onChange={(v) => onChange({ h_page_fb_ig: v })}
            />
          </AccessRow>
          <AccessRow label="Domaine (vérification)">
            <BrutalistRadioGroup
              label=""
              options={[
                { value: "a_faire", label: "À faire" },
                { value: "ok", label: "OK ✓" },
              ]}
              value={data.h_domaine}
              onChange={(v) => onChange({ h_domaine: v })}
            />
          </AccessRow>
          <AccessRow label="Outil (CRM / Shopify…)">
            <BrutalistRadioGroup
              label=""
              options={OUTIL_OPTIONS}
              value={data.h_outil}
              onChange={(v) => onChange({ h_outil: v })}
            />
          </AccessRow>
        </div>
      </div>
    </div>
  );
}
