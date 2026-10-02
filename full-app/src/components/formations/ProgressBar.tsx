"use client";

interface Props {
  completed: number;
  total: number;
  className?: string;
}

export function ProgressBar({ completed, total, className = "" }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold uppercase tracking-wide">
          {completed}/{total} modules
        </span>
        <span className="text-xs font-black">{pct}%</span>
      </div>
      <div className="w-full h-3 bg-gray-200 border-2 border-black">
        <div
          className={`h-full transition-all duration-300 ${pct === 100 ? "bg-lf-green" : "bg-lf-blue"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
