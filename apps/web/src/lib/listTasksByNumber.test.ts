import { afterEach, describe, expect, it, vi } from 'vitest';
import { listTasksByNumber } from './api.js';

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function task(i: number) {
  return { id: `task-${i}`, subjectId: 'math', taskNumber: 20 };
}

describe('listTasksByNumber', () => {
  it('returns every copy of the number, not just the first API page (ЕГЭ 2027: 25 variants)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const all = Array.from({ length: 25 }, (_, i) => task(i + 1));
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input), 'http://x');
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const items = all.slice(start, start + Math.min(limit, 10)); // a server page of 10
      const next = start + items.length < all.length ? String(start + items.length) : null;
      return Promise.resolve(
        new Response(JSON.stringify({ items, nextCursor: next }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const items = await listTasksByNumber('math', 20, 'ege-2027-yashchenko');
    expect(items.map((t) => t.id)).toEqual(all.map((t) => t.id));
    const first = new URL(String(fetchMock.mock.calls[0]![0]), 'http://x');
    expect(first.searchParams.get('collection')).toBe('ege-2027-yashchenko');
    expect(first.searchParams.get('limit')).toBe('100');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('an empty result is one request and an empty list', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await listTasksByNumber('math', 20, 'empty')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
