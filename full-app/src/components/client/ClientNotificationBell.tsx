"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, UserPlus, MessageSquare } from "lucide-react";
import {createClient as createBrowserClient} from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

interface ClientNote {
  id: string;
  campaign_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface ClientNotification {
  id: string;
  kind: "new_lead" | "follow_up_reminder" | "weekly_summary" | "system";
  lead_id: string | null;
  title: string;
  body: string;
  link_path: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface FeedItem {
  source: "note" | "notification";
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  kind?: ClientNotification["kind"];
  /** For navigation on click */
  linkPath?: string | null;
  /** Original raw refs for marking-as-read on the right endpoint */
  rawNote?: ClientNote;
  rawNotif?: ClientNotification;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function noteToItem(n: ClientNote): FeedItem {
  return {
    source: "note",
    id: `note-${n.id}`,
    title: "Message de votre gestionnaire",
    body: n.content,
    isRead: n.is_read,
    createdAt: n.created_at,
    linkPath: `/client/campaigns/${n.campaign_id}`,
    rawNote: n,
  };
}

function notifToItem(n: ClientNotification): FeedItem {
  return {
    source: "notification",
    id: `notif-${n.id}`,
    title: n.title || (n.kind === "new_lead" ? "Nouveau lead" : "Notification"),
    body: n.body,
    isRead: n.is_read,
    createdAt: n.created_at,
    kind: n.kind,
    linkPath: n.link_path,
    rawNotif: n,
  };
}

export function ClientNotificationBell({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Merge + sort feed
  const feed: FeedItem[] = [
    ...notes.map(noteToItem),
    ...notifications.map(notifToItem),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  const unreadCount = feed.filter((it) => !it.isRead).length;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [notesRes, notifsRes] = await Promise.all([
        fetch("/api/client/notes"),
        fetch("/api/client/notifications?limit=20"),
      ]);
      const notesData = notesRes.ok ? await notesRes.json() : null;
      const notifsData = notifsRes.ok ? await notifsRes.json() : null;
      if (notesData?.notes) setNotes(notesData.notes.slice(0, 12) as ClientNote[]);
      if (notifsData?.notifications)
        setNotifications(notifsData.notifications as ClientNotification[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Realtime channels — unique IDs to avoid duplicate subscription errors
  // when both mobile and desktop instances render simultaneously.
  const channelIdRef = useRef(Math.random().toString(36).slice(2, 8));
  useEffect(() => {
    const supabase = createBrowserClient();

    const notesChannel = supabase
      .channel(`client-notes-${clientId}-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "client_notes", filter: `client_id=eq.${clientId}` },
        (payload) => {
          const newNote = payload.new as ClientNote;
          setNotes((prev) => [newNote, ...prev].slice(0, 12));
        }
      )
      .subscribe();

    const notifsChannel = supabase
      .channel(`client-notifs-${clientId}-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "client_notifications", filter: `client_id=eq.${clientId}` },
        (payload) => {
          const newNotif = payload.new as ClientNotification;
          setNotifications((prev) => [newNotif, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notesChannel);
      supabase.removeChannel(notifsChannel);
    };
  }, [clientId]);

  // Click outside closes the dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = async () => {
    setOpen((v) => !v);
    if (open || unreadCount === 0) return;

    // Optimistic local update
    setNotes((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() }))
    );

    // Server: mark unread notes (legacy endpoint) + unread notifications (new endpoint)
    const unreadNoteIds = notes.filter((n) => !n.is_read).map((n) => n.id);
    const unreadNotifIds = notifications.filter((n) => !n.is_read).map((n) => n.id);

    const calls: Promise<unknown>[] = [];
    if (unreadNoteIds.length > 0) {
      calls.push(
        fetch("/api/client/notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unreadNoteIds }),
        })
      );
    }
    if (unreadNotifIds.length > 0) {
      calls.push(
        fetch("/api/client/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unreadNotifIds }),
        })
      );
    }
    await Promise.allSettled(calls);
  };

  const handleClickItem = (item: FeedItem) => {
    setOpen(false);
    if (item.linkPath) router.push(item.linkPath);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className="relative p-2 hover:text-lf-yellow transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-black flex items-center justify-center border-2 border-white px-0.5">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-canvas border-3 border-black shadow-brutal z-50">
          <div className="px-4 py-3 bg-lf-black text-white border-b-3 border-black flex items-center justify-between">
            <p className="font-black uppercase text-xs tracking-wider">Notifications</p>
            {loading && <span className="text-white/50 text-xs">Chargement…</span>}
          </div>

          {feed.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm font-medium text-lf-gray">
                Aucune notification pour l&apos;instant.
              </p>
            </div>
          ) : (
            <div className="divide-y-3 divide-black max-h-[28rem] overflow-y-auto">
              {feed.map((item) => {
                const Icon = item.source === "notification" && item.kind === "new_lead"
                  ? UserPlus
                  : MessageSquare;
                const iconClass = item.source === "notification" && item.kind === "new_lead"
                  ? "text-lf-blue"
                  : "text-lf-gray";
                return (
                  <button
                    key={item.id}
                    onClick={() => handleClickItem(item)}
                    className={`w-full text-left px-4 py-3 hover:bg-lf-yellow/30 transition-colors ${!item.isRead ? "bg-lf-yellow/10" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${iconClass}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {!item.isRead && (
                            <span className="inline-block w-2 h-2 bg-lf-blue flex-shrink-0 rounded-full" />
                          )}
                          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
                            {formatDate(item.createdAt)}
                          </p>
                        </div>
                        <p className="text-sm font-black leading-tight mb-0.5">
                          {item.title}
                        </p>
                        <p className="text-xs font-medium text-lf-gray line-clamp-2">
                          {item.body}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
