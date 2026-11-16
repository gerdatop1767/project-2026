/** `GET /tasks/:taskId/similar` response row — aggregated metadata
 * similarity, never user-specific. */
export interface SimilarTaskEntry {
  readonly taskId: string;
  readonly taskNumber: number;
  /** 0..100 — closeness inside the pool (`closeness`, similarRanking.ts). */
  readonly score: number;
  /** How close: the same subtype, a shared feature/method/subtopic, or the
   * same EGE topic only (docs/learning/SIMILAR-TASKS.md). */
  readonly match?: 'exact' | 'close' | 'topic';
}
