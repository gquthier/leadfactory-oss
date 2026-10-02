import { redirect } from "next/navigation";
import Link from "next/link";
import { Linkedin, Film, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase-server";
import { OutboundCard } from "@/components/client/OutboundCard";

export const dynamic = "force-dynamic";

export default async function PersonalBrandHubPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">PERSONAL BRAND IA</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Personal Brand</h1>
        <p className="text-lf-gray font-medium mt-2">
          Fais grossir ton audience avec des posts qui sonnent comme toi et qui attirent ton ICP.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <OutboundCard
          href="/client/personal-brand/linkedin"
          icon={Linkedin}
          title="Générateur LinkedIn"
          description="Génère des posts LinkedIn viraux à partir de ton onboarding (offre, cible, promesse). Frameworks éprouvés, ton qui sonne humain, optimisé pour l'algo 2026."
          badge="Live"
          iconColor="blue"
        />
        <OutboundCard
          href="/client/personal-brand/reels"
          icon={Film}
          title="Générateur Reels"
          description="Scripts complets pour Instagram Reels, TikTok et YouTube Shorts. Hooks 1-3s qui retiennent, 12 frameworks B2B (Contrarian, Storytime, HALA…), visual cues prêts pour le montage, CTAs organiques anti-pitch."
          badge="Nouveau"
          iconColor="black"
        />
      </div>

      <Link
        href="/client/personal-brand/scheduled"
        className="card-brutal p-5 block group hover:shadow-[10px_10px_0px_0px_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all bg-white"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-lf-yellow border-3 border-black flex items-center justify-center flex-shrink-0">
            <Calendar className="w-5 h-5 text-black" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
              Mes posts programmés
            </h3>
            <p className="text-sm font-medium text-lf-gray">
              Calendrier des posts à publier sur ton LinkedIn — programme, modifie, suis le statut.
            </p>
          </div>
          <span className="text-[10px] font-black bg-black text-white px-2 py-1 uppercase tracking-wider">
            Nouveau
          </span>
        </div>
      </Link>
    </div>
  );
}
