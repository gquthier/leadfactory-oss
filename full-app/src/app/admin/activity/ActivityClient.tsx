"use client";

import { useState, useMemo } from "react";
import {
  Activity,
  LogIn,
  UserPlus,
  UserMinus,
  UserCheck,
  UserX,
  Pencil,
  Eye,
  ClipboardCheck,
  FileText,
  ArrowRightLeft,
  Search,
  Filter,
  ChevronDown,
} from "lucide-react";

interface ActivityLog {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  role: string;
  is_active: boolean;
  first_login_at: string | null;
  last_seen_at: string | null;
}

interface Props {
  logs: ActivityLog[];
  profiles: Profile[];
}

const ACTION_CONFIG: Record<string, { label: string; icon: typeof Activity; color: string }> = {
  login: { label: "Connexion", icon: LogIn, color: "text-lf-blue" },
  first_login: { label: "Première connexion", icon: UserCheck, color: "text-lf-green" },
  client_created: { label: "Client créé", icon: UserPlus, color: "text-lf-green" },
  client_updated: { label: "Client modifié", icon: Pencil, color: "text-lf-blue" },
  client_deleted: { label: "Client supprimé", icon: UserMinus, color: "text-red-500" },
  client_deactivated: { label: "Client désactivé", icon: UserX, color: "text-red-500" },
  client_reactivated: { label: "Client réactivé", icon: UserCheck, color: "text-lf-green" },
  campaign_created: { label: "Campagne créée", icon: FileText, color: "text-lf-green" },
  campaign_updated: { label: "Campagne modifiée", icon: Pencil, color: "text-lf-blue" },
  campaign_status_changed: { label: "Statut campagne changé", icon: ArrowRightLeft, color: "text-lf-yellow" },
  task_created: { label: "Tâche créée", icon: ClipboardCheck, color: "text-lf-blue" },
  task_completed: { label: "Tâche complétée", icon: ClipboardCheck, color: "text-lf-green" },
  lead_viewed: { label: "Lead consulté", icon: Eye, color: "text-lf-gray" },
  onboarding_processed: { label: "Onboarding traité", icon: UserPlus, color: "text-lf-green" },
  password_reset: { label: "Mot de passe réinitialisé", icon: LogIn, color: "text-lf-yellow" },
  page_visit: { label: "Page visitée", icon: Eye, color: "text-lf-gray" },
};

const ACTION_FILTER_GROUPS = [
  { label: "Connexions", actions: ["login", "first_login"] },
  { label: "Clients", actions: ["client_created", "client_updated", "client_deleted", "client_deactivated", "client_reactivated"] },
  { label: "Campagnes", actions: ["campaign_created", "campaign_updated", "campaign_status_changed"] },
  { label: "Onboarding", actions: ["onboarding_processed"] },
  { label: "Navigation", actions: ["page_visit"] },
];

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin}min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  if (diffDays < 7) return `il y a ${diffDays}j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function getLoginStatus(profile: Profile): { label: string; color: string } {
  if (!profile.first_login_at) return { label: "Jamais connecté", color: "bg-red-100 text-red-700 border-red-300" };
  if (!profile.last_seen_at) return { label: "Inactif", color: "bg-gray-100 text-gray-600 border-gray-300" };

  const lastSeen = new Date(profile.last_seen_at);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - lastSeen.getTime()) / 86400000);

  if (diffDays < 1) return { label: "Actif aujourd'hui", color: "bg-green-100 text-green-700 border-green-300" };
  if (diffDays < 7) return { label: `Vu il y a ${diffDays}j`, color: "bg-blue-100 text-blue-700 border-blue-300" };
  if (diffDays < 30) return { label: `Inactif ${diffDays}j`, color: "bg-yellow-100 text-yellow-700 border-yellow-300" };
  return { label: `Inactif ${diffDays}j`, color: "bg-red-100 text-red-700 border-red-300" };
}

export function ActivityClient({ logs, profiles }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "users">("timeline");

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches =
          log.actor_email?.toLowerCase().includes(q) ||
          log.target_label?.toLowerCase().includes(q) ||
          log.action.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Role filter
      if (selectedRole !== "all" && log.actor_role !== selectedRole) return false;

      // Action filter
      if (selectedActions.length > 0 && !selectedActions.includes(log.action)) return false;

      return true;
    });
  }, [logs, searchQuery, selectedRole, selectedActions]);

  const filteredProfiles = useMemo(() => {
    if (!searchQuery) return profiles;
    const q = searchQuery.toLowerCase();
    return profiles.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.company?.toLowerCase().includes(q)
    );
  }, [profiles, searchQuery]);

  const toggleAction = (action: string) => {
    setSelectedActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  // Stats
  const clientProfiles = profiles.filter((p) => p.role === "client");
  const neverConnected = clientProfiles.filter((p) => !p.first_login_at).length;
  const activeToday = clientProfiles.filter((p) => {
    if (!p.last_seen_at) return false;
    const diff = Date.now() - new Date(p.last_seen_at).getTime();
    return diff < 86400000;
  }).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="sticker -rotate-1 inline-block mb-3">SUPER ADMIN</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Journal d'activité</h1>
        <p className="text-sm text-lf-gray font-medium mt-1">
          Suivi des connexions, actions et activité des utilisateurs.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card-brutal p-4 text-center">
          <p className="text-3xl font-black">{clientProfiles.length}</p>
          <p className="text-xs font-bold uppercase text-lf-gray mt-1">Clients</p>
        </div>
        <div className="card-brutal p-4 text-center">
          <p className="text-3xl font-black text-lf-green">{activeToday}</p>
          <p className="text-xs font-bold uppercase text-lf-gray mt-1">Actifs aujourd'hui</p>
        </div>
        <div className="card-brutal p-4 text-center">
          <p className="text-3xl font-black text-red-500">{neverConnected}</p>
          <p className="text-xs font-bold uppercase text-lf-gray mt-1">Jamais connectés</p>
        </div>
        <div className="card-brutal p-4 text-center">
          <p className="text-3xl font-black text-lf-blue">{logs.length}</p>
          <p className="text-xs font-bold uppercase text-lf-gray mt-1">Actions récentes</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("timeline")}
          className={`px-4 py-2 font-black text-xs uppercase border-3 border-black transition-all ${
            activeTab === "timeline"
              ? "bg-lf-black text-white shadow-brutal-sm"
              : "bg-white hover:bg-gray-50"
          }`}
        >
          Timeline
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`px-4 py-2 font-black text-xs uppercase border-3 border-black transition-all ${
            activeTab === "users"
              ? "bg-lf-black text-white shadow-brutal-sm"
              : "bg-white hover:bg-gray-50"
          }`}
        >
          Utilisateurs
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lf-gray" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par email, nom, action..."
            className="input-brutal pl-10 w-full"
          />
        </div>

        {activeTab === "timeline" && (
          <>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="input-brutal w-auto"
            >
              <option value="all">Tous les rôles</option>
              <option value="admin">Admin</option>
              <option value="client">Client</option>
              <option value="system">Système</option>
            </select>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 font-black text-xs uppercase border-3 border-black transition-all ${
                selectedActions.length > 0
                  ? "bg-lf-blue text-white"
                  : "bg-white hover:bg-gray-50"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filtres
              {selectedActions.length > 0 && (
                <span className="bg-white text-lf-black px-1.5 py-0.5 text-[10px] font-black rounded-sm">
                  {selectedActions.length}
                </span>
              )}
              <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && activeTab === "timeline" && (
        <div className="card-brutal p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            {ACTION_FILTER_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-black uppercase text-lf-gray mb-2">{group.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.actions.map((action) => {
                    const config = ACTION_CONFIG[action];
                    const isSelected = selectedActions.includes(action);
                    return (
                      <button
                        key={action}
                        onClick={() => toggleAction(action)}
                        className={`px-2.5 py-1 text-[11px] font-bold border-2 border-black transition-all ${
                          isSelected
                            ? "bg-lf-black text-white"
                            : "bg-white hover:bg-gray-50"
                        }`}
                      >
                        {config?.label ?? action}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {selectedActions.length > 0 && (
            <button
              onClick={() => setSelectedActions([])}
              className="mt-3 text-xs font-bold text-lf-blue hover:underline"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      )}

      {/* Timeline tab */}
      {activeTab === "timeline" && (
        <div className="space-y-2">
          {filteredLogs.length === 0 ? (
            <div className="card-brutal p-12 text-center">
              <Activity className="w-10 h-10 text-lf-gray mx-auto mb-3" />
              <p className="font-bold text-lf-gray">Aucune activité trouvée</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const config = ACTION_CONFIG[log.action] ?? {
                label: log.action,
                icon: Activity,
                color: "text-lf-gray",
              };
              const Icon = config.icon;
              const actorProfile = log.actor_id ? profileMap.get(log.actor_id) : null;
              const actorName = actorProfile?.full_name ?? log.actor_email ?? "Système";

              return (
                <div
                  key={log.id}
                  className="card-brutal p-4 flex items-start gap-4 hover:shadow-brutal-sm transition-shadow"
                >
                  <div className={`mt-0.5 ${config.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-sm">{actorName}</span>
                      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${
                        log.actor_role === "admin"
                          ? "bg-lf-blue/10 text-lf-blue border-lf-blue/30"
                          : log.actor_role === "client"
                          ? "bg-lf-yellow/20 text-yellow-700 border-yellow-400/30"
                          : "bg-gray-100 text-gray-500 border-gray-200"
                      }`}>
                        {log.actor_role ?? "system"}
                      </span>
                    </div>
                    <p className="text-sm mt-0.5">
                      <span className="font-bold">{config.label}</span>
                      {log.target_label && (
                        <span className="text-lf-gray">
                          {" "}— {log.target_label}
                        </span>
                      )}
                    </p>
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {typeof log.metadata.new_status === "string" && (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-lf-blue/10 text-lf-blue border border-lf-blue/20">
                            {"→ "}{log.metadata.new_status}
                          </span>
                        )}
                        {Array.isArray(log.metadata.changed_fields) && (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                            {"Champs: "}{(log.metadata.changed_fields as string[]).join(", ")}
                          </span>
                        )}
                        {typeof log.metadata.page === "string" && (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                            {log.metadata.page}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-lf-gray font-medium whitespace-nowrap flex-shrink-0">
                    {timeAgo(log.created_at)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
        <div className="space-y-2">
          {filteredProfiles.length === 0 ? (
            <div className="card-brutal p-12 text-center">
              <p className="font-bold text-lf-gray">Aucun utilisateur trouvé</p>
            </div>
          ) : (
            filteredProfiles.map((profile) => {
              const status = getLoginStatus(profile);
              return (
                <div
                  key={profile.id}
                  className="card-brutal p-4 flex items-center gap-4 hover:shadow-brutal-sm transition-shadow"
                >
                  <div className={`w-10 h-10 border-3 border-black flex items-center justify-center font-black text-sm uppercase ${
                    profile.role === "admin" ? "bg-lf-blue text-white" : "bg-lf-yellow"
                  }`}>
                    {profile.full_name?.charAt(0) ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-sm">{profile.full_name}</span>
                      {profile.company && (
                        <span className="text-xs text-lf-gray font-medium">{profile.company}</span>
                      )}
                    </div>
                    <p className="text-xs text-lf-gray truncate">{profile.email}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`px-2.5 py-1 text-[10px] font-bold uppercase border ${status.color}`}>
                      {status.label}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${
                      profile.role === "admin"
                        ? "bg-lf-blue/10 text-lf-blue border-lf-blue/30"
                        : "bg-lf-yellow/20 text-yellow-700 border-yellow-400/30"
                    }`}>
                      {profile.role}
                    </span>
                    {!profile.is_active && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-red-100 text-red-600 border border-red-200">
                        Désactivé
                      </span>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 hidden md:block">
                    <p className="text-[10px] font-bold uppercase text-lf-gray">Dernière connexion</p>
                    <p className="text-xs font-medium">
                      {profile.last_seen_at
                        ? timeAgo(profile.last_seen_at)
                        : "—"}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
