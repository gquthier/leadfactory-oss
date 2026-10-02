"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Clock, CheckSquare } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

const LS_KEY = "lf_notif_last_seen";
const LS_TASK_KEY = "lf_notif_task_last_seen";

interface Brief {
  id: string;
  submitted_at: string;
  responses: Record<string, unknown>;
}

interface CompletedTask {
  id: string;
  title: string;
  client_id: string;
  completed_at: string | null;
  clientName?: string;
}

export function NotificationBell() {
  const router = useRouter();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [unreadBriefCount, setUnreadBriefCount] = useState(0);
  const [unreadTaskCount, setUnreadTaskCount] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = unreadBriefCount + unreadTaskCount;

  const getLastSeen = (key: string): number => {
    if (typeof window === "undefined") return 0;
    const stored = localStorage.getItem(key);
    return stored ? parseInt(stored, 10) : 0;
  };

  const markAsSeen = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY, Date.now().toString());
      localStorage.setItem(LS_TASK_KEY, Date.now().toString());
    }
  };

  const fetchBriefs = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("onboarding_responses")
      .select("id, submitted_at, responses")
      .order("submitted_at", { ascending: false })
      .limit(5);

    if (data) {
      setBriefs(data as Brief[]);
      const lastSeen = getLastSeen(LS_KEY);
      const newCount = data.filter(
        (b) => new Date(b.submitted_at).getTime() > lastSeen
      ).length;
      setUnreadBriefCount(newCount);
    }
  };

  const fetchCompletedTasks = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("client_tasks")
      .select("id, title, client_id, completed_at")
      .eq("is_completed", true)
      .order("completed_at", { ascending: false })
      .limit(5);

    if (data) {
      setCompletedTasks(data as CompletedTask[]);
      const lastSeen = getLastSeen(LS_TASK_KEY);
      const newCount = data.filter(
        (t) => t.completed_at && new Date(t.completed_at).getTime() > lastSeen
      ).length;
      setUnreadTaskCount(newCount);
    }
  };

  useEffect(() => {
    fetchBriefs();
    fetchCompletedTasks();

    const supabase = createClient();

    const channel = supabase
      .channel("admin-notif-combined")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "onboarding_responses" },
        (payload) => {
          const newBrief = payload.new as Brief;
          setBriefs((prev) => [newBrief, ...prev].slice(0, 5));
          setUnreadBriefCount((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "client_tasks", filter: "is_completed=eq.true" },
        (payload) => {
          const task = payload.new as CompletedTask;
          setCompletedTasks((prev) => {
            const filtered = prev.filter(t => t.id !== task.id);
            return [task, ...filtered].slice(0, 5);
          });
          setUnreadTaskCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen((prev) => !prev);
    if (!open) {
      markAsSeen();
      setUnreadBriefCount(0);
      setUnreadTaskCount(0);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative p-2 text-white/60 hover:text-white transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 border border-white text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5 leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-white border-3 border-black shadow-[4px_4px_0px_#000] z-50 max-h-[80vh] overflow-y-auto">
          {/* Briefs section */}
          <div className="flex items-center justify-between px-4 py-3 border-b-3 border-black bg-lf-black text-white">
            <span className="font-black text-xs uppercase tracking-wider">Derniers briefs</span>
            <button
              onClick={() => { setOpen(false); router.push("/admin/onboarding"); }}
              className="text-lf-yellow text-[10px] font-bold uppercase hover:underline"
            >
              Voir tout →
            </button>
          </div>

          <div className="divide-y-2 divide-black">
            {briefs.length === 0 && (
              <p className="px-4 py-4 text-center text-xs text-lf-gray font-medium">Aucun brief pour l&apos;instant.</p>
            )}
            {briefs.map((b) => {
              const r = b.responses as Record<string, unknown>;
              const entreprise = String(r.a_entreprise || "Sans nom");
              return (
                <button
                  key={b.id}
                  onClick={() => { setOpen(false); router.push("/admin/onboarding"); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-lf-yellow/20 text-left transition-colors"
                >
                  <div>
                    <p className="font-black text-xs uppercase text-black">{entreprise}</p>
                    <p className="text-[10px] text-lf-gray font-medium flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(b.submitted_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <span className="text-lf-blue text-[10px] font-black uppercase">→</span>
                </button>
              );
            })}
          </div>

          {/* Completed tasks section */}
          {completedTasks.length > 0 && (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-t-3 border-b-2 border-black bg-lf-green text-white">
                <span className="font-black text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5" />
                  Tâches complétées
                </span>
                <button
                  onClick={() => { setOpen(false); router.push("/admin/clients"); }}
                  className="text-white/70 text-[10px] font-bold uppercase hover:underline"
                >
                  Voir clients →
                </button>
              </div>
              <div className="divide-y-2 divide-black">
                {completedTasks.map((task) => (
                  <div key={task.id} className="px-4 py-3 flex items-start gap-3">
                    <CheckSquare className="w-3.5 h-3.5 text-lf-green mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-black text-xs uppercase text-black truncate">{task.title}</p>
                      {task.completed_at && (
                        <p className="text-[10px] text-lf-gray font-medium mt-0.5">
                          {new Date(task.completed_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
