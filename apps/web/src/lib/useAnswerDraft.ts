import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, readDraft, saveDraft } from './answerDrafts.js';

/**
 * The task screen's answer fields, backed by `answerDrafts`: they start
 * from the draft left on this task and keep it up to date as the student
 * types. `discardDraft` once the answer has been checked.
 */
export function useAnswerDraft(taskId: string) {
  const [answer, setAnswer] = useState(() => {
    const draft = readDraft(taskId);
    return typeof draft === 'string' ? draft : '';
  });
  const [partAnswers, setPartAnswers] = useState<Record<string, string>>(() => {
    const draft = readDraft(taskId);
    return draft && typeof draft === 'object' ? { ...draft } : {};
  });
  const discarded = useRef(false);

  useEffect(() => {
    if (discarded.current) return;
    saveDraft(taskId, Object.keys(partAnswers).length > 0 ? partAnswers : answer);
  }, [taskId, answer, partAnswers]);

  const discardDraft = useCallback(() => {
    discarded.current = true;
    clearDraft(taskId);
  }, [taskId]);

  return { answer, setAnswer, partAnswers, setPartAnswers, discardDraft };
}
