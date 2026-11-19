import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SEO_SETTINGS } from '@zybrilka/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../../router.js';
import { SeoAgentPage } from './Agent.js';
import { SeoArticlesPage } from './Articles.js';
import { SeoOverviewPage } from './Overview.js';
import { SeoIntegrationsPage } from './Sections.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const emptyKpis = {
  organicVisits: null,
  organicUsers: null,
  impressions: null,
  clicks: null,
  ctr: null,
  avgPosition: null,
  top3: null,
  top10: null,
  top50: null,
  publishedArticles: 0,
  externalPublished: 0,
  seoRegistrations: 0,
  organicGoalReaches: null,
  conversion: null,
};

describe('AI SEO Center UI', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('overview shows «no data» (never zeros) for unconnected sources and links to integrations', async () => {
    window.history.replaceState(null, '', '/admin/seo');
    fetchMock.mockImplementation(() =>
      json(200, {
        days: 30,
        current: emptyKpis,
        previous: emptyKpis,
        compare: {},
        totals: {
          publishedArticles: 3,
          externalPublished: 1,
          indexedPages: null,
          indexedArticles: null,
        },
        series: [
          {
            date: '2026-11-18',
            organic: null,
            published: 1,
            position: null,
            indexed: null,
            externalClicks: 2,
            registrations: 0,
            goals: null,
          },
        ],
        sources: {},
      }),
    );
    render(
      <AdminRouter>
        <SeoOverviewPage />
      </AdminRouter>,
    );
    expect(await screen.findByText('Органический трафик (визиты)')).toBeInTheDocument();
    expect(screen.getAllByText('Недостаточно данных').length).toBeGreaterThanOrEqual(8);
    expect(
      screen.getByText(/Не подключено: Яндекс Метрика, Яндекс Вебмастер, Google Search Console/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Подключить' })).toHaveAttribute(
      'href',
      '/admin/seo/integrations',
    );
    expect(screen.getByText('Нет данных — подключите Яндекс Метрику.')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/v1/admin/seo/overview?days=30');
  });

  it('agent page: emergency stop asks for confirmation and calls the API', async () => {
    window.history.replaceState(null, '', '/admin/seo/agent');
    fetchMock.mockImplementation((url: URL | string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/seo/agent/stop')) return json(200, { stopped: true, cancelled: 2 });
      if (u.includes('/seo/agent')) {
        return json(200, {
          settings: DEFAULT_SEO_SETTINGS,
          anthropicConfigured: false,
          status: {
            usage: {
              dayCost: 0.12,
              weekCost: 0.5,
              monthCost: 1.5,
              dayCalls: 3,
              monthCalls: 20,
              monthIn: 1000,
              monthOut: 500,
            },
            tasks: {
              queued: 1,
              running: 0,
              doneToday: 4,
              failedToday: 1,
              lastStarted: null,
              nextRun: '2026-11-19T10:00:00Z',
            },
            made: { articles: 2, posts: 1, topics: 10, keywords: 40 },
            heartbeat: null,
          },
          recentTasks: [],
        });
      }
      if (u.includes('/seo/usage')) return json(200, { byAgent: [], byDay: [] });
      if (u.includes('/seo/log')) return json(200, { items: [] });
      void init;
      return json(404, { error: 'not_found' });
    });
    render(
      <AdminRouter>
        <SeoAgentPage />
      </AdminRouter>,
    );
    expect(await screen.findByText('Выключен')).toBeInTheDocument();
    expect(screen.getByText(/Claude API не подключён/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Остановить всё' }));
    // The dialog's own confirm button (the second one with this name).
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Остановить всё' })).toHaveLength(2),
    );
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/seo/agent/stop'))).toBe(false);
    await userEvent.click(screen.getAllByRole('button', { name: 'Остановить всё' })[1]!);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).includes('/seo/agent/stop') && (i as RequestInit).method === 'POST',
        ),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/seo/agent/stop'))!;
    expect((call[1] as RequestInit).headers).toMatchObject({ 'x-zybrilka-admin': '1' });
  });

  it('articles list shows statuses and real metrics or dashes', async () => {
    window.history.replaceState(null, '', '/admin/seo/articles');
    fetchMock.mockImplementation(() =>
      json(200, {
        items: [
          {
            id: 'a1',
            title: 'Задание 13 ЕГЭ',
            slug: 'zadanie-13',
            url: 'https://zybrilka.ru/blog/zadanie-13',
            status: 'published',
            primaryKeyword: 'задание 13 егэ',
            secondaryKeywords: [],
            priority: 78,
            createdAt: '2026-11-01T10:00:00Z',
            publishedAt: '2026-11-02T10:00:00Z',
            scheduledFor: null,
            wordCount: 1500,
            metrics: {
              impressions: null,
              clicks: null,
              ctr: null,
              position: null,
              organicVisits: null,
              views: null,
              registrations: 3,
              ctaClicks: 10,
              seoScore: 42.5,
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
        counts: { published: 1 },
      }),
    );
    render(
      <AdminRouter>
        <SeoArticlesPage />
      </AdminRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Задание 13 ЕГЭ' })).toHaveAttribute(
      'href',
      '/admin/seo/articles/a1',
    );
    expect(screen.getAllByText('Опубликована').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('43')).toBeInTheDocument();
  });

  it('integrations never echo secrets and warn when the encryption key is missing', async () => {
    window.history.replaceState(null, '', '/admin/seo/integrations');
    fetchMock.mockImplementation(() =>
      json(200, {
        secretsKeyConfigured: false,
        items: [
          {
            kind: 'yandex_metrika',
            status: 'connected',
            config: { counterId: 114059780 },
            hasSecret: true,
            lastCheckAt: null,
            lastSyncAt: null,
            lastError: null,
          },
        ],
      }),
    );
    render(
      <AdminRouter>
        <SeoIntegrationsPage />
      </AdminRouter>,
    );
    expect(await screen.findByText('Яндекс Метрика')).toBeInTheDocument();
    expect(screen.getByText(/не задан SEO_SECRETS_KEY\. Сгенерируйте/)).toBeInTheDocument();
    expect(screen.getByText('(сохранён; введите новый, чтобы заменить)')).toBeInTheDocument();
    expect((screen.getByLabelText(/OAuth-токен Яндекса/) as HTMLInputElement).value).toBe('');
    expect(screen.getByDisplayValue('114059780')).toBeInTheDocument();
  });
});
