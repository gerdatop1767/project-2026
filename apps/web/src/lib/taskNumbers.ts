import type { CollectionListItem } from '@zybrilka/shared';
import { getSubjectContent } from '../data/subjectContent.js';

/**
 * The exam numbers a «По номерам» / variant-builder grid offers — always
 * the ones the database really has (GET /collections for a chosen
 * Сборник, GET /tasks/counts for «Все источники»), never a fixed count:
 * ЕГЭ 2027 Ященко has №1–20 while the 2026 format has №1–19.
 *
 * Only before the API answers (or for an older API without the lists)
 * does it fall back to the subject's static count, so the grid is never
 * empty while loading.
 */
export function availableTaskNumbers(params: {
  subjectId: string;
  collection?: CollectionListItem | null;
  /** «Все источники» numbers from GET /tasks/counts, if loaded. */
  poolNumbers?: readonly number[] | null;
}): number[] {
  const fromCollection = params.collection?.taskNumbers;
  if (params.collection && fromCollection) return [...fromCollection];
  if (!params.collection && params.poolNumbers && params.poolNumbers.length > 0) {
    return [...params.poolNumbers];
  }
  return Array.from(
    { length: getSubjectContent(params.subjectId).taskNumberCount },
    (_, i) => i + 1,
  );
}
