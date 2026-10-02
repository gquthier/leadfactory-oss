"use client";

import { useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Users,
  Euro,
  Target,
  Clock,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  PieChart,
} from "lucide-react";
import type { Lead, PipelineStage, LeadSource } from "@/types/index";
import { LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS } from "@/types/index";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  leads: Lead[];
  stages: PipelineStage[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_SOURCES: LeadSource[] = [
  "meta_ads",
  "google_ads",
  "manual",
  "website",
  "referral",
  "phone",
  "email",
  "linkedin",
  "salon",
  "other",
];

// Maps LEAD_SOURCE_COLORS bg tokens to hex for charts
const SOURCE_HEX: Record<LeadSource, string> = {
  meta_ads: "#3B82F6",
  google_ads: "#EF4444",
  manual: "#6B7280",
  website: "#8B5CF6",
  referral: "#22C55E",
  phone: "#EAB308",
  email: "#EC4899",
  linkedin: "#0EA5E9",
  salon: "#F97316",
  other: "#9CA3AF",
};

const QUALITY_COLORS = ["#EF4444", "#F97316", "#EAB308", "#84CC16", "#22C55E"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtEur(n: number): string {
  return `${fmt(n, 0)} €`;
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7
  );
  return `${d.getFullYear()}-S${String(week).padStart(2, "0")}`;
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function getWeekLabel(key: string): string {
  return key.replace(/^\d{4}-/, "");
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── SVG Helpers ────────────────────────────────────────────────────────────────

function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`;
  const d = [`M ${pts[0][0]},${pts[0][1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cpx = (x0 + x1) / 2;
    d.push(`C ${cpx},${y0} ${cpx},${y1} ${x1},${y1}`);
  }
  return d.join(" ");
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
  className = "",
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-3 border-black bg-white shadow-brutal ${className}`}>
      <div className="px-5 py-3 border-b-3 border-black flex items-center gap-2">
        {icon && <span className="text-black">{icon}</span>}
        <h3 className="font-black uppercase tracking-wide text-sm">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── 1. Hero KPI Row ────────────────────────────────────────────────────────────

function HeroKPIRow({ leads }: { leads: Lead[] }) {
  const total = leads.length;
  const converted = leads.filter((l) => l.status === "converted").length;
  const totalRevenue = leads.reduce((s, l) => s + (l.revenue ?? 0), 0);
  const totalCash = leads.reduce((s, l) => s + (l.cash_collected ?? 0), 0);
  const convRate = total > 0 ? (converted / total) * 100 : 0;

  const kpis = [
    {
      label: "Total Leads",
      value: fmt(total),
      icon: <Users className="w-6 h-6" />,
      bg: "bg-lf-blue",
      text: "text-white",
      sub: `${converted} converti${converted > 1 ? "s" : ""}`,
      trend: null,
    },
    {
      label: "Taux de Conversion",
      value: `${fmt(convRate, 1)}%`,
      icon: <Target className="w-6 h-6" />,
      bg: "bg-lf-green",
      text: "text-white",
      sub: `${converted} / ${total} leads`,
      trend: convRate >= 20 ? "up" : convRate >= 10 ? null : "down",
    },
    {
      label: "CA Total Généré",
      value: fmtEur(totalRevenue),
      icon: <Euro className="w-6 h-6" />,
      bg: "bg-lf-yellow",
      text: "text-black",
      sub: total > 0 ? `${fmtEur(Math.round(totalRevenue / total))} / lead` : "—",
      trend: totalRevenue > 0 ? "up" : null,
    },
    {
      label: "Cash Collecté",
      value: fmtEur(totalCash),
      icon: <TrendingUp className="w-6 h-6" />,
      bg: "bg-lf-pink",
      text: "text-black",
      sub:
        totalRevenue > 0
          ? `${fmt((totalCash / totalRevenue) * 100, 0)}% du CA`
          : "—",
      trend: totalCash > 0 ? "up" : null,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map(({ label, value, icon, bg, text, sub, trend }) => (
        <div
          key={label}
          className={`border-3 border-black shadow-brutal p-5 ${bg} ${text} flex flex-col gap-2`}
        >
          <div className="flex items-start justify-between">
            <div className="opacity-80">{icon}</div>
            {trend === "up" && (
              <TrendingUp className="w-4 h-4 opacity-70" />
            )}
            {trend === "down" && (
              <TrendingDown className="w-4 h-4 opacity-70" />
            )}
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
            {label}
          </p>
          <p className="text-3xl font-black leading-none">{value}</p>
          <p className="text-xs font-bold opacity-60">{sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── 2. Pipeline Funnel ─────────────────────────────────────────────────────────

function PipelineFunnel({
  leads,
  stages,
}: {
  leads: Lead[];
  stages: PipelineStage[];
}) {
  const total = leads.length;
  const sortedStages = [...stages].sort((a, b) => a.display_order - b.display_order);

  const stageData = sortedStages.map((stage) => {
    const stageLeads = leads.filter((l) => l.pipeline_stage_id === stage.id);
    return {
      ...stage,
      count: stageLeads.length,
      revenue: stageLeads.reduce((s, l) => s + (l.revenue ?? 0), 0),
      pct: total > 0 ? (stageLeads.length / total) * 100 : 0,
    };
  });

  const wonStage = stages.find((s) => s.is_won);
  const wonCount = wonStage
    ? leads.filter((l) => l.pipeline_stage_id === wonStage.id).length
    : leads.filter((l) => l.status === "converted").length;
  const winRate = total > 0 ? ((wonCount / total) * 100).toFixed(1) : "0";
  const maxCount = Math.max(...stageData.map((s) => s.count), 1);

  return (
    <SectionCard
      title="Funnel Pipeline"
      icon={<BarChart3 className="w-4 h-4" />}
    >
      <div className="space-y-3">
        {stageData.map((stage, idx) => {
          const barPct = (stage.count / maxCount) * 100;
          const nextStage = stageData[idx + 1];
          const convToNext =
            nextStage && stage.count > 0
              ? ((nextStage.count / stage.count) * 100).toFixed(0)
              : null;

          return (
            <div key={stage.id}>
              <div className="flex items-center gap-3">
                <div className="w-32 flex-none">
                  <span className="text-xs font-black truncate block">{stage.name}</span>
                </div>
                <div className="flex-1 bg-gray-100 border-2 border-black h-8 relative overflow-hidden">
                  <div
                    className="h-full flex items-center px-2 transition-all duration-500"
                    style={{
                      width: `${barPct}%`,
                      backgroundColor: stage.color,
                      minWidth: stage.count > 0 ? "2rem" : "0",
                    }}
                  >
                    {stage.count > 0 && (
                      <span className="text-[10px] font-black text-white whitespace-nowrap drop-shadow">
                        {stage.count}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-20 text-right flex-none">
                  <span className="font-black text-sm">{stage.count}</span>
                  <span className="text-xs text-gray-500 ml-1">
                    ({stage.pct.toFixed(0)}%)
                  </span>
                </div>
                {stage.revenue > 0 && (
                  <div className="w-24 text-right flex-none hidden md:block">
                    <span className="text-xs font-bold text-green-600">
                      {fmtEur(stage.revenue)}
                    </span>
                  </div>
                )}
              </div>
              {convToNext !== null && (
                <div className="flex items-center gap-3 py-1">
                  <div className="w-32 flex-none" />
                  <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
                    <div className="h-4 border-l-2 border-dashed border-gray-300 ml-4" />
                    <span className="bg-lf-yellow text-black px-2 py-0.5 border border-black text-[10px] font-black">
                      {convToNext}% avancent
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t-3 border-black flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-lf-green" />
        <div>
          <span className="font-black text-xl text-lf-green">{winRate}%</span>
          <span className="text-xs font-bold text-gray-500 ml-2">
            taux de gain global ({wonCount} / {total} leads)
          </span>
        </div>
      </div>
    </SectionCard>
  );
}

// ── 3a. Source Donut Chart (pure SVG) ─────────────────────────────────────────

function SourceDonutChart({
  data,
}: {
  data: Array<{ source: LeadSource; count: number; pct: number }>;
}) {
  const [hovered, setHovered] = useState<LeadSource | null>(null);
  const CX = 120;
  const CY = 120;
  const R_OUTER = 90;
  const R_INNER = 52;

  let cumAngle = -90;
  const slices = data.map((d) => {
    const startAngle = cumAngle;
    const sweepAngle = (d.pct / 100) * 360;
    cumAngle += sweepAngle;
    return { ...d, startAngle, sweepAngle };
  });

  function polarToCart(cx: number, cy: number, r: number, deg: number) {
    const rad = (deg * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function arcPath(
    cx: number,
    cy: number,
    r: number,
    startDeg: number,
    endDeg: number
  ): string {
    const s = polarToCart(cx, cy, r, startDeg);
    const e = polarToCart(cx, cy, r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  function slicePath(
    cx: number,
    cy: number,
    ro: number,
    ri: number,
    startDeg: number,
    sweepDeg: number
  ): string {
    const endDeg = startDeg + sweepDeg;
    const s_outer = polarToCart(cx, cy, ro, startDeg);
    const e_outer = polarToCart(cx, cy, ro, endDeg);
    const s_inner = polarToCart(cx, cy, ri, startDeg);
    const e_inner = polarToCart(cx, cy, ri, endDeg);
    const large = sweepDeg > 180 ? 1 : 0;
    return [
      `M ${s_outer.x} ${s_outer.y}`,
      `A ${ro} ${ro} 0 ${large} 1 ${e_outer.x} ${e_outer.y}`,
      `L ${e_inner.x} ${e_inner.y}`,
      `A ${ri} ${ri} 0 ${large} 0 ${s_inner.x} ${s_inner.y}`,
      "Z",
    ].join(" ");
  }

  const activeSlice = hovered ? slices.find((s) => s.source === hovered) : null;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 240 240"
        width="100%"
        style={{ maxWidth: 240, display: "block" }}
      >
        {slices.map((slice) => {
          if (slice.sweepAngle < 0.5) return null;
          const isHovered = hovered === slice.source;
          const ro = isHovered ? R_OUTER + 6 : R_OUTER;
          const ri = isHovered ? R_INNER - 4 : R_INNER;
          return (
            <path
              key={slice.source}
              d={slicePath(CX, CY, ro, ri, slice.startAngle, slice.sweepAngle)}
              fill={SOURCE_HEX[slice.source]}
              stroke="#000"
              strokeWidth={isHovered ? 2.5 : 1.5}
              style={{ cursor: "pointer", transition: "all 0.15s ease" }}
              onMouseEnter={() => setHovered(slice.source)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
        {/* Center label */}
        {activeSlice ? (
          <>
            <text
              x={CX}
              y={CY - 8}
              textAnchor="middle"
              fontSize="18"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="900"
              fill="#000"
            >
              {activeSlice.count}
            </text>
            <text
              x={CX}
              y={CY + 10}
              textAnchor="middle"
              fontSize="8"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              fill="#555"
            >
              {LEAD_SOURCE_LABELS[activeSlice.source]}
            </text>
            <text
              x={CX}
              y={CY + 23}
              textAnchor="middle"
              fontSize="9"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="900"
              fill={SOURCE_HEX[activeSlice.source]}
            >
              {activeSlice.pct.toFixed(1)}%
            </text>
          </>
        ) : (
          <>
            <text
              x={CX}
              y={CY - 6}
              textAnchor="middle"
              fontSize="11"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="900"
              fill="#000"
            >
              SOURCES
            </text>
            <text
              x={CX}
              y={CY + 10}
              textAnchor="middle"
              fontSize="9"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              fill="#888"
            >
              {data.reduce((s, d) => s + d.count, 0)} leads
            </text>
          </>
        )}
        {/* Outer border ring */}
        <circle
          cx={CX}
          cy={CY}
          r={R_OUTER + 1}
          fill="none"
          stroke="#000"
          strokeWidth="1.5"
          opacity="0.08"
        />
      </svg>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 w-full">
        {data.map((d) => (
          <div
            key={d.source}
            className="flex items-center gap-1.5 cursor-pointer"
            onMouseEnter={() => setHovered(d.source)}
            onMouseLeave={() => setHovered(null)}
          >
            <div
              className="w-2.5 h-2.5 border border-black flex-shrink-0"
              style={{ backgroundColor: SOURCE_HEX[d.source] }}
            />
            <span
              className={`text-[10px] font-bold truncate ${
                hovered === d.source ? "underline" : ""
              }`}
            >
              {LEAD_SOURCE_LABELS[d.source]}
            </span>
            <span className="text-[10px] font-black ml-auto text-gray-600">
              {d.pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 3b. Source Performance Table ───────────────────────────────────────────────

interface SourceStats {
  source: LeadSource;
  count: number;
  converted: number;
  convRate: number;
  revenue: number;
  avgRevenue: number;
  avgQuality: number | null;
  pct: number;
}

function SourceTable({ data }: { data: SourceStats[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-3 border-black bg-lf-black text-white">
            {[
              "Source",
              "Leads",
              "Convertis",
              "Conv. %",
              "CA Généré",
              "CA Moy/Lead",
              "Qualité Moy.",
            ].map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left font-black uppercase tracking-wide text-[10px] whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const colorCls =
              LEAD_SOURCE_COLORS[row.source] ?? LEAD_SOURCE_COLORS.other;
            return (
              <tr
                key={row.source}
                className={`border-b border-black/10 ${
                  i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                }`}
              >
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 font-bold text-[10px] border border-black/20 ${colorCls}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: SOURCE_HEX[row.source] }}
                    />
                    {LEAD_SOURCE_LABELS[row.source]}
                  </span>
                </td>
                <td className="px-3 py-2 font-black">{row.count}</td>
                <td className="px-3 py-2 font-bold text-lf-green">
                  {row.converted}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`font-black ${
                      row.convRate >= 20
                        ? "text-lf-green"
                        : row.convRate >= 10
                        ? "text-lf-yellow"
                        : "text-red-500"
                    }`}
                  >
                    {fmt(row.convRate, 1)}%
                  </span>
                </td>
                <td className="px-3 py-2 font-bold">
                  {row.revenue > 0 ? fmtEur(row.revenue) : "—"}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {row.avgRevenue > 0 ? fmtEur(row.avgRevenue) : "—"}
                </td>
                <td className="px-3 py-2">
                  {row.avgQuality !== null ? (
                    <div className="flex items-center gap-1">
                      <div className="flex gap-px">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <div
                            key={n}
                            className="w-2.5 h-2.5 border border-black/30"
                            style={{
                              backgroundColor:
                                n <= Math.round(row.avgQuality!)
                                  ? QUALITY_COLORS[Math.round(row.avgQuality!) - 1]
                                  : "#e5e7eb",
                            }}
                          />
                        ))}
                      </div>
                      <span className="font-black text-[10px]">
                        {fmt(row.avgQuality, 1)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 3c. Source Quality Horizontal Bar Chart ────────────────────────────────────

function SourceQualityChart({
  data,
}: {
  data: Array<{ source: LeadSource; avgQuality: number }>;
}) {
  const maxQ = 5;
  const BAR_H = 22;
  const GAP = 8;
  const W = 500;
  const LABEL_W = 100;
  const CHART_W = W - LABEL_W - 60;
  const totalH = data.length * (BAR_H + GAP) + 20;

  return (
    <svg
      viewBox={`0 0 ${W} ${totalH}`}
      width="100%"
      style={{ display: "block" }}
    >
      {/* Grid lines */}
      {[1, 2, 3, 4, 5].map((v) => {
        const x = LABEL_W + (v / maxQ) * CHART_W;
        return (
          <g key={v}>
            <line
              x1={x}
              y1={0}
              x2={x}
              y2={totalH - 20}
              stroke="#000"
              strokeWidth={v === 5 ? 1.5 : 0.5}
              strokeDasharray={v === 5 ? "" : "3,3"}
              opacity={v === 5 ? 0.3 : 0.12}
            />
            <text
              x={x}
              y={totalH - 6}
              textAnchor="middle"
              fontSize="8"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              fill="#999"
            >
              {v}
            </text>
          </g>
        );
      })}

      {data.map((d, i) => {
        const y = i * (BAR_H + GAP);
        const barW = (d.avgQuality / maxQ) * CHART_W;
        const qualityColor =
          QUALITY_COLORS[Math.round(d.avgQuality) - 1] ?? "#9CA3AF";
        return (
          <g key={d.source}>
            <text
              x={LABEL_W - 6}
              y={y + BAR_H / 2 + 4}
              textAnchor="end"
              fontSize="9"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              fill="#333"
            >
              {LEAD_SOURCE_LABELS[d.source]}
            </text>
            {/* BG track */}
            <rect
              x={LABEL_W}
              y={y}
              width={CHART_W}
              height={BAR_H}
              fill="#f3f4f6"
              stroke="#000"
              strokeWidth="1"
            />
            {/* Value bar */}
            <rect
              x={LABEL_W}
              y={y}
              width={barW}
              height={BAR_H}
              fill={qualityColor}
              stroke="#000"
              strokeWidth="1"
            />
            {/* Value label */}
            <text
              x={LABEL_W + CHART_W + 8}
              y={y + BAR_H / 2 + 4}
              fontSize="10"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="900"
              fill="#000"
            >
              {fmt(d.avgQuality, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 4a. Stage Distribution Bar Chart ──────────────────────────────────────────

function StageBarChart({
  data,
}: {
  data: Array<{
    id: string;
    name: string;
    color: string;
    count: number;
    revenue: number;
  }>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 560;
  const BAR_H = 28;
  const GAP = 10;
  const LABEL_W = 110;
  const VALUE_W = 80;
  const CHART_W = W - LABEL_W - VALUE_W - 16;
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const totalH = data.length * (BAR_H + GAP) + 12;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${totalH}`}
      width="100%"
      style={{ display: "block", overflow: "visible" }}
    >
      {data.map((stage, i) => {
        const y = i * (BAR_H + GAP);
        const barW = (stage.count / maxCount) * CHART_W;
        const isHov = hovered === stage.id;
        return (
          <g
            key={stage.id}
            onMouseEnter={() => setHovered(stage.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: "default" }}
          >
            <text
              x={LABEL_W - 8}
              y={y + BAR_H / 2 + 4}
              textAnchor="end"
              fontSize="9"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              fill={isHov ? "#000" : "#444"}
            >
              {stage.name}
            </text>
            {/* BG */}
            <rect
              x={LABEL_W}
              y={y}
              width={CHART_W}
              height={BAR_H}
              fill="#f3f4f6"
              stroke="#000"
              strokeWidth="1.5"
            />
            {/* Bar */}
            {stage.count > 0 && (
              <rect
                x={LABEL_W}
                y={y}
                width={barW}
                height={BAR_H}
                fill={stage.color}
                stroke="#000"
                strokeWidth="1.5"
              />
            )}
            {/* Count inside bar */}
            {stage.count > 0 && barW > 24 && (
              <text
                x={LABEL_W + 8}
                y={y + BAR_H / 2 + 4}
                fontSize="10"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="900"
                fill="#fff"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
              >
                {stage.count}
              </text>
            )}
            {/* Revenue label */}
            <text
              x={LABEL_W + CHART_W + 8}
              y={y + BAR_H / 2 + 4}
              fontSize="9"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              fill="#22c55e"
            >
              {stage.revenue > 0 ? fmtEur(stage.revenue) : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 4b. Pipeline Value Cards ───────────────────────────────────────────────────

function PipelineValueCards({
  data,
}: {
  data: Array<{
    id: string;
    name: string;
    color: string;
    count: number;
    revenue: number;
    is_won: boolean;
    is_lost: boolean;
  }>;
}) {
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  return (
    <div className="space-y-2">
      {data
        .filter((d) => d.count > 0)
        .map((stage) => {
          const pct =
            totalRevenue > 0 ? (stage.revenue / totalRevenue) * 100 : 0;
          return (
            <div
              key={stage.id}
              className="flex items-center gap-3 p-3 border-2 border-black"
              style={{ borderLeftColor: stage.color, borderLeftWidth: 6 }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-black text-xs uppercase">{stage.name}</span>
                  {stage.is_won && (
                    <span className="text-[9px] bg-lf-green text-white font-black px-1 py-0.5 border border-black">
                      GAGNÉ
                    </span>
                  )}
                  {stage.is_lost && (
                    <span className="text-[9px] bg-gray-400 text-white font-black px-1 py-0.5 border border-black">
                      PERDU
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 font-medium">
                  {stage.count} lead{stage.count > 1 ? "s" : ""}
                </p>
              </div>
              <div className="text-right flex-none">
                <p className="font-black text-sm">
                  {stage.revenue > 0 ? fmtEur(stage.revenue) : "—"}
                </p>
                {totalRevenue > 0 && stage.revenue > 0 && (
                  <p className="text-[10px] text-gray-400 font-bold">
                    {fmt(pct, 1)}% du total
                  </p>
                )}
              </div>
            </div>
          );
        })}
      {data.every((d) => d.count === 0) && (
        <p className="text-xs text-gray-400 font-bold py-4 text-center uppercase">
          Aucun lead dans le pipeline
        </p>
      )}
    </div>
  );
}

// ── 5a. Leads Over Time (Area Chart SVG) ──────────────────────────────────────

function LeadsOverTimeChart({
  data,
}: {
  data: Array<{ key: string; label: string; count: number; cumulative: number }>;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 560;
  const H = 180;
  const PL = 40;
  const PR = 16;
  const PT = 16;
  const PB = 32;
  const CW = W - PL - PR;
  const CH = H - PT - PB;

  const n = data.length;
  const maxCum = Math.max(...data.map((d) => d.cumulative), 1);

  const pts: [number, number][] = data.map((d, i) => [
    PL + (i / Math.max(n - 1, 1)) * CW,
    PT + CH - (d.cumulative / maxCum) * CH,
  ]);

  const maxLabels = Math.floor(CW / 48);
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((svgX - PL) / CW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(idx, n - 1)));
  };

  if (n === 0)
    return (
      <p className="text-xs text-gray-400 font-bold text-center py-6 uppercase">
        Pas assez de données temporelles
      </p>
    );

  const hoverX = hoverIdx !== null ? pts[hoverIdx][0] : null;
  const hoverPt = hoverIdx !== null ? pts[hoverIdx] : null;
  const hoverData = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: "block", overflow: "visible" }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y = PT + pct * CH;
        const val = Math.round(maxCum * (1 - pct));
        return (
          <g key={i}>
            <line
              x1={PL}
              y1={y}
              x2={W - PR}
              y2={y}
              stroke="#000"
              strokeWidth={i === 4 ? 2 : 0.5}
              strokeDasharray={i === 4 ? "" : "4,4"}
              opacity={i === 4 ? 0.5 : 0.12}
            />
            {i < 4 && (
              <text
                x={PL - 4}
                y={y + 4}
                textAnchor="end"
                fontSize="8"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="700"
                fill="#aaa"
              >
                {val}
              </text>
            )}
          </g>
        );
      })}

      {/* Area fill */}
      {pts.length > 1 && (
        <path
          d={`${smoothPath(pts)} L ${pts[pts.length - 1][0]},${PT + CH} L ${pts[0][0]},${PT + CH} Z`}
          fill="#3B82F6"
          opacity="0.12"
        />
      )}
      {/* Line */}
      {pts.length > 1 && (
        <path
          d={smoothPath(pts)}
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Bar columns (weekly/monthly counts) */}
      {data.map((d, i) => {
        const x = PL + (i / Math.max(n - 1, 1)) * CW;
        const barH = n > 1 ? Math.max(2, (d.count / maxCum) * CH * 0.25) : 0;
        return (
          <rect
            key={d.key}
            x={x - 3}
            y={PT + CH - barH}
            width={6}
            height={barH}
            fill="#3B82F6"
            opacity="0.35"
          />
        );
      })}

      {/* X labels */}
      {data.map((d, i) => {
        if (i % labelStep !== 0) return null;
        return (
          <text
            key={d.key}
            x={PL + (i / Math.max(n - 1, 1)) * CW}
            y={PT + CH + 16}
            textAnchor="middle"
            fontSize="8"
            fontFamily="Space Grotesk, sans-serif"
            fontWeight="700"
            fill="#666"
          >
            {d.label}
          </text>
        );
      })}

      {/* Hover */}
      {hoverX !== null && hoverPt && hoverData && (
        <g>
          <line
            x1={hoverX}
            y1={PT}
            x2={hoverX}
            y2={PT + CH}
            stroke="#000"
            strokeWidth="1"
            strokeDasharray="4,4"
            opacity="0.35"
          />
          <circle
            cx={hoverPt[0]}
            cy={hoverPt[1]}
            r="5"
            fill="#3B82F6"
            stroke="#fff"
            strokeWidth="2"
          />
          {/* Tooltip */}
          {(() => {
            const TW = 120;
            const TH = 42;
            const tx =
              hoverX + TW / 2 + 8 > W - PR
                ? hoverX - TW - 8
                : hoverX + 8;
            const ty = Math.max(PT, hoverPt[1] - TH / 2);
            return (
              <g>
                <rect
                  x={tx + 2}
                  y={ty + 2}
                  width={TW}
                  height={TH}
                  fill="#000"
                />
                <rect
                  x={tx}
                  y={ty}
                  width={TW}
                  height={TH}
                  fill="#FFFDF5"
                  stroke="#000"
                  strokeWidth="2"
                />
                <text
                  x={tx + TW / 2}
                  y={ty + 14}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="Space Grotesk, sans-serif"
                  fontWeight="900"
                  fill="#000"
                >
                  {hoverData.label}
                </text>
                <text
                  x={tx + TW / 2}
                  y={ty + 27}
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="Space Grotesk, sans-serif"
                  fontWeight="700"
                  fill="#3B82F6"
                >
                  +{hoverData.count} lead{hoverData.count > 1 ? "s" : ""}
                </text>
                <text
                  x={tx + TW / 2}
                  y={ty + 38}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="Space Grotesk, sans-serif"
                  fontWeight="700"
                  fill="#666"
                >
                  Total: {hoverData.cumulative}
                </text>
              </g>
            );
          })()}
        </g>
      )}

      {/* Interaction overlay */}
      <rect
        x={PL}
        y={PT}
        width={CW}
        height={CH}
        fill="transparent"
        className="cursor-crosshair"
        onMouseMove={handleMouseMove}
      />
    </svg>
  );
}

// ── 5b. Revenue Over Time (Area Chart SVG) ────────────────────────────────────

function RevenueOverTimeChart({
  data,
}: {
  data: Array<{ key: string; label: string; revenue: number }>;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 560;
  const H = 180;
  const PL = 60;
  const PR = 16;
  const PT = 16;
  const PB = 32;
  const CW = W - PL - PR;
  const CH = H - PT - PB;

  const n = data.length;
  const maxRev = Math.max(...data.map((d) => d.revenue), 1);

  const pts: [number, number][] = data.map((d, i) => [
    PL + (i / Math.max(n - 1, 1)) * CW,
    PT + CH - (d.revenue / maxRev) * CH,
  ]);

  const maxLabels = Math.floor(CW / 60);
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((svgX - PL) / CW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(idx, n - 1)));
  };

  if (n === 0)
    return (
      <p className="text-xs text-gray-400 font-bold text-center py-6 uppercase">
        Aucun CA généré
      </p>
    );

  const hoverX = hoverIdx !== null ? pts[hoverIdx]?.[0] ?? null : null;
  const hoverPt = hoverIdx !== null ? pts[hoverIdx] ?? null : null;
  const hoverData = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: "block", overflow: "visible" }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
        const y = PT + pct * CH;
        const val = maxRev * (1 - pct);
        return (
          <g key={i}>
            <line
              x1={PL}
              y1={y}
              x2={W - PR}
              y2={y}
              stroke="#000"
              strokeWidth={i === 4 ? 2 : 0.5}
              strokeDasharray={i === 4 ? "" : "4,4"}
              opacity={i === 4 ? 0.5 : 0.12}
            />
            {i < 4 && (
              <text
                x={PL - 4}
                y={y + 4}
                textAnchor="end"
                fontSize="8"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="700"
                fill="#aaa"
              >
                {val >= 1000
                  ? `${(val / 1000).toFixed(0)}k€`
                  : `${val.toFixed(0)}€`}
              </text>
            )}
          </g>
        );
      })}

      {/* Area */}
      {pts.length > 1 && (
        <path
          d={`${smoothPath(pts)} L ${pts[pts.length - 1][0]},${PT + CH} L ${pts[0][0]},${PT + CH} Z`}
          fill="#58BC82"
          opacity="0.18"
        />
      )}
      {/* Line */}
      {pts.length > 1 && (
        <path
          d={smoothPath(pts)}
          fill="none"
          stroke="#58BC82"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Dots */}
      {pts.map((pt, i) => (
        <circle
          key={i}
          cx={pt[0]}
          cy={pt[1]}
          r="3"
          fill="#58BC82"
          stroke="#fff"
          strokeWidth="1.5"
        />
      ))}

      {/* X labels */}
      {data.map((d, i) => {
        if (i % labelStep !== 0) return null;
        return (
          <text
            key={d.key}
            x={PL + (i / Math.max(n - 1, 1)) * CW}
            y={PT + CH + 16}
            textAnchor="middle"
            fontSize="8"
            fontFamily="Space Grotesk, sans-serif"
            fontWeight="700"
            fill="#666"
          >
            {d.label}
          </text>
        );
      })}

      {/* Hover */}
      {hoverX !== null && hoverPt && hoverData && (
        <g>
          <line
            x1={hoverX}
            y1={PT}
            x2={hoverX}
            y2={PT + CH}
            stroke="#000"
            strokeWidth="1"
            strokeDasharray="4,4"
            opacity="0.35"
          />
          <circle
            cx={hoverPt[0]}
            cy={hoverPt[1]}
            r="5"
            fill="#58BC82"
            stroke="#fff"
            strokeWidth="2"
          />
          {(() => {
            const TW = 120;
            const TH = 36;
            const tx =
              hoverX + TW / 2 + 8 > W - PR
                ? hoverX - TW - 8
                : hoverX + 8;
            const ty = Math.max(PT, hoverPt[1] - TH / 2);
            return (
              <g>
                <rect
                  x={tx + 2}
                  y={ty + 2}
                  width={TW}
                  height={TH}
                  fill="#000"
                />
                <rect
                  x={tx}
                  y={ty}
                  width={TW}
                  height={TH}
                  fill="#FFFDF5"
                  stroke="#000"
                  strokeWidth="2"
                />
                <text
                  x={tx + TW / 2}
                  y={ty + 14}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="Space Grotesk, sans-serif"
                  fontWeight="900"
                  fill="#000"
                >
                  {hoverData.label}
                </text>
                <text
                  x={tx + TW / 2}
                  y={ty + 28}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="Space Grotesk, sans-serif"
                  fontWeight="900"
                  fill="#58BC82"
                >
                  {fmtEur(hoverData.revenue)}
                </text>
              </g>
            );
          })()}
        </g>
      )}

      <rect
        x={PL}
        y={PT}
        width={CW}
        height={CH}
        fill="transparent"
        className="cursor-crosshair"
        onMouseMove={handleMouseMove}
      />
    </svg>
  );
}

// ── 6a. Quality Distribution ───────────────────────────────────────────────────

function QualityDistribution({ leads }: { leads: Lead[] }) {
  const total = leads.length;
  const unscored = leads.filter((l) => l.quality_score === null).length;
  const byScore = [1, 2, 3, 4, 5].map((score) => ({
    score,
    count: leads.filter((l) => l.quality_score === score).length,
    color: QUALITY_COLORS[score - 1],
    label: score === 1 ? "Très faible" : score === 2 ? "Faible" : score === 3 ? "Moyen" : score === 4 ? "Bon" : "Excellent",
  }));
  const maxCount = Math.max(...byScore.map((b) => b.count), unscored, 1);

  return (
    <div className="space-y-3">
      {byScore.map(({ score, count, color, label }) => {
        const pct = (count / maxCount) * 100;
        return (
          <div key={score} className="flex items-center gap-3">
            <div className="w-20 flex-none flex items-center gap-1.5">
              <div
                className="w-3 h-3 border border-black flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs font-bold">{label}</span>
            </div>
            <div className="flex-1 bg-gray-100 border-2 border-black h-6 relative">
              <div
                className="h-full transition-all duration-500 flex items-center"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <div className="w-20 text-right flex-none">
              <span className="font-black text-sm">{count}</span>
              <span className="text-xs text-gray-500 ml-1">
                ({total > 0 ? ((count / total) * 100).toFixed(0) : 0}%)
              </span>
            </div>
          </div>
        );
      })}
      {unscored > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-20 flex-none flex items-center gap-1.5">
            <div className="w-3 h-3 border border-black bg-gray-200 flex-shrink-0" />
            <span className="text-xs font-bold text-gray-400">Non noté</span>
          </div>
          <div className="flex-1 bg-gray-100 border-2 border-black h-6 relative">
            <div
              className="h-full bg-gray-200 transition-all duration-500"
              style={{ width: `${(unscored / maxCount) * 100}%` }}
            />
          </div>
          <div className="w-20 text-right flex-none">
            <span className="font-black text-sm text-gray-400">{unscored}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 7. Follow-up Health ────────────────────────────────────────────────────────

function FollowUpHealth({ leads }: { leads: Lead[] }) {
  const now = new Date();

  const overdue = leads.filter(
    (l) =>
      l.next_follow_up &&
      new Date(l.next_follow_up) < now &&
      l.status !== "converted" &&
      l.status !== "lost"
  );

  const neverContacted = leads.filter(
    (l) => l.last_contacted_at === null && l.status === "new"
  );

  const contactedLeads = leads.filter((l) => l.last_contacted_at !== null);
  const avgDaysSince =
    contactedLeads.length > 0
      ? Math.round(
          contactedLeads.reduce(
            (s, l) => s + (daysSince(l.last_contacted_at) ?? 0),
            0
          ) / contactedLeads.length
        )
      : null;

  const cards = [
    {
      label: "Suivis en retard",
      value: overdue.length,
      icon: <AlertTriangle className="w-5 h-5" />,
      severity:
        overdue.length === 0 ? "ok" : overdue.length > 5 ? "critical" : "warn",
      sub:
        overdue.length === 0
          ? "Tout est à jour"
          : `${overdue.length} lead${overdue.length > 1 ? "s" : ""} à recontacter`,
    },
    {
      label: "Jamais contactés",
      value: neverContacted.length,
      icon: <Clock className="w-5 h-5" />,
      severity:
        neverContacted.length === 0
          ? "ok"
          : neverContacted.length > 10
          ? "critical"
          : "warn",
      sub:
        neverContacted.length === 0
          ? "Aucun lead ignoré"
          : `${neverContacted.length} lead${neverContacted.length > 1 ? "s" : ""} nouveau${neverContacted.length > 1 ? "x" : ""} sans contact`,
    },
    {
      label: "Délai moyen depuis contact",
      value: avgDaysSince !== null ? `${avgDaysSince}j` : "—",
      icon: <CheckCircle className="w-5 h-5" />,
      severity:
        avgDaysSince === null
          ? "neutral"
          : avgDaysSince <= 3
          ? "ok"
          : avgDaysSince <= 7
          ? "warn"
          : "critical",
      sub:
        avgDaysSince !== null
          ? `Sur ${contactedLeads.length} lead${contactedLeads.length > 1 ? "s" : ""} contacté${contactedLeads.length > 1 ? "s" : ""}`
          : "Aucun contact enregistré",
    },
  ];

  const severityStyles: Record<string, string> = {
    ok: "border-lf-green bg-green-50",
    warn: "border-lf-yellow bg-yellow-50",
    critical: "border-red-500 bg-red-50",
    neutral: "border-gray-300 bg-gray-50",
  };

  const severityTextStyles: Record<string, string> = {
    ok: "text-lf-green",
    warn: "text-yellow-700",
    critical: "text-red-600",
    neutral: "text-gray-500",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map(({ label, value, icon, severity, sub }) => (
        <div
          key={label}
          className={`border-3 p-4 shadow-brutal ${severityStyles[severity]}`}
        >
          <div
            className={`flex items-center gap-2 mb-2 ${severityTextStyles[severity]}`}
          >
            {icon}
            <span className="text-xs font-black uppercase tracking-wide">
              {label}
            </span>
          </div>
          <p className={`text-3xl font-black ${severityTextStyles[severity]}`}>
            {value}
          </p>
          <p className="text-xs text-gray-500 font-bold mt-1">{sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function CRMStatsView({ leads, stages }: Props) {
  // ── Derived data ──────────────────────────────────────────────────────────

  const total = leads.length;

  // Source stats
  const sourceStats = useMemo<SourceStats[]>(() => {
    const map = new Map<LeadSource, SourceStats>();
    for (const source of ALL_SOURCES) {
      map.set(source, {
        source,
        count: 0,
        converted: 0,
        convRate: 0,
        revenue: 0,
        avgRevenue: 0,
        avgQuality: null,
        pct: 0,
      });
    }
    for (const lead of leads) {
      const s = (lead.source ?? "other") as LeadSource;
      const entry = map.get(s) ?? map.get("other")!;
      entry.count++;
      if (lead.status === "converted") entry.converted++;
      entry.revenue += lead.revenue ?? 0;
      if (lead.quality_score !== null) {
        entry.avgQuality =
          entry.avgQuality === null
            ? lead.quality_score
            : entry.avgQuality + lead.quality_score;
      }
    }
    const results: SourceStats[] = [];
    for (const entry of Array.from(map.values())) {
      if (entry.count === 0) continue;
      entry.convRate =
        entry.count > 0 ? (entry.converted / entry.count) * 100 : 0;
      entry.avgRevenue =
        entry.converted > 0 ? entry.revenue / entry.converted : 0;
      entry.pct = total > 0 ? (entry.count / total) * 100 : 0;
      // Fix avgQuality: it was summed, now divide
      if (entry.avgQuality !== null) {
        const scoredLeads = leads.filter(
          (l) =>
            (l.source ?? "other") === entry.source &&
            l.quality_score !== null
        );
        entry.avgQuality =
          scoredLeads.length > 0
            ? scoredLeads.reduce((s, l) => s + (l.quality_score ?? 0), 0) /
              scoredLeads.length
            : null;
      }
      results.push(entry);
    }
    return results.sort((a, b) => b.count - a.count);
  }, [leads, total]);

  const sourceDonutData = useMemo(
    () =>
      sourceStats
        .filter((s) => s.count > 0)
        .map((s) => ({
          source: s.source,
          count: s.count,
          pct: s.pct,
        })),
    [sourceStats]
  );

  const sourceQualityData = useMemo(
    () =>
      sourceStats
        .filter((s) => s.avgQuality !== null && s.count > 0)
        .map((s) => ({
          source: s.source,
          avgQuality: s.avgQuality!,
        }))
        .sort((a, b) => b.avgQuality - a.avgQuality),
    [sourceStats]
  );

  // Pipeline stage data
  const stageData = useMemo(() => {
    const sorted = [...stages].sort((a, b) => a.display_order - b.display_order);
    return sorted.map((stage) => {
      const stageLeads = leads.filter((l) => l.pipeline_stage_id === stage.id);
      return {
        ...stage,
        count: stageLeads.length,
        revenue: stageLeads.reduce((s, l) => s + (l.revenue ?? 0), 0),
      };
    });
  }, [leads, stages]);

  // Time data
  const leadsOverTime = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of leads) {
      const dateStr = lead.meta_created_at ?? lead.created_at;
      // Group by week if range < 90 days, else by month
      const key = getWeekKey(dateStr);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    let cumulative = 0;
    return sorted.map(([key, count]) => {
      cumulative += count;
      return { key, label: getWeekLabel(key), count, cumulative };
    });
  }, [leads]);

  const revenueOverTime = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of leads) {
      if (!lead.revenue || lead.status !== "converted") continue;
      const dateStr = lead.meta_created_at ?? lead.created_at;
      const key = getMonthKey(dateStr);
      map.set(key, (map.get(key) ?? 0) + lead.revenue);
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return sorted.map(([key, revenue]) => ({
      key,
      label: getMonthLabel(key),
      revenue,
    }));
  }, [leads]);

  // Quality by source table
  const qualityBySource = useMemo(
    () =>
      sourceStats
        .filter((s) => s.avgQuality !== null)
        .sort((a, b) => (b.avgQuality ?? 0) - (a.avgQuality ?? 0)),
    [sourceStats]
  );

  // Empty state
  if (total === 0) {
    return (
      <div className="border-3 border-black bg-white shadow-brutal p-12 text-center">
        <BarChart3 className="w-10 h-10 mx-auto mb-4 text-gray-300" />
        <p className="font-black uppercase tracking-wide text-gray-400">
          Aucune donnée à afficher
        </p>
        <p className="text-xs text-gray-300 font-bold mt-1">
          Ajoutez des leads pour voir les statistiques
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 1. Hero KPIs ────────────────────────────────────────── */}
      <HeroKPIRow leads={leads} />

      {/* ── 2. Pipeline Funnel ──────────────────────────────────── */}
      {stages.length > 0 && (
        <PipelineFunnel leads={leads} stages={stages} />
      )}

      {/* ── 3. Acquisition par source ───────────────────────────── */}
      <div className="border-3 border-black bg-white shadow-brutal">
        <div className="px-5 py-3 border-b-3 border-black flex items-center gap-2 bg-lf-black text-white">
          <PieChart className="w-4 h-4" />
          <h3 className="font-black uppercase tracking-wide text-sm">
            Acquisition par Source
          </h3>
        </div>
        <div className="p-5 space-y-6">
          {/* 3a + 3b side by side or stacked */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 3a. Donut */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                Répartition par source
              </p>
              {sourceDonutData.length > 0 ? (
                <SourceDonutChart data={sourceDonutData} />
              ) : (
                <p className="text-xs text-gray-400 font-bold">
                  Aucune source renseignée
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="hidden lg:block border-l-3 border-black -mx-6 self-stretch" />

            {/* 3c. Quality bar chart */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                Qualité moyenne par source
              </p>
              {sourceQualityData.length > 0 ? (
                <SourceQualityChart data={sourceQualityData} />
              ) : (
                <p className="text-xs text-gray-400 font-bold">
                  Aucun score de qualité renseigné
                </p>
              )}
            </div>
          </div>

          {/* 3b. Source Table */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
              Performance détaillée par source
            </p>
            <SourceTable data={sourceStats} />
          </div>
        </div>
      </div>

      {/* ── 4. Pipeline Analytics ───────────────────────────────── */}
      {stages.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard
            title="Distribution par étape"
            icon={<BarChart3 className="w-4 h-4" />}
          >
            <StageBarChart data={stageData} />
          </SectionCard>

          <SectionCard
            title="Valeur pipeline"
            icon={<Euro className="w-4 h-4" />}
          >
            <PipelineValueCards data={stageData} />
          </SectionCard>
        </div>
      )}

      {/* ── 5. Analyse temporelle ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard
          title="Leads dans le temps"
          icon={<TrendingUp className="w-4 h-4" />}
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
            Cumul hebdomadaire
          </p>
          <LeadsOverTimeChart data={leadsOverTime} />
          <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-xs">
            <div>
              <span className="font-black uppercase tracking-wide opacity-50 text-[10px]">
                Semaines actives
              </span>
              <p className="font-black">{leadsOverTime.length}</p>
            </div>
            <div>
              <span className="font-black uppercase tracking-wide opacity-50 text-[10px]">
                Pic semaine
              </span>
              <p className="font-black">
                {Math.max(...leadsOverTime.map((d) => d.count), 0)} leads
              </p>
            </div>
            <div>
              <span className="font-black uppercase tracking-wide opacity-50 text-[10px]">
                Moy/semaine
              </span>
              <p className="font-black">
                {leadsOverTime.length > 0
                  ? fmt(
                      leadsOverTime.reduce((s, d) => s + d.count, 0) /
                        leadsOverTime.length,
                      1
                    )
                  : "—"}{" "}
                leads
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="CA dans le temps"
          icon={<Euro className="w-4 h-4" />}
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
            CA mensuel (leads convertis)
          </p>
          <RevenueOverTimeChart data={revenueOverTime} />
          {revenueOverTime.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-xs">
              <div>
                <span className="font-black uppercase tracking-wide opacity-50 text-[10px]">
                  Meilleur mois
                </span>
                <p className="font-black text-lf-green">
                  {fmtEur(
                    Math.max(...revenueOverTime.map((d) => d.revenue), 0)
                  )}
                </p>
              </div>
              <div>
                <span className="font-black uppercase tracking-wide opacity-50 text-[10px]">
                  Moy mensuelle
                </span>
                <p className="font-black">
                  {revenueOverTime.length > 0
                    ? fmtEur(
                        Math.round(
                          revenueOverTime.reduce((s, d) => s + d.revenue, 0) /
                            revenueOverTime.length
                        )
                      )
                    : "—"}
                </p>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── 6. Qualité des leads ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard
          title="Distribution de la qualité"
          icon={<Target className="w-4 h-4" />}
        >
          <QualityDistribution leads={leads} />

          {/* Global avg */}
          {(() => {
            const scored = leads.filter((l) => l.quality_score !== null);
            if (scored.length === 0) return null;
            const avg =
              scored.reduce((s, l) => s + (l.quality_score ?? 0), 0) /
              scored.length;
            const color = QUALITY_COLORS[Math.round(avg) - 1] ?? "#9CA3AF";
            return (
              <div className="mt-4 pt-4 border-t-3 border-black flex items-center gap-3">
                <div
                  className="w-3 h-3 border border-black"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs font-bold text-gray-500">
                  Score moyen global :
                </span>
                <span className="font-black text-xl" style={{ color }}>
                  {fmt(avg, 2)} / 5
                </span>
                <span className="text-xs text-gray-400">
                  ({scored.length} noté{scored.length > 1 ? "s" : ""})
                </span>
              </div>
            );
          })()}
        </SectionCard>

        <SectionCard
          title="Qualité par source"
          icon={<PieChart className="w-4 h-4" />}
        >
          {qualityBySource.length > 0 ? (
            <div className="space-y-2">
              {qualityBySource.map((s) => {
                const color =
                  QUALITY_COLORS[Math.round(s.avgQuality ?? 0) - 1] ??
                  "#9CA3AF";
                const pct = ((s.avgQuality ?? 0) / 5) * 100;
                return (
                  <div key={s.source} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 border border-black/20 ${
                          LEAD_SOURCE_COLORS[s.source] ??
                          LEAD_SOURCE_COLORS.other
                        }`}
                      >
                        {LEAD_SOURCE_LABELS[s.source]}
                      </span>
                      <span className="font-black text-sm" style={{ color }}>
                        {fmt(s.avgQuality ?? 0, 2)}
                      </span>
                    </div>
                    <div className="bg-gray-100 border border-black h-3">
                      <div
                        className="h-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400 font-bold text-center py-6 uppercase">
              Aucun score de qualité renseigné
            </p>
          )}
        </SectionCard>
      </div>

      {/* ── 7. Suivi & Relance ──────────────────────────────────── */}
      <SectionCard
        title="Sante du suivi"
        icon={<Clock className="w-4 h-4" />}
      >
        <FollowUpHealth leads={leads} />

        {/* Overdue list */}
        {(() => {
          const now = new Date();
          const overdue = leads
            .filter(
              (l) =>
                l.next_follow_up &&
                new Date(l.next_follow_up) < now &&
                l.status !== "converted" &&
                l.status !== "lost"
            )
            .sort(
              (a, b) =>
                new Date(a.next_follow_up!).getTime() -
                new Date(b.next_follow_up!).getTime()
            )
            .slice(0, 5);

          if (overdue.length === 0) return null;
          return (
            <div className="mt-5 border-t-3 border-black pt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                Top {overdue.length} leads en retard de suivi
              </p>
              <div className="space-y-2">
                {overdue.map((lead) => {
                  const days = daysSince(lead.next_follow_up);
                  return (
                    <div
                      key={lead.id}
                      className="flex items-center justify-between border-2 border-red-300 bg-red-50 px-3 py-2"
                    >
                      <div>
                        <p className="font-black text-sm text-red-700">
                          {lead.full_name ?? "—"}
                        </p>
                        {lead.company && (
                          <p className="text-xs text-red-400">{lead.company}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-black text-xs text-red-600">
                          {days !== null ? `${days}j de retard` : "—"}
                        </p>
                        {lead.next_follow_up && (
                          <p className="text-[10px] text-red-400">
                            Prévu le{" "}
                            {new Date(lead.next_follow_up).toLocaleDateString(
                              "fr-FR"
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </SectionCard>
    </div>
  );
}
