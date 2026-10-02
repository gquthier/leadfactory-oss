"use client";

import { useState } from "react";
import { StatusUpdateModal } from "@/components/admin/StatusUpdateModal";
import Link from "next/link";
import {
  ArrowLeft, Mail, Phone, Building2, Calendar, BadgeCheck,
  Megaphone, TrendingUp, Link2, Check, Save, ChevronDown,
  Pencil, X, CheckSquare, Square, CalendarClock, Plus, Trash2, Eye, Flame,
} from "lucide-react";
import { DeleteClientModal } from "./DeleteClientModal";
import { WebhookProvisionCard } from "@/components/admin/WebhookProvisionCard";
import {
  CANONICAL_CAMPAIGN_STATUSES,
  getCanonicalCampaignStatus,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  CLIENT_RESULTS_RATINGS,
  CLIENT_RESULTS_RATING_LABELS,
  getClientResultsRatingColor,
  type CanonicalCampaignStatus,
  type ClientResultsRating,
} from "@/types/index";

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  budget_monthly: number | null;
  created_at: string;
  ad_account_id: string | null;
  meta_token_id: string | null;
  ai_creative_prompt: string | null;
  notes: string | null;
  onboarding_response_id: string | null;
  weekly_report_enabled: boolean;
};

type ClientProfile = {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  phone: string | null;
  created_at: string;
  role: string;
  is_active: boolean;
  next_catchup: string | null;
  results_rating: string | null;
  results_rating_note: string | null;
};

type ClientTask = {
  id: string;
  client_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type MetaAccount = {
  id: string;
  account_id: string;
  name: string;
};

type MetaToken = {
  id: string;
  name: string;
  is_active: boolean;
};

interface Props {
  client: ClientProfile;
  campaigns: CampaignRow[];
  tasks: ClientTask[];
  metaAccounts?: MetaAccount[];
  metaTokens?: MetaToken[];
  isSuperAdmin?: boolean;
}

const ALL_STATUSES: CanonicalCampaignStatus[] = CANONICAL_CAMPAIGN_STATUSES;

// Checklist items per campaign
function getChecklist(c: CampaignRow): { label: string; done: boolean }[] {
  const workflowStatus = getCanonicalCampaignStatus(c);
  const statusOrder: CanonicalCampaignStatus[] = CANONICAL_CAMPAIGN_STATUSES;
  const idx = statusOrder.indexOf(workflowStatus);
  return [
    { label: "Brief onboarding reçu", done: true },
    { label: "Proposition de campagne prête", done: idx >= statusOrder.indexOf("campaign_proposal") },
    { label: "Créatives publicitaires prêtes", done: idx >= statusOrder.indexOf("ad_creative") || !!c.ai_creative_prompt },
    { label: "Compte Meta configuré", done: idx >= statusOrder.indexOf("meta_account_setup") || !!c.ad_account_id },
    { label: "Campagne en ligne", done: idx >= statusOrder.indexOf("live_optimizing") },
  ];
}

export function ClientDetailClient({ client: initialClient, campaigns: initialCampaigns, tasks: initialTasks, metaAccounts = [], metaTokens = [], isSuperAdmin = false }: Props) {
  const [client, setClient] = useState(initialClient);
  const [campaigns, setCampaigns] = useState(initialCampaigns);

  // Task management state
  const [tasks, setTasks] = useState<ClientTask[]>(initialTasks ?? []);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [taskAdding, setTaskAdding] = useState(false);
  const [taskAddOpen, setTaskAddOpen] = useState(false);
  const [taskDeleting, setTaskDeleting] = useState<string | null>(null);

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    full_name: initialClient.full_name,
    company: initialClient.company ?? "",
    phone: initialClient.phone ?? "",
    next_catchup: initialClient.next_catchup ?? "",
    ad_account_id: initialCampaigns[0]?.ad_account_id ?? "",
    meta_token_id: initialCampaigns[0]?.meta_token_id ?? "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Status update modal state
  const [statusModal, setStatusModal] = useState<{
    open: boolean;
    campaignId: string;
    campaignName: string;
    clientName: string;
    clientEmail: string;
    clientId: string;
    oldStatus: string;
    newStatus: string;
  } | null>(null);
  const [statusModalLoading, setStatusModalLoading] = useState(false);

  // Quick catchup state
  const [catchupDraft, setCatchupDraft] = useState(initialClient.next_catchup ?? "");
  const [catchupSaving, setCatchupSaving] = useState(false);
  const [catchupSaved, setCatchupSaved] = useState(false);

  // Results rating state
  const [ratingSaving, setRatingSaving] = useState(false);

  const NOT_RATED = "__not_rated__";
  const saveRating = async (value: string) => {
    const newRating = value === NOT_RATED ? null : (value as ClientResultsRating);
    setRatingSaving(true);
    const prev = client.results_rating;
    setClient((c) => ({ ...c, results_rating: newRating }));
    try {
      const res = await fetch("/api/admin/update-client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, results_rating: newRating ?? "" }),
      });
      if (!res.ok) setClient((c) => ({ ...c, results_rating: prev }));
    } catch {
      setClient((c) => ({ ...c, results_rating: prev }));
    } finally {
      setRatingSaving(false);
    }
  };

  // Campaign inline edit state: { [campaignId]: { status, notes, saving, saved, notesOpen } }
  const [campaignEdits, setCampaignEdits] = useState<
    Record<string, { status: CanonicalCampaignStatus; notes: string; saving: boolean; saved: boolean; notesOpen: boolean }>
  >(
    Object.fromEntries(
      initialCampaigns.map((c) => [
        c.id,
        {
          status: getCanonicalCampaignStatus(c),
          notes: c.notes ?? "",
          saving: false,
          saved: false,
          notesOpen: false,
        },
      ])
    )
  );

  const updateCampaignEdit = (id: string, patch: Partial<typeof campaignEdits[string]>) => {
    setCampaignEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  // Quick catchup save
  const saveCatchup = async (value: string) => {
    setCatchupSaving(true);
    try {
      const res = await fetch("/api/admin/update-client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, next_catchup: value || null }),
      });
      if (res.ok) {
        setClient((prev) => ({ ...prev, next_catchup: value || null }));
        setProfileForm((p) => ({ ...p, next_catchup: value }));
        setCatchupSaved(true);
        setTimeout(() => setCatchupSaved(false), 2000);
      }
    } finally {
      setCatchupSaving(false);
    }
  };

  // Save profile
  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      // 1. Save profile fields
      const { ad_account_id, meta_token_id, ...profileFields } = profileForm;
      const res = await fetch("/api/admin/update-client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, ...profileFields }),
      });
      if (!res.ok) return;

      // 2. Update ad_account_id on all campaigns if it changed
      const currentAdAccountId = campaigns[0]?.ad_account_id ?? "";
      if (ad_account_id !== currentAdAccountId && campaigns.length > 0) {
        await Promise.all(
          campaigns.map((c) =>
            fetch("/api/admin/link-meta-account", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ campaign_id: c.id, ad_account_id: ad_account_id || null }),
            })
          )
        );
        setCampaigns((prev) =>
          prev.map((c) => ({ ...c, ad_account_id: ad_account_id || null }))
        );
      }

      // 3. Update meta_token_id on all campaigns if it changed
      const currentTokenId = campaigns[0]?.meta_token_id ?? "";
      if (meta_token_id !== currentTokenId && campaigns.length > 0) {
        await Promise.all(
          campaigns.map((c) =>
            fetch("/api/admin/meta-tokens/assign", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ campaign_id: c.id, token_id: meta_token_id || null }),
            })
          )
        );
        setCampaigns((prev) =>
          prev.map((c) => ({ ...c, meta_token_id: meta_token_id || null }))
        );
      }

      setClient((prev) => ({
        ...prev,
        full_name: profileForm.full_name,
        company: profileForm.company || null,
        phone: profileForm.phone || null,
        next_catchup: profileForm.next_catchup || null,
      }));
      setProfileSaved(true);
      setEditingProfile(false);
      setTimeout(() => setProfileSaved(false), 2000);
    } finally {
      setProfileSaving(false);
    }
  };

  // Save campaign status + notes (core logic)
  const doSaveCampaign = async (campaignId: string, targetStatus: CanonicalCampaignStatus) => {
    const edit = campaignEdits[campaignId];
    updateCampaignEdit(campaignId, { saving: true });
    try {
      const res = await fetch("/api/admin/update-campaign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          status: targetStatus,
          notes: edit.notes || null,
        }),
      });
      if (res.ok) {
        setCampaigns((prev) =>
          prev.map((c) =>
            c.id === campaignId ? { ...c, status: targetStatus, notes: edit.notes || null } : c
          )
        );
        updateCampaignEdit(campaignId, { saved: true, saving: false });
        setTimeout(() => updateCampaignEdit(campaignId, { saved: false }), 2000);
      }
    } catch {
      updateCampaignEdit(campaignId, { saving: false });
    }
  };

  // Save campaign — opens status modal if status changed
  const saveCampaign = (campaignId: string) => {
    const edit = campaignEdits[campaignId];
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    const originalStatus = getCanonicalCampaignStatus(campaign);
    if (edit.status !== originalStatus) {
      setStatusModal({
        open: true,
        campaignId,
        campaignName: campaign.name,
        clientName: client.company || client.full_name,
        clientEmail: client.email,
        clientId: client.id,
        oldStatus: originalStatus,
        newStatus: edit.status,
      });
    } else {
      void doSaveCampaign(campaignId, edit.status);
    }
  };

  const addTask = async () => {
    if (!newTaskTitle.trim()) return;
    setTaskAdding(true);
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, title: newTaskTitle.trim(), description: newTaskDesc.trim() || null }),
      });
      const data = await res.json();
      if (data.task) {
        setTasks(prev => [...prev, data.task]);
        setNewTaskTitle("");
        setNewTaskDesc("");
        setTaskAddOpen(false);
      }
    } finally {
      setTaskAdding(false);
    }
  };

  const deleteTask = async (taskId: string) => {
    setTaskDeleting(taskId);
    try {
      await fetch(`/api/admin/tasks/${taskId}`, { method: "DELETE" });
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } finally {
      setTaskDeleting(null);
    }
  };

  // Stats
  const activeBudget = campaigns
    .filter((c) => getCanonicalCampaignStatus(c) === "live_optimizing")
    .reduce((sum, c) => sum + (c.budget_monthly ?? 0), 0);
  const hasMetaAccount = campaigns.some((c) => !!c.ad_account_id);

  const initials = (client.full_name || client.email)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      {/* Back + Header */}
      <div className="mb-8">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-2 text-sm font-black uppercase text-lf-gray hover:text-black mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour aux clients
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-lf-blue border-3 border-black flex items-center justify-center flex-shrink-0">
              <span className="font-black text-white text-lg">{initials}</span>
            </div>
            <div>
              <div className="sticker -rotate-1 inline-block mb-1 text-xs">Client</div>
              <h1 className="text-3xl font-black uppercase tracking-tight leading-none">
                {client.company || client.full_name}
              </h1>
              {client.company && (
                <p className="text-lf-gray font-medium text-sm mt-0.5">{client.full_name}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Results rating widget */}
            <div className={`flex items-center gap-1.5 border-3 border-black px-2 py-1 ${getClientResultsRatingColor(client.results_rating)}`}>
              <Flame className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
              <span className="text-xs font-black uppercase tracking-wider whitespace-nowrap">Résultats</span>
              <select
                value={client.results_rating ?? NOT_RATED}
                onChange={(e) => saveRating(e.target.value)}
                disabled={ratingSaving}
                aria-label="Niveau de résultats du client"
                className={`border-0 bg-transparent text-xs font-black uppercase tracking-wide focus:outline-none cursor-pointer appearance-none ${getClientResultsRatingColor(client.results_rating).includes("text-white") ? "text-white" : "text-black"}`}
              >
                <option value={NOT_RATED} className="bg-white text-black">Non noté</option>
                {CLIENT_RESULTS_RATINGS.map((r) => (
                  <option key={r} value={r} className="bg-white text-black">
                    {CLIENT_RESULTS_RATING_LABELS[r]}
                  </option>
                ))}
              </select>
              {ratingSaving && (
                <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full flex-shrink-0" />
              )}
            </div>
            {/* Quick catchup widget */}
            <div className="flex items-center gap-1.5 border-3 border-black bg-white px-2 py-1">
              <CalendarClock className="w-3.5 h-3.5 text-lf-gray flex-shrink-0" />
              <span className="text-xs font-black uppercase tracking-wider text-lf-gray whitespace-nowrap">Catchup</span>
              <input
                type="date"
                value={catchupDraft}
                onChange={(e) => setCatchupDraft(e.target.value)}
                className="border-0 bg-transparent text-xs font-bold focus:outline-none cursor-pointer w-32"
              />
              <button
                onClick={() => saveCatchup(catchupDraft)}
                disabled={catchupSaving}
                title="Sauvegarder le catchup"
                className={`flex items-center justify-center w-6 h-6 border-2 border-black transition-colors flex-shrink-0 ${
                  catchupSaved ? "bg-lf-green text-white" : "bg-lf-yellow hover:bg-lf-black hover:text-white"
                }`}
              >
                {catchupSaving ? (
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                ) : catchupSaved ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
              </button>
            </div>

            {!editingProfile && (
              <button
                onClick={() => setEditingProfile(true)}
                className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-lf-yellow hover:shadow-brutal-sm transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
                Modifier profil
              </button>
            )}
            <DeleteClientModal
              clientId={client.id}
              clientName={client.company || client.full_name}
            />
            <button
              onClick={async () => {
                await fetch("/api/admin/preview-client", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ client_id: client.id }),
                });
                window.location.href = "/client/overview";
              }}
              className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-blue text-white hover:bg-blue-700 hover:shadow-brutal-sm transition-all"
              title="Voir l'espace client tel que le client le voit"
            >
              <Eye className="w-3.5 h-3.5" />
              Vue client
            </button>
            <div className="text-xs font-bold text-lf-gray uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Depuis le {new Date(client.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Profile edit form */}
      {editingProfile && (
        <div className="card-brutal p-6 mb-6 bg-lf-yellow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black uppercase tracking-wider text-sm">Modifier le profil client</h2>
            <button onClick={() => setEditingProfile(false)} className="text-lf-gray hover:text-black">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="label-brutal">Nom complet</label>
              <input
                type="text"
                value={profileForm.full_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, full_name: e.target.value }))}
                className="input-brutal text-sm"
              />
            </div>
            <div>
              <label className="label-brutal">Société</label>
              <input
                type="text"
                value={profileForm.company}
                onChange={(e) => setProfileForm((p) => ({ ...p, company: e.target.value }))}
                className="input-brutal text-sm"
              />
            </div>
            <div>
              <label className="label-brutal">Téléphone</label>
              <input
                type="text"
                value={profileForm.phone}
                onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                className="input-brutal text-sm"
              />
            </div>
            <div>
              <label className="label-brutal">Prochain catchup</label>
              <input
                type="date"
                value={profileForm.next_catchup}
                onChange={(e) => setProfileForm((p) => ({ ...p, next_catchup: e.target.value }))}
                className="input-brutal text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-brutal flex items-center gap-1.5">
                <Link2 className="w-3 h-3" />
                Compte publicitaire Meta
              </label>
              {metaAccounts.length > 0 ? (
                <select
                  value={profileForm.ad_account_id}
                  onChange={(e) => setProfileForm((p) => ({ ...p, ad_account_id: e.target.value }))}
                  className="input-brutal text-sm w-full"
                >
                  <option value="">— Aucun compte lié —</option>
                  {metaAccounts.map((acc) => (
                    <option key={acc.account_id} value={acc.account_id}>
                      {acc.name} ({acc.account_id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={profileForm.ad_account_id}
                  onChange={(e) => setProfileForm((p) => ({ ...p, ad_account_id: e.target.value }))}
                  placeholder="ex: 1234567890"
                  className="input-brutal text-sm"
                />
              )}
              {profileForm.ad_account_id && (
                <p className="text-xs font-medium text-lf-gray mt-1 flex items-center gap-1">
                  <Check className="w-3 h-3 text-lf-green" />
                  Compte lié : <span className="font-black text-black">{metaAccounts.find(a => a.account_id === profileForm.ad_account_id)?.name ?? profileForm.ad_account_id}</span>
                </p>
              )}
            </div>
            {metaTokens.length > 0 && (
              <div className="sm:col-span-3">
                <label className="label-brutal flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" />
                  Token Meta (Business Manager)
                </label>
                <select
                  value={profileForm.meta_token_id}
                  onChange={(e) => setProfileForm((p) => ({ ...p, meta_token_id: e.target.value }))}
                  className="input-brutal text-sm w-full"
                >
                  <option value="">— Token par défaut (env) —</option>
                  {metaTokens.filter(t => t.is_active).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {profileForm.meta_token_id && (
                  <p className="text-xs font-medium text-lf-gray mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3 text-lf-green" />
                    Token : <span className="font-black text-black">{metaTokens.find(t => t.id === profileForm.meta_token_id)?.name}</span>
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={saveProfile}
              disabled={profileSaving}
              className="btn-primary flex items-center gap-2 text-sm px-5 py-2"
            >
              {profileSaving ? (
                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
              ) : profileSaved ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {profileSaved ? "Sauvegardé !" : "Enregistrer"}
            </button>
            <button
              onClick={() => setEditingProfile(false)}
              className="btn-secondary text-sm px-5 py-2"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Grid: info card + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        {/* Client info card */}
        <div className="lg:col-span-2 card-brutal-sm p-6">
          <h2 className="font-black uppercase tracking-wider text-sm mb-4">Informations client</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 mt-0.5 text-lf-gray flex-shrink-0" />
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-0.5">Email</p>
                <a href={`mailto:${client.email}`} className="text-sm font-bold text-lf-blue hover:underline break-all">
                  {client.email}
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="w-4 h-4 mt-0.5 text-lf-gray flex-shrink-0" />
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-0.5">Téléphone</p>
                {client.phone ? (
                  <a href={`tel:${client.phone}`} className="text-sm font-bold text-lf-blue hover:underline">
                    {client.phone}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-lf-gray">—</span>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="w-4 h-4 mt-0.5 text-lf-gray flex-shrink-0" />
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-0.5">Entreprise</p>
                <p className="text-sm font-bold">{client.company || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <BadgeCheck className="w-4 h-4 mt-0.5 text-lf-gray flex-shrink-0" />
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-0.5">Statut</p>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-black px-2 py-1 border-2 border-black inline-block ${
                    client.role === "admin" ? "bg-lf-black text-white" : "bg-lf-blue text-white"
                  }`}>
                    {client.role === "admin" ? "ADMIN" : "CLIENT"}
                  </span>
                  <span className={`text-xs font-black px-2 py-1 border-2 border-black inline-block ${
                    client.is_active ? "bg-lf-green text-white" : "bg-gray-300 text-black"
                  }`}>
                    {client.is_active ? "Actif" : "Inactif"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 sm:col-span-2">
              <CalendarClock className="w-4 h-4 mt-0.5 text-lf-gray flex-shrink-0" />
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-0.5">Prochain Catchup</p>
                {client.next_catchup ? (
                  <CatchupBadge date={client.next_catchup} />
                ) : (
                  <button
                    onClick={() => setEditingProfile(true)}
                    className="text-sm font-bold text-lf-gray hover:text-lf-blue hover:underline"
                  >
                    Non planifié — définir une date
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-3">
          <div className="card-brutal-sm p-5 bg-lf-blue text-white flex-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider opacity-70 mb-1">Campagnes</p>
                <p className="text-4xl font-black leading-none">{campaigns.length}</p>
              </div>
              <Megaphone className="w-7 h-7 opacity-30" />
            </div>
          </div>
          <div className="card-brutal-sm p-5 bg-lf-green text-white flex-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider opacity-70 mb-1">Budget actif</p>
                <p className="text-4xl font-black leading-none">
                  {activeBudget > 0 ? `${activeBudget}€` : "—"}
                </p>
                {activeBudget > 0 && <p className="text-xs opacity-70 font-medium mt-1">/mois</p>}
              </div>
              <TrendingUp className="w-7 h-7 opacity-30" />
            </div>
          </div>
          <div className={`card-brutal-sm p-5 flex-1 ${hasMetaAccount ? "bg-lf-yellow" : "bg-white"}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">Compte Meta</p>
                <p className="text-lg font-black uppercase">{hasMetaAccount ? "Lié" : "Non lié"}</p>
              </div>
              <Link2 className={`w-7 h-7 ${hasMetaAccount ? "text-black" : "text-lf-gray"} opacity-40`} />
            </div>
          </div>
        </div>
      </div>

      {/* Webhook Make.com provisioning */}
      <div className="mb-8">
        <WebhookProvisionCard
          clientId={client.id}
          clientLabel={client.company || client.full_name || client.email || "Client"}
        />
      </div>

      {/* Campaigns with inline management */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black uppercase tracking-tight">
            Campagnes{" "}
            <span className="text-lf-gray font-medium text-base normal-case tracking-normal">
              ({campaigns.length})
            </span>
          </h2>
          <Link
            href={`/admin/campaigns`}
            className="text-xs font-black uppercase text-lf-blue hover:underline"
          >
            Toutes les campagnes →
          </Link>
        </div>

        {campaigns.length === 0 ? (
          <div className="card-brutal p-12 text-center">
            <Megaphone className="w-10 h-10 mx-auto text-lf-gray opacity-30 mb-3" />
            <p className="font-black text-lg">Aucune campagne</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {campaigns.map((campaign) => {
              const edit = campaignEdits[campaign.id];
              if (!edit) return null;
              const checklist = getChecklist({ ...campaign, status: edit.status, ai_creative_prompt: campaign.ai_creative_prompt });
              const doneCount = checklist.filter((i) => i.done).length;

              return (
                <div key={campaign.id} className="card-brutal p-5">
                  {/* Campaign header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap mb-1">
                        <p className="font-black text-sm uppercase truncate">{campaign.name}</p>
                        <span className={`text-xs font-black px-2 py-0.5 border-2 border-black flex-shrink-0 ${getCampaignStatusColor(edit.status)}`}>
                          {getCampaignStatusLabel(edit.status)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-lf-gray font-medium">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(campaign.created_at).toLocaleDateString("fr-FR")}
                        </span>
                        {campaign.ad_account_id && (
                          <span className="flex items-center gap-1">
                            <Link2 className="w-3 h-3" />
                            <span className="font-mono">{campaign.ad_account_id}</span>
                          </span>
                        )}
                        {campaign.budget_monthly != null && (
                          <span className="font-bold text-black">{campaign.budget_monthly}€/mois</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/campaigns/${campaign.id}`}
                        className="text-xs font-black uppercase text-lf-blue hover:underline flex-shrink-0"
                      >
                        Détail →
                      </Link>
                    </div>
                  </div>

                  {/* Checklist */}
                  <div className="mb-4">
                    <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">
                      Checklist setup — {doneCount}/{checklist.length}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                      {checklist.map((item) => (
                        <div key={item.label} className="flex items-center gap-1.5">
                          {item.done ? (
                            <CheckSquare className="w-4 h-4 text-lf-green flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-lf-gray flex-shrink-0" />
                          )}
                          <span className={`text-xs font-medium ${item.done ? "text-black line-through decoration-lf-green" : "text-lf-gray"}`}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Status + Notes editors */}
                  <div className="border-t-2 border-dashed border-gray-200 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Status dropdown */}
                      <div>
                        <label className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1.5 block">
                          Statut
                        </label>
                        <div className="relative">
                          <select
                            value={edit.status}
                            onChange={(e) => updateCampaignEdit(campaign.id, { status: e.target.value as CanonicalCampaignStatus })}
                            className="input-brutal text-sm pr-8 appearance-none cursor-pointer"
                          >
                            {ALL_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {getCampaignStatusLabel(s)}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-lf-gray" />
                        </div>
                      </div>

                      {/* Notes toggle */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-black uppercase tracking-wider text-lf-gray">
                            Notes admin
                          </label>
                          <button
                            onClick={() => updateCampaignEdit(campaign.id, { notesOpen: !edit.notesOpen })}
                            className="text-xs font-bold text-lf-blue hover:underline"
                          >
                            {edit.notesOpen ? "Réduire" : edit.notes ? "Modifier" : "Ajouter"}
                          </button>
                        </div>
                        {edit.notesOpen ? (
                          <textarea
                            value={edit.notes}
                            onChange={(e) => updateCampaignEdit(campaign.id, { notes: e.target.value })}
                            rows={3}
                            placeholder="Notes internes sur ce client / cette campagne..."
                            className="textarea-brutal text-sm resize-none w-full"
                          />
                        ) : (
                          <p className="text-sm font-medium text-lf-gray truncate">
                            {edit.notes || "—"}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Weekly report toggle — visible only if ad_account_id is set */}
                    {campaign.ad_account_id && (
                      <div className="mt-4 border-t-2 border-dashed border-gray-200 pt-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={campaign.weekly_report_enabled}
                                onChange={async () => {
                                  const newVal = !campaign.weekly_report_enabled;
                                  setCampaigns((prev) =>
                                    prev.map((c) =>
                                      c.id === campaign.id ? { ...c, weekly_report_enabled: newVal } : c
                                    )
                                  );
                                  await fetch("/api/admin/update-campaign", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ campaign_id: campaign.id, weekly_report_enabled: newVal }),
                                  });
                                }}
                                className="w-4 h-4 accent-blue-600 cursor-pointer"
                              />
                              <span className="text-xs font-black uppercase tracking-wider">
                                Rapport hebdo automatique
                              </span>
                            </label>
                            <p className="text-xs text-lf-gray mt-0.5 ml-6">Envoi chaque lundi à 9h</p>
                          </div>
                          <a
                            href={`/api/admin/weekly-report/preview?campaign_id=${campaign.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs font-bold text-lf-blue hover:underline"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Prévisualiser
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Save button */}
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        onClick={() => saveCampaign(campaign.id)}
                        disabled={edit.saving}
                        className={`flex items-center gap-2 text-xs px-5 py-2 font-black uppercase tracking-wider border-3 border-black transition-all ${
                          edit.saved
                            ? "bg-lf-green text-white"
                            : "bg-lf-black text-white hover:bg-lf-blue hover:shadow-brutal-sm"
                        }`}
                      >
                        {edit.saving ? (
                          <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                        ) : edit.saved ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        {edit.saved ? "Sauvegardé !" : "Enregistrer les modifications"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Tâches client ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            Tâches client
            <span className="text-lf-gray font-medium text-base normal-case tracking-normal">
              ({tasks.filter(t => !t.is_completed).length} en attente)
            </span>
          </h2>
          <button
            onClick={() => setTaskAddOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-yellow hover:shadow-brutal-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter une tâche
          </button>
        </div>

        {/* Add task form */}
        {taskAddOpen && (
          <div className="card-brutal-sm p-4 mb-4 bg-lf-yellow">
            <div className="flex flex-col gap-3">
              <div>
                <label className="label-brutal">Titre de la tâche *</label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder="Ex: Partager les accès Notion..."
                  className="input-brutal text-sm w-full"
                  onKeyDown={e => e.key === "Enter" && addTask()}
                />
              </div>
              <div>
                <label className="label-brutal">Description (optionnel)</label>
                <textarea
                  value={newTaskDesc}
                  onChange={e => setNewTaskDesc(e.target.value)}
                  placeholder="Instructions détaillées pour le client..."
                  rows={2}
                  className="textarea-brutal text-sm resize-none w-full"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addTask}
                  disabled={taskAdding || !newTaskTitle.trim()}
                  className="btn-primary text-xs px-4 py-2 flex items-center gap-2"
                >
                  {taskAdding ? (
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  Créer la tâche
                </button>
                <button onClick={() => setTaskAddOpen(false)} className="btn-secondary text-xs px-4 py-2">
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Task list */}
        {tasks.length === 0 ? (
          <div className="card-brutal p-8 text-center">
            <CheckSquare className="w-8 h-8 mx-auto text-lf-gray opacity-30 mb-2" />
            <p className="font-black text-sm uppercase text-lf-gray">Aucune tâche assignée</p>
            <p className="text-xs font-medium text-lf-gray mt-1">Cliquez sur &ldquo;Ajouter une tâche&rdquo; pour en créer une.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map(task => (
              <div
                key={task.id}
                className={`border-3 border-black p-4 flex items-start gap-3 ${task.is_completed ? "bg-gray-50 opacity-70" : "bg-white"}`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {task.is_completed ? (
                    <CheckSquare className="w-4 h-4 text-lf-green" />
                  ) : (
                    <Square className="w-4 h-4 text-lf-gray" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-black text-sm uppercase ${task.is_completed ? "line-through text-lf-gray" : ""}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs font-medium text-lf-gray mt-1">{task.description}</p>
                  )}
                  {task.is_completed && task.completed_at && (
                    <p className="text-[10px] font-black uppercase tracking-wider text-lf-green mt-1">
                      Complété le {new Date(task.completed_at).toLocaleDateString("fr-FR")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteTask(task.id)}
                  disabled={taskDeleting === task.id}
                  className="p-1.5 text-lf-gray hover:text-red-500 hover:bg-red-50 border-2 border-transparent hover:border-red-200 transition-colors flex-shrink-0"
                  title="Supprimer"
                >
                  {taskDeleting === task.id ? (
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {statusModal && (
        <StatusUpdateModal
          open={statusModal.open}
          onClose={() => setStatusModal(null)}
          onConfirm={async ({ sendEmail, customMessage, deliverables }) => {
            setStatusModalLoading(true);
            try {
              await doSaveCampaign(statusModal.campaignId, statusModal.newStatus as CanonicalCampaignStatus);
              if (sendEmail) {
                await fetch("/api/admin/send-status-update", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    campaignId: statusModal.campaignId,
                    campaignName: statusModal.campaignName,
                    clientId: statusModal.clientId,
                    clientName: statusModal.clientName,
                    clientEmail: statusModal.clientEmail,
                    oldStatus: statusModal.oldStatus,
                    newStatus: statusModal.newStatus,
                    customMessage,
                    deliverables,
                  }),
                });
              }
            } finally {
              setStatusModalLoading(false);
              setStatusModal(null);
            }
          }}
          onCancel={() => setStatusModal(null)}
          campaignName={statusModal.campaignName}
          clientName={statusModal.clientName}
          clientEmail={statusModal.clientEmail}
          newStatus={statusModal.newStatus}
          oldStatus={statusModal.oldStatus}
          loading={statusModalLoading}
        />
      )}
    </div>
  );
}

function CatchupBadge({ date }: { date: string }) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  let badgeClass = "bg-lf-yellow text-black";
  let suffix = "";
  if (diffDays < 0) {
    badgeClass = "bg-red-500 text-white";
    suffix = ` (il y a ${Math.abs(diffDays)}j)`;
  } else if (diffDays === 0) {
    badgeClass = "bg-lf-green text-white";
    suffix = " (aujourd'hui)";
  } else if (diffDays <= 7) {
    badgeClass = "bg-lf-yellow text-black";
    suffix = ` (dans ${diffDays}j)`;
  } else {
    badgeClass = "bg-white text-black";
    suffix = ` (dans ${diffDays}j)`;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-black px-2 py-1 border-2 border-black ${badgeClass}`}>
      <CalendarClock className="w-3 h-3" />
      {label}{suffix}
    </span>
  );
}
