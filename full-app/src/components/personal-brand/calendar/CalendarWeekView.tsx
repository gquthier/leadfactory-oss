"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import {
  type ScheduledPostRow,
  CALENDAR_HOURS,
  addDays,
  addWeeks,
  startOfWeek,
  isInHour,
  formatDayShort,
  formatWeekRange,
  isSweetSpot,
  isMildSpot,
  sameDay,
} from "./calendar-utils";
import { PostCalendarCard } from "./PostCalendarCard";
import { BestTimeHintSlot } from "./BestTimeHintSlot";

interface Props {
  posts: ScheduledPostRow[];
  onSlotClick: (day: Date, hour: number) => void;
  onPostClick: (post: ScheduledPostRow) => void;
}

export function CalendarWeekView({ posts, onSlotClick, onPostClick }: Props) {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const today = useMemo(() => new Date(), []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  return (
    <div className="border-3 border-black bg-white shadow-brutal">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b-3 border-black bg-canvas">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((w) => addWeeks(w, -1))}
            className="w-8 h-8 border-2 border-black bg-white hover:bg-lf-yellow flex items-center justify-center"
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-1.5 border-2 border-black bg-white hover:bg-lf-yellow text-xs font-black uppercase tracking-wider flex items-center gap-1.5"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Aujourd&apos;hui
          </button>
          <button
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
            className="w-8 h-8 border-2 border-black bg-white hover:bg-lf-yellow flex items-center justify-center"
            aria-label="Semaine suivante"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="text-sm font-black uppercase tracking-tight">
          {formatWeekRange(weekStart)}
        </div>
      </div>

      {/* Grid : 8 cols (1 heure + 7 jours) */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[800px]" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
          {/* Day headers */}
          <div className="border-b-2 border-r-2 border-black bg-canvas" />
          {days.map((day) => {
            const isToday = sameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`border-b-2 border-r-2 border-black p-2 text-center ${isToday ? "bg-lf-yellow" : "bg-canvas"}`}
              >
                <div className="text-xs font-black uppercase tracking-wider">
                  {formatDayShort(day)}
                </div>
              </div>
            );
          })}

          {/* Rows */}
          {CALENDAR_HOURS.map((hour) => (
            <RowFragment
              key={hour}
              hour={hour}
              days={days}
              posts={posts}
              onSlotClick={onSlotClick}
              onPostClick={onPostClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RowFragment({
  hour,
  days,
  posts,
  onSlotClick,
  onPostClick,
}: {
  hour: number;
  days: Date[];
  posts: ScheduledPostRow[];
  onSlotClick: (day: Date, hour: number) => void;
  onPostClick: (post: ScheduledPostRow) => void;
}) {
  return (
    <>
      <div className="border-b border-r-2 border-black bg-canvas px-2 py-3 text-[10px] font-black uppercase tracking-wider text-lf-gray flex items-start justify-end">
        {String(hour).padStart(2, "0")}h
      </div>
      {days.map((day) => {
        const cellPosts = posts.filter((p) => isInHour(p, day, hour));
        const sweet = isSweetSpot(day, hour);
        const mild = isMildSpot(day, hour);
        return (
          <div
            key={`${day.toISOString()}-${hour}`}
            className="border-b border-r border-black/30 min-h-[60px] relative p-1"
          >
            {cellPosts.length > 0 ? (
              <div className="flex flex-col gap-1">
                {cellPosts.map((p) => (
                  <PostCalendarCard key={p.id} post={p} onClick={() => onPostClick(p)} />
                ))}
              </div>
            ) : (
              <BestTimeHintSlot
                isSweet={sweet}
                isMild={mild}
                onClick={() => onSlotClick(day, hour)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
