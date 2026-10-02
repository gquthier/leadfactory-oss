"use client";

import { CalendarDays, List } from "lucide-react";

export type ScheduledView = "calendar" | "list";

export function ScheduledViewToggle({
  value,
  onChange,
}: {
  value: ScheduledView;
  onChange: (v: ScheduledView) => void;
}) {
  return (
    <div className="inline-flex border-3 border-black">
      <button
        onClick={() => onChange("calendar")}
        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wider border-r-2 border-black ${value === "calendar" ? "bg-lf-yellow" : "bg-white hover:bg-lf-yellow/40"}`}
      >
        <CalendarDays className="w-3.5 h-3.5" />
        Calendrier
      </button>
      <button
        onClick={() => onChange("list")}
        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase tracking-wider ${value === "list" ? "bg-lf-yellow" : "bg-white hover:bg-lf-yellow/40"}`}
      >
        <List className="w-3.5 h-3.5" />
        Liste
      </button>
    </div>
  );
}
