"use client";

import { Sparkles } from "lucide-react";

interface QuickSlot {
  key: string;
  label: string;
  iso: string;
  highlight?: boolean;
}

function isoOf(year: number, month: number, day: number, hour: number): string {
  const d = new Date(year, month, day, hour, 0, 0, 0);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function buildQuickSlots(now: Date): QuickSlot[] {
  const slots: QuickSlot[] = [];
  // Tomorrow 9h
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  slots.push({
    key: "tomorrow-9",
    label: "Demain 9h",
    iso: isoOf(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9),
  });
  // Tomorrow 12h
  slots.push({
    key: "tomorrow-12",
    label: "Demain 12h",
    iso: isoOf(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 12),
  });
  // Day after tomorrow 9h
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);
  slots.push({
    key: "after-9",
    label: "Après-demain 9h",
    iso: isoOf(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 9),
  });
  // Next Tuesday 8h30 — gold day
  const dow = now.getDay();
  const daysUntilTue = dow === 2 ? 7 : (2 - dow + 7) % 7 || 7;
  const nextTue = new Date(now);
  nextTue.setDate(nextTue.getDate() + daysUntilTue);
  slots.push({
    key: "next-tue-9",
    label: `Mardi prochain 9h`,
    iso: isoOf(nextTue.getFullYear(), nextTue.getMonth(), nextTue.getDate(), 9),
    highlight: true,
  });
  return slots;
}

export function QuickSlotsPicker({
  onPick,
}: {
  onPick: (iso: string) => void;
}) {
  const slots = buildQuickSlots(new Date());
  return (
    <div className="flex flex-wrap gap-2">
      {slots.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onPick(s.iso)}
          className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1.5 border-2 border-black flex items-center gap-1 ${
            s.highlight
              ? "bg-lf-yellow hover:shadow-[3px_3px_0_#000]"
              : "bg-white hover:bg-lf-yellow/40"
          }`}
        >
          {s.highlight && <Sparkles className="w-3 h-3" />}
          {s.label}
        </button>
      ))}
    </div>
  );
}
