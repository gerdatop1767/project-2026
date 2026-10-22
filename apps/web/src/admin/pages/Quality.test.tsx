import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRouter } from '../router.js';
import { QualityPage } from './Quality.js';

const period = {
  from: '2026-09-23',
  to: '2026-10-22',
  days: 30,
  granularity: 'day',
  timezone: 'Europe/Moscow',
  previous: { from: '2026-08-24', to: '2026-09-22' },
};

const thresholds = {
  minSample: 30,
  lowAccuracy: 0.15,
  accuracyDrop: 0.25,
  complaints: 2,
  abandonment: 0.6,
};

const report = {
  period,
  thresholds,
  counts: { low_accuracy: 1, missing_topic: 2 },
  totalFlagged: 2,
  items: [
    {
      id: 'aaaaaaaa-1111-4222-8333-444455556666',
      subjectId: 'math',
      taskNumber: 12,
      status: 'published',
      preview: 'Найдите наибольшее значение',
      attempts: 40,
      accuracy: 0.1,
      previousAccuracy: 0.3,
      openComplaints: 0,
      signals: [
        {
          type: 'low_accuracy',
          detail: 'Точность 10% при 40 ответах (порог 15%, выборка ≥ 30)',
        },
        { type: 'missing_topic', detail: 'Не указана тема' },
      ],
    },
    {
      id: 'bbbbbbbb-1111-4222-8333-444455556666',
      subjectId: 'russian',
      taskNumber: 3,
      status: 'needs_review',
      preview: 'Укажите варианты',
      attempts: 0,
      accuracy: null,
      previousAccuracy: null,
      openComplaints: 0,
      signals: [{ type: 'missing_topic', detail: 'Не указана тема' }],
    },
  ],
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <AdminRouter>
      <QualityPage />
    </AdminRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QualityPage', () => {
  it('renders thresholds, signal counts and flagged tasks with details', async () => {
    mockFetch(200, report);
    renderAt('/admin/quality');
    expect(
      await screen.findByText('Точность 10% при 40 ответах (порог 15%, выборка ≥ 30)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'aaaaaaaa' })).toHaveAttribute(
      'href',
      '/admin/content/tasks/aaaaaaaa-1111-4222-8333-444455556666?period=30d',
    );
    expect(screen.getByText('10% / 30%')).toBeInTheDocument();
    expect(screen.getByText('нет данных / нет данных')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Очень низкая точность · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Нет темы · 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Изменить →' })).toHaveAttribute(
      'href',
      '/admin/manage',
    );
    expect(screen.getByText(/Сигнал — повод проверить задание/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CSV' })).toHaveAttribute(
      'href',
      '/api/v1/admin/export/quality?period=30d',
    );
  });

  it('filters by signal type through the URL', async () => {
    mockFetch(200, report);
    const user = userEvent.setup();
    renderAt('/admin/quality');
    await user.click(await screen.findByRole('button', { name: 'Очень низкая точность · 1' }));
    expect(new URLSearchParams(window.location.search).get('signal')).toBe('low_accuracy');
    expect(screen.queryByRole('link', { name: 'bbbbbbbb' })).toBeNull();
    expect(screen.getByRole('link', { name: 'aaaaaaaa' })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockFetch(200, { period, thresholds, counts: {}, items: [], totalFlagged: 0 });
    renderAt('/admin/quality');
    expect(await screen.findByText('Задач, требующих внимания, нет')).toBeInTheDocument();
  });

  it('shows an error with retry on 500', async () => {
    mockFetch(500, { error: 'internal_error' });
    renderAt('/admin/quality');
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
