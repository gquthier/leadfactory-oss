"use client";

import { useState, useEffect, useCallback } from "react";
import { Menu, Sparkles, ClipboardList, X, ExternalLink, ArrowLeft, Eye } from "lucide-react";
import { usePathname } from "next/navigation";
import { ClientSidebar } from "@/components/layout/ClientSidebar";
import { AskAIPanel } from "@/components/ai/AskAIPanel";
import { ClientNotificationBell } from "@/components/client/ClientNotificationBell";
import {createClient as createBrowserClient} from "@/lib/supabase-browser";
import { useTrackPageVisit } from "@/hooks/useTrackPageVisit";

const AI_WIDTH_KEY = "lf-askai-width";
const DEFAULT_AI_WIDTH = 420;
const SIDEBAR_COLLAPSED_KEY = "lf-main-sidebar-collapsed";

interface NewTaskToast {
  id: string;
  title: string;
}

interface Props {
  children: React.ReactNode;
  companyName: string;
  nextCatchup?: string | null;
  clientId: string;
  pendingTasksCount: number;
  isPreview?: boolean;
  previewClientName?: string | null;
  adminClientId?: string | null;
}

export function ClientLayoutClient({ children, companyName, nextCatchup, clientId, pendingTasksCount: initialCount, isPreview = false, previewClientName, adminClientId }: Props) {
  useTrackPageVisit();
  const pathname = usePathname();
  // Pages full-screen sans topbar globale (l'UI gère son propre header local)
  // Note: /client/sequence est un hub (cards), seul /client/sequence/cold-email
  // est full-screen — pareil pour /client/personal-brand/linkedin.
  const isFullScreenPage =
    (pathname?.startsWith("/client/sequence/cold-email") ||
      pathname?.startsWith("/client/personal-brand/linkedin")) ?? false;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(DEFAULT_AI_WIDTH);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pendingTasksCount, setPendingTasksCount] = useState(initialCount);
  const [toasts, setToasts] = useState<NewTaskToast[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(AI_WIDTH_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed)) setAiWidth(parsed);
    }
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
      setSidebarCollapsed(true);
    }
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // Permet aux pages full-screen (Outbound IA) de déclencher le toggle
  // depuis leur propre header via un CustomEvent.
  useEffect(() => {
    const handler = () => toggleSidebarCollapsed();
    window.addEventListener("lf-toggle-main-sidebar", handler);
    return () => window.removeEventListener("lf-toggle-main-sidebar", handler);
  }, [toggleSidebarCollapsed]);

  // Listen to task completions from TodosClient (window event)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ delta: number }>;
      setPendingTasksCount(prev => Math.max(0, prev + ce.detail.delta));
    };
    window.addEventListener("task-status-changed", handler);
    return () => window.removeEventListener("task-status-changed", handler);
  }, []);

  // Realtime: new task assigned by admin
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const supabase = createBrowserClient();

    const channel = supabase
      .channel(`client-tasks-${clientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "client_tasks", filter: `client_id=eq.${clientId}` },
        (payload) => {
          const newTask = payload.new as { id: string; title: string };
          setPendingTasksCount(prev => prev + 1);
          const toast: NewTaskToast = { id: newTask.id, title: newTask.title };
          setToasts(prev => [toast, ...prev]);
          // Auto-dismiss after 6s
          setTimeout(() => dismissToast(newTask.id), 6000);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [clientId, dismissToast]);

  const handleExitPreview = async () => {
    await fetch("/api/admin/preview-client", { method: "DELETE" });
    window.location.href = adminClientId
      ? `/admin/clients/${adminClientId}`
      : "/admin/clients";
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-canvas">
      {/* Bandeau mode aperçu */}
      {isPreview && (
        <div className="flex-none flex items-center justify-between gap-3 px-4 py-2 bg-lf-black text-white border-b-3 border-lf-yellow z-50">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider">
            <Eye className="w-3.5 h-3.5 text-lf-yellow flex-none" />
            <span className="text-lf-yellow">Aperçu client</span>
            <span className="text-white/60">—</span>
            <span>{previewClientName ?? "Client"}</span>
          </div>
          <button
            onClick={handleExitPreview}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase bg-lf-yellow text-black border-2 border-lf-yellow hover:bg-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour admin
          </button>
        </div>
      )}
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar desktop — largeur conditionnelle */}
      <div
        className={`hidden lg:flex lg:flex-shrink-0 transition-[width] duration-200 ${
          sidebarCollapsed ? "lg:w-16" : "lg:w-56"
        }`}
      >
        <ClientSidebar
          companyName={companyName}
          nextCatchup={nextCatchup}
          pendingTasksCount={pendingTasksCount}
          collapsed={sidebarCollapsed}
        />
      </div>

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-56 flex-shrink-0">
            <ClientSidebar
              companyName={companyName}
              nextCatchup={nextCatchup}
              pendingTasksCount={pendingTasksCount}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <div
        className="flex-1 flex flex-col overflow-hidden transition-[padding-right] duration-200"
        style={{ paddingRight: aiOpen && isDesktop ? `min(${aiWidth}px, 50vw)` : 0 }}
      >
        {/* Top bar — mobile */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-canvas border-b-3 border-black">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-black uppercase tracking-tight flex-1">LeadFactory</span>
          <ClientNotificationBell clientId={clientId} />
          <a
            href="https://example.invalid"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-2 bg-white border-2 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-yellow transition-all"
          >
            <ExternalLink className="w-3 h-3" />
            Slack
          </a>
          {!aiOpen && (
            <button
              onClick={() => setAiOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-lf-black text-white border-2 border-black font-black text-xs uppercase tracking-wider"
            >
              <Sparkles className="w-3.5 h-3.5 text-lf-yellow" />
              Parler à Opti
            </button>
          )}
        </div>

        {/* Top bar — desktop (hauteur 73px pour aligner avec sidebar header)
            Cachée sur les pages full-screen comme Outbound IA. */}
        {!isFullScreenPage && (
        <div className="hidden lg:flex items-center justify-end gap-3 px-6 border-b-3 border-black bg-canvas h-[73px] flex-shrink-0">
          <ClientNotificationBell clientId={clientId} />
          {!aiOpen && (
            <button
              onClick={() => setAiOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[4px_4px_0_#000] transition-all"
            >
              <Sparkles className="w-4 h-4 text-lf-yellow" />
              Parler à Opti
            </button>
          )}
        </div>
        )}

        <main className="flex-1 overflow-y-auto lg:pl-3">
          {children}
        </main>
      </div>

      <AskAIPanel
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
        isAdmin={false}
        onWidthChange={setAiWidth}
      />

      {/* New task toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map(toast => (
            <div key={toast.id} className="bg-lf-black text-white border-3 border-lf-yellow shadow-brutal flex items-start gap-3 p-4 animate-in slide-in-from-bottom-2">
              <ClipboardList className="w-5 h-5 text-lf-yellow flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black uppercase tracking-wider text-lf-yellow">Nouvelle tâche assignée</p>
                <p className="text-sm font-medium mt-0.5 line-clamp-2">{toast.title}</p>
              </div>
              <button onClick={() => dismissToast(toast.id)} className="text-white/60 hover:text-white flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
