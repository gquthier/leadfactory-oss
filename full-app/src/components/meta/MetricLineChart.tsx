"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import type { DatePreset } from "@/lib/meta-api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DailyRow {
  date: string;
  spend: number;
  leads: number;
  cpl: number;
  cpm: number;
  cpc: number;
  ctr: number;
  impressions: number;
  clicks: number;
}

type MetricKey = "cpl" | "cpm" | "cpc" | "ctr" | "leads" | "spend" | "impressions" | "clicks";

interface MetricConfig {
  key: MetricKey;
  label: string;
  color: string;
  format: (v: number) => string;
}

interface Props {
  adAccountId: string;
  period: DatePreset;
  conversionLabel?: string;
}

// ── Metric definitions (labels resolved at render time via buildMetrics()) ────
const METRIC_DEFS: Omit<MetricConfig, "label">[] = [
  { key: "cpl",         color: "#F59E0B", format: v => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€` },
  { key: "ctr",         color: "#3B82F6", format: v => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` },
  { key: "cpm",         color: "#8B5CF6", format: v => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€` },
  { key: "cpc",         color: "#06B6D4", format: v => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€` },
  { key: "leads",       color: "#58BC82", format: v => v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) },
  { key: "spend",       color: "#EC4899", format: v => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€` },
  { key: "impressions", color: "#6B7280", format: v => v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) },
  { key: "clicks",      color: "#FB923C", format: v => v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) },
];

function buildMetrics(conversionLabel: string): MetricConfig[] {
  const LABELS: Record<MetricKey, string> = {
    cpl: `Coût / ${conversionLabel}`,
    ctr: "CTR",
    cpm: "CPM",
    cpc: "CPC",
    leads: conversionLabel,
    spend: "Dépense",
    impressions: "Impressions",
    clicks: "Clics",
  };
  return METRIC_DEFS.map(d => ({ ...d, label: LABELS[d.key] }));
}

const DEFAULT_ACTIVE: MetricKey[] = ["cpl", "ctr"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/** Smooth cubic-bezier path through [x, y] points */
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

// ── Component ─────────────────────────────────────────────────────────────────
export function MetricLineChart({ adAccountId, period, conversionLabel = "Leads" }: Props) {
  const [daily, setDaily]   = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [active, setActive] = useState<MetricKey[]>(DEFAULT_ACTIVE);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/meta/campaign-stats?ad_account_id=${encodeURIComponent(adAccountId)}&period=${period}&daily=1`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setDaily(
        (data.daily ?? []).map((r: Record<string, unknown>) => ({
          date:        String(r.date        ?? ""),
          spend:       Number(r.spend       ?? 0),
          leads:       Number(r.leads       ?? 0),
          cpl:         Number(r.cpl         ?? 0),
          cpm:         Number(r.cpm         ?? 0),
          cpc:         Number(r.cpc         ?? 0),
          ctr:         Number(r.ctr         ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks:      Number(r.clicks      ?? 0),
        }))
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, [adAccountId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggle = (key: MetricKey) =>
    setActive(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  // ── States ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="border-3 border-black bg-white p-5 flex items-center gap-2 text-lf-gray text-sm font-medium justify-center py-12">
      <RefreshCw className="w-4 h-4 animate-spin" /> Chargement des courbes…
    </div>
  );
  if (error) return (
    <div className="border-3 border-black bg-white p-4 text-xs font-black text-red-600">Erreur : {error}</div>
  );
  if (daily.length === 0) return (
    <div className="border-3 border-black bg-white p-5 text-center">
      <p className="font-black text-sm uppercase text-lf-gray">Pas de données quotidiennes disponibles</p>
    </div>
  );

  // ── SVG layout ──────────────────────────────────────────────────────────────
  const W = 600, H = 220, PL = 16, PR = 16, PT = 20, PB = 36;
  const CW = W - PL - PR;
  const CH = H - PT - PB;
  const n  = daily.length;

  /** Normalize metric 0→100% of its own max, returns [x,y] SVG points */
  const getPoints = (key: MetricKey): [number, number][] => {
    const vals = daily.map(d => d[key] as number);
    const max  = Math.max(...vals, 0.0001);
    return vals.map((v, i) => [
      PL + (i / Math.max(n - 1, 1)) * CW,
      PT + CH - (v / max) * CH,
    ]);
  };

  const maxLabels = Math.floor(CW / 36);
  const labelStep = Math.ceil(n / maxLabels);
  const METRICS = buildMetrics(conversionLabel);
  const activeMetrics = METRICS.filter(m => active.includes(m.key));

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((svgX - PL) / CW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(idx, n - 1)));
  };

  const hoverX    = hoverIdx !== null ? PL + (hoverIdx / Math.max(n - 1, 1)) * CW : null;
  const hoverData = hoverIdx !== null ? daily[hoverIdx] : null;

  return (
    <div className="border-3 border-black bg-white overflow-hidden">
      {/* Header + toggles */}
      <div className="px-5 py-3 border-b-3 border-black">
        <p className="font-black text-xs uppercase tracking-wider mb-2.5">Courbes de tendance</p>
        <div className="flex items-center flex-wrap gap-1.5">
          {buildMetrics(conversionLabel).map(m => {
            const on = active.includes(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggle(m.key)}
                className="flex items-center gap-1.5 px-2.5 py-1 border-2 text-[10px] font-black uppercase tracking-wider transition-all"
                style={on
                  ? { borderColor: m.color, color: m.color, backgroundColor: `${m.color}18` }
                  : { borderColor: "#d1d5db", color: "#9ca3af" }
                }
              >
                <span
                  className="w-2.5 h-2.5 rounded-full border border-current flex-shrink-0"
                  style={{ backgroundColor: on ? m.color : "transparent" }}
                />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        {active.length === 0 ? (
          <p className="text-center text-xs font-black text-lf-gray py-8 uppercase tracking-wider">
            Sélectionnez au moins une métrique
          </p>
        ) : (
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
              return (
                <line key={i} x1={PL} y1={y} x2={W - PR} y2={y}
                  stroke="#000" strokeWidth={i === 4 ? 2 : 0.5}
                  strokeDasharray={i === 4 ? "" : "4,4"} opacity={i === 4 ? 1 : 0.12}
                />
              );
            })}

            {/* Y-axis legend (normalized) */}
            {["100%", "75%", "50%", "25%", ""].map((lbl, i) => {
              const y = PT + (i / 4) * CH;
              return lbl ? (
                <text key={i} x={PL - 3} y={y + 4} textAnchor="end"
                  fontSize="7" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fill="#aaa">
                  {lbl}
                </text>
              ) : null;
            })}

            {/* Curves */}
            {activeMetrics.map(m => {
              const pts = getPoints(m.key);
              return (
                <g key={m.key}>
                  {/* Area fill */}
                  <path
                    d={`${smoothPath(pts)} L ${pts[pts.length - 1][0]},${PT + CH} L ${pts[0][0]},${PT + CH} Z`}
                    fill={m.color} opacity="0.07"
                  />
                  {/* Line */}
                  <path d={smoothPath(pts)} fill="none"
                    stroke={m.color} strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {/* Hover dot */}
                  {hoverIdx !== null && (
                    <circle cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r="5"
                      fill={m.color} stroke="#fff" strokeWidth="2"
                    />
                  )}
                </g>
              );
            })}

            {/* X-axis date labels */}
            {daily.map((d, i) => {
              if (i % labelStep !== 0) return null;
              return (
                <text key={i}
                  x={PL + (i / Math.max(n - 1, 1)) * CW}
                  y={PT + CH + 14}
                  textAnchor="middle" fontSize="8"
                  fontFamily="Space Grotesk, sans-serif" fontWeight="700" fill="#666"
                >
                  {formatDate(d.date)}
                </text>
              );
            })}

            {/* Hover crosshair */}
            {hoverX !== null && (
              <line x1={hoverX} y1={PT} x2={hoverX} y2={PT + CH}
                stroke="#000" strokeWidth="1" strokeDasharray="4,4" opacity="0.35"
              />
            )}

            {/* Tooltip */}
            {hoverData && hoverX !== null && (() => {
              const CARD_W = 140;
              const LINE_H = 14;
              const CARD_H = 26 + activeMetrics.length * LINE_H;
              const tx = hoverX + 10 + CARD_W > W - PR ? hoverX - CARD_W - 10 : hoverX + 10;
              const ty = PT + 4;
              return (
                <g>
                  <rect x={tx + 2} y={ty + 2} width={CARD_W} height={CARD_H} fill="#000" />
                  <rect x={tx} y={ty} width={CARD_W} height={CARD_H}
                    fill="#FFFDF5" stroke="#000" strokeWidth="2"
                  />
                  <text x={tx + CARD_W / 2} y={ty + 14} textAnchor="middle"
                    fontSize="9" fontFamily="Space Grotesk, sans-serif"
                    fontWeight="900" fill="#000"
                  >
                    {formatDate(hoverData.date)}
                  </text>
                  {activeMetrics.map((m, mi) => (
                    <g key={m.key}>
                      <rect x={tx + 10} y={ty + 20 + mi * LINE_H} width={8} height={8}
                        fill={m.color} stroke="#000" strokeWidth="0.5"
                      />
                      <text x={tx + 24} y={ty + 28 + mi * LINE_H}
                        fontSize="8.5" fontFamily="Space Grotesk, sans-serif"
                        fontWeight="700" fill="#000"
                      >
                        {m.label} : {m.format(hoverData[m.key] as number)}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}

            {/* Invisible interaction overlay */}
            <rect x={PL} y={PT} width={CW} height={CH}
              fill="transparent" className="cursor-crosshair"
              onMouseMove={handleMouseMove}
            />
          </svg>
        )}

        {/* Footnote */}
        <p className="text-[9px] font-medium text-lf-gray mt-2 text-right uppercase tracking-wider">
          Chaque courbe est normalisée sur son propre max (0 → 100%)
        </p>
      </div>
    </div>
  );
}
