import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeAuthUser, TestAuthProvider } from '../../lib/authTestUtils.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { LearningSessionProvider } from '../../lib/learningSessionContext.js';
import { AdviceScreen } from '../../screens/PersonalLearning/AdviceScreen.js';
import { PlanScreen } from '../../screens/PersonalLearning/PlanScreen.js';
import { SkillProgressScreen } from '../../screens/PersonalLearning/SkillProgressScreen.js';
import { adviceFixture, personalFixture, planFixture, progressFixture } from './fixtures.js';
import { HomeRecommendations, PersonalPlanBlock } from './PersonalPlanBlock.js';

type Handler = (url: string, init?: RequestInit) => unknown;

function stubApi(routes: Record<string, Handler>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, path] = pattern.split(' ');
      if (m === method && url.includes(path!)) {
        const data = handler(url, init);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{overlay ? JSON.stringify(overlay) : 'none'}</p>;
}

function renderWith(node: React.ReactNode, user = makeAuthUser()) {
  return render(
    <TestAuthProvider user={user}>
      <NavigationProvider>
        <LearningSessionProvider>
          {node}
          <OverlayMarker />
        </LearningSessionProvider>
      </NavigationProvider>
    </TestAuthProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('«Твой персональный план»', () => {
  it('header numbers, cards with the diagnosed problem, priority and honest progress', async () => {
    stubApi({ 'GET /me/learning/personal': () => personalFixture });
    renderWith(<PersonalPlanBlock limit={4} />);
    expect(await screen.findByText('Уравнения (развёрнутый ответ)')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('приоритетных тем')).toBeInTheDocument();
    expect(screen.getByText('до +4')).toBeInTheDocument();
    expect(screen.getByText(/≈ 7 дней/)).toBeInTheDocument();
    const cards = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-priority'));
    expect(cards).toHaveLength(3);
    const first = within(cards[0]!);
    expect(first.getByText('Вычислительные ошибки.')).toBeInTheDocument();
    expect(first.getByText('Приоритет: высокий')).toBeInTheDocument();
    expect(first.getByRole('img', { name: 'Освоение 41%' })).toBeInTheDocument();
    // Too little data: no bar, «мало данных».
    expect(within(cards[1]!).getByText('мало данных')).toBeInTheDocument();
    expect(within(cards[1]!).queryByRole('img')).not.toBeInTheDocument();
  });

  it('«Начать» starts a training of that number; «Подробнее» opens the advice', async () => {
    const calls = stubApi({
      'GET /me/learning/personal': () => personalFixture,
      'POST /me/learning/sessions': () => ({
        sessionId: 's1',
        subject: 'math',
        status: 'active',
        position: 1,
        total: 3,
        task: { id: 't1', subjectId: 'math', taskNumber: 13 },
      }),
    });
    const user = userEvent.setup();
    renderWith(<PersonalPlanBlock limit={4} />);
    await user.click(await screen.findByRole('button', { name: /Начать: Уравнения/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        subjectId: 'math',
        limit: 3,
        focusSkill: 'math.equations-advanced',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Подробный совет: Векторы' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('"screen":"skillAdvice"');
    expect(screen.getByTestId('overlay')).toHaveTextContent('math.vectors');
  });

  it('a guest is asked to sign in, nothing is requested', () => {
    const calls = stubApi({});
    renderWith(<PersonalPlanBlock />, null as unknown as ReturnType<typeof makeAuthUser>);
    expect(screen.getByText(/Войди, чтобы получать план/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('mobile home: at most two recommendations, plan progress, «Все рекомендации»', async () => {
    stubApi({
      'GET /me/learning/personal': () => ({
        ...personalFixture,
        summary: {
          ...personalFixture.summary,
          activePlan: { id: 'p', subjectId: 'math', kind: 'week', percent: 43, today: null },
        },
      }),
    });
    const user = userEvent.setup();
    renderWith(<HomeRecommendations />);
    expect(await screen.findByText('Уравнения (развёрнутый ответ)')).toBeInTheDocument();
    expect(screen.queryByText('Н и НН')).not.toBeInTheDocument();
    expect(screen.getByText('43%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Все рекомендации/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('"screen":"recommendations"');
  });
});

describe('advice, plan and progress screens', () => {
  it('advice: problem, evidence, steps, theory link, a gap of the base is admitted', async () => {
    stubApi({ 'GET /me/learning/skills/math.equations-advanced/advice': () => adviceFixture() });
    const user = userEvent.setup();
    renderWith(<AdviceScreen skillKey="math.equations-advanced" />);
    expect(
      await screen.findByRole('heading', { name: 'Вычислительные ошибки' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/почти совпадают с верным/)).toBeInTheDocument();
    expect(screen.getByText('Записывай промежуточные вычисления.')).toBeInTheDocument();
    expect(
      screen.getByText(/точного совета именно для этого номера в базе пока нет/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Открыть теорию №13' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('"screen":"theory"');
    expect(screen.getByTestId('overlay')).toHaveTextContent('"taskNumber":13');
  });

  it('plan: choose a week plan when there is none', async () => {
    const calls = stubApi({
      'GET /me/learning/plans/current': () => ({ plan: null }),
      'POST /me/learning/plans': () => ({ plan: planFixture() }),
    });
    const user = userEvent.setup();
    renderWith(<PlanScreen subjectId="math" />);
    await user.click(await screen.findByRole('button', { name: /План на 7 дней/ }));
    expect(await screen.findByRole('heading', { name: 'План на 7 дней' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      subjectId: 'math',
      kind: 'week',
    });
  });

  it('plan: real progress, today’s start, skip and move a day', async () => {
    const skipped = planFixture({
      days: planFixture().days.map((d) =>
        d.dayIndex === 1 ? { ...d, status: 'skipped', canSkip: false, canMove: false } : d,
      ),
      progress: { ...planFixture().progress, daysSkipped: 1 },
    });
    const calls = stubApi({
      'GET /me/learning/plans/current': () => ({ plan: planFixture() }),
      'POST /me/learning/plans/11111111-1111-4111-8111-111111111111/days/1/skip': () => ({
        plan: skipped,
      }),
    });
    const user = userEvent.setup();
    renderWith(<PlanScreen subjectId="math" />);
    expect(await screen.findByRole('progressbar', { name: 'Выполнение плана' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(screen.getByText('27')).toBeInTheDocument(); // tasks left
    const days = screen
      .getAllByRole('listitem')
      .filter((li) => /^День \d/.test(li.textContent ?? ''));
    expect(within(days[0]!).getByText('Решено 1 из 4 · уровень: средний')).toBeInTheDocument();
    expect(
      within(days[0]!).getByRole('button', { name: /Начать · 3 задания/ }),
    ).toBeInTheDocument();
    await user.click(within(days[1]!).getByRole('button', { name: 'Пропустить' }));
    await waitFor(() =>
      expect(
        within(
          screen.getAllByRole('listitem').filter((li) => /^День 2/.test(li.textContent ?? ''))[0]!,
        ).getByText('Пропущено тобой'),
      ).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/days/1/skip'))).toBe(true);
  });

  it('progress: no percentage on too little data; chart, dynamics, history', async () => {
    stubApi({ 'GET /me/learning/skills/math.vectors/progress': () => progressFixture() });
    renderWith(<SkillProgressScreen skillKey="math.vectors" />);
    expect(await screen.findByRole('heading', { name: 'Векторы' })).toBeInTheDocument();
    expect(screen.getAllByText('мало данных').length).toBeGreaterThan(0);
    // Mastery tile says «мало данных»; 100 % is the accuracy of one answer, labelled so.
    expect(screen.getByText('верных из 1 ответов')).toBeInTheDocument(); // accuracy, not mastery
    expect(screen.getByRole('img', { name: /Точность за 7 дней/ })).toBeInTheDocument();
    expect(screen.getAllByText('мало данных для сравнения')).toHaveLength(2);
    expect(screen.getByText('1 из 1 верно')).toBeInTheDocument();
    expect(screen.getByText(/Ближайшая цель — освоение 55%/)).toBeInTheDocument();
  });
});
