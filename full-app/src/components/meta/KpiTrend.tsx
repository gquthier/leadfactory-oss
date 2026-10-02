"use client";

interface Props {
  data: number[];
  color: string;
  label: string;
  value: string;
}

export function KpiTrend({ data, color, label, value }: Props) {
  if (!data || data.length < 2) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-black uppercase tracking-wider opacity-60">{label}</p>
        <p className="text-lg font-black leading-none">{value}</p>
        <div className="h-8 flex items-center">
          <span className="text-xs opacity-40">—</span>
        </div>
      </div>
    );
  }

  const W = 80;
  const H = 32;
  const pad = 2;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // Fill area under the line
  const firstPt = points[0].split(",");
  const lastPt = points[points.length - 1].split(",");
  const fillPoints = [
    `${firstPt[0]},${H - pad}`,
    ...points,
    `${lastPt[0]},${H - pad}`,
  ].join(" ");

  const lastVal = data[data.length - 1];
  const prevVal = data[data.length - 2];
  const trend = lastVal >= prevVal ? "up" : "down";

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-black uppercase tracking-wider opacity-60">{label}</p>
      <div className="flex items-end gap-2">
        <p className="text-lg font-black leading-none">{value}</p>
        <span className={`text-xs font-black ${trend === "up" ? "text-green-600" : "text-red-500"}`}>
          {trend === "up" ? "↑" : "↓"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="overflow-visible"
        aria-hidden="true"
      >
        {/* Fill */}
        <polygon
          points={fillPoints}
          fill={color}
          opacity="0.12"
        />
        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Last dot */}
        <circle
          cx={parseFloat(lastPt[0])}
          cy={parseFloat(lastPt[1])}
          r="2.5"
          fill={color}
          stroke="#000"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
