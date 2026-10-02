export interface ScheduledPostRow {
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

export const SWEET_HOURS = [8, 9, 12, 17];
export const GOLD_DAYS = [2, 3, 4]; // mardi, mercredi, jeudi (0 = dim)
export const MILD_DAYS = [1, 5]; // lundi, vendredi
export const CALENDAR_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addWeeks(date: Date, n: number): Date {
  return addDays(date, n * 7);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isInHour(post: ScheduledPostRow, day: Date, hour: number): boolean {
  const d = new Date(post.scheduled_at);
  return sameDay(d, day) && d.getHours() === hour;
}

export function formatDayShort(d: Date): string {
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${weekStart.getDate()} – ${end.getDate()} ${end.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
  }
  return `${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
}

export function isSweetSpot(day: Date, hour: number): boolean {
  return GOLD_DAYS.includes(day.getDay()) && SWEET_HOURS.includes(hour);
}

export function isMildSpot(day: Date, hour: number): boolean {
  return MILD_DAYS.includes(day.getDay()) && SWEET_HOURS.includes(hour);
}

export function buildSlotIso(day: Date, hour: number): string {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  // datetime-local format YYYY-MM-DDTHH:mm (local timezone)
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function statusColor(status: ScheduledPostRow["status"]): {
  bg: string;
  border: string;
  text: string;
} {
  switch (status) {
    case "queued":
      return { bg: "bg-lf-yellow", border: "border-black", text: "text-black" };
    case "publishing":
      return { bg: "bg-lf-blue/20", border: "border-lf-blue", text: "text-lf-blue" };
    case "published":
      return { bg: "bg-lf-green/20", border: "border-lf-green", text: "text-lf-green" };
    case "failed":
      return { bg: "bg-red-100", border: "border-red-400", text: "text-red-700" };
    case "cancelled":
      return { bg: "bg-gray-100", border: "border-gray-300", text: "text-gray-500" };
  }
}

export function statusLabel(status: ScheduledPostRow["status"]): string {
  switch (status) {
    case "queued":
      return "En attente";
    case "publishing":
      return "Publication…";
    case "published":
      return "Publié";
    case "failed":
      return "Échec";
    case "cancelled":
      return "Annulé";
  }
}

export function linkedInPostUrl(urn: string | null): string | null {
  if (!urn) return null;
  const m = urn.match(/urn:li:(share|ugcPost):(\d+)/);
  if (!m) return null;
  return `https://www.linkedin.com/feed/update/${urn}/`;
}
