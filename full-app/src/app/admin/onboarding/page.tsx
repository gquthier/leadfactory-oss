import { createClient, createAdminClient } from "@/lib/supabase-server";
import { getVisibleOnboardingResponses } from "@/lib/onboarding-briefs";
import { redirect } from "next/navigation";
import { OnboardingCard } from "@/components/admin/OnboardingCard";

export default async function AdminOnboarding() {
  // Auth check
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  // Use service role to bypass RLS — admins must see ALL briefs
  const adminSupabase = createAdminClient();
  const { data: responses, error } = await adminSupabase
    .from("onboarding_responses")
    .select("*")
    .order("submitted_at", { ascending: false });

  if (error) console.error("[admin/onboarding] DB error:", error.message);

  const visibleResponses = getVisibleOnboardingResponses(responses);
  const pending = visibleResponses.filter((r) => !r.client_id);
  const processed = visibleResponses.filter((r) => !!r.client_id);

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <div className="mb-8">
        <div className="sticker -rotate-1 inline-block mb-3">BRIEFS</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Onboarding</h1>
        <p className="text-lf-gray font-medium mt-1">
          {pending.length} brief{pending.length > 1 ? "s" : ""} en attente · {processed.length} traité{processed.length > 1 ? "s" : ""}
        </p>
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <div className="mb-10">
          <h2 className="font-black uppercase tracking-wider text-sm mb-4 flex items-center gap-2">
            <span className="bg-lf-yellow border-2 border-black px-2 py-0.5">{pending.length}</span>
            À traiter
          </h2>
          <div className="flex flex-col gap-4">
            {pending.map((r) => (
              <OnboardingCard key={r.id} response={r} />
            ))}
          </div>
        </div>
      )}

      {/* Processed */}
      {processed.length > 0 && (
        <div>
          <h2 className="font-black uppercase tracking-wider text-sm mb-4 text-lf-gray">
            Traités ({processed.length})
          </h2>
          <div className="flex flex-col gap-3">
            {processed.map((r) => (
              <OnboardingCard key={r.id} response={r} processed />
            ))}
          </div>
        </div>
      )}

      {!visibleResponses.length && (
        <div className="card-brutal p-12 text-center">
          <p className="text-2xl font-black mb-2">Aucun brief reçu</p>
          <p className="text-lf-gray font-medium">Les soumissions du questionnaire d'onboarding apparaîtront ici.</p>
        </div>
      )}
    </div>
  );
}
