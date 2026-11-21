import { createHash } from 'node:crypto';
import { SEO_GATE_REASON_LABELS } from '@zybrilka/shared';
import {
  classifyFactIssue,
  classifyStyleNote,
  type ClassifiedIssue,
  type ClassifiedStyleNote,
} from './factClassification.js';

/**
 * Publication Safety Gate (SEO Center, stage 2.1).
 *
 * The one server-side decision whether an article's current text may go on
 * the site — used by every path that publishes or schedules: the admin
 * «Опубликовать» and «Запланировать», the scheduler's due publications, the
 * worker's auto mode, and applying an update to a live article.
 *
 * What the model returns is input, never the decision: a `verdict: 'pass'`
 * or `factCheckPassed: true` authorizes nothing. The gate reads only a
 * fact-check record the server built (with proof that a web check actually
 * ran — search results returned by the API, not words of the model) and an
 * owner's manual approval; both are bound to a hash of the exact text, so
 * any edit after the check makes it stale.
 *
 * Storage: `seo_articles.review_notes` (jsonb), keys `factCheck` and
 * `manualApproval`. Only server code writes them — the admin PATCH schema is
 * strict and has no such fields — so no migration is needed.
 */

export const GATE_REASONS = SEO_GATE_REASON_LABELS;
export type GateReason = keyof typeof GATE_REASONS;

export type GateTarget = 'publish' | 'schedule' | 'apply_update';

const ALLOWED_STATUSES: Record<GateTarget, readonly string[]> = {
  publish: ['draft', 'review', 'scheduled', 'needs_update'],
  // Not needs_update: that article is live — «scheduled» would take it off the
  // site until the due time (and for good if the gate then refuses).
  schedule: ['draft', 'review', 'scheduled'],
  apply_update: ['published', 'needs_update'],
};

/** Issue as the fact-check model reports it (category/status are required in its output schema). */
export interface FactCheckIssueInput {
  claim: string;
  problem?: string;
  /** One of FACT_CATEGORIES; anything else is «ambiguous» (factClassification.ts). */
  category?: string;
  /** The model's suggestion only — the server decides by category. */
  severity?: string;
  status?: string;
}

export interface FactCheckRecord {
  v: 3;
  /** articleContentHash of the text that was checked. */
  contentHash: string;
  checkedAt: string;
  result: 'verified' | 'failed';
  webChecked: boolean;
  /** URLs the search tool returned (API data, not model text). */
  webSources: string[];
  /** critical + contradicted: blocks everything, a manual approval included. */
  criticalContradictions: string[];
  /** critical + unverified, and every ambiguous issue: blocks automatic publication. */
  unverifiedCritical: string[];
  /** Issues the server could not file as critical or minor (subset of unverifiedCritical). */
  ambiguous: string[];
  minorIssues: string[];
  /** Every issue with the server's classification and the rule that decided. */
  issues: ClassifiedIssue[];
  /** Style notes: safe only when the triage and the marker check both cleared them. */
  styleNotes: ClassifiedStyleNote[];
  /** The pending update this check was for (null = the article itself). */
  revisionId: string | null;
}

export interface ManualApproval {
  adminId: string;
  at: string;
  reason: string;
  contentHash: string;
  revisionId: string | null;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isHash = (v: unknown): v is string => isStr(v) && /^[0-9a-f]{64}$/.test(v);

/** Article fields whose text readers see — what a fact-check vouches for. */
export interface GateContent {
  title: string;
  h1?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  bodyMd: string;
  faq: { question: string; answer: string }[];
  /** The article's sources — evidence: the set of URLs is part of what was checked. */
  sources?: { url: string; title?: string }[] | null;
}

/**
 * A source URL as evidence: scheme/host case, a trailing slash and the
 * fragment do not matter; path and query do.
 */
export function normalizeSourceUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw.trim();
  }
}

/** The evidence of an article: its sources' URLs as a sorted set (titles and order excluded). */
export function sourceUrlSet(sources: GateContent['sources']): string[] {
  return [...new Set((sources ?? []).map((x) => normalizeSourceUrl(x.url)))].sort();
}

/**
 * sha256 of what a check vouches for: the text and the evidence. Images
 * (`![alt](media:<uuid>)`, inserted by the visual agent after the review),
 * whitespace, source titles and source order are left out, so adding
 * pictures or renaming a link does not invalidate a check; any change of
 * words, and adding, removing or changing a source URL, does.
 */
export function articleContentHash(c: GateContent): string {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const body = c.bodyMd.replace(/!\[[^\]]*\]\(media:[0-9a-f-]{36}\)/g, '');
  const payload = JSON.stringify([
    norm(c.title),
    norm(c.h1),
    norm(c.seoTitle),
    norm(c.metaDescription),
    norm(c.ogTitle),
    norm(c.ogDescription),
    norm(body),
    (c.faq ?? []).map((f) => [norm(f.question), norm(f.answer)]),
    sourceUrlSet(c.sources),
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Builds the record the gate trusts. `webSources` must come from the API's
 * search results (web_search_tool_result / citations), never from model
 * text. Conservative policy (factClassification.ts): «verified» needs a
 * «pass» verdict, real search results, NO factual issue of any category,
 * and every style note confirmed as purely stylistic by the triage and the
 * marker check. The category of an issue only decides whether a manual
 * approval can override it (critical + contradicted → never).
 */
export function buildFactCheckRecord(input: {
  verdict: string;
  factualIssues: FactCheckIssueInput[];
  /** Style notes with the separate triage's answer (null/missing = no answer). */
  styleNotes?: { text: string; triage?: string | null }[];
  webChecked: boolean;
  webSources: string[];
  contentHash: string;
  checkedAt: Date;
  revisionId?: string | null;
}): FactCheckRecord {
  const issues = input.factualIssues.slice(0, 30).map(classifyFactIssue);
  // More than we keep: whatever was cut off is unknown → ambiguous.
  const overflow = input.factualIssues.length > 30;
  const styleNotes = (input.styleNotes ?? []).slice(0, 30).map(classifyStyleNote);
  const pick = (f: (i: ClassifiedIssue) => boolean) => issues.filter(f).map((i) => i.claim);
  const criticalContradictions = pick(
    (i) => i.criticality === 'critical' && i.status === 'contradicted',
  );
  const ambiguous = [
    ...pick((i) => i.criticality === 'ambiguous'),
    ...styleNotes.filter((n) => !n.safe).map((n) => `Стиль (не подтверждено): ${n.text}`),
    ...(overflow || (input.styleNotes?.length ?? 0) > 30 ? ['(список замечаний обрезан)'] : []),
  ];
  const unverifiedCritical = [
    ...pick((i) => i.criticality === 'critical' && i.status === 'unverified'),
    ...ambiguous,
  ];
  const minorIssues = pick((i) => i.criticality === 'minor');
  const webSources = [...new Set(input.webSources)].slice(0, 30);
  const verified =
    input.verdict === 'pass' &&
    input.factualIssues.length === 0 &&
    ambiguous.length === 0 &&
    input.webChecked &&
    webSources.length > 0;
  return {
    v: 3,
    contentHash: input.contentHash,
    checkedAt: input.checkedAt.toISOString(),
    result: verified ? 'verified' : 'failed',
    webChecked: input.webChecked,
    webSources,
    criticalContradictions,
    unverifiedCritical,
    ambiguous,
    minorIssues,
    issues,
    styleNotes,
    revisionId: input.revisionId ?? null,
  };
}

export function readFactCheckRecord(notes: unknown): FactCheckRecord | null {
  const r = (notes as Record<string, unknown> | null | undefined)?.factCheck as
    Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  const ok =
    r.v === 3 &&
    isHash(r.contentHash) &&
    isStr(r.checkedAt) &&
    (r.result === 'verified' || r.result === 'failed') &&
    typeof r.webChecked === 'boolean' &&
    isStrs(r.webSources) &&
    isStrs(r.criticalContradictions) &&
    isStrs(r.unverifiedCritical) &&
    isStrs(r.ambiguous) &&
    isStrs(r.minorIssues) &&
    Array.isArray(r.issues) &&
    Array.isArray(r.styleNotes) &&
    (r.revisionId === null || isStr(r.revisionId));
  return ok ? (r as unknown as FactCheckRecord) : null;
}

export function readManualApproval(notes: unknown): ManualApproval | null {
  const r = (notes as Record<string, unknown> | null | undefined)?.manualApproval as
    Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  const ok =
    isStr(r.adminId) &&
    r.adminId.length > 0 &&
    isStr(r.at) &&
    isStr(r.reason) &&
    r.reason.trim().length > 0 &&
    isHash(r.contentHash) &&
    (r.revisionId === null || isStr(r.revisionId));
  return ok ? (r as unknown as ManualApproval) : null;
}

export interface GateDecision {
  allowed: boolean;
  /** What allowed it: an automatic verified check, or the owner's approval of this exact text. */
  basis: 'verified' | 'manual' | null;
  reasons: GateReason[];
  /** Critical contradictions block even a manual approval. */
  criticalContradictions: string[];
  unverifiedCritical: string[];
  contentHash: string;
  /** A manual approval can unblock this (no critical contradiction known). */
  manualAllowed: boolean;
}

/**
 * The decision. Pure: callers pass the article as it is inside their
 * transaction (row locked), so the text checked is the text published.
 */
export function evaluatePublicationGate(o: {
  target: GateTarget;
  status: string;
  content: GateContent;
  reviewNotes: unknown;
}): GateDecision {
  const contentHash = articleContentHash(o.content);
  const record = readFactCheckRecord(o.reviewNotes);
  const manual = readManualApproval(o.reviewNotes);
  const reasons: GateReason[] = [];
  if (!ALLOWED_STATUSES[o.target].includes(o.status)) reasons.push('status_not_allowed');

  // Contradictions found by the latest check block until a new check of a
  // new text clears them — even if the text was edited since (an edit alone
  // must not turn «contradicted» into «manually approvable»).
  const criticalContradictions = record?.criticalContradictions ?? [];
  const current = record !== null && record.contentHash === contentHash;
  const unverifiedCritical = current ? record.unverifiedCritical : [];

  if (!record) reasons.push('no_fact_check');
  else if (!current) reasons.push('stale_fact_check');
  if (criticalContradictions.length) reasons.push('critical_contradiction');
  if (current) {
    if (unverifiedCritical.length) reasons.push('unverified_critical_claims');
    if (record.result !== 'verified') {
      reasons.push(
        !record.webChecked || record.webSources.length === 0
          ? 'no_web_evidence'
          : 'fact_check_failed',
      );
    }
  }

  const manualAllowed = criticalContradictions.length === 0;
  const statusOk = !reasons.includes('status_not_allowed');
  const verified =
    current && record.result === 'verified' && manualAllowed && !unverifiedCritical.length;
  const manualOk = manualAllowed && manual !== null && manual.contentHash === contentHash;
  const basis = verified ? 'verified' : manualOk ? 'manual' : null;
  const allowed = statusOk && basis !== null;
  return {
    allowed,
    basis: allowed ? basis : null,
    reasons: allowed ? [] : reasons.length ? [...new Set(reasons)] : ['no_fact_check'],
    criticalContradictions,
    unverifiedCritical,
    contentHash,
    manualAllowed,
  };
}

/** Human-readable reasons for logs and the admin. */
export function gateReasonText(reasons: GateReason[]): string {
  return reasons.map((r) => GATE_REASONS[r]).join('; ');
}

/**
 * New review notes after a check: the model's review (for the admin), the
 * server record, and the owner's earlier manual approval only if it was for
 * this very text and the new check found no contradiction.
 */
export function reviewNotesWithRecord(
  review: Record<string, unknown>,
  record: FactCheckRecord,
  previousNotes: unknown,
): Record<string, unknown> {
  const manual = readManualApproval(previousNotes);
  const keep =
    manual !== null &&
    manual.contentHash === record.contentHash &&
    record.criticalContradictions.length === 0;
  // Keys only the server writes: whatever the model put there is dropped.
  const modelReview = Object.fromEntries(
    Object.entries(review).filter(([k]) => k !== 'factCheck' && k !== 'manualApproval'),
  );
  return { ...modelReview, factCheck: record, ...(keep ? { manualApproval: manual } : {}) };
}
