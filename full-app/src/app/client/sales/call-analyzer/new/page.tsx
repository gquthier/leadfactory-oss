import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { NewAnalysisForm } from "./NewAnalysisForm";

export const dynamic = "force-dynamic";

export default async function NewAnalysisPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: keys } = await admin
    .from("client_external_api_keys")
    .select("provider, key_preview")
    .eq("client_id", session.user.id);

  const connectedProviders: Record<string, string> = {};
  (keys ?? []).forEach((k) => {
    connectedProviders[k.provider] = k.key_preview;
  });

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <Link
        href="/client/sales/call-analyzer"
        className="inline-flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Sales Call Analyzer
      </Link>

      <div className="mb-6">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">NOUVEAU CALL</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Analyser un call</h1>
        <p className="text-lf-gray font-medium mt-2">
          Choisis ton AI Notetaker, colle l&apos;URL d&apos;un meeting ou paste le transcript brut. L&apos;analyse prend 30 à 90 secondes.
        </p>
      </div>

      <NewAnalysisForm connectedProviders={connectedProviders} />
    </div>
  );
}
