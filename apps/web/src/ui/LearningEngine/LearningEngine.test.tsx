import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeAuthUser, TestAuthProvider } from '../../lib/authTestUtils.js';
import { DifficultyRating } from './DifficultyRating.js';
import { SkillsPanel } from './SkillsPanel.js';

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
const skill = (over: Record<string, unknown>) => ({
  subjectId: 'math',
  title: 'T',
  part: 1,
  mastery: 0,
  confidence: 0,
  level: 'none',
  attempts: 0,
  correct: 0,
  incorrect: 0,
  lastAttemptAt: null,
  daysSince: null,
  trend: null,
  repeatedErrorTasks: 0,
  recoveredTasks: 0,
  recent: { attempts: 0, wrong: 0 },
  openMistakes: 0,
  stuckAfterExplanation: 0,
  myAverageRating: null,
  hardButCorrect: 0,
  availableTasks: 10,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('SkillsPanel', () => {
  it('shows percentages only with enough data; little data says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          hasProfile: true,
          subjects: [
            {
              subjectId: 'math',
              selected: true,
              targetScore: '80_plus',
              totals: { attempts: 9, correct: 6, solvedTasks: 6, accuracy: 67 },
              skills: [
                skill({
                  key: 'math.planimetry',
                  examNumber: 1,
                  title: 'Планиметрия',
                  level: 'strong',
                  mastery: 82,
                  attempts: 8,
                  correct: 7,
                  trend: 'up',
                }),
                skill({
                  key: 'math.vectors',
                  examNumber: 2,
                  title: 'Векторы',
                  level: 'low_data',
                  mastery: 60,
                  attempts: 1,
                  correct: 1,
                }),
                skill({ key: 'math.stereometry', examNumber: 3, title: 'Стереометрия' }),
              ],
            },
          ],
        }),
      ),
    );
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <SkillsPanel subjectId="math" />
      </TestAuthProvider>,
    );
    expect(await screen.findByText('82% ↑')).toBeInTheDocument();
    expect(screen.getByText('мало данных')).toBeInTheDocument();
    expect(screen.queryByText('60%')).not.toBeInTheDocument();
    expect(screen.getByText('не решал')).toBeInTheDocument();
    expect(screen.getByText('80+')).toBeInTheDocument();
  });
});

describe('DifficultyRating', () => {
  it('saves a 1–10 rating and shows the community value only when confident', async () => {
    const calls: { method: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined });
        if (init?.method === 'PUT') {
          return json({
            myRating: 7,
            community: { count: 6, used: 6, median: 8, confident: true, band: 'hard' },
          });
        }
        return json({
          myRating: null,
          community: { count: 2, used: 2, median: null, confident: false, band: null },
        });
      }),
    );
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <DifficultyRating taskId="t1" />
      </TestAuthProvider>,
    );
    expect(screen.getByText('Насколько сложным было это задание?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '7 из 10' }));
    expect(
      await screen.findByText(/Ученики оценивают задание как сложное: 8 из 10 \(6 оценок\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '7 из 10' })).toHaveAttribute('aria-checked', 'true');
    expect(calls.find((c) => c.method === 'PUT')!.body).toBe(JSON.stringify({ rating: 7 }));
  });

  it('is not shown to a guest', () => {
    render(
      <TestAuthProvider user={null}>
        <DifficultyRating taskId="t1" />
      </TestAuthProvider>,
    );
    expect(screen.queryByText('Насколько сложным было это задание?')).not.toBeInTheDocument();
  });
});
