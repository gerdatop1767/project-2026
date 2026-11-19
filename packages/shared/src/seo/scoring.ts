import { DEFAULT_PRIORITY_WEIGHTS, type SeoPriorityWeights } from './settings.js';

/** Each factor 0–10, as judged by the research agent (with a written reason). */
export interface SeoTopicFactors {
  demand: number;
  /** 10 = very competitive (bad). Inverted in the score. */
  competition: number;
  seasonality: number;
  freshness: number;
  fit: number;
  conversion: number;
  rankChance: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** SEO priority 0–100 (docs/SEO_CENTER.md §6). Weights are normalised to sum 1. */
export function topicPriority(
  f: SeoTopicFactors,
  weights: SeoPriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): number {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const value =
    weights.demand * clamp(f.demand, 0, 10) +
    weights.competition * (10 - clamp(f.competition, 0, 10)) +
    weights.seasonality * clamp(f.seasonality, 0, 10) +
    weights.freshness * clamp(f.freshness, 0, 10) +
    weights.fit * clamp(f.fit, 0, 10) +
    weights.conversion * clamp(f.conversion, 0, 10) +
    weights.rankChance * clamp(f.rankChance, 0, 10);
  return Math.round((value / total) * 10 * 10) / 10;
}

/** Real metrics of one article over a window. `null` = source not connected. */
export interface SeoArticleMetrics {
  impressions: number | null;
  clicks: number | null;
  /** Impression-weighted average position, 1 = top. */
  position: number | null;
  organicVisits: number | null;
  registrations: number | null;
  /** Metrika average visit duration, seconds. */
  avgVisitSeconds?: number | null;
}

/**
 * SEO Score 0–100 from real data only. Each component is a saturating curve
 * (so one huge number doesn't dominate); components with no data are left
 * out and the weights re-normalised. All components missing → null, never 0.
 */
export function articleSeoScore(m: SeoArticleMetrics): number | null {
  const parts: [number, number][] = [];
  const sat = (v: number, half: number) => v / (v + half);
  if (m.impressions !== null) parts.push([0.15, sat(m.impressions, 500)]);
  if (m.clicks !== null) parts.push([0.2, sat(m.clicks, 30)]);
  if (m.impressions !== null && m.clicks !== null && m.impressions > 0) {
    parts.push([0.15, clamp(m.clicks / m.impressions / 0.08, 0, 1)]);
  }
  if (m.position !== null && m.position > 0) {
    parts.push([0.2, clamp((50 - m.position) / 49, 0, 1)]);
  }
  if (m.organicVisits !== null) parts.push([0.15, sat(m.organicVisits, 50)]);
  if (m.registrations !== null) parts.push([0.15, sat(m.registrations, 3)]);
  if (m.avgVisitSeconds !== undefined && m.avgVisitSeconds !== null) {
    parts.push([0.05, sat(m.avgVisitSeconds, 60)]);
  }
  if (parts.length === 0) return null;
  const w = parts.reduce((a, [weight]) => a + weight, 0);
  return Math.round((parts.reduce((a, [weight, v]) => a + weight * v, 0) / w) * 1000) / 10;
}

/** Percent change; null when the base is 0 or either side is unknown. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
