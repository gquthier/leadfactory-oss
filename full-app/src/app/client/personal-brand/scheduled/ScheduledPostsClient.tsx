"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  ExternalLink,
  Trash2,
  RefreshCw,
} from "lucide-react";

export interface ScheduledRow {
  id: string;
  source_type: "linkedin_post" | "surprise_asset" | "manual";
  body_snapshot: string;
  scheduled_at: string;
  status: "queued" | "publishing" | "published" | "failed" | "cancelled";
  retry_count: number;
  linkedin_post_urn: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}

const STATUS_INFO: Record<
  ScheduledRow["status"],
  { label: string; bg: string; text: string; icon: typeof Clock }
> = {
  queued: { label: "En attente", bg: "bg-lf-yellow/30", text: "text-black", icon: Clock },
  publishing: { label: "Publication…", bg: "bg-lf-blue/20", text: "text-lf-blue", icon: Loader2 },
  published: { label: "Publié", bg: "bg-lf-green/20", text: "text-lf-green", icon: CheckCircle2 },
  failed: { label: "Échec", bg: "bg-red-100", text: "text-red-700", icon: XCircle },
  cancelled: { label: "Annulé", bg: "bg-gray-100", text: "text-gray-500", icon: Ban },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function linkedInPostUrl(urn: string | null): string | null {
  if (!urn) return null;
  const m = urn.match(/urn:li:(share|ugcPost):(\d+)/);
  if (!m) return null;
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

export function ScheduledPostsClient({
  initialPosts,
}: {
  initialPosts: ScheduledRow[];
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function reload() {
    setBusy("reload");
    try {
      const res = await fetch("/api/client/linkedin/scheduled-posts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { posts?: ScheduledRow[] };
        if (data.posts) setPosts(data.posts);
      }
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    if (!confirm("Annuler ce post programmé ?")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/client/linkedin/scheduled-posts/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setPosts((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: "cancelled" as const } : p))
        );
      }
    } finally {
      setBusy(null);
    }
  }

  if (posts.length === 0) {
    return (
      <div className="card-brutal p-10 text-center">
        <Clock className="w-10 h-10 mx-auto mb-4 text-lf-gray" />
        <h3 className="text-xl font-black uppercase tracking-tight mb-2">
          Aucun post programmé
        </h3>
        <p className="text-sm font-medium text-lf-gray max-w-md mx-auto">
          Quand vous programmez un post depuis Personal Brand IA ou Surprises, il
          apparaîtra ici.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
          {posts.length} post{posts.length > 1 ? "s" : ""}
        </p>
        <button
          onClick={() => {
            void reload();
            router.refresh();
          }}
          disabled={busy === "reload"}
          className="text-xs flex items-center gap-1 px-2 py-1 border-2 border-black bg-white hover:bg-lf-yellow disabled:opacity-50"
        >
          {busy === "reload" ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Rafraîchir
        </button>
      </div>
      <ul className="grid grid-cols-1 gap-3">
        {posts.map((p) => {
          const s = STATUS_INFO[p.status];
          const StatusIcon = s.icon;
          const liUrl = linkedInPostUrl(p.linkedin_post_urn);
          const isExpanded = expanded === p.id;
          return (
            <li
              key={p.id}
              className="border-3 border-black bg-white shadow-brutal p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span
                      className={`text-[10px] font-black px-2 py-1 border-2 border-black uppercase ${s.bg} ${s.text} inline-flex items-center gap-1`}
                    >
                      <StatusIcon
                        className={`w-3 h-3 ${p.status === "publishing" ? "animate-spin" : ""}`}
                      />
                      {s.label}
                    </span>
                    <span className="text-xs font-bold">
                      {p.status === "published" && p.published_at
                        ? `Publié le ${formatDate(p.published_at)}`
                        : `Programmé pour le ${formatDate(p.scheduled_at)}`}
                    </span>
                    {p.retry_count > 0 && p.status !== "published" && (
                      <span className="text-[10px] text-lf-gray">
                        ({p.retry_count} retry)
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-sm font-medium ${
                      isExpanded ? "" : "line-clamp-2"
                    } cursor-pointer`}
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                  >
                    {p.body_snapshot}
                  </p>
                  {p.error_message && (
                    <p className="text-xs text-red-600 mt-2 break-words">
                      {p.error_message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  {liUrl && (
                    <a
                      href={liUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs flex items-center gap-1 px-2 py-1 border-2 border-black bg-white hover:bg-lf-yellow"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Voir sur LinkedIn
                    </a>
                  )}
                  {(p.status === "queued" || p.status === "failed") && (
                    <button
                      onClick={() => cancel(p.id)}
                      disabled={busy === p.id}
                      className="text-xs flex items-center gap-1 px-2 py-1 border-2 border-black bg-white hover:bg-red-50 hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      {busy === p.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
