import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { recordTaskResult } from './sessionResults.js';
import { resetPrivateCaches } from './privateCaches.js';
import { useVariantTaskMarks } from './useVariantTaskMarks.js';

describe('useVariantTaskMarks outside a variant attempt', () => {
  it('marks only the answers actually checked in this visit, live', () => {
    resetPrivateCaches();
    const { result } = renderHook(() => useVariantTaskMarks(null, 'a', ['a', 'b', 'c', 'd']));
    expect(result.current).toEqual({});

    act(() => {
      recordTaskResult('b', true);
      recordTaskResult('c', false);
    });
    expect(result.current).toEqual({ b: 'correct', c: 'incorrect' });

    // The latest check wins: a fixed mistake shows as fixed.
    act(() => recordTaskResult('c', true));
    expect(result.current).toEqual({ b: 'correct', c: 'correct' });

    // Signing out forgets them.
    act(() => resetPrivateCaches());
    expect(result.current).toEqual({});
  });
});
