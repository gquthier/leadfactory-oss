import { redirect } from "next/navigation";
import { Headphones, PhoneCall } from "lucide-react";
import { createClient } from "@/lib/supabase-server";
import { OutboundCard } from "@/components/client/OutboundCard";

export const dynamic = "force-dynamic";

export default async function SalesHubPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">SALES IA</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Sales</h1>
        <p className="text-lf-gray font-medium mt-2">
          Coache tes appels de vente avec l&apos;IA. Analyse tes calls, génère tes scripts de cold call, monte en compétences sur ton sales game.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <OutboundCard
          href="/client/sales/call-analyzer"
          icon={Headphones}
          title="Sales Call Analyzer"
          description="Colle l'URL d'un meeting Fathom (ou le transcript brut) et reçois un score, les 3 leviers à activer au prochain call, les objections détectées et le verdict d'alignement à la doctrine LeadFactory."
          badge="Live"
          iconColor="blue"
        />
        <OutboundCard
          href="/client/sales/cold-call-script"
          icon={PhoneCall}
          title="Cold Call Script Writer"
          description="Décris ton offre, ton ICP et ton ton — l'IA experte cold call B2B te génère un script complet : openers, pitch 7/15/30 sec, discovery questions, matrice d'objections, closes, voicemails et coaching tonalité."
          badge="Nouveau"
          iconColor="yellow"
        />
      </div>
    </div>
  );
}
