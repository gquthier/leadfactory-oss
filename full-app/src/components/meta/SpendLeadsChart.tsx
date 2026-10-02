"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { DatePreset } from "@/lib/meta-api";

interface DailyData {
  date: string;
  spend: number;
  leads: number;
  impressions: number;
}

interface Tooltip {
  x: number;
  y: number;
  date: string;
  spend: number;
  leads: number;
  visible: boolean;
}

interface Props {
  adAccountId: string;
  period: DatePreset;
  conversionLabel?: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function fmt(n: number, dec = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Skeleton bar chart placeholder
function SkeletonChart() {
  const bars = [40, 60, 35, 80, 55, 70, 45, 90, 65, 50, 75, 40, 85, 60, 70];
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 bg-gray-200 mb-4" />
      <div className="flex items-end gap-1 h-40">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 flex items-end gap-0.5">
            <div className="flex-1 bg-blue-100" style={{ height: `${h}%` }} />
            <div className="flex-1 bg-green-100" style={{ height: `${h * 0.4}%` }} />
          </div>
        ))}
      </div>
      <div className="h-3 bg-gray-100 mt-2" />
    </div>
  );
}

export function SpendLeadsChart({ adAccountId, period, conversionLabel = "Leads" }: Props) {
  const [daily, setDaily] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip>({
    x: 0, y: 0, date: "", spend: 0, leads: 0, visible: false,
  });
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/meta/campaign-stats?ad_account_id=${encodeURIComponent(adAccountId)}&period=${period}&daily=1`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur de chargement");
      const rows: DailyData[] = (data.daily ?? []).map((row: {
        date: string;
        spend: number;
        leads: number;
        impressions: number;
      }) => ({
        date: row.date,
        spend: Number(row.spend ?? 0),
        leads: Number(row.leads ?? 0),
        impressions: Number(row.impressions ?? 0),
      }));
      setDaily(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, [adAccountId, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="border-3 border-black bg-white p-5">
        <SkeletonChart />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-3 border-black bg-white p-5">
        <p className="text-xs font-black uppercase text-red-600">Erreur : {error}</p>
      </div>
    );
  }

  if (daily.length === 0) {
    return (
      <div className="border-3 border-black bg-white p-5 text-center">
        <p className="font-black text-sm uppercase text-lf-gray">Pas de données quotidiennes disponibles</p>
        <p className="text-xs font-medium text-lf-gray mt-1">Aucune donnée pour cette période.</p>
      </div>
    );
  }

  // ─── SVG layout ───────────────────────────────────────────────
  const SVG_W = 600;
  const SVG_H = 200;
  const PAD_LEFT = 52;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 36;
  const CHART_W = SVG_W - PAD_LEFT - PAD_RIGHT;
  const CHART_H = SVG_H - PAD_TOP - PAD_BOTTOM;

  const n = daily.length;
  const maxSpend = Math.max(...daily.map((d) => d.spend), 0.01);
  const maxLeads = Math.max(...daily.map((d) => d.leads), 1);

  // Bar width with gap
  const barGroupW = CHART_W / n;
  const barW = Math.max(2, barGroupW * 0.36);
  const gap = 1;

  // Y axis ticks (spend axis, left)
  const spendTicks = 4;
  const spendStep = maxSpend / spendTicks;
  const yTicks = Array.from({ length: spendTicks + 1 }, (_, i) => i * spendStep);

  // Decide how many date labels to show (avoid overlap)
  const maxLabels = Math.floor(CHART_W / 36);
  const labelStep = Math.ceil(n / maxLabels);

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>, d: DailyData, idx: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgScaleX = SVG_W / rect.width;
    const svgScaleY = SVG_H / rect.height;
    const rawX = (e.clientX - rect.left) * svgScaleX;
    const rawY = (e.clientY - rect.top) * svgScaleY;
    // Position tooltip above the bar group
    const groupX = PAD_LEFT + idx * barGroupW + barGroupW / 2;
    const tipX = Math.min(Math.max(groupX, 80), SVG_W - 80);
    setTooltip({
      x: tipX,
      y: Math.max(PAD_TOP + 4, rawY - 50),
      date: d.date,
      spend: d.spend,
      leads: d.leads,
      visible: true,
    });
    void rawX;
  };

  const handleMouseLeave = () => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  return (
    <div className="border-3 border-black bg-white overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b-3 border-black flex items-center justify-between">
        <p className="font-black text-xs uppercase tracking-wider">Evolution jour par jour</p>
        {/* Legend */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border border-black" style={{ background: "#3B82F6" }} />
            <span className="text-xs font-bold uppercase">Dépenses</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border border-black" style={{ background: "#58BC82" }} />
            <span className="text-xs font-bold uppercase">{conversionLabel}</span>
          </div>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="p-4">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width="100%"
          style={{ display: "block", overflow: "visible" }}
          aria-label="Graphique dépenses et leads par jour"
        >
          {/* Grid lines + Y axis labels (spend) */}
          {yTicks.map((tick, i) => {
            const y = PAD_TOP + CHART_H - (tick / maxSpend) * CHART_H;
            return (
              <g key={i}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={SVG_W - PAD_RIGHT}
                  y2={y}
                  stroke="#000"
                  strokeWidth={i === 0 ? 2 : 0.5}
                  strokeDasharray={i === 0 ? "" : "4,4"}
                  opacity={i === 0 ? 1 : 0.18}
                />
                {i > 0 && (
                  <text
                    x={PAD_LEFT - 4}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="9"
                    fontFamily="Space Grotesk, sans-serif"
                    fontWeight="700"
                    fill="#666"
                  >
                    {tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick.toFixed(0)}€
                  </text>
                )}
              </g>
            );
          })}

          {/* Right axis label (leads) */}
          <text
            x={SVG_W - PAD_RIGHT + 4}
            y={PAD_TOP + CHART_H / 2}
            textAnchor="start"
            fontSize="9"
            fontFamily="Space Grotesk, sans-serif"
            fontWeight="700"
            fill="#58BC82"
            transform={`rotate(90, ${SVG_W - PAD_RIGHT + 4}, ${PAD_TOP + CHART_H / 2})`}
          >
            leads
          </text>

          {/* Bars */}
          {daily.map((d, i) => {
            const groupX = PAD_LEFT + i * barGroupW;
            const centerX = groupX + barGroupW / 2;

            // Spend bar (blue, left of center)
            const spendH = (d.spend / maxSpend) * CHART_H;
            const spendX = centerX - barW - gap / 2;
            const spendY = PAD_TOP + CHART_H - spendH;

            // Leads bar (green, right of center) — normalized on secondary axis
            const leadsH = maxLeads > 0 ? (d.leads / maxLeads) * CHART_H : 0;
            const leadsX = centerX + gap / 2;
            const leadsY = PAD_TOP + CHART_H - leadsH;

            return (
              <g key={i}>
                {/* Spend bar */}
                {d.spend > 0 && (
                  <rect
                    x={spendX}
                    y={spendY}
                    width={barW}
                    height={spendH}
                    fill="#3B82F6"
                    stroke="#000"
                    strokeWidth="1"
                  />
                )}
                {/* Leads bar */}
                {d.leads > 0 && (
                  <rect
                    x={leadsX}
                    y={leadsY}
                    width={barW}
                    height={leadsH}
                    fill="#58BC82"
                    stroke="#000"
                    strokeWidth="1"
                  />
                )}
                {/* Invisible hover zone */}
                <rect
                  x={groupX}
                  y={PAD_TOP}
                  width={barGroupW}
                  height={CHART_H}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseMove={(e) => handleMouseMove(e, d, i)}
                  onMouseLeave={handleMouseLeave}
                />
                {/* Date label */}
                {i % labelStep === 0 && (
                  <text
                    x={centerX}
                    y={PAD_TOP + CHART_H + 14}
                    textAnchor="middle"
                    fontSize="8"
                    fontFamily="Space Grotesk, sans-serif"
                    fontWeight="700"
                    fill="#666"
                  >
                    {formatDate(d.date)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Tooltip */}
          {tooltip.visible && (
            <g>
              {/* Shadow rect */}
              <rect
                x={tooltip.x - 62}
                y={tooltip.y - 2}
                width={124}
                height={52}
                fill="#000"
                rx="0"
              />
              {/* White card */}
              <rect
                x={tooltip.x - 64}
                y={tooltip.y - 4}
                width={124}
                height={52}
                fill="#FFFDF5"
                stroke="#000"
                strokeWidth="2"
                rx="0"
              />
              <text
                x={tooltip.x}
                y={tooltip.y + 12}
                textAnchor="middle"
                fontSize="9"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="900"
                fill="#000"
                style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                {formatDate(tooltip.date)}
              </text>
              {/* Spend line */}
              <rect x={tooltip.x - 52} y={tooltip.y + 19} width={8} height={8} fill="#3B82F6" stroke="#000" strokeWidth="1" />
              <text
                x={tooltip.x - 40}
                y={tooltip.y + 27}
                fontSize="9"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="700"
                fill="#000"
              >
                {fmt(tooltip.spend, 2)} €
              </text>
              {/* Leads line */}
              <rect x={tooltip.x - 52} y={tooltip.y + 32} width={8} height={8} fill="#58BC82" stroke="#000" strokeWidth="1" />
              <text
                x={tooltip.x - 40}
                y={tooltip.y + 40}
                fontSize="9"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="700"
                fill="#000"
              >
                {fmt(tooltip.leads)} {conversionLabel.toLowerCase()}
              </text>
            </g>
          )}
        </svg>

        {/* Summary row */}
        <div className="flex gap-4 mt-2 pt-3 border-t-3 border-black">
          <div>
            <p className="text-xs font-black uppercase tracking-wider opacity-50">Total dépensé</p>
            <p className="font-black text-sm">{fmt(daily.reduce((s, d) => s + d.spend, 0), 2)} €</p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wider opacity-50">Total {conversionLabel.toLowerCase()}</p>
            <p className="font-black text-sm text-lf-green">{fmt(daily.reduce((s, d) => s + d.leads, 0))}</p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wider opacity-50">Jours actifs</p>
            <p className="font-black text-sm">{daily.filter((d) => d.spend > 0).length}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
