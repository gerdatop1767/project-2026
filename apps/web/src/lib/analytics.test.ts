import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushAnalytics,
  setAnalyticsEnabled,
  track,
  trackRoute,
  trackSubject,
} from './analytics.js';

describe('client analytics', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    setAnalyticsEnabled(true);
  });
  afterEach(() => {
    setAnalyticsEnabled(false);
    vi.unstubAllGlobals();
  });

  const sentBodies = () =>
    fetchMock.mock.calls.map((call) =>
      JSON.parse((call as unknown as [URL, RequestInit])[1].body as string),
    );

  it('batches events into one request with ids and types only', () => {
    track('visit');
    trackSubject('math');
    trackSubject('math'); // same subject again: not repeated
    trackRoute({ screen: 'task', subjectId: 'math', taskNumber: 5, taskId: 't-1' });
    trackRoute({ screen: 'task', subjectId: 'math', taskNumber: 5, taskId: 't-1' });
    flushAnalytics();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [body] = sentBodies();
    expect(body.client).toBe('web');
    expect(body.events.map((e: { type: string }) => e.type)).toEqual([
      'visit',
      'subject_selected',
      'task_started',
    ]);
    expect(body.events[2]).toMatchObject({ subjectId: 'math', taskId: 't-1' });
    for (const event of body.events) expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends nothing when disabled (the default in tests)', () => {
    setAnalyticsEnabled(false);
    track('visit');
    flushAnalytics();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the network fails', () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    track('visit');
    expect(() => flushAnalytics()).not.toThrow();
  });
});
