import { z } from 'zod';
import { SEO_MODES, SEO_SEARCH_ENGINES } from './constants.js';

/**
 * AI model price list, USD per 1M tokens (Anthropic first-party rates,
 * 2026-11). Used to cost every call and to refuse a call that would not
 * fit the budget. Unknown model → the most expensive row, so an unknown
 * model can never under-count spend.
 */
export const SEO_MODEL_PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};
const MOST_EXPENSIVE = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };
/** Anthropic web search: $10 per 1000 searches. */
export const SEO_WEB_SEARCH_PRICE_USD = 0.01;

export function modelPrice(model: string) {
  return SEO_MODEL_PRICES[model] ?? MOST_EXPENSIVE;
}

export interface SeoUsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearches?: number;
}

/** Exact cost of a finished call in USD. */
export function usageCostUsd(model: string, u: SeoUsageTokens): number {
  const p = modelPrice(model);
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite) /
      1_000_000 +
    (u.webSearches ?? 0) * SEO_WEB_SEARCH_PRICE_USD
  );
}

/** Worst case of a call before it runs: all input uncached, full max_tokens out. */
export function worstCaseCostUsd(
  model: string,
  inputTokens: number,
  maxTokens: number,
  maxWebSearches = 0,
): number {
  return usageCostUsd(model, {
    inputTokens,
    outputTokens: maxTokens,
    cacheWriteTokens: 0,
    webSearches: maxWebSearches,
  });
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/** Priority factor weights (docs/SEO_CENTER.md §6); normalised to sum 1 on use. */
export const seoPriorityWeightsSchema = z.object({
  demand: z.number().min(0).max(1),
  competition: z.number().min(0).max(1),
  seasonality: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  fit: z.number().min(0).max(1),
  conversion: z.number().min(0).max(1),
  rankChance: z.number().min(0).max(1),
});
export type SeoPriorityWeights = z.infer<typeof seoPriorityWeightsSchema>;

export const DEFAULT_PRIORITY_WEIGHTS: SeoPriorityWeights = {
  demand: 0.25,
  competition: 0.15,
  seasonality: 0.1,
  freshness: 0.1,
  fit: 0.15,
  conversion: 0.15,
  rankChance: 0.1,
};

export const seoSettingsSchema = z.object({
  enabled: z.boolean(),
  /** The big red button: nothing is planned, taken from the queue or sent to AI. */
  emergencyStop: z.boolean(),
  mode: z.enum(SEO_MODES),
  publishingPaused: z.boolean(),
  articlesPerDay: z.number().int().min(0).max(10),
  /** Moscow time the daily cycle starts. */
  dailyRunTime: time,
  /** Moscow time scheduled articles go live (auto mode). */
  publishTime: time,
  maxExternalPostsPerDay: z.number().int().min(0).max(20),
  maxImagesPerArticle: z.number().int().min(0).max(8),
  monthlyBudgetUsd: z.number().min(0).max(100_000),
  dailyBudgetUsd: z.number().min(0).max(10_000),
  languages: z.array(z.enum(['ru', 'en'])).min(1),
  prioritySubjects: z.array(z.string().regex(/^[a-z_]{1,32}$/)).max(20),
  searchEngines: z.array(z.enum(SEO_SEARCH_ENGINES)).min(1),
  /** Topics below this priority are never written automatically. */
  minTopicPriority: z.number().min(0).max(100),
  strongModel: z.string().min(3).max(64),
  cheapModel: z.string().min(3).max(64),
  /** Max web searches one research call may run. */
  maxSearchesPerResearch: z.number().int().min(0).max(30),
  priorityWeights: seoPriorityWeightsSchema,
});
export type SeoSettings = z.infer<typeof seoSettingsSchema>;

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  enabled: false,
  emergencyStop: false,
  mode: 'manual',
  publishingPaused: false,
  articlesPerDay: 1,
  dailyRunTime: '04:10',
  publishTime: '09:40',
  maxExternalPostsPerDay: 2,
  maxImagesPerArticle: 3,
  monthlyBudgetUsd: 30,
  dailyBudgetUsd: 3,
  languages: ['ru'],
  prioritySubjects: ['math', 'russian'],
  searchEngines: ['yandex', 'google'],
  minTopicPriority: 55,
  strongModel: 'claude-opus-5-5',
  cheapModel: 'claude-haiku-5-5',
  maxSearchesPerResearch: 8,
  priorityWeights: DEFAULT_PRIORITY_WEIGHTS,
};

/** Admin patch: any subset of settings. */
export const seoSettingsPatchSchema = seoSettingsSchema.partial().strict();

/** Reads a stored settings JSON leniently: unknown/invalid fields fall back to defaults. */
export function normalizeSeoSettings(raw: unknown): SeoSettings {
  const base: Record<string, unknown> = { ...DEFAULT_SEO_SETTINGS };
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!(key in DEFAULT_SEO_SETTINGS)) continue;
      const field = seoSettingsSchema.shape[key as keyof SeoSettings];
      if (field.safeParse(value).success) base[key] = value;
    }
  }
  return seoSettingsSchema.parse(base);
}
