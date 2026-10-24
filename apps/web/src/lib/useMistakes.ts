import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Mistake } from '../data/sampleMistakes.js';
import { subjects } from '../data/subjects.js';
import { dismissMistake, getMistakes, restoreMistake } from './api.js';
import { toSampleMistake } from './mistakeAdapter.js';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * «Мои ошибки» data for both the mobile and desktop screens: the user's
 * real mistakes (GET /mistakes, every subject at once), the subject the
 * screen is showing, and the reversible «Убрать из ошибок» action.
 *
 * The subject filter is applied here, synchronously, to the one list the
 * screen renders — header, stats, tabs and cards all read `mistakes`
 * below, so switching subject can never leave the old subject's cards
 * under the new subject's name (the bug this replaces: the subject was
 * hard-coded on mobile and never applied on desktop).
 *
 * Until the user picks a subject: math if it has mistakes, otherwise the
 * subject with the most of them (so the screen doesn't open on an empty
 * subject while others are full).
 */
export function useMistakes() {
  const [all, setAll] = useState<readonly Mistake[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [nonce, setNonce] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getMistakes()
      .then((items) => {
        if (cancelled) return;
        setAll(items.map(toSampleMistake));
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const countsBySubject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of all) counts.set(m.subjectId, (counts.get(m.subjectId) ?? 0) + 1);
    return counts;
  }, [all]);

  const subjectId = picked ?? defaultSubject(countsBySubject);
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0]!;
  const mistakes = useMemo(() => all.filter((m) => m.subjectId === subjectId), [all, subjectId]);

  const reload = useCallback(() => {
    setState('loading');
    setNonce((n) => n + 1);
  }, []);

  /** Resolves true only once the server confirmed it; the card leaves the
   * list after that, never before (no false «убрано» on a failed call). A
   * second tap while the request runs is ignored. */
  const dismiss = useCallback(
    async (id: string): Promise<boolean> => {
      if (pending.has(id)) return false;
      setPending((prev) => new Set(prev).add(id));
      try {
        await dismissMistake(id);
        setAll((prev) => prev.filter((m) => m.id !== id));
        return true;
      } catch {
        return false;
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [pending],
  );

  /** The «Вернуть» undo: restores on the server, then re-reads the list so
   * the card comes back in its real place and state. */
  const restore = useCallback(async (id: string): Promise<boolean> => {
    try {
      await restoreMistake(id);
      setNonce((n) => n + 1);
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    state,
    reload,
    subject,
    subjectId,
    selectSubject: setPicked,
    countsBySubject,
    mistakes,
    dismiss,
    restore,
    isPending: (id: string) => pending.has(id),
  };
}

function defaultSubject(counts: ReadonlyMap<string, number>): string {
  if ((counts.get('math') ?? 0) > 0 || counts.size === 0) return 'math';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
