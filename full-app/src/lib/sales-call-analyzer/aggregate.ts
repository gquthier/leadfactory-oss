/**
 * Agrégation cross-calls : objections récurrentes + recommandations brutes.
 * Pure : prend les analyses du client, retourne des structures prêtes UI / CSV.
 */

import {
  OBJECTION_LABELS,
  PAIN_CATEGORY_LABELS,
  PHASE_LABELS,
  type DetectedObjection,
  type PainCategory,
  type PainPoint,
  type Recommendation,
  type SalesCallAnalysis,
  type VerbatimQuote,
} from "./analyzer-schema";

export interface CallMeta {
  call_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  created_at: string;
}

export interface CallAnalysisInput extends CallMeta {
  analysis: SalesCallAnalysis;
}

// ─── Objections agrégées ──────────────────────────────────────────────

export interface ObjectionOccurrence {
  call_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  raised_verbatim: string;
  was_isolated: boolean;
  was_treated: boolean;
  was_validated: boolean;
  reco: string;
}

export interface AggregatedObjection {
  type: DetectedObjection["type"];
  label: string;
  recurrence: number; // nombre d'occurrences (= nb d'apparitions, peut être > nb de calls si l'IA détecte plusieurs fois dans un call)
  call_count: number; // nombre de calls distincts touchés
  treated_count: number;
  validated_count: number;
  isolated_count: number;
  occurrences: ObjectionOccurrence[];
  ideal_response: string; // synthèse manuelle des `reco` (dédoublonnées + concatenées)
}

function dedupeAndJoin(values: string[], maxItems = 5): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const v of values) {
    const norm = v.trim();
    if (!norm) continue;
    const key = norm.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(norm);
    if (kept.length >= maxItems) break;
  }
  return kept.join(" • ");
}

export function aggregateObjections(calls: CallAnalysisInput[]): AggregatedObjection[] {
  const byType = new Map<DetectedObjection["type"], AggregatedObjection>();

  for (const c of calls) {
    const callIdsForType = new Map<DetectedObjection["type"], Set<string>>();
    for (const obj of c.analysis.objections ?? []) {
      const existing = byType.get(obj.type) ?? {
        type: obj.type,
        label: OBJECTION_LABELS[obj.type] ?? obj.type,
        recurrence: 0,
        call_count: 0,
        treated_count: 0,
        validated_count: 0,
        isolated_count: 0,
        occurrences: [],
        ideal_response: "",
      };

      existing.recurrence += 1;
      if (obj.was_treated) existing.treated_count += 1;
      if (obj.was_validated) existing.validated_count += 1;
      if (obj.was_isolated) existing.isolated_count += 1;
      existing.occurrences.push({
        call_id: c.call_id,
        meeting_title: c.meeting_title,
        meeting_date: c.meeting_date,
        raised_verbatim: obj.raised_verbatim,
        was_isolated: obj.was_isolated,
        was_treated: obj.was_treated,
        was_validated: obj.was_validated,
        reco: obj.reco,
      });

      // call_count : compte les call_ids distincts par type
      const seen = callIdsForType.get(obj.type) ?? new Set<string>();
      seen.add(c.call_id);
      callIdsForType.set(obj.type, seen);

      byType.set(obj.type, existing);
    }
    // Une fois le call traité, on met à jour call_count
    Array.from(callIdsForType.entries()).forEach(([type, seenIds]) => {
      const agg = byType.get(type);
      if (agg) agg.call_count = Math.max(agg.call_count, seenIds.size);
    });
  }

  // Recompute call_count proprement (le passage ci-dessus ne le fait que pour le call courant)
  const aggs = Array.from(byType.values());
  for (const agg of aggs) {
    const ids = new Set<string>();
    agg.occurrences.forEach((o: ObjectionOccurrence) => ids.add(o.call_id));
    agg.call_count = ids.size;
    agg.ideal_response = dedupeAndJoin(
      agg.occurrences.map((o: ObjectionOccurrence) => o.reco)
    );
  }

  return aggs.sort((a, b) => b.recurrence - a.recurrence);
}

// ─── Recommandations agrégées ─────────────────────────────────────────

export interface AggregatedRecommendation {
  call_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  call_created_at: string;
  priority: Recommendation["priority"];
  title: string;
  why: string;
  how_next_call: string;
  framework_source: string;
}

export function aggregateRecommendations(
  calls: CallAnalysisInput[]
): AggregatedRecommendation[] {
  const out: AggregatedRecommendation[] = [];
  for (const c of calls) {
    for (const r of c.analysis.top_3_recommendations ?? []) {
      out.push({
        call_id: c.call_id,
        meeting_title: c.meeting_title,
        meeting_date: c.meeting_date,
        call_created_at: c.created_at,
        priority: r.priority,
        title: r.title,
        why: r.why,
        how_next_call: r.how_next_call,
        framework_source: r.framework_source,
      });
    }
  }
  // Tri : priority (1 = top) puis date décroissante
  return out.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (
      new Date(b.call_created_at).getTime() - new Date(a.call_created_at).getTime()
    );
  });
}

// ─── CSV utils ───────────────────────────────────────────────────────

const CSV_BOM = "﻿";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

export function buildObjectionsCsv(objs: AggregatedObjection[]): string {
  const header = [
    "type",
    "label",
    "recurrence",
    "call_count",
    "treated_count",
    "validated_count",
    "isolated_count",
    "ideal_response",
  ];
  const rows = objs.map((o) =>
    csvLine([
      o.type,
      o.label,
      o.recurrence,
      o.call_count,
      o.treated_count,
      o.validated_count,
      o.isolated_count,
      o.ideal_response,
    ])
  );
  return CSV_BOM + [csvLine(header), ...rows].join("\r\n");
}

// ─── Verbatim Library agrégée ─────────────────────────────────────────

export interface AggregatedVerbatim {
  call_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  call_created_at: string;
  speaker: VerbatimQuote["speaker"];
  quote: string;
  timestamp: string | null;
  context: string;
  phase: SalesCallAnalysis["phases"][number]["phase"];
  phase_label: string;
}

export function aggregateVerbatims(
  calls: CallAnalysisInput[]
): AggregatedVerbatim[] {
  const out: AggregatedVerbatim[] = [];
  for (const c of calls) {
    for (const phase of c.analysis.phases ?? []) {
      for (const q of phase.verbatim_quotes ?? []) {
        out.push({
          call_id: c.call_id,
          meeting_title: c.meeting_title,
          meeting_date: c.meeting_date,
          call_created_at: c.created_at,
          speaker: q.speaker,
          quote: q.quote,
          timestamp: q.timestamp ?? null,
          context: q.context,
          phase: phase.phase,
          phase_label: PHASE_LABELS[phase.phase] ?? phase.phase,
        });
      }
    }
  }
  // Tri : plus récents d'abord
  return out.sort(
    (a, b) =>
      new Date(b.call_created_at).getTime() -
      new Date(a.call_created_at).getTime()
  );
}

// ─── Pain Points Catalog agrégé ───────────────────────────────────────

export interface PainOccurrence {
  call_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  raised_verbatim: string;
  current_state: string;
  desired_state: string | null;
  cost_of_inaction: string | null;
  intensity: number;
}

export interface AggregatedPainCategory {
  category: PainCategory;
  label: string;
  occurrence_count: number;
  call_count: number;
  avg_intensity: number;
  max_intensity: number;
  occurrences: PainOccurrence[];
  /** Synthèse des current_state dédupliqués */
  pattern_summary: string;
  /** Coûts d'inaction extraits (dédupliqués) */
  cost_summary: string;
}

export function aggregatePains(
  calls: CallAnalysisInput[]
): AggregatedPainCategory[] {
  const byCat = new Map<PainCategory, AggregatedPainCategory>();

  for (const c of calls) {
    const pains: PainPoint[] = (c.analysis.pains ?? []) as PainPoint[];
    for (const p of pains) {
      const agg =
        byCat.get(p.category) ?? {
          category: p.category,
          label: PAIN_CATEGORY_LABELS[p.category] ?? p.category,
          occurrence_count: 0,
          call_count: 0,
          avg_intensity: 0,
          max_intensity: 0,
          occurrences: [],
          pattern_summary: "",
          cost_summary: "",
        };

      agg.occurrence_count += 1;
      agg.max_intensity = Math.max(agg.max_intensity, p.intensity);
      agg.occurrences.push({
        call_id: c.call_id,
        meeting_title: c.meeting_title,
        meeting_date: c.meeting_date,
        raised_verbatim: p.raised_verbatim,
        current_state: p.current_state,
        desired_state: p.desired_state ?? null,
        cost_of_inaction: p.cost_of_inaction ?? null,
        intensity: p.intensity,
      });

      byCat.set(p.category, agg);
    }
  }

  // Post-traitement : call_count + avg_intensity + summaries
  const aggs = Array.from(byCat.values());
  for (const agg of aggs) {
    const ids = new Set<string>();
    let sum = 0;
    for (const o of agg.occurrences) {
      ids.add(o.call_id);
      sum += o.intensity;
    }
    agg.call_count = ids.size;
    agg.avg_intensity = agg.occurrences.length
      ? Math.round((sum / agg.occurrences.length) * 10) / 10
      : 0;

    agg.pattern_summary = dedupeAndJoin(
      agg.occurrences.map((o) => o.current_state),
      4
    );
    agg.cost_summary = dedupeAndJoin(
      agg.occurrences
        .map((o) => o.cost_of_inaction)
        .filter((c): c is string => !!c),
      4
    );
  }

  // Tri : par fréquence d'occurrence puis intensité moyenne
  return aggs.sort((a, b) => {
    if (a.occurrence_count !== b.occurrence_count) {
      return b.occurrence_count - a.occurrence_count;
    }
    return b.avg_intensity - a.avg_intensity;
  });
}

// ─── CSV : Verbatim + Pains ──────────────────────────────────────────

export function buildVerbatimsCsv(items: AggregatedVerbatim[]): string {
  const header = [
    "speaker",
    "quote",
    "timestamp",
    "phase",
    "context",
    "meeting_title",
    "meeting_date",
    "call_id",
  ];
  const rows = items.map((v) =>
    csvLine([
      v.speaker,
      v.quote,
      v.timestamp ?? "",
      v.phase_label,
      v.context,
      v.meeting_title ?? "",
      v.meeting_date ?? v.call_created_at,
      v.call_id,
    ])
  );
  return CSV_BOM + [csvLine(header), ...rows].join("\r\n");
}

export function buildPainsCsv(items: AggregatedPainCategory[]): string {
  const header = [
    "category",
    "label",
    "occurrence_count",
    "call_count",
    "avg_intensity",
    "max_intensity",
    "pattern_summary",
    "cost_summary",
  ];
  const rows = items.map((p) =>
    csvLine([
      p.category,
      p.label,
      p.occurrence_count,
      p.call_count,
      p.avg_intensity,
      p.max_intensity,
      p.pattern_summary,
      p.cost_summary,
    ])
  );
  return CSV_BOM + [csvLine(header), ...rows].join("\r\n");
}

export function buildRecommendationsCsv(recs: AggregatedRecommendation[]): string {
  const header = [
    "priority",
    "title",
    "why",
    "how_next_call",
    "framework_source",
    "meeting_title",
    "meeting_date",
    "call_id",
  ];
  const rows = recs.map((r) =>
    csvLine([
      r.priority,
      r.title,
      r.why,
      r.how_next_call,
      r.framework_source,
      r.meeting_title ?? "",
      r.meeting_date ?? r.call_created_at,
      r.call_id,
    ])
  );
  return CSV_BOM + [csvLine(header), ...rows].join("\r\n");
}
