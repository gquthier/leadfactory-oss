"use client";

import { useState } from "react";
import { Menu, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AskAIPanel } from "@/components/ai/AskAIPanel";

export function AdminLayoutClient({
  children,
  pendingCount,
  isSuperAdmin = false,
}: {
  children: React.ReactNode;
  pendingCount: number;
  isSuperAdmin?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Extract campaign_id from URL if admin is viewing a specific campaign
  const pathname = usePathname();
  const campaignIdMatch = pathname.match(/\/admin\/campaigns\/([0-9a-f-]{36})/);
  const campaignId = campaignIdMatch?.[1];

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Sidebar desktop */}
      <div className="hidden lg:flex lg:w-60 lg:flex-shrink-0">
        <AdminSidebar pendingCount={pendingCount} isSuperAdmin={isSuperAdmin} />
      </div>

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-60 flex-shrink-0">
            <AdminSidebar pendingCount={pendingCount} isSuperAdmin={isSuperAdmin} onClose={() => setSidebarOpen(false)} />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — mobile (hidden on /admin/chat) */}
        {pathname !== "/admin/chat" && (
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-lf-black border-b-3 border-black">
            <button onClick={() => setSidebarOpen(true)} className="text-white">
              <Menu className="w-6 h-6" />
            </button>
            <span className="text-white font-black uppercase tracking-tight flex-1">LeadFactory Admin</span>
            {!aiOpen && (
              <button
                onClick={() => setAiOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-lf-yellow text-black border-2 border-black font-black text-xs uppercase tracking-wider hover:shadow-[3px_3px_0_#000] transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Ask AI
              </button>
            )}
          </div>
        )}

        {/* Top bar — desktop (hidden on /admin/chat) */}
        {pathname !== "/admin/chat" && (
          <div className="hidden lg:flex items-center justify-end px-6 py-3 border-b-3 border-black bg-canvas gap-3">
            {campaignId && (
              <span className="text-xs font-bold text-lf-gray uppercase tracking-wider">
                Contexte : campagne active
              </span>
            )}
            {!aiOpen && (
              <button
                onClick={() => setAiOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[4px_4px_0_#000] transition-all"
              >
                <Sparkles className="w-4 h-4 text-lf-yellow" />
                Ask AI
              </button>
            )}
          </div>
        )}

        <main className={`flex-1 ${pathname === "/admin/chat" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {process.env.NEXT_PUBLIC_LEADFACTORY_DATA_MODE!=='supabase'&&<div className="bg-lf-yellow border-b-3 border-black px-6 py-2 text-xs font-bold">MODE LOCAL · Données de votre copie uniquement · Services externes déconnectés par défaut</div>}{children}
        </main>
      </div>

      {/* AI Chat Panel */}
      <AskAIPanel
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
        campaignId={campaignId}
        isAdmin={true}
      />
    </div>
  );
}
