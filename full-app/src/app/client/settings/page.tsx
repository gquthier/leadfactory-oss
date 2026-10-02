import {getPreviewClientId} from '@/lib/client-preview';
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ClientSettingsForm } from "./ClientSettingsForm";
import { SettingsTabs } from "./SettingsTabs";
import { IntegrationsPanel } from "./integrations/IntegrationsPanel";
import { MyBriefClient } from "./brief/MyBriefClient";
import { CreditsPanel } from "./credits/CreditsPanel";

export const dynamic = "force-dynamic";

type Tab = "profile" | "integrations" | "brief" | "credits";

function parseTab(value: string | string[] | undefined): Tab {
  const v = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  if (v === "integrations") return "integrations";
  if (v === "brief") return "brief";
  if (v === "credits") return "credits";
  return "profile";
}

export default async function ClientSettings(
  props: {
    searchParams?: Promise<{ tab?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const previewId=await getPreviewClientId();
  const effectiveId=previewId??session.user.id;
  const profileClient=previewId?createAdminClient():supabase;
  const { data: profile } = await profileClient
    .from("profiles")
    .select("full_name,company,phone,role,email")
    .eq("id", effectiveId)
    .single();

  const tab = parseTab(searchParams?.tab);

  let briefResponses: Record<string, unknown> | null = null;
  if (tab === "brief") {
    const admin = createAdminClient();
    const { data: briefRow } = await admin
      .from("onboarding_responses")
      .select("responses")
      .eq("client_id", effectiveId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    briefResponses = briefRow
      ? ((briefRow.responses ?? {}) as Record<string, unknown>)
      : null;
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <div className="sticker -rotate-1 inline-block mb-3">MON COMPTE</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Paramètres</h1>
        <p className="text-lf-gray font-medium mt-1">
          Gérez votre compte, vos intégrations et votre brief.
        </p>
      </div>

      <SettingsTabs active={tab} />

      <div className="mt-6">
        {tab === "profile" && (
          <div className="max-w-2xl">
            <fieldset disabled={!!previewId}><ClientSettingsForm profile={profile} email={profile?.email ?? ""} /></fieldset>
          </div>
        )}
        {tab === "integrations" && (previewId?<p>Les connexions personnelles sont accessibles dans la propre session du client, après configuration Auth.</p>:<IntegrationsPanel />)}
        {tab === "brief" && <MyBriefClient initialResponses={briefResponses} />}
        {tab === "credits" && (previewId?<p>Le solde personnel est consultable depuis la session authentifiée du client.</p>:<CreditsPanel />)}
      </div>
    </div>
  );
}
