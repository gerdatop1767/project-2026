import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { VariantProgressItem } from '@zybrilka/shared';
import { NavigationProvider } from '../../lib/navigation.js';
import { VariantHistoryCard } from './VariantHistoryCard.js';

const base: VariantProgressItem = {
  sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
  variantId: 'bbbbbbbb-0000-4000-8000-000000000001',
  variantNumber: 1,
  variantTitle: 'ЕГЭ 2026 — Ященко, Вариант 1',
  subjectId: 'math',
  status: 'completed',
  startedAt: '2026-11-10T10:00:00.000Z',
  completedAt: '2026-11-10T11:00:00.000Z',
  plannedCount: 19,
  solvedCount: 14,
  correctCount: 12,
  incorrectCount: 2,
  accuracyPercent: 86,
  totalTimeMs: null,
  keyErrors: [],
};

const renderCard = (item: VariantProgressItem) =>
  render(
    <NavigationProvider>
      <VariantHistoryCard item={item} />
    </NavigationProvider>,
  );

describe('VariantHistoryCard — баллы ЕГЭ', () => {
  it('with a table: the test score and its table, primary points labelled apart', () => {
    renderCard({
      ...base,
      examScore: {
        primary: 14,
        examMaxTotal: 32,
        testScore: 74,
        scaleLabel: 'Тестовый балл · ориентир по шкале ЕГЭ-2026',
        scaleYear: 2026,
        noScaleReason: null,
        notGradedMax: 0,
        preliminary: false,
      },
    });
    expect(screen.getByText(/тестовых баллов/).closest('p')!).toHaveTextContent(
      '74 тестовых баллов · ориентир по шкале ЕГЭ-2026 · 14 из 32 первичных',
    );
  });

  it('without a table: only primary points, said to be primary — never as test points', () => {
    renderCard({
      ...base,
      examScore: {
        primary: 14,
        examMaxTotal: 33,
        testScore: null,
        scaleLabel: null,
        scaleYear: null,
        noScaleReason: 'Растягивать шкалу нельзя',
        notGradedMax: 0,
        preliminary: true,
      },
    });
    const line = screen.getByText(/из 33 первичных баллов/).closest('p')!;
    expect(line).toHaveTextContent('тестовый балл не считается');
    expect(line).toHaveTextContent('предварительно');
    expect(line).toHaveAttribute('title', 'Растягивать шкалу нельзя');
    expect(screen.queryByText(/тестовых баллов/)).not.toBeInTheDocument();
  });

  it('Russian: the result says the essay is not in it', () => {
    renderCard({
      ...base,
      subjectId: 'russian',
      examScore: {
        primary: 24,
        examMaxTotal: 50,
        testScore: 49,
        scaleLabel: 'Тестовый балл · ориентир по шкале ЕГЭ-2026',
        scaleYear: 2026,
        noScaleReason: null,
        notGradedMax: 22,
        preliminary: false,
      },
    });
    expect(screen.getByText(/тестовых баллов/).closest('p')!).toHaveTextContent(
      '49 тестовых баллов · ориентир по шкале ЕГЭ-2026 · 24 из 50 первичных · без сочинения',
    );
  });

  it('a variant without an exam format shows no ЕГЭ line', () => {
    renderCard({ ...base, examScore: null });
    expect(screen.queryByText(/первичн/)).not.toBeInTheDocument();
  });
});
