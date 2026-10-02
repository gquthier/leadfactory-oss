"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, LayoutDashboard, ClipboardList, Users, Megaphone, Settings, LogOut, X, BarChart2, MessageSquare, UserCheck, KanbanSquare, Video, Wallet, Shield, Activity, GraduationCap, Webhook, BookOpen, Flame } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { NotificationBell } from "@/components/admin/NotificationBell";

const NAV = [
  { href: "/admin/start-here", label: "Start Here", icon: Zap },
  { href: "/admin/agents", label: "Agents IA", icon: Users },
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/admin/onboarding", label: "Onboarding", icon: ClipboardList },
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/results", label: "Résultats", icon: Flame },
  { href: "/admin/campaigns", label: "Campagnes", icon: Megaphone },
  { href: "/admin/leads", label: "Leads", icon: UserCheck },
  { href: "/admin/crm", label: "CRM LF", icon: KanbanSquare },
  { href: "/admin/meta", label: "Meta Ads", icon: BarChart2 },
  { href: "/admin/chat", label: "Chat IA", icon: MessageSquare },
  { href: "/admin/ugc/montage", label: "UGC Scripts", icon: Video },
  { href: "/admin/resources", label: "Ressources", icon: BookOpen },
  { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/admin/settings", label: "Paramètres", icon: Settings },
];

interface Props {
  pendingCount?: number;
  isSuperAdmin?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ pendingCount = 0, isSuperAdmin = false, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = isSuperAdmin
    ? [
        ...NAV.slice(0, 8),
        { href: "/admin/team", label: "Team", icon: Shield },
        { href: "/admin/finances", label: "Finance", icon: Wallet },
        { href: "/admin/activity", label: "Activité", icon: Activity },
        { href: "/admin/formations", label: "Formations", icon: GraduationCap },
        ...NAV.slice(8),
      ]
    : NAV;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="flex flex-col h-full bg-lf-black text-white border-r-3 border-black">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-5 border-b-3 border-white/10">
        <Link href="/admin/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-lf-blue border-2 border-white/20 rounded-full flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-black uppercase tracking-tight">LeadFactory</span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 hover:text-lf-yellow">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Admin badge */}
      <div className="px-5 py-3 border-b-3 border-white/10">
        <span className="inline-block bg-lf-yellow text-black text-xs font-black uppercase tracking-wider px-3 py-1 border-2 border-black">
          {isSuperAdmin ? "SUPER ADMIN" : "ADMIN"}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-3 font-bold text-sm uppercase tracking-wide transition-colors duration-100 border-2 ${
                active
                  ? "bg-lf-blue border-lf-blue text-white"
                  : "border-transparent text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {label === "Onboarding" && pendingCount > 0 && (
                <span className="ml-auto bg-lf-yellow text-black text-xs font-black px-2 py-0.5 border border-black">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t-3 border-white/10">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-3 font-bold text-sm uppercase tracking-wide text-white/60 hover:text-red-400 border-2 border-transparent hover:border-red-400/30 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Déconnexion
        </button>
      </div>
    </div>
  );
}
