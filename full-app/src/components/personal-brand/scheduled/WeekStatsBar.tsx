"use client";

import { Clock, CheckCircle2 } from "lucide-react";
import type { ScheduledPostRow } from "../calendar/calendar-utils";

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

export function WeekStatsBar({ posts }: { posts: ScheduledPostRow[] }) {
  const now = new Date();
  const weekStart = startOfWeek(now).getTime();
  const monthStart = startOfMonth(now).getTime();

  const weekScheduled = posts.filter(
    (p) =>
      (p.status === "queued" || p.status === "publishing") &&
      new Date(p.scheduled_at).getTime() >= weekStart
  ).length;

  const monthPublished = posts.filter(
    (p) => p.status === "published" && new Date(p.published_at ?? p.scheduled_at).getTime() >= monthStart
  ).length;

  return (
    <div className="flex items-center gap-2">
      <div className="border-3 border-black bg-lf-yellow/30 px-3 py-1.5 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        <span className="text-xs font-black uppercase">
          {weekScheduled} {weekScheduled === 1 ? "programmé" : "programmés"} cette semaine
        </span>
      </div>
      <div className="border-3 border-black bg-lf-green/20 px-3 py-1.5 flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span className="text-xs font-black uppercase">
          {monthPublished} {monthPublished === 1 ? "publié" : "publiés"} ce mois
        </span>
      </div>
    </div>
  );
}
