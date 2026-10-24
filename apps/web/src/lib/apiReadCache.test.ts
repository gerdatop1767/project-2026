import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFavorite, getProgressSummary, getTaskCountsBySubject } from './api.js';
import { resetPrivateCaches } from './privateCaches.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function stub() {
  vi.stubGlobal('fetch', fetchMock);
}

describe('API read cache (dashboard reads shared across screen visits)', () => {
  it('serves a repeated read from memory and shares one in flight', async () => {
    stub();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ items: [] })));
    await Promise.all([getTaskCountsBySubject(), getTaskCountsBySubject()]);
    await getTaskCountsBySubject();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is cleared by any change the user makes (non-GET request)', async () => {
    stub();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).includes('/favorites')
          ? new Response(null, { status: 204 })
          : jsonResponse({ solvedTotal: 1 }),
      ),
    );
    await getProgressSummary();
    await addFavorite('t1');
    await getProgressSummary();
    const summaryCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/summary'));
    expect(summaryCalls).toHaveLength(2);
  });

  it('never keeps a failed read', async () => {
    stub();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500))
      .mockResolvedValueOnce(jsonResponse({ solvedTotal: 2 }));
    await expect(getProgressSummary()).rejects.toThrow();
    await expect(getProgressSummary()).resolves.toEqual({ solvedTotal: 2 });
  });

  it('is cleared when the account goes away', async () => {
    stub();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ solvedTotal: 3 })));
    await getProgressSummary();
    resetPrivateCaches();
    await getProgressSummary();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
