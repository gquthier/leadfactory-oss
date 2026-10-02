"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  CircleDollarSign,
  Copy,
  Eye,
  EyeOff,
  KanbanSquare,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Shield,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { TeamResourcesPanel } from "./TeamResourcesPanel";
import type {
  TeamCampaign,
  TeamDashboardMember,
  TeamDashboardSummary,
  TeamRole,
  TeamStatus,
} from "@/types/index";
import { getCampaignStatusColor, getCampaignStatusLabel } from "@/types/index";

const ROLE_OPTIONS: Array<{ value: TeamRole; label: string }> = [
  { value: "admin", label: "Admin CRM" },
  { value: "designer", label: "Designer" },
  { value: "media_buyer", label: "Media Buyer" },
];

const STATUS_OPTIONS: Array<{ value: TeamStatus; label: string }> = [
  { value: "active", label: "Actif" },
  { value: "invited", label: "Invité" },
  { value: "disabled", label: "Désactivé" },
];

type CreateFormState = {
  full_name: string;
  email: string;
  password: string;
  team_role: TeamRole;
  team_status: TeamStatus;
  send_access_email: boolean;
};

type SaveState = { ok: boolean; msg: string } | null;

function formatCurrency(value: number) {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getRoleLabel(role: TeamRole | null | undefined) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Super Admin";
}

function getStatusBadgeClass(status: TeamStatus | null | undefined) {
  switch (status) {
    case "disabled":
      return "bg-red-100 text-red-700 border-red-400";
    case "invited":
      return "bg-lf-yellow text-black border-black";
    default:
      return "bg-lf-green text-white border-lf-green";
  }
}

function isActiveCampaignStatus(status: string) {
  return !["paused", "completed", "completed_project"].includes(status);
}

/* -------------------------------------------------------------------------- */
/*  Summary Card                                                              */
/* -------------------------------------------------------------------------- */

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  className?: string;
}) {
  return (
    <div className={`card-brutal-sm p-5 ${className ?? "bg-white"}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wider opacity-70">{label}</p>
          <p className="mt-2 text-3xl font-black leading-none">{value}</p>
        </div>
        <Icon className="h-7 w-7 opacity-30" />
      </div>
      <p className="text-xs font-bold uppercase tracking-wide opacity-70">{hint}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Create Team Member Modal                                                  */
/* -------------------------------------------------------------------------- */

function CreateTeamMemberModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<CreateFormState>({
    full_name: "",
    email: "",
    password: "",
    team_role: "designer",
    team_status: "active",
    send_access_email: false,
  });
  const [result, setResult] = useState<SaveState>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/admin/team-members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });
          const data = await response.json();

          if (!response.ok) {
            setResult({ ok: false, msg: data.error ?? "Erreur lors de la création du membre" });
            return;
          }

          setResult({
            ok: true,
            msg: data.local_only ? 'Membre ajouté localement ; aucun compte distant ni email créé.' : form.send_access_email
              ? `Compte créé et accès envoyés à ${form.email}.`
              : `Compte créé pour ${form.email}.`,
          });
          setForm({
            full_name: "",
            email: "",
            password: "",
            team_role: "designer",
            team_status: "active",
            send_access_email: false,
          });
          router.refresh();
        } catch {
          setResult({ ok: false, msg: "Erreur réseau" });
        }
      })();
    });
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="card-brutal w-full max-w-2xl overflow-hidden bg-white">
        <div className="border-b-3 border-black bg-lf-black px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-lf-yellow" />
            <p className="font-black uppercase tracking-wider">Créer un team member</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label-brutal">Nom complet</label>
              <input
                type="text"
                required
                value={form.full_name}
                onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
                placeholder="Thomas Martin"
                className="input-brutal"
              />
            </div>
            <div>
              <label className="label-brutal">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="contact@example.com"
                className="input-brutal"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="label-brutal">Rôle équipe</label>
              <select
                value={form.team_role}
                onChange={(event) =>
                  setForm((current) => ({ ...current, team_role: event.target.value as TeamRole }))
                }
                className="input-brutal"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-brutal">Statut</label>
              <select
                value={form.team_status}
                onChange={(event) =>
                  setForm((current) => ({ ...current, team_status: event.target.value as TeamStatus }))
                }
                className="input-brutal"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 border-3 border-black bg-lf-yellow/30 px-4 py-3 text-sm font-bold">
            <input
              type="checkbox"
              checked={form.send_access_email}
              onChange={(event) =>
                setForm((current) => ({ ...current, send_access_email: event.target.checked }))
              }
              className="checkbox-brutal"
            />
            Envoyer automatiquement les accès par email HTML via SMTP
          </label>

          {result && (
            <div
              className={`flex items-start gap-2 border-3 p-3 text-sm font-bold ${
                result.ok
                  ? "border-lf-green bg-lf-green/10 text-lf-green"
                  : "border-red-400 bg-red-50 text-red-700"
              }`}
            >
              {result.ok ? (
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              {result.msg}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {isPending ? "Création..." : "Créer le compte"}
            </button>
            <p className="text-xs font-medium text-lf-gray">
              Le membre sera créé en tant qu&apos;utilisateur interne Lead Factory.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Team Member Card (collapsible)                                            */
/* -------------------------------------------------------------------------- */

function TeamMemberCard({
  member,
  campaigns,
  defaultOpen = false,
}: {
  member: TeamDashboardMember;
  campaigns: TeamCampaign[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SaveState>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendResult, setResendResult] = useState<SaveState>(null);
  const [currentPassword, setCurrentPassword] = useState<string|null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [fullName, setFullName] = useState(member.full_name);
  const [teamRole, setTeamRole] = useState<TeamRole>(
    member.team_role && member.team_role !== "super_admin" ? member.team_role : "admin"
  );
  const [teamStatus, setTeamStatus] = useState<TeamStatus>(member.team_status ?? "active");
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>(
    member.assigned_campaigns.map((campaign) => campaign.id)
  );
  const [clientRates, setClientRates] = useState<Record<string, string>>(() =>
    member.client_rates.reduce<Record<string, string>>((acc, rate) => {
      acc[rate.client_id] = rate.monthly_rate === 0 ? "" : String(rate.monthly_rate);
      return acc;
    }, {})
  );

  const readOnly = member.is_super_admin === true;

  const selectedCampaigns = useMemo(
    () => campaigns.filter((campaign) => selectedCampaignIds.includes(campaign.id)),
    [campaigns, selectedCampaignIds]
  );

  const selectedClients = useMemo(() => {
    const unique = new Map<string, { id: string; name: string; company: string | null }>();

    for (const campaign of selectedCampaigns) {
      if (!unique.has(campaign.client_id)) {
        unique.set(campaign.client_id, {
          id: campaign.client_id,
          name: campaign.client_name,
          company: campaign.client_company,
        });
      }
    }

    return Array.from(unique.values()).sort((left, right) =>
      left.name.localeCompare(right.name, "fr")
    );
  }, [selectedCampaigns]);

  const previewProjectsCount = selectedCampaigns.filter((campaign) =>
    isActiveCampaignStatus(String(campaign.status))
  ).length;

  const previewPayDue = selectedClients.reduce((sum, client) => {
    const parsed = Number(clientRates[client.id] ?? 0);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  const toggleCampaign = (campaignId: string) => {
    setSelectedCampaignIds((current) =>
      current.includes(campaignId)
        ? current.filter((id) => id !== campaignId)
        : [...current, campaignId]
    );
  };

  const handleCopyPassword = async () => {
    if (!currentPassword) return;
    await navigator.clipboard.writeText(currentPassword);
  };

  const handleResendAccess = async () => {
    setIsResending(true);
    setResendResult(null);

    try {
      const response = await fetch(`/api/admin/team-members/${member.id}/resend-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      if (!response.ok) {
        setResendResult({ ok: false, msg: data.error ?? "Erreur lors du renvoi" });
      } else {
        setCurrentPassword(null);
        setResendResult({ ok: true, msg: "Instructions de récupération envoyées par email." });
        router.refresh();
      }
    } catch {
      setResendResult({ ok: false, msg: "Erreur réseau" });
    } finally {
      setIsResending(false);
    }
  };

  const handleSave = async () => {
    setResult(null);

    startTransition(() => {
      void (async () => {
        try {
          const payload = {
            full_name: fullName,
            team_role: member.is_super_admin ? "super_admin" : teamRole,
            team_status: teamStatus,
            assigned_campaign_ids: selectedCampaignIds,
            client_rates: selectedClients.map((client) => ({
              client_id: client.id,
              monthly_rate: clientRates[client.id] || 0,
            })),
          };

          const response = await fetch(`/api/admin/team-members/${member.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await response.json();

          if (!response.ok) {
            setResult({ ok: false, msg: data.error ?? "Erreur lors de la sauvegarde" });
            return;
          }

          setResult({ ok: true, msg: "Membre mis à jour." });
          router.refresh();
        } catch {
          setResult({ ok: false, msg: "Erreur réseau" });
        }
      })();
    });
  };

  return (
    <div className="card-brutal overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full border-b-3 border-black bg-white px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-lg font-black uppercase tracking-tight truncate">{member.full_name}</span>
            <span className="border-2 border-black bg-lf-black px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white shrink-0">
              {getRoleLabel(member.team_role)}
            </span>
            <span className={`border-2 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] shrink-0 ${getStatusBadgeClass(member.team_status)}`}>
              {STATUS_OPTIONS.find((option) => option.value === member.team_status)?.label ?? "Actif"}
            </span>
            {member.is_super_admin && (
              <span className="border-2 border-black bg-lf-yellow px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-black shrink-0">
                Super Admin
              </span>
            )}
            <span className="text-sm font-medium text-lf-gray ml-2 hidden md:inline">{member.email}</span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-3 text-center">
              <div className="border-2 border-black bg-white px-2.5 py-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-lf-gray">Projets</p>
                <p className="text-base font-black leading-tight">{previewProjectsCount}</p>
              </div>
              <div className="border-2 border-black bg-white px-2.5 py-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-lf-gray">Clients</p>
                <p className="text-base font-black leading-tight">{selectedClients.length}</p>
              </div>
              <div className="border-2 border-black bg-lf-yellow px-2.5 py-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-lf-gray">Paye</p>
                <p className="text-base font-black leading-tight">{formatCurrency(previewPayDue)}</p>
              </div>
            </div>

            <ChevronDown
              className={`h-5 w-5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            />
          </div>
        </div>
      </button>

      {/* Expandable body */}
      {isOpen && (
        <div className="border-t border-gray-200">
          {/* Password + resend row */}
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-lf-gray">{member.email}</span>

            <span className="text-xs text-lf-gray">Accès personnel via récupération, après configuration Auth.</span>

            <button
              type="button"
              onClick={handleResendAccess}
              disabled={isResending}
              className="ml-auto flex items-center gap-1.5 border-2 border-black bg-lf-yellow px-3 py-1.5 text-[11px] font-black uppercase tracking-wider hover:bg-yellow-300 disabled:opacity-40"
            >
              {isResending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Renvoyer les accès
            </button>
            {resendResult && (
              <span className={`text-xs font-bold ${resendResult.ok ? "text-lf-green" : "text-red-600"}`}>
                {resendResult.msg}
              </span>
            )}
          </div>

          {/* Main content */}
          <div className="grid gap-6 p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <div>
                <label className="label-brutal">Nom affiché</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  disabled={readOnly}
                  className="input-brutal disabled:cursor-not-allowed disabled:bg-gray-100"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div>
                  <label className="label-brutal">Rôle</label>
                  <select
                    value={member.is_super_admin ? "super_admin" : teamRole}
                    onChange={(event) => setTeamRole(event.target.value as TeamRole)}
                    disabled={readOnly}
                    className="input-brutal disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {member.is_super_admin && <option value="super_admin">Super Admin</option>}
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label-brutal">Statut</label>
                  <select
                    value={teamStatus}
                    onChange={(event) => setTeamStatus(event.target.value as TeamStatus)}
                    disabled={readOnly}
                    className="input-brutal disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {readOnly ? (
                <div className="border-3 border-black bg-lf-yellow p-4 text-sm font-medium">
                  Ce compte est super admin. Les rôles, la paye et les affectations ne sont pas modifiés depuis cet écran.
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleSave}
                  className="btn-primary flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {isPending ? "Sauvegarde..." : "Sauvegarder"}
                </button>
              )}

              {result && (
                <div
                  className={`flex items-start gap-2 border-3 p-3 text-sm font-bold ${
                    result.ok
                      ? "border-lf-green bg-lf-green/10 text-lf-green"
                      : "border-red-400 bg-red-50 text-red-700"
                  }`}
                >
                  {result.ok ? (
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  {result.msg}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-6">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <KanbanSquare className="h-4 w-4" />
                  <p className="text-sm font-black uppercase tracking-wider">Projets attribués</p>
                </div>
                <div className="max-h-80 overflow-y-auto border-3 border-black bg-white">
                  {campaigns.length === 0 ? (
                    <div className="p-4 text-sm font-medium text-lf-gray">Aucun projet disponible.</div>
                  ) : (
                    campaigns.map((campaign) => {
                      const checked = selectedCampaignIds.includes(campaign.id);
                      return (
                        <label
                          key={campaign.id}
                          className={`flex cursor-pointer items-start gap-3 border-b-2 border-black px-4 py-3 last:border-b-0 ${
                            checked ? "bg-lf-yellow/20" : "bg-white"
                          } ${readOnly ? "cursor-default" : "hover:bg-gray-50"}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={readOnly}
                            onChange={() => toggleCampaign(campaign.id)}
                            className="checkbox-brutal mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-black uppercase">{campaign.name}</span>
                            <span className="mt-1 block text-xs font-medium text-lf-gray">
                              {campaign.client_name}
                            </span>
                          </span>
                          <span className={`border-2 border-black px-2 py-1 text-[10px] font-black uppercase tracking-wider ${getCampaignStatusColor(campaign.status)}`}>
                            {getCampaignStatusLabel(campaign.status)}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <CircleDollarSign className="h-4 w-4" />
                  <p className="text-sm font-black uppercase tracking-wider">Paye par client</p>
                </div>
                <div className="card-brutal-sm overflow-hidden bg-white">
                  {selectedClients.length === 0 ? (
                    <div className="p-4 text-sm font-medium text-lf-gray">
                      Attribuez au moins un projet pour configurer la paye due par client.
                    </div>
                  ) : (
                    <div className="divide-y-2 divide-black">
                      {selectedClients.map((client) => (
                        <div key={client.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_160px] md:items-center">
                          <div>
                            <p className="text-sm font-black uppercase">{client.name}</p>
                            {client.company && (
                              <p className="text-xs font-medium text-lf-gray">{client.company}</p>
                            )}
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.2em] text-lf-gray">
                              Tarif mensuel
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="10"
                              value={clientRates[client.id] ?? ""}
                              disabled={readOnly}
                              onChange={(event) =>
                                setClientRates((current) => ({
                                  ...current,
                                  [client.id]: event.target.value,
                                }))
                              }
                              className="input-brutal disabled:cursor-not-allowed disabled:bg-gray-100"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main export                                                               */
/* -------------------------------------------------------------------------- */

export function TeamWorkspaceClient({
  members,
  campaigns,
  summary,
}: {
  members: TeamDashboardMember[];
  campaigns: TeamCampaign[];
  summary: TeamDashboardSummary;
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"members" | "resources">("members");

  return (
    <div className="p-6 lg:p-8 max-w-7xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="sticker-yellow -rotate-1 inline-block mb-3">TEAM</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Gestion de l&apos;équipe</h1>
          <p className="text-lf-gray font-medium mt-1 max-w-3xl">
            Créez des comptes équipe, attribuez les projets, gérez les rôles et calculez la paye due
            en fonction des clients actifs sur lesquels chaque membre travaille.
          </p>
        </div>
        {activeTab === "members" && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            <UserPlus className="h-4 w-4" />
            Créer un membre
          </button>
        )}
      </div>

      {/* Onglets */}
      <div className="flex flex-wrap gap-2 border-b-3 border-black">
        {([
          { key: "members" as const, label: "Membres", icon: Users },
          { key: "resources" as const, label: "Ressources & SOP", icon: BookOpen },
        ]).map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`-mb-[3px] flex items-center gap-2 border-3 border-b-0 border-black px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-colors ${
                active ? "bg-lf-black text-white" : "bg-white text-black hover:bg-gray-100"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "resources" ? (
        <TeamResourcesPanel members={members} />
      ) : (
        <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Équipe active"
          value={String(summary.active_members_count)}
          hint="Membres non désactivés"
          icon={Users}
          className="bg-white"
        />
        <SummaryCard
          label="Projets attribués"
          value={String(summary.active_projects_count)}
          hint="Campagnes en cours affectées"
          icon={KanbanSquare}
          className="bg-white"
        />
        <SummaryCard
          label="Clients facturables"
          value={String(summary.active_clients_count)}
          hint="Clients actifs répartis dans l'équipe"
          icon={Shield}
          className="bg-white"
        />
        <SummaryCard
          label="Paye due"
          value={formatCurrency(summary.pay_due_total)}
          hint="Somme des tarifs par client configurés"
          icon={CircleDollarSign}
          className="bg-lf-yellow"
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          <p className="text-sm font-black uppercase tracking-wider">
            Team members ({members.length})
          </p>
        </div>

        {members.length === 0 ? (
          <div className="card-brutal p-8 text-center text-lf-gray font-medium">
            Aucun membre interne trouvé pour le moment.
          </div>
        ) : (
          members.map((member) => (
            <TeamMemberCard
              key={member.id}
              member={member}
              campaigns={campaigns}
            />
          ))
        )}
      </div>
        </>
      )}

      <CreateTeamMemberModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
}
