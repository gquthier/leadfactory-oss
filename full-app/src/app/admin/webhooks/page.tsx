import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { WebhooksAdminClient, type ClientRow } from "./WebhooksAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminWebhooksPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  if (me?.role !== "admin") redirect("/client/overview");

  // Fetch all client profiles + their active webhook keys count
  const { data: clients } = await admin
    .from("profiles")
    .select("id, full_name, email, company, role, is_active, created_at")
    .eq("role", "client")
    .order("created_at", { ascending: false })
    .limit(200);

  // Fetch active keys grouped by client (no secrets, just metadata).
  const clientIds = (clients ?? []).map((c) => c.id);
  const keysByClient: Record<string, ClientRow["keys"]> = {};
  if (clientIds.length > 0) {
    const { data: keys } = await admin
      .from("integration_api_keys")
      .select("id, client_id, label, key_prefix, provider, last_used_at, created_at")
      .in("client_id", clientIds)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    for (const k of keys ?? []) {
      if (!keysByClient[k.client_id]) keysByClient[k.client_id] = [];
      keysByClient[k.client_id].push({
        id: k.id,
        label: k.label,
        key_prefix: k.key_prefix,
        provider: k.provider,
        last_used_at: k.last_used_at,
        created_at: k.created_at,
      });
    }
  }

  const rows: ClientRow[] = (clients ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    company: c.company,
    is_active: c.is_active,
    created_at: c.created_at,
    keys: keysByClient[c.id] ?? [],
  }));

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      <div className="mb-6">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">ADMIN</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Webhooks par client</h1>
        <p className="text-lf-gray font-medium mt-2 max-w-3xl">
          Provisionnez en un clic une clé webhook + un template Make.com prêt à
          importer pour chaque client. Le template branche le module Meta Lead
          Ads sur le webhook entrant LeadFactory du client choisi. Vous n&apos;avez
          qu&apos;à connecter le compte Facebook du client dans Make + sélectionner
          la Page et le formulaire.
        </p>
      </div>

      <WebhooksAdminClient initialClients={rows} />
    </div>
  );
}
