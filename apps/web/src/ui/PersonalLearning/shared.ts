import { useCallback, useState } from 'react';
import type { IconName } from '../Icon/icons.js';
import { startLearningSession } from '../../lib/api.js';
import {
  applyLearningSessionResponse,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import { useNavigation } from '../../lib/navigation.js';

export const SUBJECT_NAMES: Readonly<Record<string, string>> = {
  math: 'Математика',
  russian: 'Русский язык',
};

/** An icon for an EGE topic — a visual hint only. */
export function skillIcon(skillKey: string): IconName {
  if (skillKey.startsWith('russian.')) {
    if (/2[2-6]|0[23]-|text/.test(skillKey)) return 'reference';
    return 'notes';
  }
  if (/equations|inequalities|expressions/.test(skillKey)) return 'topicEquations';
  if (/stereometry/.test(skillKey)) return 'topicStereometry';
  if (/planimetry|vectors/.test(skillKey)) return 'topicPlanimetry';
  if (/probability|random/.test(skillKey)) return 'topicProbability';
  if (/derivative|function/.test(skillKey)) return 'topicFunctions';
  if (/finance|word-problems|applied/.test(skillKey)) return 'calculator';
  return 'target';
}

export function tasksWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} задание`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} задания`;
  return `${n} заданий`;
}

export function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/** «16 ноября, пн». */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Starts a smart training of exactly one EGE number (a recommendation's or a
 * plan day's «Начать»); `starting` is the key in flight.
 */
export function useStartSkillTraining() {
  const { navigate } = useNavigation();
  const { setSession } = useLearningSessionContext();
  const [starting, setStarting] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const start = useCallback(
    async (p: {
      key: string;
      subjectId: string;
      skillKey: string;
      tasks: number;
      difficulty?: 1 | 2 | 3;
    }) => {
      setStarting(p.key);
      setFailed(false);
      try {
        const response = await startLearningSession({
          subjectId: p.subjectId,
          limit: Math.min(10, Math.max(1, p.tasks)),
          focusSkill: p.skillKey,
          ...(p.difficulty ? { difficulty: p.difficulty } : {}),
        });
        applyLearningSessionResponse(response, setSession, navigate);
      } catch {
        setFailed(true);
      } finally {
        setStarting(null);
      }
    },
    [navigate, setSession],
  );
  return { start, starting, failed };
}
