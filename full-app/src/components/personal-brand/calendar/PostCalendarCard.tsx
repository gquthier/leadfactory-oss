"use client";

import { Loader2, CheckCircle2, Clock, XCircle, Ban } from "lucide-react";
import { type ScheduledPostRow, statusColor, statusLabel } from "./calendar-utils";

const STATUS_ICON = {
  queued: Clock,
  publishing: Loader2,
  published: CheckCircle2,
  failed: XCircle,
  cancelled: Ban,
} as const;

export function PostCalendarCard({
  post,
  onClick,
}: {
  post: ScheduledPostRow;
  onClick: () => void;
}) {
  const color = statusColor(post.status);
  const Icon = STATUS_ICON[post.status];
  const d = new Date(post.scheduled_at);
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const hookLine = post.body_snapshot.split("\n")[0]?.slice(0, 60) ?? "";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${statusLabel(post.status)} · ${time}`}
      className={`w-full text-left border-2 ${color.border} ${color.bg} ${color.text} px-1.5 py-1 hover:shadow-[2px_2px_0_#000] transition-shadow cursor-pointer`}
    >
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`w-3 h-3 flex-shrink-0 ${post.status === "publishing" ? "animate-spin" : ""}`} />
        <span className="text-[10px] font-black uppercase tracking-wider">{time}</span>
      </div>
      <p className="text-[11px] font-medium line-clamp-2 leading-tight">{hookLine || "(vide)"}</p>
    </button>
  );
}
