"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Zap, LayoutDashboard, Megaphone, Settings, X,
  UserCheck, CalendarClock, ClipboardList, Star, GraduationCap, Kanban, Mail, Linkedin, Headphones, Gift, ExternalLink,
} from "lucide-react";
import { CreditsBadge } from "@/components/client/CreditsBadge";

interface Props {
  onClose?: () => void;
  companyName?: string;
  nextCatchup?: string | null;
  pendingTasksCount?: number;
  /** Mode compact (icônes seulement). N'a d'effet que sur desktop. */
  collapsed?: boolean;
}

function SidebarCatchup({ date }: { date: string }) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  let bgClass = "bg-white border-black";
  let hint = `dans ${diffDays}j`;
  if (diffDays < 0) { bgClass = "bg-red-100 border-red-400"; hint = `passé il y a ${Math.abs(diffDays)}j`; }
  else if (diffDays === 0) { bgClass = "bg-lf-green text-white border-lf-green"; hint = "aujourd'hui !"; }
  else if (diffDays <= 3) { bgClass = "bg-lf-yellow border-black"; }

  return (
    <div className="pl-5 flex flex-col gap-0.5">
      <span className={`inline-block text-xs font-black px-2 py-1 border-2 ${bgClass}`}>
        {label}
      </span>
      <span className="text-xs font-medium text-lf-gray">{hint}</span>
    </div>
  );
}

export function ClientSidebar({ onClose, companyName, nextCatchup, pendingTasksCount = 0, collapsed = false }: Props) {
  const pathname = usePathname();
  const [surpriseState, setSurpriseState] = useState<{ status: string; unseen: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchState() {
      try {
        const res = await fetch("/api/surprises/state", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string; unseen?: boolean };
        if (!cancelled && data.status) {
          setSurpriseState({ status: data.status, unseen: Boolean(data.unseen) });
        }
      } catch {
        /* swallow */
      }
    }
    fetchState();
    const interval = setInterval(fetchState, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]);

  const showSurprises = Boolean(surpriseState && surpriseState.status !== "pending");
  const surpriseBadge =
    surpriseState?.status === "generating" ? "..." :
    surpriseState?.status === "ready" && surpriseState.unseen ? "🎁" :
    surpriseState?.status === "ready" ? "Prêt" :
    surpriseState?.status === "failed" ? "!" :
    null;
  const surprisePulse = surpriseState?.status === "ready" && surpriseState.unseen;

  const BASE_NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard; badge?: string; pulse?: boolean }> = [
    { href: "/client/overview", label: "Aperçu", icon: LayoutDashboard },
    { href: "/client/campaigns", label: "Ma campagne", icon: Megaphone },
    { href: "/client/crm", label: "CRM", icon: Kanban },
    { href: "/client/leads", label: "Mes Leads", icon: UserCheck },
    { href: "/client/sequence", label: "Outbound IA", icon: Mail, badge: "Nouveau" },
    { href: "/client/personal-brand", label: "Personal Brand IA", icon: Linkedin, badge: "Nouveau" },
    { href: "/client/sales", label: "Sales IA", icon: Headphones, badge: "Nouveau" },
    ...(showSurprises
      ? [{ href: "/client/surprises", label: "Surprises", icon: Gift, badge: surpriseBadge ?? undefined, pulse: surprisePulse }]
      : []),
    { href: "/client/formations", label: "Formations", icon: GraduationCap },
  ];

  const FOOTER_NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> = [
    { href: "/client/espace-partenaire", label: "Espace partenaire", icon: Star },
    { href: "/client/settings", label: "Paramètres", icon: Settings },
  ];

  // Click sur zone vide de la sidebar → toggle collapse desktop.
  // Si le click vient d'un Link, button ou input → on ne toggle pas.
  const handleSidebarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 1024) return; // pas sur mobile
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, textarea, select")) return;
    window.dispatchEvent(new CustomEvent("lf-toggle-main-sidebar"));
  };

  return (
    <div
      onClick={handleSidebarClick}
      className="flex flex-col h-full bg-canvas border-r-3 border-black lg:cursor-ew-resize"
      title="Cliquer sur une zone vide pour replier / déplier"
    >
      {/* Header — bloc fusionné logo + client, une seule border-b */}
      <div
        className={`flex items-center ${
          collapsed ? "justify-center" : "justify-between"
        } gap-3 ${collapsed ? "px-3" : "px-5"} py-4 border-b-3 border-black h-[73px] flex-shrink-0`}
      >
        <Link href="/client/overview" className="flex items-center gap-3 min-w-0" title={collapsed ? "LeadFactory" : undefined}>
          <div className="w-8 h-8 bg-lf-blue border-3 border-black rounded-full flex items-center justify-center shadow-brutal-xs flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-black uppercase tracking-tight leading-none">LeadFactory</p>
              {companyName && (
                <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mt-1 truncate">
                  {companyName}
                </p>
              )}
            </div>
          )}
        </Link>
        {onClose && !collapsed && (
          <button onClick={onClose} className="lg:hidden p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>


      <nav className={`flex-1 ${collapsed ? "px-2" : "px-3"} py-4 flex flex-col gap-1 overflow-y-auto`}>
        {/* À faire — only shown when pending tasks exist */}
        {pendingTasksCount > 0 && (
          <Link
            href="/client/overview"
            onClick={onClose}
            title={collapsed ? `À faire (${pendingTasksCount})` : undefined}
            className={`flex items-center ${collapsed ? "justify-center px-2" : "justify-between px-3"} gap-3 py-3 font-bold text-sm uppercase tracking-wide transition-colors border-3 relative ${
              pathname === "/client/overview"
                ? "bg-lf-yellow border-black"
                : "border-lf-yellow bg-lf-yellow/20 hover:bg-lf-yellow hover:border-lf-yellow"
            }`}
          >
            <span className={`flex items-center ${collapsed ? "" : "gap-3"}`}>
              <ClipboardList className="w-4 h-4 flex-shrink-0" />
              {!collapsed && "À faire"}
            </span>
            {!collapsed ? (
              <span className="min-w-[20px] h-5 bg-lf-black text-white text-[10px] font-black flex items-center justify-center px-1 flex-shrink-0">
                {pendingTasksCount}
              </span>
            ) : (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-lf-black text-white text-[9px] font-black flex items-center justify-center px-1 border-2 border-canvas">
                {pendingTasksCount}
              </span>
            )}
          </Link>
        )}

        {BASE_NAV.map(({ href, label, icon: Icon, badge, pulse }) => {
          const active = pathname.startsWith(href);
          const pulseClass = pulse ? "ring-2 ring-lf-yellow ring-offset-2 ring-offset-canvas animate-pulse" : "";
          return (
            <Link key={href} href={href} onClick={onClose}
              title={collapsed ? label : undefined}
              className={`flex items-center ${collapsed ? "justify-center px-2" : "justify-between px-3"} gap-3 py-3 font-bold text-sm uppercase tracking-wide transition-colors border-3 relative ${
                active ? "bg-lf-black text-white border-lf-black" : "border-transparent hover:bg-gray-100 hover:border-gray-200"
              } ${pulseClass}`}
            >
              <span className={`flex items-center ${collapsed ? "" : "gap-3 min-w-0"}`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="min-w-0">{label}</span>}
              </span>
              {!collapsed && badge && (
                <span className={`text-[10px] font-black px-2 py-1 border-2 flex-shrink-0 ${
                  active ? "bg-lf-yellow text-black border-lf-yellow" : pulse ? "bg-lf-yellow text-black border-black animate-pulse" : "bg-white text-black border-black"
                }`}>
                  {badge}
                </span>
              )}
              {collapsed && badge && (
                <span className={`absolute -top-1 -right-1 w-2 h-2 bg-lf-yellow border-2 border-black rounded-full ${pulse ? "animate-pulse" : ""}`} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Crédits */}
      <div className={`${collapsed ? "px-2" : "px-3"} py-3 border-t-3 border-black`}>
        <CreditsBadge collapsed={collapsed} />
      </div>

      {/* Footer nav : Espace partenaire + Paramètres + Slack */}
      <nav className={`${collapsed ? "px-2" : "px-3"} py-3 flex flex-col gap-1 border-t-3 border-black`}>
        {FOOTER_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href} onClick={onClose}
              title={collapsed ? label : undefined}
              className={`flex items-center ${collapsed ? "justify-center px-2" : "px-3"} gap-3 py-2.5 font-bold text-sm uppercase tracking-wide transition-colors border-3 ${
                active ? "bg-lf-black text-white border-lf-black" : "border-transparent hover:bg-gray-100 hover:border-gray-200"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="min-w-0">{label}</span>}
            </Link>
          );
        })}
        <a
          href="https://example.invalid"
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? "Accéder à Slack" : undefined}
          className={`flex items-center ${collapsed ? "justify-center px-2" : "px-3"} gap-3 py-2.5 font-bold text-sm uppercase tracking-wide transition-colors border-3 border-transparent hover:bg-gray-100 hover:border-gray-200 text-lf-gray hover:text-black`}
        >
          <ExternalLink className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span className="min-w-0">Slack</span>}
        </a>
      </nav>

      {/* Prochain Catchup */}
      {!collapsed && (
        <div className="px-4 py-4 border-t-3 border-black">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-lf-gray flex-shrink-0" />
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray">Prochain Catchup</p>
          </div>
          {nextCatchup ? (
            <SidebarCatchup date={nextCatchup} />
          ) : (
            <p className="text-xs font-medium text-lf-gray pl-5">Non planifié</p>
          )}
        </div>
      )}

    </div>
  );
}
