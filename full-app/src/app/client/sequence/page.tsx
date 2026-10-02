import { redirect } from "next/navigation";
import { Mail, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase-server";
import { OutboundCard } from "@/components/client/OutboundCard";

export const dynamic = "force-dynamic";

export default async function OutboundHubPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">OUTBOUND IA</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Outbound</h1>
        <p className="text-lf-gray font-medium mt-2">
          Choisis l&apos;outil que tu veux utiliser pour ton outbound.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <OutboundCard
          href="/client/sequence/cold-email"
          icon={Mail}
          title="Écriture Cold Email"
          description="Génère une séquence d'emails personnalisée avec l'IA, basée sur ton ICP et ton offre."
          iconColor="blue"
        />
        <OutboundCard
          href="/client/sequence/google-maps"
          icon={MapPin}
          title="Scraping Google Maps"
          description="Colle un lien Google Maps et récupère un CSV de leads prêts pour le cold call (téléphones, emails, scoring de priorité)."
          badge="Nouveau"
          iconColor="yellow"
        />
      </div>
    </div>
  );
}
