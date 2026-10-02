"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Loader2 } from "lucide-react";
import {
  type ScheduledPostRow,
  buildSlotIso,
} from "@/components/personal-brand/calendar/calendar-utils";
import { CalendarWeekView } from "@/components/personal-brand/calendar/CalendarWeekView";
import { PostDetailModal } from "@/components/personal-brand/PostDetailModal";
import {
  ScheduledViewToggle,
  type ScheduledView,
} from "@/components/personal-brand/scheduled/ScheduledViewToggle";
import { WeekStatsBar } from "@/components/personal-brand/scheduled/WeekStatsBar";
import { LinkedInConnectionBadge } from "@/components/personal-brand/scheduled/LinkedInConnectionBadge";
import { LinkedInDisconnectedBanner } from "@/components/personal-brand/scheduled/LinkedInDisconnectedBanner";
import { SchedulePostSheet } from "@/components/client/SchedulePostSheet";
import { EmptyStateScheduled } from "@/components/personal-brand/scheduled/EmptyStateScheduled";
import { ScheduledPostsClient, type ScheduledRow } from "./ScheduledPostsClient";

interface ConnectionInfo {
  linkedin_user_id: string;
  full_name: string | null;
  profile_picture: string | null;
  refresh_expires_at: string | null;
  expires_at: string | null;
}

interface Props {
  initialPosts: ScheduledPostRow[];
  connection: ConnectionInfo | null;
}

export function ScheduledHubClient({ initialPosts, connection }: Props) {
  const router = useRouter();
  const [view, setView] = useState<ScheduledView>("calendar");
  const [posts, setPosts] = useState<ScheduledPostRow[]>(initialPosts);
  const [openPost, setOpenPost] = useState<ScheduledPostRow | null>(null);
  const [sheetState, setSheetState] = useState<{
    open: boolean;
    defaultIso?: string;
  }>({ open: false });
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/client/linkedin/scheduled-posts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { posts?: ScheduledPostRow[] };
        if (data.posts) setPosts(data.posts);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh every 30s to catch publishing/published transitions
  useEffect(() => {
    const hasActive = posts.some(
      (p) => p.status === "queued" || p.status === "publishing"
    );
    if (!hasActive) return;
    const interval = setInterval(() => {
      void reload();
    }, 30_000);
    return () => clearInterval(interval);
  }, [posts, reload]);

  const queuedWithoutConnection =
    connection === null
      ? posts.filter((p) => p.status === "queued").length
      : 0;

  function handleSlotClick(day: Date, hour: number) {
    setSheetState({ open: true, defaultIso: buildSlotIso(day, hour) });
  }

  return (
    <div>
      {!connection && queuedWithoutConnection > 0 && (
        <LinkedInDisconnectedBanner queuedCount={queuedWithoutConnection} />
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <ScheduledViewToggle value={view} onChange={setView} />
          <LinkedInConnectionBadge
            connected={connection !== null}
            fullName={connection?.full_name}
            profilePicture={connection?.profile_picture}
            refreshExpiresAt={connection?.refresh_expires_at}
          />
          <WeekStatsBar posts={posts} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            disabled={refreshing}
            className="w-9 h-9 border-2 border-black bg-white hover:bg-lf-yellow flex items-center justify-center disabled:opacity-50"
            aria-label="Rafraîchir"
            title="Rafraîchir"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setSheetState({ open: true })}
            className="inline-flex items-center gap-2 px-4 py-2 border-3 border-black bg-lf-black text-white hover:bg-lf-blue hover:shadow-[4px_4px_0_#000] font-black text-xs uppercase tracking-wider transition-all"
          >
            <Plus className="w-4 h-4" />
            Nouveau post
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <EmptyStateScheduled
          isConnected={connection !== null}
          onCreateClick={() => setSheetState({ open: true })}
        />
      ) : view === "calendar" ? (
        <CalendarWeekView
          posts={posts}
          onSlotClick={handleSlotClick}
          onPostClick={(p) => setOpenPost(p)}
        />
      ) : (
        <ScheduledPostsClient initialPosts={posts as unknown as ScheduledRow[]} />
      )}

      {openPost && (
        <PostDetailModal
          post={openPost}
          onClose={() => setOpenPost(null)}
          onChange={() => {
            void reload();
            router.refresh();
          }}
        />
      )}

      <SchedulePostSheet
        open={sheetState.open}
        onClose={() => setSheetState({ open: false })}
        postBody=""
        sourceType="manual"
        onScheduled={() => {
          void reload();
          setSheetState({ open: false });
        }}
        defaultScheduledAt={sheetState.defaultIso}
        authorName={connection?.full_name}
        authorPicture={connection?.profile_picture}
      />
    </div>
  );
}
