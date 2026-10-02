import { redirect } from "next/navigation";
import Link from "next/link";
import { PhoneCall, Plus, ArrowLeft, Sparkles, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase-server";
import { listConversations } from "@/lib/cold-call-script-writer/chat-data";

export const dynamic = "force-dynamic";

export default async function ColdCallScriptHubPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  let items: Awaited<ReturnType<typeof listConversations>> = [];
  try {
    items = await listConversations(session.user.id);
  } catch {
    items = [];
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <Link
        href="/client/sales"
        className="inline-flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Sales
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="sticker-yellow -rotate-1 inline-block mb-3">COLD CALL SCRIPT WRITER</div>
          <h1 className="text-3xl font-black uppercase tracking-tight flex items-center gap-3">
            <PhoneCall className="w-7 h-7" /> Cold Call Script Writer
          </h1>
          <p className="text-lf-gray font-medium mt-2 max-w-2xl">
            Chatte avec l&apos;IA experte cold call B2B — elle connaît déjà ton
            offre, ton ICP, tes pains, ton pricing (via ton brief d&apos;onboarding).
            Co-construis ton script en live, itère en langage naturel.
          </p>
        </div>

        <Link
          href="/client/sales/cold-call-script/new"
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Nouvelle conversation
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="card-brutal p-10 text-center">
          <PhoneCall className="w-10 h-10 mx-auto mb-4 text-lf-gray" />
          <h3 className="text-xl font-black uppercase tracking-tight mb-2">
            Aucune conversation pour le moment
          </h3>
          <p className="text-sm font-medium text-lf-gray mb-6 max-w-md mx-auto">
            Démarre une conversation — l&apos;IA pull ton brief automatiquement
            et génère ton premier script dès ton premier message.
          </p>
          <Link
            href="/client/sales/cold-call-script/new"
            className="btn-primary inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Démarrer
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((c) => {
            const hasScript = Boolean(
              c.current_script &&
                typeof c.current_script === "object" &&
                "meta" in (c.current_script as object)
            );
            const headline = hasScript
              ? ((c.current_script as { meta?: { headline?: string } }).meta?.headline ?? null)
              : null;
            const turnCount = Math.floor((c.messages?.length ?? 0) / 2);
            return (
              <Link
                key={c.id}
                href={`/client/sales/cold-call-script/${c.id}`}
                className={`card-brutal p-5 flex flex-col gap-3 transition-all hover:shadow-[10px_10px_0px_0px_#000] hover:-translate-y-1 ${
                  c.pinned ? "ring-4 ring-lf-yellow ring-offset-2" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-black uppercase tracking-tight leading-tight flex-1">
                    {c.title}
                  </h3>
                  {c.pinned && <Pin className="w-4 h-4 flex-shrink-0" />}
                </div>
                {headline && (
                  <p className="text-sm text-lf-gray font-medium line-clamp-2 italic">
                    {headline}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs font-bold pt-3 border-t-2 border-black">
                  <span className="border-2 border-black px-2 py-0.5 bg-white">
                    {turnCount} {turnCount > 1 ? "tours" : "tour"}
                  </span>
                  {hasScript && (
                    <span className="border-2 border-black px-2 py-0.5 bg-lf-green text-white">
                      Script prêt
                    </span>
                  )}
                  <span className="ml-auto text-lf-gray font-medium">
                    {new Date(c.updated_at).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
