import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { BroadcastPage, BroadcastsPage } from './Broadcasts.js';

const ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const broadcast = {
  id: ID,
  status: 'draft',
  text: '<b>Привет!</b>\nНовые задания по математике',
  mediaMode: 'caption',
  createdAt: '2026-10-23 10:00:00+00',
  confirmedAt: null,
  startedAt: null,
  finishedAt: null,
  recipientsTotal: null as number | null,
  sentCount: 0,
  failedCount: 0,
  blockedCount: 0,
  testStatus: null,
  audience: null as Record<string, unknown> | null,
  stage: null as string | null,
  trackClicks: false,
  buttonText: null as string | null,
};
const TOTALS = {
  delivered: 0,
  deliveredToUsers: 0,
  clicked: 0,
  returned: 0,
  activeAfter: 0,
  solvedAfter: 0,
  conversionPercent: null,
};
const detail = (patch: Partial<typeof broadcast> = {}, extra: object = {}) => ({
  broadcast: { ...broadcast, ...patch },
  attachments: [],
  validation: { ok: true, parts: [{ kind: 'text' }] },
  recipientsEstimate: 1234,
  audiencePreview: null,
  reaction: null,
  deliveries: [],
  ...extra,
});

type Handler = (url: URL, init: RequestInit) => [number, unknown];
function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const [status, body] = handler(new URL(String(input)), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const posts = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls
    .filter(([, i]) => i?.method === 'POST')
    .map(([u, i]) => [new URL(String(u)).pathname, i?.body ? JSON.parse(String(i.body)) : null]);

function renderAt(path: string, ui: React.ReactNode) {
  window.history.replaceState(null, '', path);
  return render(<AdminRouter>{ui}</AdminRouter>);
}

afterEach(() => vi.unstubAllGlobals());

describe('BroadcastsPage', () => {
  it('lists past broadcasts with their results and the current audience', async () => {
    mockFetch(() => [
      200,
      {
        recipientsEstimate: 1234,
        totals: TOTALS,
        items: [
          {
            ...broadcast,
            status: 'completed_with_errors',
            recipientsTotal: 10,
            sentCount: 8,
            failedCount: 1,
            blockedCount: 1,
            attachments: 1,
            targeted: false,
            authorName: 'Владелец',
            reaction: null,
          },
        ],
      },
    ]);
    renderAt('/admin/broadcasts', <BroadcastsPage />);
    expect(await screen.findByText('Завершена с ошибками')).toBeInTheDocument();
    expect(screen.getByText('1 234')).toBeInTheDocument();
    expect(screen.getByText(/только те, кто сам запускал бота/)).toBeInTheDocument();
  });

  it('explains a zero audience: the bot does not read /start while polling is off', async () => {
    mockFetch(() => [
      200,
      {
        recipientsEstimate: 0,
        totals: TOTALS,
        items: [],
        worker: {
          at: new Date().toISOString(),
          botConfigured: true,
          polling: false,
          healthCheck: true,
          owners: 1,
          stale: false,
        },
      },
    ]);
    renderAt('/admin/broadcasts', <BroadcastsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('TELEGRAM_BOT_POLLING выключен');
  });

  it('shows an empty state', async () => {
    mockFetch(() => [200, { recipientsEstimate: 0, totals: TOTALS, items: [] }]);
    renderAt('/admin/broadcasts', <BroadcastsPage />);
    expect(await screen.findByText(/Рассылок пока не было/)).toBeInTheDocument();
  });
});

describe('BroadcastPage', () => {
  it('a draft: edit, preview the formatting, save — nothing is sent', async () => {
    const fetch = mockFetch((_u, init) => [200, init.method === 'PATCH' ? detail() : detail()]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    const preview = await screen.findByLabelText('Предпросмотр сообщения');
    expect(within(preview).getByText('Привет!').tagName).toBe('STRONG');
    const box = screen.getByLabelText('Текст');
    fireEvent.change(box, { target: { value: 'Новый <i>текст</i>' } });
    // Unsaved: the send steps wait for the save.
    expect(screen.getByRole('button', { name: 'Перейти к отправке…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(fetch.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const patch = fetch.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({
      text: 'Новый <i>текст</i>',
      mediaMode: 'caption',
    });
    expect(posts(fetch).some(([p]) => String(p).endsWith('/confirm'))).toBe(false);
  });

  it('shows why the text cannot be sent', async () => {
    mockFetch(() => [200, detail()]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    fireEvent.change(await screen.findByLabelText('Текст'), {
      target: { value: '<script>x</script>' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('не поддерживает');
  });

  it('awaiting confirmation: warns about everyone, and sends only after the dialog', async () => {
    const fetch = mockFetch((_u, init) => [
      200,
      detail({ status: init.method === 'POST' ? 'sending' : 'awaiting_confirmation' }),
    ]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    const warning = (await screen.findByText(/все доступные подписчики бота/)).closest('p')!;
    expect(warning).toHaveTextContent('сейчас их 1 234');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отправку' }));
    expect(posts(fetch)).toHaveLength(0); // the dialog asks first
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Отправить 1\s234 получателям$/ }));
    await waitFor(() =>
      expect(posts(fetch)).toEqual([[`/api/v1/admin/broadcasts/${ID}/confirm`, { confirm: true }]]),
    );
  });

  it('cancelling in the dialog sends nothing', async () => {
    const fetch = mockFetch(() => [200, detail({ status: 'awaiting_confirmation' })]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить отправку' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(posts(fetch)).toHaveLength(0);
  });

  it('sending: shows progress and can be stopped', async () => {
    const fetch = mockFetch(() => [
      200,
      detail(
        { status: 'sending', recipientsTotal: 100, sentCount: 40, failedCount: 2, blockedCount: 3 },
        {
          deliveries: [
            { status: 'failed', errorCode: 'network', errorDetail: 'ENETUNREACH', n: 2 },
            { status: 'failed', errorCode: 'network_uncertain', errorDetail: 'ECONNRESET', n: 1 },
          ],
        },
      ),
    ]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    expect(await screen.findByRole('progressbar', { name: 'Прогресс рассылки' })).toHaveAttribute(
      'value',
      '45',
    );
    const errors = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(errors).toContain(
      'ошибка: сеть / Telegram недоступен (сообщение не ушло) ENETUNREACH — 2',
    );
    expect(errors).toContain(
      'ошибка: связь оборвалась после отправки — могло дойти; повторно не отправлялось, чтобы не было дубля ECONNRESET — 1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Остановить рассылку' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Остановить' }));
    await waitFor(() =>
      expect(posts(fetch)).toEqual([[`/api/v1/admin/broadcasts/${ID}/cancel`, {}]]),
    );
  });
});

describe('«Возврат пользователей»', () => {
  const PREVIEW = {
    count: 2,
    leftOut: { noBotChat: 3, notificationsOff: 1, stageAlreadySent: 4, excludedByHand: 0 },
    sample: [
      {
        id: 'u-1',
        name: 'Аня',
        registeredAt: '2026-10-30 10:00:00+00',
        lastActiveAt: null,
        solved: 0,
      },
      {
        id: 'u-2',
        name: null,
        registeredAt: '2026-10-31 10:00:00+00',
        lastActiveAt: '2026-11-01 08:00:00+00',
        solved: 5,
      },
    ],
    excluded: [],
  };

  it('a stage preset fills the filters, shows the count, the reasons and the list; exclusions and save', async () => {
    const fn = mockFetch((url, init) => {
      if (url.pathname.endsWith('/audience/preview')) {
        const body = JSON.parse(String(init.body));
        const out = body.audience.excludeUserIds ?? [];
        return [
          200,
          {
            ...PREVIEW,
            count: 2 - out.length,
            sample: PREVIEW.sample.filter((u) => !out.includes(u.id)),
            excluded: PREVIEW.sample.filter((u) => out.includes(u.id)),
            leftOut: { ...PREVIEW.leftOut, excludedByHand: out.length },
          },
        ];
      }
      return [200, detail()];
    });
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Возврат пользователей' }));
    fireEvent.click(screen.getByRole('button', { name: '3 дня после регистрации' }));
    expect(screen.getByLabelText('Аккаунту дней: от')).toHaveValue(3);
    expect(screen.getByLabelText('Аккаунту дней: до')).toHaveValue(6);
    expect(await screen.findByText(/Получат сейчас/)).toHaveTextContent('2');
    expect(screen.getByText(/уже получали этот этап: 4/)).toBeInTheDocument();
    expect(screen.getByText(/отключили уведомления: 1/)).toBeInTheDocument();
    const lastPreview = () =>
      posts(fn)
        .filter(([p]) => String(p).endsWith('/audience/preview'))
        .at(-1)![1];
    expect(lastPreview().audience).toMatchObject({
      stage: 'd3',
      accountAgeMinDays: 3,
      accountAgeMaxDays: 6,
    });

    fireEvent.click(
      within(screen.getByRole('table', { name: 'Получатели' })).getAllByRole('button', {
        name: 'Исключить',
      })[0]!,
    );
    await waitFor(() => expect(screen.getByText(/Получат сейчас/)).toHaveTextContent('1'));
    expect(lastPreview().audience.excludeUserIds).toEqual(['u-1']);
    expect(screen.getByRole('table', { name: 'Исключены вручную' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Кнопка со ссылкой/));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить аудиторию' }));
    await waitFor(() => {
      const patch = fn.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toMatchObject({
        audience: { stage: 'd3', excludeUserIds: ['u-1'] },
        trackClicks: true,
        buttonText: null,
      });
    });
    // Nothing was sent: no prepare / confirm.
    expect(posts(fn).some(([p]) => /prepare|confirm/.test(String(p)))).toBe(false);
  });

  it('confirmation names the filtered audience and who is left out', async () => {
    mockFetch(() => [
      200,
      detail(
        { status: 'awaiting_confirmation', audience: { stage: 'd7' }, stage: 'd7' },
        { audiencePreview: PREVIEW, recipientsEstimate: 2 },
      ),
    ]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    expect(await screen.findByText(/пользователи по выбранным фильтрам/)).toBeInTheDocument();
    expect(screen.getByText(/«7 дней после регистрации»/)).toBeInTheDocument();
    expect(screen.getByText(/уже получали этап — 4/)).toBeInTheDocument();
  });

  it('a sent broadcast shows the reaction, never «read»', async () => {
    mockFetch(() => [
      200,
      detail(
        {
          status: 'completed',
          recipientsTotal: 10,
          sentCount: 9,
          trackClicks: true,
          audience: { stage: 'd3' },
          stage: 'd3',
        },
        {
          reaction: {
            delivered: 9,
            deliveredToUsers: 9,
            clicked: 3,
            returned: 4,
            returned1d: 2,
            activeAfter: 3,
            answersAfter: 40,
            solvedAfter: 12,
            conversionPercent: 44.4,
          },
        },
      ),
    ]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    expect(await screen.findByText('Перешли по кнопке')).toBeInTheDocument();
    expect(screen.getByText('конверсия 44,4%')).toBeInTheDocument();
    expect(screen.getByText(/прочитал ли его человек, Telegram не сообщает/)).toBeInTheDocument();
    expect(screen.queryByText(/^Прочитали/)).not.toBeInTheDocument();
  });
});
