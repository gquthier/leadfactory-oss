"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { UserPlus, X, Copy, Check, ChevronDown, CalendarClock, Pencil, Circle } from "lucide-react";
import {
  CANONICAL_CAMPAIGN_STATUSES,
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  type CanonicalCampaignStatus,
} from "@/types/index";

type CampaignRef = {
  id: string;
  name: string;
  status: string;
  ad_account_id: string | null;
};

type ClientRow = {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  created_at: string;
  next_catchup: string | null;
  first_login_at: string | null;
  last_seen_at: string | null;
  campaigns: CampaignRef[];
};

type MetaAccount = {
  id: string;
  name: string;
  account_id: string;
};

interface Props {
  clients: ClientRow[];
}

function getActiveCampaign(campaigns: CampaignRef[]): CampaignRef | undefined {
  const priority: CanonicalCampaignStatus[] = [
    "live_optimizing",
    "meta_account_setup",
    "ad_creative",
    "campaign_proposal",
    "brief_received",
  ];
  for (const status of priority) {
    const found = campaigns.find((c) => getCanonicalCampaignStatus(c) === status);
    if (found) return found;
  }
  return campaigns[0];
}

function getAdAccountId(campaigns: CampaignRef[]): string | null {
  return campaigns.find((c) => c.ad_account_id)?.ad_account_id ?? null;
}

// ── Activity status helper ───────────────────────────────────────────────────

function getActivityStatus(client: ClientRow): { label: string; dotColor: string; textColor: string } {
  if (!client.first_login_at) {
    return { label: "Jamais connecté", dotColor: "text-red-500", textColor: "text-red-600" };
  }
  if (!client.last_seen_at) {
    return { label: "Inactif", dotColor: "text-gray-400", textColor: "text-gray-500" };
  }
  const diffMs = Date.now() - new Date(client.last_seen_at).getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 1) return { label: "Actif aujourd'hui", dotColor: "text-green-500", textColor: "text-green-700" };
  if (diffDays < 7) return { label: `Vu il y a ${diffDays}j`, dotColor: "text-blue-500", textColor: "text-blue-600" };
  if (diffDays < 30) return { label: `Inactif ${diffDays}j`, dotColor: "text-yellow-500", textColor: "text-yellow-700" };
  return { label: `Inactif ${diffDays}j`, dotColor: "text-red-500", textColor: "text-red-600" };
}

// ── Catchup badge ────────────────────────────────────────────────────────────

function CatchupBadge({ date, saved }: { date: string; saved?: boolean }) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  let cls = "bg-white border-black";
  if (saved) cls = "bg-lf-green text-white border-lf-green";
  else if (diffDays < 0) cls = "bg-red-100 border-red-400 text-red-700";
  else if (diffDays === 0) cls = "bg-lf-green text-white border-lf-green";
  else if (diffDays <= 3) cls = "bg-lf-yellow border-black";

  return (
    <span className={`text-xs font-black px-2 py-0.5 border-2 inline-flex items-center gap-1 ${cls}`}>
      {saved ? <Check className="w-3 h-3" /> : null}
      {saved ? "Sauvegardé" : label}
      {!saved && diffDays >= 0 && diffDays <= 7 && (
        <span className="opacity-60">· {diffDays === 0 ? "auj." : `${diffDays}j`}</span>
      )}
      {!saved && diffDays < 0 && (
        <span className="opacity-70">· passé</span>
      )}
    </span>
  );
}

// ── Modal création client ────────────────────────────────────────────────────

interface Credentials {
  email: string;
  temp_password: string;
  campaign_id: string | null;
  ad_account_name: string | null;
}

function CreateClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    full_name: "",
    company: "",
    email: "",
    phone: "",
    ad_account_id: "",
    ad_account_name: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [copied, setCopied] = useState<"email" | "pass" | null>(null);

  const loadAccounts = async () => {
    if (accountsLoaded) return;
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/meta/accounts");
      if (res.ok) {
        const data = await res.json();
        const accounts: MetaAccount[] = (data.accounts ?? data ?? []).map((a: Record<string, unknown>) => ({
          id: String(a.id),
          name: String(a.name),
          account_id: String(a.account_id ?? a.id),
        }));
        setMetaAccounts(accounts);
        setAccountsLoaded(true);
      }
    } catch { /* silently fail */ }
    setLoadingAccounts(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setError("Le nom est requis"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/create-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name,
          company: form.company || form.full_name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          ad_account_id: form.ad_account_id || undefined,
          ad_account_name: form.ad_account_name || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur inconnue");
      if(data.local_only){onCreated();onClose();return;}
      setCredentials({
        email: data.email,
        temp_password: data.temp_password,
        campaign_id: data.campaign_id,
        ad_account_name: data.ad_account_name,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, type: "email" | "pass") => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-canvas border-3 border-black shadow-[8px_8px_0_#000] w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-lf-black text-white border-b-3 border-black">
          <div className="flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-lf-yellow" />
            <h2 className="font-black uppercase tracking-wider text-sm">Nouveau client</h2>
          </div>
          <button onClick={onClose} className="hover:text-lf-yellow transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {credentials ? (
          // ── Écran confirmation identifiants ──────────────────────
          <div className="p-6 flex flex-col gap-5">
            <div className="card-brutal-sm p-5 bg-lf-yellow">
              <p className="font-black uppercase text-sm tracking-wider mb-3">✅ Client créé avec succès</p>
              <p className="text-sm font-medium mb-4">
                Le client choisit son accès via la récupération de mot de passe.
                {credentials.ad_account_name && (
                  <span className="block mt-1 text-lf-blue font-bold">
                    Compte Meta lié : {credentials.ad_account_name}
                  </span>
                )}
              </p>

              {/* Email */}
              <div className="border-3 border-black bg-white p-3 mb-3">
                <p className="text-xs font-black uppercase text-lf-gray mb-1">Email</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-bold break-all">{credentials.email}</code>
                  <button
                    onClick={() => copyToClipboard(credentials.email, "email")}
                    className="flex-shrink-0 p-1.5 border-2 border-black hover:bg-lf-yellow transition-colors"
                  >
                    {copied === "email" ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>


            </div>

            <div className="flex gap-3">
              {credentials.campaign_id && (
                <Link
                  href={`/admin/campaigns/${credentials.campaign_id}`}
                  className="btn-blue text-xs px-4 py-2.5 flex-1 text-center"
                  onClick={onClose}
                >
                  Voir la campagne →
                </Link>
              )}
              <button
                onClick={() => { onCreated(); onClose(); }}
                className="btn-secondary text-xs px-4 py-2.5 flex-1"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          // ── Formulaire ───────────────────────────────────────────
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            {error && (
              <div className="p-3 bg-red-50 border-3 border-red-500 text-sm font-bold text-red-700">{error}</div>
            )}

            {/* Nom */}
            <div>
              <label className="label-brutal mb-1.5">Nom du contact *</label>
              <input
                type="text"
                value={form.full_name}
                onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Ex : Jean Dupont"
                className="input-brutal w-full"
                required
              />
            </div>

            {/* Société */}
            <div>
              <label className="label-brutal mb-1.5">Société</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))}
                placeholder="Ex : Acme Corp"
                className="input-brutal w-full"
              />
            </div>

            {/* Email */}
            <div>
              <label className="label-brutal mb-1.5">Email de connexion</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Laissez vide pour auto-générer"
                className="input-brutal w-full"
              />
              <p className="text-xs text-lf-gray font-medium mt-1">
                Si vide : contact@example.com généré automatiquement
              </p>
            </div>

            {/* Téléphone */}
            <div>
              <label className="label-brutal mb-1.5">Téléphone (optionnel)</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+33 6 12 34 56 78"
                className="input-brutal w-full"
              />
            </div>

            <div className="divider" />

            {/* Compte Meta Ads */}
            <div>
              <label className="label-brutal mb-1.5">Compte Meta Ads (optionnel)</label>
              <div className="relative">
                <select
                  value={form.ad_account_id}
                  onChange={(e) => {
                    const selected = metaAccounts.find(a => a.id === e.target.value);
                    setForm(f => ({
                      ...f,
                      ad_account_id: e.target.value,
                      ad_account_name: selected?.name || "",
                    }));
                  }}
                  onFocus={loadAccounts}
                  className="input-brutal w-full appearance-none pr-8 cursor-pointer"
                >
                  <option value="">— Aucun compte lié —</option>
                  {loadingAccounts && <option disabled>Chargement...</option>}
                  {metaAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} (act_{acc.account_id})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
              </div>
              <p className="text-xs text-lf-gray font-medium mt-1">
                Une campagne en statut "Mise en place du compte Meta" sera créée automatiquement
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex-1 py-3 disabled:opacity-50"
              >
                {saving ? "Création en cours..." : "Créer le client"}
              </button>
              <button type="button" onClick={onClose} className="btn-secondary px-5 py-3">
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────

export function ClientsClient({ clients: initialClients }: Props) {
  const [clients, setClients] = useState(initialClients);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CanonicalCampaignStatus | "all" | "none">("all");
  const [showModal, setShowModal] = useState(false);
  const [editingCatchup, setEditingCatchup] = useState<string | null>(null); // client id
  const [catchupDraft, setCatchupDraft] = useState<Record<string, string>>({}); // clientId → date string
  const [catchupSaving, setCatchupSaving] = useState<Record<string, boolean>>({});
  const [catchupSaved, setCatchupSaved] = useState<Record<string, boolean>>({});

  const saveCatchup = async (clientId: string) => {
    const date = catchupDraft[clientId] ?? "";
    setCatchupSaving((p) => ({ ...p, [clientId]: true }));
    try {
      await fetch("/api/admin/update-client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, next_catchup: date || null }),
      });
      setClients((prev) =>
        prev.map((c) => c.id === clientId ? { ...c, next_catchup: date || null } : c)
      );
      setCatchupSaved((p) => ({ ...p, [clientId]: true }));
      setEditingCatchup(null);
      setTimeout(() => setCatchupSaved((p) => ({ ...p, [clientId]: false })), 2000);
    } finally {
      setCatchupSaving((p) => ({ ...p, [clientId]: false }));
    }
  };

  const availableStatuses = useMemo(() => {
    const seen = new Set<CanonicalCampaignStatus>();
    for (const client of clients) {
      const activeCampaign = getActiveCampaign(client.campaigns ?? []);
      if (activeCampaign) seen.add(getCanonicalCampaignStatus(activeCampaign));
    }

    return CANONICAL_CAMPAIGN_STATUSES.filter((status) => seen.has(status));
  }, [clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      const activeCampaign = getActiveCampaign(c.campaigns ?? []);
      const activeStatus = activeCampaign
        ? getCanonicalCampaignStatus(activeCampaign)
        : undefined;
      const name = (c.company || c.full_name || "").toLowerCase();
      const email = (c.email || "").toLowerCase();
      const matchesSearch = !q || name.includes(q) || email.includes(q);
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "none"
            ? !activeStatus
            : activeStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [clients, search, statusFilter]);

  const handleCreated = () => {
    // Recharger la page pour afficher le nouveau client
    window.location.reload();
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="sticker -rotate-1 inline-block mb-3">CRM</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Clients</h1>
        <p className="text-lf-gray font-medium mt-1">
          {filtered.length} client{filtered.length !== 1 ? "s" : ""}
          {filtered.length !== clients.length && (
            <span className="ml-1 text-xs">(sur {clients.length})</span>
          )}
        </p>
      </div>

      {/* Barre recherche + bouton nouveau client */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="RECHERCHER UN CLIENT..."
          className="input-brutal flex-1 min-w-[200px] max-w-sm text-sm font-bold uppercase placeholder:font-medium placeholder:normal-case"
        />
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-3 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[4px_4px_0_#000] transition-all flex-shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Nouveau client
        </button>
      </div>

      <div className="mb-6 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
            statusFilter === "all"
              ? "bg-lf-black text-white"
              : "bg-white text-black hover:bg-gray-100"
          }`}
        >
          Tous
        </button>
        <button
          onClick={() => setStatusFilter("none")}
          className={`px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
            statusFilter === "none"
              ? "bg-lf-black text-white"
              : "bg-white text-black hover:bg-gray-100"
          }`}
        >
          Sans campagne
        </button>
        {availableStatuses.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black transition-all ${
              statusFilter === status
                ? getCampaignStatusColor(status)
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            {getCampaignStatusLabel(status)}
          </button>
        ))}
      </div>

      {/* Grille clients */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => {
          const campaigns = c.campaigns ?? [];
          const activeCampaign = getActiveCampaign(campaigns);
          const adAccountId = getAdAccountId(campaigns);
          const status = activeCampaign
            ? getCanonicalCampaignStatus(activeCampaign)
            : undefined;

          const activity = getActivityStatus(c);

          return (
            <div key={c.id} className="card-brutal-sm p-5 flex flex-col gap-3">
              {/* Avatar + infos */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
                  <span className="font-black text-white text-sm">
                    {(c.full_name || c.email).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-sm uppercase truncate">{c.company || c.full_name}</p>
                  <p className="text-xs text-lf-gray truncate">{c.email}</p>
                </div>
                <div className={`flex items-center gap-1 flex-shrink-0 ${activity.textColor}`}>
                  <Circle className={`w-2 h-2 fill-current ${activity.dotColor}`} />
                  <span className="text-[10px] font-bold uppercase">{activity.label}</span>
                </div>
              </div>

              {/* Badges infos */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-lf-gray font-medium">Client depuis :</span>
                  <span className="text-xs font-bold">
                    {new Date(c.created_at).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-lf-gray font-medium">Campagnes :</span>
                  <span className="text-xs font-bold">{campaigns.length}</span>
                </div>
                {adAccountId && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-lf-gray font-medium">Compte Meta :</span>
                    <span className="text-xs font-mono font-bold bg-gray-100 border border-gray-300 px-1">
                      {adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`}
                    </span>
                  </div>
                )}
              </div>

              {/* Prochain catchup */}
              <div className="flex items-center gap-2 min-h-[28px]">
                <CalendarClock className="w-3.5 h-3.5 text-lf-gray flex-shrink-0" />
                {editingCatchup === c.id ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input
                      type="date"
                      autoFocus
                      value={catchupDraft[c.id] ?? c.next_catchup ?? ""}
                      onChange={(e) => setCatchupDraft((p) => ({ ...p, [c.id]: e.target.value }))}
                      className="input-brutal text-xs py-1 px-2 flex-1 min-w-0"
                    />
                    <button
                      onClick={() => saveCatchup(c.id)}
                      disabled={catchupSaving[c.id]}
                      className="flex-shrink-0 w-7 h-7 bg-lf-green border-2 border-black flex items-center justify-center hover:shadow-brutal-xs transition-all"
                    >
                      {catchupSaving[c.id]
                        ? <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block" />
                        : <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                    <button
                      onClick={() => setEditingCatchup(null)}
                      className="flex-shrink-0 w-7 h-7 bg-white border-2 border-black flex items-center justify-center hover:bg-gray-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setCatchupDraft((p) => ({ ...p, [c.id]: c.next_catchup ?? "" }));
                      setEditingCatchup(c.id);
                    }}
                    className="flex items-center gap-1.5 group"
                  >
                    {c.next_catchup ? (
                      <CatchupBadge date={c.next_catchup} saved={catchupSaved[c.id]} />
                    ) : (
                      <span className="text-xs font-medium text-lf-gray group-hover:text-black transition-colors">
                        Catchup — définir une date
                      </span>
                    )}
                    <Pencil className="w-3 h-3 text-lf-gray opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                )}
              </div>

              {/* Badge statut */}
              {status && (
                <div>
                  <span className={`text-xs font-black px-2 py-1 border-2 border-black ${getCampaignStatusColor(status)}`}>
                    {getCampaignStatusLabel(status)}
                  </span>
                </div>
              )}

              {/* CTAs */}
              <div className="flex gap-2 mt-auto">
                <Link
                  href={`/admin/clients/${c.id}`}
                  className="btn-primary text-xs px-3 py-2 flex-1 text-center"
                >
                  Détail client →
                </Link>
                {activeCampaign && (
                  <Link
                    href={`/admin/campaigns/${activeCampaign.id}`}
                    className="btn-secondary text-xs px-3 py-2 flex-1 text-center"
                  >
                    Voir campagne →
                  </Link>
                )}
              </div>
            </div>
          );
        })}

        {!filtered.length && (
          <div className="col-span-full card-brutal p-12 text-center text-lf-gray font-medium">
            {clients.length === 0
              ? "Aucun client. Créez-en un manuellement ou traitez un onboarding."
              : "Aucun client ne correspond à ce filtre."}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <CreateClientModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
