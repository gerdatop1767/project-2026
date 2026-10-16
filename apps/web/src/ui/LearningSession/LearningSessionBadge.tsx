import type { LearningSessionState } from '../../lib/learningSessionContext.js';
import { Chip } from '../Chip/Chip.js';

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 10 — the only UI Task/Result
 * add for a real backend learning session: a small, unobtrusive
 * "Тренировка · N из M" indicator built from the existing `Chip`
 * (Design Spec Section 12), never a new badge component or color.
 */
export function LearningSessionBadge({
  session,
}: {
  session: Extract<LearningSessionState, { status: 'active' }>;
}) {
  const label = session.variant ? `Вариант ${session.variant.variantNumber}` : 'Тренировка';
  return (
    <Chip selected icon={session.variant ? 'variant' : 'smart'}>
      {label} · {session.position} из {session.total}
    </Chip>
  );
}
