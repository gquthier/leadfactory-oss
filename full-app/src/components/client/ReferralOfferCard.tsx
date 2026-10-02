import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";

interface Props {
  variant?: "compact" | "full";
  secondaryLink?: { href: string; label: string };
}

export function ReferralOfferCard({ variant = "full", secondaryLink }: Props) {
  return (
    <div className="card-brutal p-0 overflow-hidden mb-8">
      <div className="bg-lf-yellow p-6 border-b-3 border-black flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-black/50 mb-2">Recommandations</p>
          <h2 className="text-3xl font-black uppercase leading-none">Une mise en relation, avec votre accord</h2>
        </div>
        <Users className="w-8 h-8 text-black/30 flex-shrink-0" />
      </div>
      <div className="p-6">
        <p className="font-medium text-lf-gray mb-5">
          Définissez avec votre agence le destinataire, les modalités et les informations que vous souhaitez partager.
          Aucun message, témoignage ou avantage commercial n’est prérempli.
        </p>
        {variant === "full" && (
          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            {["Choisir la mise en relation", "Valider les informations", "Partager volontairement"].map((label) => (
              <div key={label} className="border-3 border-black bg-gray-50 p-4 font-black text-sm">{label}</div>
            ))}
          </div>
        )}
        <Link href={secondaryLink?.href || "/client/espace-partenaire"} className="inline-flex items-center gap-2 px-5 py-3 bg-lf-black text-white border-3 border-black font-black text-sm">
          {secondaryLink?.label || "Ouvrir l’espace partenaire"}<ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
